import { getPromptSettings, renderPromptTemplate } from "@/lib/prompt-config";

type MergeCategoryInput = {
  name: string;
  definition: string;
  hitCount: number;
};

export function getCategoryMergeSystemPrompt() {
  return getPromptSettings().categoryMergeSystemPrompt;
}

export function buildCategoryMergePrompt(categories: MergeCategoryInput[], maxTargetCount: number) {
  const categoryList = categories
    .map(
      (category, index) =>
        `${index + 1}. 名称: ${category.name}\n定义: ${category.definition}\n当前命中数: ${category.hitCount}`,
    )
    .join("\n\n");

  return renderPromptTemplate(getPromptSettings().categoryMergeUserPromptTemplate, {
    max_target_count: String(maxTargetCount),
    merge_category_list: categoryList,
  });
}
