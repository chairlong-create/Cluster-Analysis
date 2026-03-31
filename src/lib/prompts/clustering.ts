import { getPromptSettings, renderPromptTemplate } from "@/lib/prompt-config";

export function buildClusteringSystemPrompt(
  reasons: string[],
  analysisGoal: string,
  analysisFocusLabel: string,
) {
  return renderPromptTemplate(getPromptSettings().clusteringSystemPrompt, {
    reasons_list: reasons.map((reason, index) => `${index + 1}. ${reason}`).join("\n"),
    analysis_goal: analysisGoal,
    analysis_focus_label: analysisFocusLabel,
  });
}

export function getClusteringUserPrompt() {
  return "请严格根据 system prompt 中的要求完成聚类，并只输出 JSON 结果。";
}
