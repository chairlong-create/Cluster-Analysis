"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { getAppSettings, saveAppSettings } from "@/lib/app-config";
import {
  applyCategoryMergeSuggestions,
  discardCategoryMergeSuggestions,
  generateCategoryMergeSuggestions,
} from "@/lib/category-merge-service";
import { db } from "@/lib/db";
import { getPromptSettings, savePromptSettings } from "@/lib/prompt-config";
import {
  confirmClusterSuggestions,
  discardClusterSuggestions,
  generateClusterSuggestions,
} from "@/lib/clustering-service";
import { runBatchClassification } from "@/lib/classification-service";
import { runReasonExtraction } from "@/lib/extraction-service";
import { importBatchesFromFormData } from "@/lib/import-service";
import { iterateOtherDialogs } from "@/lib/iterate-others-service";
import { getCurrentUser, assertTaskOwnership } from "@/lib/current-user";

const createTaskSchema = z.object({
  name: z.string().trim().min(1, "任务名称不能为空").max(100, "任务名称过长"),
  description: z.string().trim().max(500, "任务说明过长").optional(),
  analysisGoal: z.string().trim().min(1, "分析目标不能为空").max(200, "分析目标过长"),
});

const createCategorySchema = z.object({
  taskId: z.string().trim().min(1, "任务不存在"),
  name: z.string().trim().min(1, "类别名称不能为空").max(60, "类别名称过长"),
  definition: z.string().trim().min(1, "类别定义不能为空").max(300, "类别定义过长"),
});

const updateCategorySchema = createCategorySchema.extend({
  categoryId: z.string().trim().min(1, "类别不存在"),
});

const deleteCategorySchema = z.object({
  taskId: z.string().trim().min(1, "任务不存在"),
  categoryId: z.string().trim().min(1, "类别不存在"),
});

const extractReasonsSchema = z.object({
  taskId: z.string().trim().min(1, "任务不存在"),
  batchId: z.string().trim().min(1, "批次不存在"),
});

const clusterReasonsSchema = z.object({
  taskId: z.string().trim().min(1, "任务不存在"),
  batchId: z.string().trim().min(1, "批次不存在"),
});

const classifyBatchSchema = z.object({
  taskId: z.string().trim().min(1, "任务不存在"),
  batchId: z.string().trim().min(1, "批次不存在"),
});

const iterateOthersSchema = z.object({
  taskId: z.string().trim().min(1, "任务不存在"),
  batchId: z.string().trim().min(1, "批次不存在"),
});

const appSettingsSchema = z.object({
  llmApiKey: z.string().trim(),
  llmBaseUrl: z.string().trim().url("接口地址格式不正确"),
  llmModel: z.string().trim().min(1, "模型名称不能为空").max(120, "模型名称过长"),
  extractionConcurrency: z.coerce.number().int().min(1, "提取并发至少为 1").max(50, "提取并发不能超过 50"),
  classifyConcurrency: z.coerce.number().int().min(1, "分类并发至少为 1").max(50, "分类并发不能超过 50"),
});

const deleteTaskSchema = z.object({
  taskId: z.string().trim().min(1, "任务不存在"),
});

const updateBatchWorkflowModeSchema = z.object({
  taskId: z.string().trim().min(1, "任务不存在"),
  batchId: z.string().trim().min(1, "批次不存在"),
  workflowMode: z.enum(["seed", "classify_only"]),
});

const categoryMergeSchema = z.object({
  taskId: z.string().trim().min(1, "任务不存在"),
  maxTargetCount: z.coerce.number().int().min(1, "最大合并后类别数至少为 1").max(50, "最大合并后类别数不能超过 50"),
});

const categoryMergeApplySchema = z.object({
  taskId: z.string().trim().min(1, "任务不存在"),
  mergeRunId: z.string().trim().min(1, "合并建议不存在"),
});

const promptSettingsSchema = z.object({
  extractionSystemPrompt: z.string().trim().min(1, "提取 system prompt 不能为空"),
  clusteringSystemPrompt: z.string().trim().min(1, "聚类 system prompt 不能为空"),
  classificationSystemPrompt: z.string().trim().min(1, "分类 system prompt 不能为空"),
  categoryMergeSystemPrompt: z.string().trim().min(1, "合并 system prompt 不能为空"),
});

type InlineCategoryResult =
  | { ok: true }
  | {
      ok: false;
      error: string;
    };

type CategoryRemovalOutcome =
  | {
      ok: true;
      mode: "deleted";
      affectedCount: number;
    }
  | {
      ok: true;
      mode: "recycled_to_other";
      affectedCount: number;
    }
  | {
      ok: false;
      error: string;
    };

function mapCategoryMutationError(error: unknown) {
  if (error instanceof Error) {
    if (error.message.includes("UNIQUE constraint failed")) {
      return "类别名称已存在，请换一个名称。";
    }

    return error.message;
  }

  return "类别操作失败";
}

function removeCategoryWithFallbackToOther(taskId: string, categoryId: string): CategoryRemovalOutcome {
  const category = db
    .prepare(`
      SELECT id, name, is_other AS isOther
      FROM categories
      WHERE id = ? AND task_id = ?
    `)
    .get(categoryId, taskId) as { id: string; name: string; isOther: number } | undefined;

  if (!category) {
    return {
      ok: false,
      error: "类别不存在",
    };
  }

  if (category.isOther) {
    return {
      ok: false,
      error: '系统保留类别"其他"不能删除',
    };
  }

  const hitCountRow = db
    .prepare(`SELECT COUNT(*) AS count FROM dialog_analysis_results WHERE task_id = ? AND category_id = ?`)
    .get(taskId, categoryId) as { count: number };

  const affectedCount = hitCountRow.count;
  const now = new Date().toISOString();

  try {
    if (affectedCount === 0) {
      db.transaction(() => {
        db.prepare(`DELETE FROM categories WHERE id = ?`).run(categoryId);
        db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(now, taskId);
      })();

      return {
        ok: true,
        mode: "deleted",
        affectedCount: 0,
      };
    }

    const otherCategory = db
      .prepare(`
        SELECT id, name
        FROM categories
        WHERE task_id = ? AND is_other = 1 AND status = 'active'
        LIMIT 1
      `)
      .get(taskId) as { id: string; name: string } | undefined;

    if (!otherCategory) {
      return {
        ok: false,
        error: '当前任务缺少系统类别"其他"，无法执行拆解回流',
      };
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE dialog_analysis_results
        SET
          category_id = @otherCategoryId,
          category_name_snapshot = @otherCategoryName,
          result_status = 'classified_other',
          updated_at = @updatedAt
        WHERE task_id = @taskId AND category_id = @categoryId
      `).run({
        otherCategoryId: otherCategory.id,
        otherCategoryName: otherCategory.name,
        updatedAt: now,
        taskId,
        categoryId,
      });

      db.prepare(`
        UPDATE categories
        SET status = 'inactive', updated_by = 'human', updated_at = @updatedAt
        WHERE id = @categoryId
      `).run({
        updatedAt: now,
        categoryId,
      });

      db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(now, taskId);
    })();

    return {
      ok: true,
      mode: "recycled_to_other",
      affectedCount,
    };
  } catch (error) {
    return {
      ok: false,
      error: mapCategoryMutationError(error),
    };
  }
}

export async function createTaskAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = createTaskSchema.safeParse({
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    analysisGoal: formData.get("analysisGoal") || "分析对话中的关键模式",
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "任务创建失败");
  }

  const now = new Date().toISOString();
  const taskId = randomUUID();

  const insertTask = db.prepare(`
    INSERT INTO tasks (
      id, name, description, llm_provider, analysis_goal, analysis_focus_label, user_id, created_at, updated_at
    )
    VALUES (
      @id, @name, @description, 'OpenAI-compatible', @analysisGoal, @analysisFocusLabel, @userId, @createdAt, @updatedAt
    )
  `);
  const insertCategory = db.prepare(`
    INSERT INTO categories (
      id, task_id, name, definition, status, created_from_round, is_other, updated_by, created_at, updated_at
    ) VALUES (
      @id, @taskId, '其他', '当前类别表无法稳定匹配的分析信号。', 'active', 0, 1, 'system', @createdAt, @updatedAt
    )
  `);

  const transaction = db.transaction(() => {
    insertTask.run({
      id: taskId,
      name: parsed.data.name,
      description: parsed.data.description || null,
      analysisGoal: parsed.data.analysisGoal,
      analysisFocusLabel: "信号",
      userId,
      createdAt: now,
      updatedAt: now,
    });

    insertCategory.run({
      id: randomUUID(),
      taskId,
      createdAt: now,
      updatedAt: now,
    });
  });

  transaction();

  redirect(`/tasks/${taskId}`);
}

export async function createCategoryAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = createCategorySchema.safeParse({
    taskId: formData.get("taskId"),
    name: formData.get("name"),
    definition: formData.get("definition"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "类别创建失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);

  db.prepare(`
    INSERT INTO categories (
      id, task_id, name, definition, status, created_from_round, is_other, updated_by, created_at, updated_at
    ) VALUES (
      @id, @taskId, @name, @definition, 'active', 0, 0, 'human', @createdAt, @updatedAt
    )
  `).run({
    id: randomUUID(),
    taskId: parsed.data.taskId,
    name: parsed.data.name,
    definition: parsed.data.definition,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });

  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function updateCategoryAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = updateCategorySchema.safeParse({
    taskId: formData.get("taskId"),
    categoryId: formData.get("categoryId"),
    name: formData.get("name"),
    definition: formData.get("definition"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "类别更新失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);

  const category = db
    .prepare(`SELECT is_other AS isOther FROM categories WHERE id = ?`)
    .get(parsed.data.categoryId) as { isOther: number } | undefined;

  if (!category) {
    throw new Error("类别不存在");
  }

  if (category.isOther) {
    throw new Error('系统保留类别"其他"不能编辑');
  }

  db.prepare(`
    UPDATE categories
    SET name = @name, definition = @definition, updated_by = 'human', updated_at = @updatedAt
    WHERE id = @categoryId
  `).run({
    categoryId: parsed.data.categoryId,
    name: parsed.data.name,
    definition: parsed.data.definition,
    updatedAt: new Date().toISOString(),
  });

  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function deleteCategoryAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = deleteCategorySchema.safeParse({
    taskId: formData.get("taskId"),
    categoryId: formData.get("categoryId"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "类别删除失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);

  const result = removeCategoryWithFallbackToOther(parsed.data.taskId, parsed.data.categoryId);

  if (!result.ok) {
    throw new Error(result.error);
  }

  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function createCategoryInlineAction(input: {
  taskId: string;
  name: string;
  definition: string;
}): Promise<InlineCategoryResult> {
  const { userId } = await getCurrentUser();

  const parsed = createCategorySchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "类别创建失败",
    };
  }

  try {
    assertTaskOwnership(parsed.data.taskId, userId);

    db.prepare(`
      INSERT INTO categories (
        id, task_id, name, definition, status, created_from_round, is_other, updated_by, created_at, updated_at
      ) VALUES (
        @id, @taskId, @name, @definition, 'active', 0, 0, 'human', @createdAt, @updatedAt
      )
    `).run({
      id: randomUUID(),
      taskId: parsed.data.taskId,
      name: parsed.data.name,
      definition: parsed.data.definition,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    revalidatePath(`/tasks/${parsed.data.taskId}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: mapCategoryMutationError(error),
    };
  }
}

export async function updateCategoryInlineAction(input: {
  taskId: string;
  categoryId: string;
  name: string;
  definition: string;
}): Promise<InlineCategoryResult> {
  const { userId } = await getCurrentUser();

  const parsed = updateCategorySchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "类别更新失败",
    };
  }

  assertTaskOwnership(parsed.data.taskId, userId);

  const category = db
    .prepare(`SELECT is_other AS isOther, name FROM categories WHERE id = ?`)
    .get(parsed.data.categoryId) as { isOther: number; name: string } | undefined;

  if (!category) {
    return {
      ok: false,
      error: "类别不存在",
    };
  }

  try {
    if (category.isOther) {
      db.prepare(`
        UPDATE categories
        SET definition = @definition, updated_by = 'human', updated_at = @updatedAt
        WHERE id = @categoryId
      `).run({
        categoryId: parsed.data.categoryId,
        definition: parsed.data.definition,
        updatedAt: new Date().toISOString(),
      });
    } else {
      db.prepare(`
        UPDATE categories
        SET name = @name, definition = @definition, updated_by = 'human', updated_at = @updatedAt
        WHERE id = @categoryId
      `).run({
        categoryId: parsed.data.categoryId,
        name: parsed.data.name,
        definition: parsed.data.definition,
        updatedAt: new Date().toISOString(),
      });
    }

    revalidatePath(`/tasks/${parsed.data.taskId}`);
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: mapCategoryMutationError(error),
    };
  }
}

export async function deleteCategoryInlineAction(input: {
  taskId: string;
  categoryId: string;
}): Promise<InlineCategoryResult> {
  const { userId } = await getCurrentUser();

  const parsed = deleteCategorySchema.safeParse(input);

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "类别删除失败",
    };
  }

  assertTaskOwnership(parsed.data.taskId, userId);

  const result = removeCategoryWithFallbackToOther(parsed.data.taskId, parsed.data.categoryId);

  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
    };
  }

  revalidatePath(`/tasks/${parsed.data.taskId}`);
  return { ok: true };
}

export async function uploadBatchAction(formData: FormData) {
  const { userId } = await getCurrentUser();
  const taskId = formData.get("taskId") as string;
  if (taskId) assertTaskOwnership(taskId, userId);

  const result = await importBatchesFromFormData(formData);
  revalidatePath(`/tasks/${result.taskId}`);
}

export async function updateAppSettingsAction(formData: FormData) {
  const { userId } = await getCurrentUser();
  const current = getAppSettings(userId);
  const parsed = appSettingsSchema.safeParse({
    llmApiKey: formData.get("llmApiKey") ?? "",
    llmBaseUrl: formData.get("llmBaseUrl") ?? current.llmBaseUrl,
    llmModel: formData.get("llmModel") ?? current.llmModel,
    extractionConcurrency: formData.get("extractionConcurrency") ?? current.extractionConcurrency,
    classifyConcurrency: formData.get("classifyConcurrency") ?? current.classifyConcurrency,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "应用配置保存失败");
  }

  saveAppSettings(userId, parsed.data);
  redirect("/?settingsSaved=1");
}

export async function updatePromptSettingsAction(formData: FormData) {
  const { userId } = await getCurrentUser();
  const current = getPromptSettings(userId);
  const parsed = promptSettingsSchema.safeParse({
    extractionSystemPrompt: formData.get("extractionSystemPrompt") ?? current.extractionSystemPrompt,
    clusteringSystemPrompt: formData.get("clusteringSystemPrompt") ?? current.clusteringSystemPrompt,
    classificationSystemPrompt:
      formData.get("classificationSystemPrompt") ?? current.classificationSystemPrompt,
    categoryMergeSystemPrompt:
      formData.get("categoryMergeSystemPrompt") ?? current.categoryMergeSystemPrompt,
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Prompt 配置保存失败");
  }

  savePromptSettings(userId, parsed.data);
  redirect("/?promptSaved=1");
}

export async function deleteTaskAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = deleteTaskSchema.safeParse({
    taskId: formData.get("taskId"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "删除任务失败");
  }

  const task = db.prepare(`SELECT id FROM tasks WHERE id = ? AND user_id = ?`).get(parsed.data.taskId, userId) as { id: string } | undefined;
  if (!task) {
    throw new Error("任务不存在");
  }

  db.prepare(`DELETE FROM tasks WHERE id = ?`).run(parsed.data.taskId);
  revalidatePath("/");
}

export async function updateBatchWorkflowModeAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = updateBatchWorkflowModeSchema.safeParse({
    taskId: formData.get("taskId"),
    batchId: formData.get("batchId"),
    workflowMode: formData.get("workflowMode"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "更新批次用途失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);

  const batch = db
    .prepare(`SELECT id FROM batches WHERE id = ? AND task_id = ?`)
    .get(parsed.data.batchId, parsed.data.taskId) as { id: string } | undefined;

  if (!batch) {
    throw new Error("批次不存在");
  }

  db.prepare(`
    UPDATE batches
    SET workflow_mode = ?, updated_at = ?
    WHERE id = ? AND task_id = ?
  `).run(parsed.data.workflowMode, new Date().toISOString(), parsed.data.batchId, parsed.data.taskId);

  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function generateCategoryMergeSuggestionsAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = categoryMergeSchema.safeParse({
    taskId: formData.get("taskId"),
    maxTargetCount: formData.get("maxTargetCount"),
  });

  if (!parsed.success) {
    redirect(
      `/tasks/${String(formData.get("taskId") ?? "")}?tab=convergence&mergeError=${encodeURIComponent(parsed.error.issues[0]?.message ?? "生成类别合并建议失败")}`,
    );
  }

  assertTaskOwnership(parsed.data.taskId, userId);
  const settings = getAppSettings(userId);
  const promptSettingsData = getPromptSettings(userId);

  try {
    await generateCategoryMergeSuggestions(parsed.data.taskId, parsed.data.maxTargetCount, settings, promptSettingsData);
  } catch (error) {
    const message = error instanceof Error ? error.message : "生成类别合并建议失败";
    redirect(`/tasks/${parsed.data.taskId}?tab=convergence&mergeError=${encodeURIComponent(message)}`);
  }

  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function applyCategoryMergeSuggestionsAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = categoryMergeApplySchema.safeParse({
    taskId: formData.get("taskId"),
    mergeRunId: formData.get("mergeRunId"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "应用类别合并建议失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);

  await applyCategoryMergeSuggestions(parsed.data.taskId, parsed.data.mergeRunId);
  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function discardCategoryMergeSuggestionsAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = categoryMergeApplySchema.safeParse({
    taskId: formData.get("taskId"),
    mergeRunId: formData.get("mergeRunId"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "丢弃类别合并建议失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);

  await discardCategoryMergeSuggestions(parsed.data.taskId, parsed.data.mergeRunId);
  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function extractReasonsAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = extractReasonsSchema.safeParse({
    taskId: formData.get("taskId"),
    batchId: formData.get("batchId"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "信号提取启动失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);
  const settings = getAppSettings(userId);
  const promptSettingsData = getPromptSettings(userId);

  await runReasonExtraction(parsed.data.taskId, parsed.data.batchId, settings, promptSettingsData);
  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function generateClusterSuggestionsAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = clusterReasonsSchema.safeParse({
    taskId: formData.get("taskId"),
    batchId: formData.get("batchId"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "聚类建议生成失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);
  const settings = getAppSettings(userId);
  const promptSettingsData = getPromptSettings(userId);

  await generateClusterSuggestions(parsed.data.taskId, parsed.data.batchId, "cluster_reasons", undefined, settings, promptSettingsData);
  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function confirmClusterSuggestionsAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = clusterReasonsSchema.safeParse({
    taskId: formData.get("taskId"),
    batchId: formData.get("batchId"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "确认类别建议失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);

  await confirmClusterSuggestions(parsed.data.taskId, parsed.data.batchId);
  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function discardClusterSuggestionsAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = clusterReasonsSchema.safeParse({
    taskId: formData.get("taskId"),
    batchId: formData.get("batchId"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "废弃类别建议失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);

  await discardClusterSuggestions(parsed.data.taskId, parsed.data.batchId);
  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function classifyBatchAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = classifyBatchSchema.safeParse({
    taskId: formData.get("taskId"),
    batchId: formData.get("batchId"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "批量分类启动失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);
  const settings = getAppSettings(userId);
  const promptSettingsData = getPromptSettings(userId);

  await runBatchClassification(parsed.data.taskId, parsed.data.batchId, settings, promptSettingsData);
  revalidatePath(`/tasks/${parsed.data.taskId}`);
}

export async function iterateOthersAction(formData: FormData) {
  const { userId } = await getCurrentUser();

  const parsed = iterateOthersSchema.safeParse({
    taskId: formData.get("taskId"),
    batchId: formData.get("batchId"),
  });

  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "处理其他失败");
  }

  assertTaskOwnership(parsed.data.taskId, userId);
  const settings = getAppSettings(userId);
  const promptSettingsData = getPromptSettings(userId);

  await iterateOtherDialogs(parsed.data.taskId, parsed.data.batchId, settings, promptSettingsData);
  revalidatePath(`/tasks/${parsed.data.taskId}`);
}
