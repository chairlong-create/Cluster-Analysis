import test from "node:test";
import assert from "node:assert/strict";

import { planOneClickBatchSteps } from "../src/lib/one-click-classification-plan.ts";

test("planOneClickBatchSteps runs all seed steps when nothing exists", () => {
  assert.deepEqual(
    planOneClickBatchSteps({
      workflowMode: "seed",
      hasSuccessfulExtraction: false,
      hasPendingSuggestions: false,
      hasConfirmedSuggestions: false,
      hasSuccessfulClusterRun: false,
      clusterReturnedEmpty: false,
    }),
    ["extract", "cluster", "confirm", "classify"],
  );
});

test("planOneClickBatchSteps skips extraction when it already succeeded", () => {
  assert.deepEqual(
    planOneClickBatchSteps({
      workflowMode: "seed",
      hasSuccessfulExtraction: true,
      hasPendingSuggestions: false,
      hasConfirmedSuggestions: false,
      hasSuccessfulClusterRun: false,
      clusterReturnedEmpty: false,
    }),
    ["cluster", "confirm", "classify"],
  );
});

test("planOneClickBatchSteps confirms pending suggestions before classification", () => {
  assert.deepEqual(
    planOneClickBatchSteps({
      workflowMode: "seed",
      hasSuccessfulExtraction: true,
      hasPendingSuggestions: true,
      hasConfirmedSuggestions: false,
      hasSuccessfulClusterRun: true,
      clusterReturnedEmpty: false,
    }),
    ["confirm", "classify"],
  );
});

test("planOneClickBatchSteps classifies when clustering succeeded with empty suggestions", () => {
  assert.deepEqual(
    planOneClickBatchSteps({
      workflowMode: "seed",
      hasSuccessfulExtraction: true,
      hasPendingSuggestions: false,
      hasConfirmedSuggestions: false,
      hasSuccessfulClusterRun: true,
      clusterReturnedEmpty: true,
    }),
    ["classify"],
  );
});

test("planOneClickBatchSteps classify-only batches skip build-category steps", () => {
  assert.deepEqual(
    planOneClickBatchSteps({
      workflowMode: "classify_only",
      hasSuccessfulExtraction: false,
      hasPendingSuggestions: false,
      hasConfirmedSuggestions: false,
      hasSuccessfulClusterRun: false,
      clusterReturnedEmpty: false,
    }),
    ["classify"],
  );
});
