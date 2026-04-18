export type OneClickWorkflowMode = "seed" | "classify_only";
export type OneClickStep = "extract" | "cluster" | "confirm" | "classify";

export type OneClickPlanInput = {
  workflowMode: OneClickWorkflowMode;
  hasSuccessfulExtraction: boolean;
  hasPendingSuggestions: boolean;
  hasConfirmedSuggestions: boolean;
  hasSuccessfulClusterRun: boolean;
  clusterReturnedEmpty: boolean;
};

export function planOneClickBatchSteps(input: OneClickPlanInput): OneClickStep[] {
  if (input.workflowMode === "classify_only") return ["classify"];

  const steps: OneClickStep[] = [];
  if (!input.hasSuccessfulExtraction) steps.push("extract");
  if (!input.hasPendingSuggestions && !input.hasConfirmedSuggestions && !input.clusterReturnedEmpty) steps.push("cluster");
  if (input.hasPendingSuggestions || steps.includes("cluster")) steps.push("confirm");
  steps.push("classify");
  return steps;
}
