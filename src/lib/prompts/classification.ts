import { getPromptSettings, renderPromptTemplate } from "@/lib/prompt-config";

type CategoryInput = {
  id: string;
  name: string;
  definition: string;
  isOther: number;
};

export function getClassificationSystemPrompt() {
  return getPromptSettings().classificationSystemPrompt;
}

export function buildClassificationPrompt(input: {
  text: string;
  extractedReason: string;
  categories: CategoryInput[];
  analysisGoal: string;
  analysisFocusLabel: string;
}) {
  return renderPromptTemplate(getPromptSettings().classificationUserPromptTemplate, {
    category_list: input.categories
      .map((category, index) => `${index + 1}. ${category.name}: ${category.definition}`)
      .join("\n"),
    extracted_reason: input.extractedReason || "暂无",
    dialog_text: input.text,
    analysis_goal: input.analysisGoal,
    analysis_focus_label: input.analysisFocusLabel,
  });
}
