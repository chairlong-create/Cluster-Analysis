# One-Click Batch Classification V2 Design

## Context

The current batch advance flow asks users to manually move a seed batch through signal extraction, cluster suggestion generation, suggestion confirmation, and batch classification. In normal use, the middle transitions are often mechanical: after extraction succeeds, the user clicks next; after cluster suggestions are generated, the user confirms them; then classification starts.

V2 simplifies this into a default one-click path while keeping the existing step-by-step controls available for recovery and advanced inspection.

## Goals

- Make the common batch flow a one-click operation after a batch file is uploaded.
- Automatically confirm generated cluster suggestions and write them to the category table.
- Continue to classification when cluster generation returns no suggestions.
- Give users clear progress feedback for the full workflow and the current sub-step.
- Preserve the existing manual step controls as advanced operations.
- Stop safely on failure and make the failed step visible.

## Non-Goals

- Do not auto-start processing immediately after upload.
- Do not redesign the import or column mapping flow.
- Do not introduce a new queueing system or background worker architecture.
- Do not remove existing manual step actions.
- Do not add cross-batch one-click processing in this iteration.

## User Experience

The batch detail panel uses one primary action:

- `一键分类` for a batch with no completed classification.
- `重新一键分类` for a batch that already has classification results.

For seed batches, the button runs:

1. Extract analysis signals.
2. Generate cluster suggestions.
3. Automatically confirm suggestions and write them to the category table.
4. Run batch classification.

For classify-only batches, the button runs only batch classification using the current category table.

The existing manual operations move into an advanced operation area:

- Re-extract signals.
- Retry failed extraction records.
- Generate or retry cluster suggestions.
- Confirm or discard pending suggestions.
- Run or rerun classification.
- Retry failed classification records.

## Progress Display

One-click mode must show explicit workflow progress instead of only disabling the button.

For seed batches, the progress card displays a stage tracker:

```text
提取分析信号 -> 生成类别建议 -> 写入类别表 -> 批量分类
```

The active stage is highlighted and the card shows copy like:

```text
一键分类进行中
步骤 1/4：正在提取分析信号
已完成 126/500 条
```

Stage-specific progress rules:

- Extraction: use the existing extraction step run counts, `successCount + failedCount / inputCount`.
- Cluster generation: show an active indeterminate state because it is a single LLM call.
- Category write: show a short active state and the number of suggestions confirmed when available.
- Classification: use the existing classification step run counts, `successCount + failedCount / inputCount`.

For classify-only batches, the tracker shows a single classification stage and uses classification counts.

When the flow fails, the panel displays:

```text
一键分类未完成
失败步骤：生成类别建议
已完成：信号提取
未执行：写入类别表、批量分类
```

The recovery actions are:

- Retry one-click classification.
- Open advanced operations.

## Backend Design

Add a batch workflow orchestration service:

```ts
runOneClickBatchClassification(taskId, batchId, settings, promptSettings)
```

The service reuses existing domain services:

- `runReasonExtraction`
- `generateClusterSuggestions`
- `confirmClusterSuggestions`
- `runBatchClassification`

The orchestrator should not duplicate extraction, clustering, confirmation, or classification logic.

For seed batches, it runs:

1. Ensure signal extraction exists and is usable. If not, run extraction.
2. Ensure cluster suggestions have been generated. If not, run cluster generation.
3. If pending suggestions exist, confirm them automatically.
4. Run classification.

For classify-only batches, it runs:

1. Run classification.

## Resume and Retry Semantics

Retrying one-click classification should continue from usable existing results where possible:

- If extraction already succeeded, do not repeat extraction.
- If pending cluster suggestions already exist, confirm them instead of generating again.
- If confirmed suggestions already exist or cluster generation returned no suggestions, continue to classification.
- If classification failed or partially failed, rerun classification for the batch through the one-click path.

The orchestrator stops at the first failed required step. It does not attempt later steps after failure.

Cluster generation returning zero suggestions is not a failure. The workflow continues to classification.

## Status and Step Runs

Use existing step runs for sub-step progress:

- `extract_reasons`
- `cluster_reasons`
- `classify`

Add a workflow-level step run type:

- `one_click_classify`

The workflow-level step run records the overall one-click operation and enables the UI to detect that the current activity is an orchestrated flow rather than a manually launched step.

When a sub-step starts, the existing batch statuses continue to reflect the active operation:

- `extracting`
- `clustering`
- `classifying`

The workflow-level step run should finish as:

- `succeeded` when the required workflow completes.
- `failed` when a required step throws or ends in failure.
- `partial_success` only if the one-click operation reaches classification and classification itself returns partial success.

## API Design

Add a new route:

```text
POST /api/tasks/:taskId/batches/:batchId/one-click-classify
```

The route:

- Validates task and batch ownership through the same mechanisms as existing batch routes.
- Loads user settings and prompt settings.
- Starts the orchestration service.
- Returns an error message when the workflow cannot start or fails synchronously.

The existing single-step routes remain unchanged.

## UI Integration

Update `BatchDetailPanel` so the primary action points to the one-click route.

The panel should infer the displayed active stage from:

- The active `one_click_classify` run.
- The latest active extraction, cluster, or classification run.
- Pending or confirmed suggestions for the selected batch.

The batch progress table should also prefer one-click labels for primary actions:

- `一键分类`
- `重新一键分类`
- `处理中`
- `失败重试`

Manual next-step wording should move out of the default path.

## Error Handling

The UI must distinguish:

- A currently running one-click flow.
- A failed one-click flow.
- A successful one-click flow.
- A normal manual step failure.

For failed one-click flows, show the failed stage and keep advanced manual controls available. Conflict handling should continue to block starting another batch operation while any extraction, clustering, classification, merge, or iterate-others flow is active.

## Testing

Add focused coverage for the orchestration service:

- Seed batch with no prior runs executes extraction, clustering, confirmation, and classification in order.
- Seed batch with zero cluster suggestions still proceeds to classification.
- Seed batch with existing successful extraction does not re-extract.
- Seed batch with pending suggestions confirms them and classifies.
- Classify-only batch skips extraction and clustering.
- Failure in extraction, clustering, or confirmation stops later steps.

Add UI-level checks where practical:

- Primary action label changes to `一键分类`.
- Running one-click flow shows the stage tracker.
- Failed one-click flow shows the failed stage and retry entry.

## Open Decisions

No unresolved product decisions remain for V2 scope. The agreed behavior is:

- One-click automatically writes generated category suggestions.
- Empty cluster suggestions continue to classification.
- Manual step controls remain available as advanced operations.
