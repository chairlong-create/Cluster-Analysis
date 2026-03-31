import { getPromptSettings, renderPromptTemplate } from "@/lib/prompt-config";

type MergeCategoryInput = {
  name: string;
  definition: string;
  hitCount: number;
};

export function buildCategoryMergeSystemPrompt(categories: MergeCategoryInput[], maxTargetCount: number) {
  const categoryList = categories
    .map(
      (category, index) =>
        `${index + 1}. 名称: ${category.name}\n定义: ${category.definition}\n当前命中数: ${category.hitCount}`,
    )
    .join("\n\n");

  return renderPromptTemplate(getPromptSettings().categoryMergeSystemPrompt, {
    max_target_count: String(maxTargetCount),
    merge_category_list: categoryList,
  });
}

export function getCategoryMergeUserPrompt() {
  return "请严格根据 system prompt 中的要求完成类别合并，并只输出 JSON 结果。";
}
