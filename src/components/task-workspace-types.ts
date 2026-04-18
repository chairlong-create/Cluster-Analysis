export type TaskSummary = {
  id: string;
  name: string;
  description: string | null;
  llmProvider: string;
  analysisGoal: string;
  analysisFocusLabel: string;
  dialogCount: number;
  batchCount: number;
};

export type BatchSummary = {
  id: string;
  fileName: string;
  workflowMode: "seed" | "classify_only";
  sourceIdColumn: string;
  sourceTextColumn: string;
  rowCount: number;
  importedCount: number;
  duplicateCount: number;
  status: string;
  createdAt: string;
};

export type CategorySummary = {
  id: string;
  name: string;
  definition: string;
  isOther: number;
  updatedBy: string;
  hitCount: number;
};

export type StepRunSummary = {
  id: string;
  batchId: string | null;
  stepType?: string;
  status: string;
  roundNo: number;
  inputCount: number;
  successCount: number;
  failedCount: number;
  startedAt?: string;
  finishedAt: string | null;
};

export type ClusterSuggestion = {
  id: string;
  batchId: string | null;
  name: string;
  definition: string;
  exampleReasonsJson: string | null;
  status: string;
  updatedAt: string;
};

export type MergeSuggestion = {
  id: string;
  suggestedName: string;
  suggestedDefinition: string;
  sourceCategoryNamesJson: string;
  status: string;
};

export type BatchCategoryCount = {
  categoryName: string | null;
  count: number;
};

export type SummaryItem = {
  categoryName: string;
  count: number;
};

export type CategorySample = {
  sourceDialogId: string;
  analysisSummary: string;
};

export type ExtractionSample = {
  sourceDialogId: string;
  analysisSummary: string;
  evidenceQuote: string;
};
