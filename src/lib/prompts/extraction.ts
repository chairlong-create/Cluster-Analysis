import { getPromptSettings, renderPromptTemplate } from "@/lib/prompt-config";
import type { ExtractionRequest } from "@/lib/llm/types";

export function getExtractionSystemPrompt() {
  return getPromptSettings().extractionSystemPrompt;
}

export function buildExtractionUserPrompt(request: ExtractionRequest) {
  return renderPromptTemplate(getPromptSettings().extractionUserPromptTemplate, {
    dialog_id: request.sourceDialogId,
    dialog_text: request.text,
    analysis_goal: request.analysisGoal,
    analysis_focus_label: request.analysisFocusLabel,
  });
}
