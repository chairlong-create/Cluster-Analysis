import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { mergeCategoriesWithMiniMax } from "@/lib/llm/category-merge";
import { failRunningStepRuns, failStepRun } from "@/lib/step-run-utils";

type ActiveCategory = {
  id: string;
  name: string;
  definition: string;
  hitCount: number;
};

function normalizeMergedCoverage(
  sourceCategories: ActiveCategory[],
  mergedCategories: Array<{ name: string; definition: string; sourceCategoryNames: string[] }>,
  maxTargetCount: number,
) {
  if (mergedCategories.length > maxTargetCount) {
    throw new Error("LLM 返回的合并后类别数超过设定上限");
  }

  const sourceNames = new Set(sourceCategories.map((category) => category.name));
  const coveredNames = new Set<string>();

  for (const category of mergedCategories) {
    for (const sourceName of category.sourceCategoryNames) {
      if (!sourceNames.has(sourceName)) {
        throw new Error(`LLM 返回了不存在的源类别：${sourceName}`);
      }

      if (coveredNames.has(sourceName)) {
        throw new Error(`LLM 重复映射了类别：${sourceName}`);
      }

      coveredNames.add(sourceName);
    }
  }

  const missingCategories = sourceCategories.filter((category) => !coveredNames.has(category.name));
  if (!missingCategories.length) {
    return {
      normalizedCategories: mergedCategories,
      missingCategoryNames: [] as string[],
    };
  }

  if (mergedCategories.length + missingCategories.length > maxTargetCount) {
    throw new Error(
      `LLM 未覆盖全部类别，且补齐后会超过设定上限：${missingCategories.map((category) => category.name).join("、")}`,
    );
  }

  return {
    normalizedCategories: [
      ...mergedCategories,
      ...missingCategories.map((category) => ({
        name: category.name,
        definition: category.definition,
        sourceCategoryNames: [category.name],
      })),
    ],
    missingCategoryNames: missingCategories.map((category) => category.name),
  };
}

export async function generateCategoryMergeSuggestions(taskId: string, maxTargetCount: number) {
  const sourceCategories = db
    .prepare(`
      SELECT
        c.id,
        c.name,
        c.definition,
        COUNT(r.id) AS hitCount
      FROM categories c
      LEFT JOIN dialog_analysis_results r ON r.category_id = c.id
      WHERE c.task_id = ? AND c.is_other = 0 AND c.status = 'active'
      GROUP BY c.id, c.name, c.definition
      ORDER BY hitCount DESC, c.created_at ASC
    `)
    .all(taskId) as ActiveCategory[];

  if (sourceCategories.length < 2) {
    throw new Error("当前可合并的活跃类别少于 2 个，无需执行近似类别合并");
  }

  if (maxTargetCount < 1) {
    throw new Error("最大合并后类别数至少为 1");
  }

  const latestRound = db
    .prepare(`
      SELECT COALESCE(MAX(round_no), 0) AS latestRound
      FROM step_runs
      WHERE task_id = ? AND batch_id IS NULL AND step_type = 'merge_categories'
    `)
    .get(taskId) as { latestRound: number };

  const now = new Date().toISOString();
  const stepRunId = randomUUID();

  failRunningStepRuns({
    taskId,
    batchId: null,
    stepType: "merge_categories",
  });

  db.prepare(`
    INSERT INTO step_runs (
      id, task_id, batch_id, step_type, round_no, status, input_count, success_count, failed_count, started_at
    ) VALUES (
      @id, @taskId, NULL, 'merge_categories', @roundNo, 'running', @inputCount, 0, 0, @startedAt
    )
  `).run({
    id: stepRunId,
    taskId,
    roundNo: latestRound.latestRound + 1,
    inputCount: sourceCategories.length,
    startedAt: now,
  });

  db.prepare(`
    UPDATE category_merge_suggestion_items
    SET status = 'discarded', updated_at = ?
    WHERE task_id = ? AND status = 'suggested'
  `).run(now, taskId);

  try {
    const response = await mergeCategoriesWithMiniMax(
      sourceCategories.map((category) => ({
        name: category.name,
        definition: category.definition,
        hitCount: category.hitCount,
      })),
      maxTargetCount,
    );

    const insertLog = db.prepare(`
    INSERT INTO llm_call_logs (
      id, task_id, step_run_id, dialog_id, call_type, provider, model, prompt_text, response_text, status, latency_ms, created_at
    ) VALUES (
      @id, @taskId, @stepRunId, NULL, 'merge_categories', @provider, @model, @promptText, @responseText, @status, @latencyMs, @createdAt
    )
  `);
    const insertRunItem = db.prepare(`
    INSERT INTO step_run_items (
      id, step_run_id, dialog_id, raw_output_json, parsed_status, error_message, created_at
    ) VALUES (
      @id, @stepRunId, NULL, @rawOutputJson, @parsedStatus, @errorMessage, @createdAt
    )
  `);

    if (response.log.status === "failed") {
      db.transaction(() => {
        insertRunItem.run({
          id: randomUUID(),
          stepRunId,
          rawOutputJson: JSON.stringify(response.mergedCategories),
          parsedStatus: "failed",
          errorMessage: response.log.responseText,
          createdAt: now,
        });

        insertLog.run({
          id: randomUUID(),
          taskId,
          stepRunId,
          provider: response.log.provider,
          model: response.log.model,
          promptText: response.log.promptText,
          responseText: response.log.responseText,
          status: response.log.status,
          latencyMs: response.log.latencyMs,
          createdAt: now,
        });

        db.prepare(`
          UPDATE step_runs
          SET status = 'failed', success_count = 0, failed_count = 1, finished_at = @finishedAt
          WHERE id = @id
        `).run({
          id: stepRunId,
          finishedAt: now,
        });
      })();

      throw new Error("生成类别合并建议失败，请查看日志里的模型返回内容");
    }

    const { normalizedCategories, missingCategoryNames } = normalizeMergedCoverage(
      sourceCategories,
      response.mergedCategories,
      maxTargetCount,
    );

    const sourceCategoryByName = new Map(sourceCategories.map((category) => [category.name, category]));
    const normalizedResponseText = missingCategoryNames.length
      ? `${response.log.responseText}\n\n[merge-normalized] auto_preserved_categories=${missingCategoryNames.join("、")}`
      : response.log.responseText;
    const insertItem = db.prepare(`
    INSERT INTO category_merge_suggestion_items (
      id, task_id, merge_run_id, suggested_name, suggested_definition, source_category_ids_json,
      source_category_names_json, status, created_at, updated_at
    ) VALUES (
      @id, @taskId, @mergeRunId, @suggestedName, @suggestedDefinition, @sourceCategoryIdsJson,
      @sourceCategoryNamesJson, 'suggested', @createdAt, @updatedAt
    )
  `);

    db.transaction(() => {
      insertRunItem.run({
        id: randomUUID(),
        stepRunId,
        rawOutputJson: JSON.stringify(normalizedCategories),
        parsedStatus: "parsed",
        errorMessage: null,
        createdAt: now,
      });

      insertLog.run({
        id: randomUUID(),
        taskId,
        stepRunId,
        provider: response.log.provider,
        model: response.log.model,
        promptText: response.log.promptText,
        responseText: normalizedResponseText,
        status: response.log.status,
        latencyMs: response.log.latencyMs,
        createdAt: now,
      });

      for (const mergedCategory of normalizedCategories) {
        const sourceCategoryIds = mergedCategory.sourceCategoryNames.map((name) => {
          const category = sourceCategoryByName.get(name);
          if (!category) {
            throw new Error(`缺少源类别：${name}`);
          }
          return category.id;
        });

        insertItem.run({
          id: randomUUID(),
          taskId,
          mergeRunId: stepRunId,
          suggestedName: mergedCategory.name,
          suggestedDefinition: mergedCategory.definition,
          sourceCategoryIdsJson: JSON.stringify(sourceCategoryIds),
          sourceCategoryNamesJson: JSON.stringify(mergedCategory.sourceCategoryNames),
          createdAt: now,
          updatedAt: now,
        });
      }

      db.prepare(`
      UPDATE step_runs
      SET status = @status, success_count = @successCount, failed_count = 0, finished_at = @finishedAt
      WHERE id = @id
    `).run({
      id: stepRunId,
      status: "succeeded",
      successCount: normalizedCategories.length,
      finishedAt: now,
    });

      db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(now, taskId);
    })();

    return {
      stepRunId,
      suggestedCount: normalizedCategories.length,
    };
  } catch (error) {
    failStepRun(stepRunId);
    throw error;
  }
}

export async function applyCategoryMergeSuggestions(taskId: string, mergeRunId: string) {
  const suggestions = db
    .prepare(`
      SELECT
        id,
        suggested_name AS suggestedName,
        suggested_definition AS suggestedDefinition,
        source_category_ids_json AS sourceCategoryIdsJson
      FROM category_merge_suggestion_items
      WHERE task_id = ? AND merge_run_id = ? AND status = 'suggested'
      ORDER BY created_at ASC
    `)
    .all(taskId, mergeRunId) as Array<{
    id: string;
    suggestedName: string;
    suggestedDefinition: string;
    sourceCategoryIdsJson: string;
  }>;

  if (!suggestions.length) {
    throw new Error("当前没有待应用的类别合并建议");
  }

  const now = new Date().toISOString();
  const existingCategories = db
    .prepare(`
      SELECT id, name, status
      FROM categories
      WHERE task_id = ?
    `)
    .all(taskId) as Array<{ id: string; name: string; status: string }>;

  const existingByName = new Map(existingCategories.map((category) => [category.name, category]));
  const insertCategory = db.prepare(`
    INSERT INTO categories (
      id, task_id, name, definition, status, created_from_round, is_other, updated_by, created_at, updated_at
    ) VALUES (
      @id, @taskId, @name, @definition, 'active', 0, 0, 'llm_merge', @createdAt, @updatedAt
    )
  `);
  const updateCategory = db.prepare(`
    UPDATE categories
    SET name = @name, definition = @definition, status = 'active', updated_by = 'llm_merge', updated_at = @updatedAt
    WHERE id = @id
  `);
  const deactivateCategory = db.prepare(`
    UPDATE categories
    SET status = 'inactive', updated_by = 'llm_merge', updated_at = @updatedAt
    WHERE id = @id
  `);
  const updateResults = db.prepare(`
    UPDATE dialog_analysis_results
    SET category_id = @toCategoryId, category_name_snapshot = @toCategoryName, updated_at = @updatedAt
    WHERE task_id = @taskId AND category_id = @fromCategoryId
  `);
  const insertMapping = db.prepare(`
    INSERT INTO category_merge_mappings (
      id, task_id, merge_run_id, from_category_id, to_category_id, created_at
    ) VALUES (
      @id, @taskId, @mergeRunId, @fromCategoryId, @toCategoryId, @createdAt
    )
  `);

  db.transaction(() => {
    for (const suggestion of suggestions) {
      const sourceCategoryIds = JSON.parse(suggestion.sourceCategoryIdsJson) as string[];
      const reusableSource = existingCategories.find(
        (category) => sourceCategoryIds.includes(category.id) && category.name === suggestion.suggestedName,
      );
      const existingBySuggestedName = existingByName.get(suggestion.suggestedName);
      const targetCategoryId = reusableSource?.id ?? existingBySuggestedName?.id ?? randomUUID();

      if (reusableSource || existingBySuggestedName) {
        updateCategory.run({
          id: targetCategoryId,
          name: suggestion.suggestedName,
          definition: suggestion.suggestedDefinition,
          updatedAt: now,
        });
      } else {
        insertCategory.run({
          id: targetCategoryId,
          taskId,
          name: suggestion.suggestedName,
          definition: suggestion.suggestedDefinition,
          createdAt: now,
          updatedAt: now,
        });
        existingByName.set(suggestion.suggestedName, {
          id: targetCategoryId,
          name: suggestion.suggestedName,
          status: "active",
        });
      }

      for (const sourceCategoryId of sourceCategoryIds) {
        insertMapping.run({
          id: randomUUID(),
          taskId,
          mergeRunId: mergeRunId,
          fromCategoryId: sourceCategoryId,
          toCategoryId: targetCategoryId,
          createdAt: now,
        });

        updateResults.run({
          taskId,
          fromCategoryId: sourceCategoryId,
          toCategoryId: targetCategoryId,
          toCategoryName: suggestion.suggestedName,
          updatedAt: now,
        });

        if (sourceCategoryId !== targetCategoryId) {
          deactivateCategory.run({
            id: sourceCategoryId,
            updatedAt: now,
          });
        }
      }
    }

    db.prepare(`
      UPDATE category_merge_suggestion_items
      SET status = 'applied', updated_at = ?
      WHERE task_id = ? AND merge_run_id = ? AND status = 'suggested'
    `).run(now, taskId, mergeRunId);

    db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(now, taskId);
  })();
}

export async function discardCategoryMergeSuggestions(taskId: string, mergeRunId: string) {
  const now = new Date().toISOString();

  db.prepare(`
    UPDATE category_merge_suggestion_items
    SET status = 'discarded', updated_at = ?
    WHERE task_id = ? AND merge_run_id = ? AND status = 'suggested'
  `).run(now, taskId, mergeRunId);

  db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`).run(now, taskId);
}
