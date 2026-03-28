export type ExtractionResult = {
  hasTargetSignal: boolean;
  analysisSummary: string;
  evidenceQuote: string;
  evidenceExplanation: string;
  confidence: number;
};

export type ExtractionRequest = {
  dialogId: string;
  sourceDialogId: string;
  text: string;
  analysisGoal: string;
  analysisFocusLabel: string;
};

export type ProviderCallLog = {
  promptText: string;
  responseText: string;
  status: "succeeded" | "failed";
  latencyMs: number;
  model: string;
  provider: string;
};

export type ProviderExtractionResponse = {
  result: ExtractionResult;
  log: ProviderCallLog;
};
