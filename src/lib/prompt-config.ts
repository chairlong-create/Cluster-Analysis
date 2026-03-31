import { db } from "@/lib/db";

type PromptKey =
  | "extraction_system_prompt"
  | "clustering_system_prompt"
  | "classification_system_prompt"
  | "category_merge_system_prompt";

export type PromptSettings = {
  extractionSystemPrompt: string;
  clusteringSystemPrompt: string;
  classificationSystemPrompt: string;
  categoryMergeSystemPrompt: string;
};

export type PromptReferences = {
  extraction: string;
  clustering: string;
  classification: string;
  categoryMerge: string;
};

export const promptReferences: PromptReferences = {
  extraction: [
    "任务目标：{{analysis_goal}}",
    "请阅读下面的对话，提取与任务目标最相关的一条{{analysis_focus_label}}。",
    "",
    "输出 JSON schema：",
    JSON.stringify(
      {
        has_buy_block_reason: true,
        buy_block_reason: "一句话概括这条对话里的核心分析信号",
        evidence_quote: "直接引用原文",
        evidence_explanation: "说明为什么这句原文支持该判断",
        confidence: 0.85,
      },
      null,
      2,
    ),
    "",
    "对话ID: {{dialog_id}}",
    "对话全文：",
    "{{dialog_text}}",
  ].join("\n"),
  clustering: [
    "任务目标：{{analysis_goal}}",
    "请将下面这些“{{analysis_focus_label}}摘要”聚类成可复用的类别定义。",
    "要求：",
    "1. 类别名短、稳定、可复用",
    "2. 类别定义要能用于后续批量分类",
    "3. 类别之间尽量互斥",
    "4. 最多输出 50 个类别；如果样本很多，请优先合并近义项，不要超过 50 类",
    "5. 输出严格 JSON，不要解释",
    "",
    "输出 JSON schema:",
    JSON.stringify(
      {
        categories: [
          {
            name: "年龄/时机不合适",
            definition: "用户认为孩子当前年龄、学段或报名时机不适合当前课程。",
            example_reasons: ["孩子还小，暂时不想开始系统学习。"],
          },
        ],
      },
      null,
      2,
    ),
    "",
    "原因列表：",
    "{{reasons_list}}",
  ].join("\n"),
  classification: [
    "任务目标：{{analysis_goal}}",
    "请根据下面的类别表，对对话进行单标签归类。",
    "要求：",
    "1. 只能命中一个类别",
    "2. 如果没有合适类别，matched_category_name 返回“其他”，is_other 返回 true",
    "3. 输出严格 JSON，不要解释",
    "4. evidence_quote 必须引用原对话中的原文",
    "",
    "类别表：",
    "{{category_list}}",
    "",
    "已提取的{{analysis_focus_label}}摘要（供参考）: {{extracted_reason}}",
    "对话全文：",
    "{{dialog_text}}",
    "",
    "输出 JSON schema:",
    JSON.stringify(
      {
        matched_category_name: "年龄/时机不合适",
        is_other: false,
        buy_block_reason: "用户认为孩子当前阶段不适合报名",
        evidence_quote: "这个正式上学还小",
        evidence_explanation: "用户直接表达孩子当前年龄阶段偏早，因此匹配该类别",
        confidence: 0.9,
      },
      null,
      2,
    ),
  ].join("\n"),
  categoryMerge: [
    "请基于下面这组任务级类别表，合并含义相近的类别。",
    "",
    "要求：",
    "- 合并后的非系统类别数不能超过 {{max_target_count}} 个。",
    "- 如果当前类别体系已经足够紧凑，可以保持不变，不必强行合并。",
    "- 每个原始类别都必须被映射到且仅映射到一个合并后的类别。",
    "- source_category_names 中必须完整列出该新类别由哪些旧类别合并而来。",
    "",
    "输入类别：",
    "{{merge_category_list}}",
    "",
    "输出格式：",
    JSON.stringify(
      {
        merged_categories: [
          {
            name: "合并后的类别名",
            definition: "合并后的类别定义",
            source_category_names: ["旧类别A", "旧类别B"],
          },
        ],
      },
      null,
      2,
    ),
  ].join("\n"),
};

export const defaultPromptSettings: PromptSettings = {
  extractionSystemPrompt: promptReferences.extraction,
  clusteringSystemPrompt: promptReferences.clustering,
  classificationSystemPrompt: promptReferences.classification,
  categoryMergeSystemPrompt: promptReferences.categoryMerge,
};

function getPromptSettingValue(key: PromptKey) {
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = ?`)
    .get(key) as { value: string } | undefined;

  return row?.value ?? null;
}

export function getPromptSettings(): PromptSettings {
  return {
    extractionSystemPrompt:
      getPromptSettingValue("extraction_system_prompt") ?? defaultPromptSettings.extractionSystemPrompt,
    clusteringSystemPrompt:
      getPromptSettingValue("clustering_system_prompt") ?? defaultPromptSettings.clusteringSystemPrompt,
    classificationSystemPrompt:
      getPromptSettingValue("classification_system_prompt") ??
      defaultPromptSettings.classificationSystemPrompt,
    categoryMergeSystemPrompt:
      getPromptSettingValue("category_merge_system_prompt") ??
      defaultPromptSettings.categoryMergeSystemPrompt,
  };
}

export function savePromptSettings(input: PromptSettings) {
  const now = new Date().toISOString();
  const upsert = db.prepare(`
    INSERT INTO app_settings (key, value, updated_at)
    VALUES (@key, @value, @updatedAt)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at
  `);

  const transaction = db.transaction(() => {
    upsert.run({ key: "extraction_system_prompt", value: input.extractionSystemPrompt.trim(), updatedAt: now });
    upsert.run({ key: "clustering_system_prompt", value: input.clusteringSystemPrompt.trim(), updatedAt: now });
    upsert.run({
      key: "classification_system_prompt",
      value: input.classificationSystemPrompt.trim(),
      updatedAt: now,
    });
    upsert.run({
      key: "category_merge_system_prompt",
      value: input.categoryMergeSystemPrompt.trim(),
      updatedAt: now,
    });
  });

  transaction();
}

function replaceAll(template: string, replacements: Record<string, string>) {
  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  );
}

export function renderPromptTemplate(template: string, replacements: Record<string, string>) {
  return replaceAll(template, replacements);
}
