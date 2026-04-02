import { renderPromptTemplate, type PromptSettings } from "@/lib/prompt-config";

type CategoryInput = {
  id: string;
  name: string;
  definition: string;
  isOther: number;
};

export function buildClassificationSystemPrompt(input: {
  text: string;
  extractedReason: string;
  categories: CategoryInput[];
  analysisGoal: string;
  analysisFocusLabel: string;
}, promptSettings: PromptSettings) {
  return renderPromptTemplate(promptSettings.classificationSystemPrompt, {
    category_list: input.categories
      .map((category, index) => `${index + 1}. ${category.name}: ${category.definition}`)
      .join("\n"),
    extracted_reason: input.extractedReason || "暂无",
    dialog_text: input.text,
    analysis_goal: input.analysisGoal,
    analysis_focus_label: input.analysisFocusLabel,
  });
}

export function getClassificationUserPrompt() {
  return "请严格根据 system prompt 中的要求完成分类，并只输出 JSON 结果。";
}
