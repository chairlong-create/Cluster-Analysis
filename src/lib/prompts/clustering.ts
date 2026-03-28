import { getPromptSettings, renderPromptTemplate } from "@/lib/prompt-config";

export function getClusteringSystemPrompt() {
  return getPromptSettings().clusteringSystemPrompt;
}

export function buildClusteringPrompt(reasons: string[], analysisGoal: string, analysisFocusLabel: string) {
  return renderPromptTemplate(getPromptSettings().clusteringUserPromptTemplate, {
    reasons_list: reasons.map((reason, index) => `${index + 1}. ${reason}`).join("\n"),
    analysis_goal: analysisGoal,
    analysis_focus_label: analysisFocusLabel,
  });
}
