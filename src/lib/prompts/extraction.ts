import { getPromptSettings, renderPromptTemplate } from "@/lib/prompt-config";
import type { ExtractionRequest } from "@/lib/llm/types";

export function buildExtractionSystemPrompt(request: ExtractionRequest) {
  return renderPromptTemplate(getPromptSettings().extractionSystemPrompt, {
    dialog_id: request.sourceDialogId,
    dialog_text: request.text,
    analysis_goal: request.analysisGoal,
    analysis_focus_label: request.analysisFocusLabel,
  });
}

export function getExtractionUserPrompt() {
  return "请严格根据 system prompt 中的要求完成提取，并只输出 JSON 结果。";
}
