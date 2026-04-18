# One-Click Batch Classification V2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the default batch advance path with a one-click classification workflow that automatically extracts signals, generates and confirms categories, and classifies the batch while showing clear progress.

**Architecture:** Add a focused orchestration service above the existing extraction, clustering, confirmation, and classification services. Keep the current single-step endpoints and controls as advanced operations, and add a workflow-level `one_click_classify` step run so the UI can distinguish orchestrated progress from manual steps.

**Tech Stack:** Next.js App Router, React Server Components, TypeScript, better-sqlite3, Node `node:test`, existing `AsyncStepButton` client component.

---

## File Map

- Create `src/lib/one-click-classification-plan.ts`: pure one-click resume decision helper with no app path aliases, so `node --test` can import it directly.
- Create `src/lib/one-click-classification-service.ts`: workflow orchestration and workflow-level step run lifecycle.
- Create `src/app/api/tasks/[taskId]/batches/[batchId]/one-click-classify/route.ts`: POST endpoint that launches the orchestrator in the background.
- Modify `src/app/tasks/[taskId]/page.tsx`: load latest `one_click_classify` runs and pass them to the batch detail panel; update table primary labels.
- Modify `src/components/task-workspace-types.ts`: add optional `stepType` and `startedAt` to `StepRunSummary` for UI stage inference.
- Modify `src/components/batch-detail-panel.tsx`: make one-click the default primary action, add stage tracker, move manual steps under advanced operations.
- Modify `src/components/batch-progress-table.tsx`: prefer one-click action labels.
- Modify `src/lib/step-run-utils.ts`: include `one_click_classify` in stalled-run reconciliation.
- Add `tests/one-click-classification-plan.test.ts`: unit tests for orchestration decisions.

---

## Task 1: Add Workflow Orchestrator

**Files:**
- Create: `src/lib/one-click-classification-plan.ts`
- Create: `src/lib/one-click-classification-service.ts`
- Test: `tests/one-click-classification-plan.test.ts`

- [ ] **Step 1: Write the failing tests for decision behavior**

Create `tests/one-click-classification-plan.test.ts` with tests for the pure planning helper first. The helper keeps orchestration decisions testable without live LLM calls and avoids importing files that use the `@/` path alias.

```ts
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
```

- [ ] **Step 2: Run the new test and verify it fails**

Run:

```bash
npm test -- tests/one-click-classification-plan.test.ts
```

Expected: FAIL because `src/lib/one-click-classification-plan.ts` does not exist.

- [ ] **Step 3: Add the planning helper**

Create `src/lib/one-click-classification-plan.ts`:

```ts
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
  if (input.workflowMode === "classify_only") {
    return ["classify"];
  }

  const steps: OneClickStep[] = [];

  if (!input.hasSuccessfulExtraction) {
    steps.push("extract");
  }

  if (!input.hasPendingSuggestions && !input.hasConfirmedSuggestions && !input.clusterReturnedEmpty) {
    steps.push("cluster");
  }

  if (input.hasPendingSuggestions || steps.includes("cluster")) {
    steps.push("confirm");
  }

  steps.push("classify");
  return steps;
}
```

- [ ] **Step 4: Add the orchestrator service**

Create `src/lib/one-click-classification-service.ts`:

```ts
import { randomUUID } from "node:crypto";

import type { AppSettings } from "@/lib/app-config";
import { runBatchClassification } from "@/lib/classification-service";
import { confirmClusterSuggestions, generateClusterSuggestions } from "@/lib/clustering-service";
import { db } from "@/lib/db";
import { runReasonExtraction } from "@/lib/extraction-service";
import { planOneClickBatchSteps, type OneClickWorkflowMode } from "@/lib/one-click-classification-plan";
import { failStepRun } from "@/lib/step-run-utils";
import type { PromptSettings } from "@/lib/prompt-config";

type BatchWorkflowRow = {
  id: string;
  workflowMode: OneClickWorkflowMode;
};

type StepRunRow = {
  id: string;
  status: string;
  successCount: number;
  failedCount: number;
};

function getLatestStepRun(taskId: string, batchId: string, stepTypes: string[]) {
  return db
    .prepare(`
      SELECT
        id,
        status,
        success_count AS successCount,
        failed_count AS failedCount
      FROM step_runs
      WHERE task_id = ?
        AND batch_id = ?
        AND step_type IN (${stepTypes.map(() => "?").join(",")})
      ORDER BY started_at DESC
      LIMIT 1
    `)
    .get(taskId, batchId, ...stepTypes) as StepRunRow | undefined;
}

function getSuggestionState(taskId: string, batchId: string) {
  const rows = db
    .prepare(`
      SELECT status, COUNT(*) AS count
      FROM category_suggestions
      WHERE task_id = ? AND batch_id = ?
      GROUP BY status
    `)
    .all(taskId, batchId) as Array<{ status: string; count: number }>;

  return {
    pending: rows.find((row) => row.status === "suggested")?.count ?? 0,
    confirmed: rows.find((row) => row.status === "confirmed")?.count ?? 0,
  };
}

function createWorkflowRun(taskId: string, batchId: string, inputCount: number) {
  const latestRound = db
    .prepare(`
      SELECT COALESCE(MAX(round_no), 0) AS latestRound
      FROM step_runs
      WHERE task_id = ? AND batch_id = ? AND step_type = 'one_click_classify'
    `)
    .get(taskId, batchId) as { latestRound: number };

  const now = new Date().toISOString();
  const id = randomUUID();

  db.prepare(`
    INSERT INTO step_runs (
      id, task_id, batch_id, step_type, round_no, status, input_count, success_count, failed_count, started_at, last_heartbeat_at
    ) VALUES (
      @id, @taskId, @batchId, 'one_click_classify', @roundNo, 'running', @inputCount, 0, 0, @startedAt, @lastHeartbeatAt
    )
  `).run({
    id,
    taskId,
    batchId,
    roundNo: latestRound.latestRound + 1,
    inputCount,
    startedAt: now,
    lastHeartbeatAt: now,
  });

  return id;
}

function finishWorkflowRun(
  stepRunId: string,
  status: "succeeded" | "partial_success" | "failed",
  successCount: number,
  failedCount: number,
) {
  const finishedAt = new Date().toISOString();
  db.prepare(`
    UPDATE step_runs
    SET status = @status,
        success_count = @successCount,
        failed_count = @failedCount,
        finished_at = @finishedAt,
        last_heartbeat_at = @finishedAt
    WHERE id = @id
  `).run({
    id: stepRunId,
    status,
    successCount,
    failedCount,
    finishedAt,
  });
}

export async function runOneClickBatchClassification(
  taskId: string,
  batchId: string,
  settings: AppSettings,
  promptSettings: PromptSettings,
) {
  const batch = db
    .prepare(`SELECT id, workflow_mode AS workflowMode FROM batches WHERE id = ? AND task_id = ?`)
    .get(batchId, taskId) as BatchWorkflowRow | undefined;

  if (!batch) {
    throw new Error("批次不存在");
  }

  const dialogCount = (db.prepare(`SELECT COUNT(*) AS count FROM dialogs WHERE task_id = ? AND batch_id = ?`).get(taskId, batchId) as { count: number }).count;
  const workflowRunId = createWorkflowRun(taskId, batchId, dialogCount);

  try {
    const extractionRun = getLatestStepRun(taskId, batchId, ["extract_reasons", "extract_reasons_retry"]);
    const clusterRun = getLatestStepRun(taskId, batchId, ["cluster_reasons"]);
    const suggestions = getSuggestionState(taskId, batchId);
    const plan = planOneClickBatchSteps({
      workflowMode: batch.workflowMode,
      hasSuccessfulExtraction: extractionRun?.status === "succeeded" || extractionRun?.status === "partial_success",
      hasPendingSuggestions: suggestions.pending > 0,
      hasConfirmedSuggestions: suggestions.confirmed > 0,
      hasSuccessfulClusterRun: clusterRun?.status === "succeeded",
      clusterReturnedEmpty: clusterRun?.status === "succeeded" && clusterRun.successCount === 0,
    });

    for (const step of plan) {
      if (step === "extract") {
        await runReasonExtraction(taskId, batchId, settings, promptSettings);
      }

      if (step === "cluster") {
        await generateClusterSuggestions(taskId, batchId, "cluster_reasons", undefined, settings, promptSettings);
      }

      if (step === "confirm") {
        const latestSuggestions = getSuggestionState(taskId, batchId);
        if (latestSuggestions.pending > 0) {
          await confirmClusterSuggestions(taskId, batchId);
        }
      }

      if (step === "classify") {
        const classification = await runBatchClassification(taskId, batchId, settings, promptSettings);
        finishWorkflowRun(
          workflowRunId,
          classification.failedCount > 0 ? "partial_success" : "succeeded",
          classification.successCount,
          classification.failedCount,
        );
        return classification;
      }
    }

    finishWorkflowRun(workflowRunId, "succeeded", dialogCount, 0);
    return null;
  } catch (error) {
    failStepRun(workflowRunId);
    throw error;
  }
}
```

- [ ] **Step 5: Run the focused test**

Run:

```bash
npm test -- tests/one-click-classification-plan.test.ts
```

Expected: PASS for the pure helper tests.

- [ ] **Step 6: Commit**

```bash
git add src/lib/one-click-classification-plan.ts src/lib/one-click-classification-service.ts tests/one-click-classification-plan.test.ts
git commit -m "Add one-click batch classification orchestrator"
```

---

## Task 2: Add One-Click API Route

**Files:**
- Create: `src/app/api/tasks/[taskId]/batches/[batchId]/one-click-classify/route.ts`

- [ ] **Step 1: Create the API route**

Add `src/app/api/tasks/[taskId]/batches/[batchId]/one-click-classify/route.ts`:

```ts
import { NextResponse } from "next/server";

import { getAppSettings } from "@/lib/app-config";
import { auth } from "@/lib/auth";
import { launchBackgroundTask } from "@/lib/background-task";
import { db } from "@/lib/db";
import { runOneClickBatchClassification } from "@/lib/one-click-classification-service";
import { getPromptSettings } from "@/lib/prompt-config";

type RouteContext = {
  params: Promise<{
    taskId: string;
    batchId: string;
  }>;
};

export async function POST(_request: Request, { params }: RouteContext) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const { taskId, batchId } = await params;

  const task = db.prepare(`SELECT id FROM tasks WHERE id = ? AND user_id = ?`).get(taskId, userId);
  if (!task) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const batch = db.prepare(`SELECT id FROM batches WHERE id = ? AND task_id = ?`).get(batchId, taskId);
  if (!batch) return NextResponse.json({ error: "Batch not found" }, { status: 404 });

  const settings = getAppSettings(userId);
  const promptSettingsData = getPromptSettings(userId);

  try {
    launchBackgroundTask(
      async () => {
        await runOneClickBatchClassification(taskId, batchId, settings, promptSettingsData);
      },
      (error) => {
        console.error("one-click classify failed", error);
      },
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "一键分类启动失败" },
      { status: 500 },
    );
  }
}
```

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: no lint errors from the new route.

- [ ] **Step 3: Commit**

```bash
git add 'src/app/api/tasks/[taskId]/batches/[batchId]/one-click-classify/route.ts'
git commit -m "Add one-click classification API route"
```

---

## Task 3: Load One-Click Runs in Task Page

**Files:**
- Modify: `src/components/task-workspace-types.ts`
- Modify: `src/app/tasks/[taskId]/page.tsx`

- [ ] **Step 1: Extend the step run summary type**

Modify `src/components/task-workspace-types.ts`:

```ts
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
```

- [ ] **Step 2: Load `one_click_classify` runs in `page.tsx`**

In `src/app/tasks/[taskId]/page.tsx`, near the existing `classifyRuns` query, add:

```ts
  const oneClickRuns = db
    .prepare(`
      SELECT
        id,
        batch_id AS batchId,
        step_type AS stepType,
        status,
        round_no AS roundNo,
        input_count AS inputCount,
        success_count AS successCount,
        failed_count AS failedCount,
        started_at AS startedAt,
        finished_at AS finishedAt
      FROM step_runs
      WHERE task_id = ? AND step_type = 'one_click_classify'
      ORDER BY started_at DESC
    `)
    .all(taskId) as StepRunSummary[];

  const latestOneClickRunByBatch = mapLatestByKey(oneClickRuns, (run) => run.batchId ?? "");
```

- [ ] **Step 3: Include one-click runs in active state**

Update:

```ts
  const batchRunsActive =
    extractRuns.some((run) => isActiveRun(run.status)) ||
    clusterRuns.some((run) => isActiveRun(run.status)) ||
    classifyRuns.some((run) => isActiveRun(run.status));
```

to:

```ts
  const batchRunsActive =
    oneClickRuns.some((run) => isActiveRun(run.status)) ||
    extractRuns.some((run) => isActiveRun(run.status)) ||
    clusterRuns.some((run) => isActiveRun(run.status)) ||
    classifyRuns.some((run) => isActiveRun(run.status));
```

- [ ] **Step 4: Pass one-click run into `BatchDetailPanel`**

Update the component call:

```tsx
          <BatchDetailPanel
            taskId={task.id}
            batch={selectedBatch}
            extractRun={selectedBatch ? latestExtractRunByBatch.get(selectedBatch.id) : undefined}
            clusterRun={selectedBatch ? latestClusterRunByBatch.get(selectedBatch.id) : undefined}
            classifyRun={selectedBatch ? latestClassifyRunByBatch.get(selectedBatch.id) : undefined}
            oneClickRun={selectedBatch ? latestOneClickRunByBatch.get(selectedBatch.id) : undefined}
```

- [ ] **Step 5: Update batch table labels**

In the `batchRows` mapping, replace the current seed step label logic with one-click labels:

```ts
    const oneClickRun = latestOneClickRunByBatch.get(batch.id);
    const hasPriorClassification = hasClassifyRun(latestClassifyRunByBatch.get(batch.id), countsByBatch.get(batch.id) ?? []);
    const primaryActionLabel = isActiveRun(oneClickRun?.status)
      ? "处理中"
      : oneClickRun?.status === "failed"
        ? "失败重试"
        : hasPriorClassification
          ? "重新一键分类"
          : "一键分类";
```

- [ ] **Step 6: Run lint**

Run:

```bash
npm run lint
```

Expected: type and lint checks pass after adding the new prop in the next task; if this task is run alone, TypeScript may fail until `BatchDetailPanel` is updated.

- [ ] **Step 7: Commit after Task 4, not here**

Do not commit this task alone if the project does not type-check until `BatchDetailPanel` accepts `oneClickRun`.

---

## Task 4: Update Batch Detail UI

**Files:**
- Modify: `src/components/batch-detail-panel.tsx`
- Modify: `src/app/tasks/[taskId]/page.tsx`

- [ ] **Step 1: Add `oneClickRun` prop**

In `BatchDetailPanelProps`, add:

```ts
  oneClickRun?: StepRunSummary;
```

In the function parameters, add:

```ts
  oneClickRun,
```

- [ ] **Step 2: Add progress stage helpers**

Add these helpers near `getRunMeta`:

```ts
type OneClickStageKey = "extract" | "cluster" | "confirm" | "classify";

const seedOneClickStages: Array<{ key: OneClickStageKey; label: string }> = [
  { key: "extract", label: "提取分析信号" },
  { key: "cluster", label: "生成类别建议" },
  { key: "confirm", label: "写入类别表" },
  { key: "classify", label: "批量分类" },
];

const classifyOnlyStages: Array<{ key: OneClickStageKey; label: string }> = [
  { key: "classify", label: "批量分类" },
];
```

- [ ] **Step 3: Infer current one-click stage**

Inside `BatchDetailPanel`, after failed count constants, add:

```ts
  const oneClickActive = oneClickRun?.status === "running";
  const oneClickFailed = oneClickRun?.status === "failed";
  const oneClickStages = batch.workflowMode === "seed" ? seedOneClickStages : classifyOnlyStages;
  const oneClickStage: OneClickStageKey =
    batch.workflowMode === "classify_only"
      ? "classify"
      : extractRun?.status === "running"
        ? "extract"
        : clusterRun?.status === "running"
          ? "cluster"
          : pendingSuggestions.length
            ? "confirm"
            : classifyRun?.status === "running"
              ? "classify"
              : oneClickFailed && clusterRun?.status === "failed"
                ? "cluster"
                : oneClickFailed && extractRun?.status === "failed"
                  ? "extract"
                  : oneClickFailed && classifyRun?.status === "failed"
                    ? "classify"
                    : "classify";
  const oneClickStageIndex = Math.max(0, oneClickStages.findIndex((stage) => stage.key === oneClickStage));
```

- [ ] **Step 4: Change primary action endpoint and label**

Replace the top-level `primaryAction` seed/classify branching with:

```ts
  const primaryAction = {
    label: hasClassifiedBefore ? "重新一键分类" : "一键分类",
    endpoint: `/api/tasks/${taskId}/batches/${batch.id}/one-click-classify`,
  };
```

Keep manual single-step actions in the advanced area added below.

- [ ] **Step 5: Add the stage tracker markup**

In the primary action card, before the button rendering, add:

```tsx
          {oneClickActive || oneClickFailed ? (
            <div className="oneClickProgressPanel">
              <div className="oneClickStageTrack">
                {oneClickStages.map((stage, index) => (
                  <span
                    key={stage.key}
                    className={`oneClickStage ${
                      index < oneClickStageIndex
                        ? "oneClickStageDone"
                        : index === oneClickStageIndex
                          ? oneClickFailed
                            ? "oneClickStageFailed"
                            : "oneClickStageActive"
                          : ""
                    }`}
                  >
                    {stage.label}
                  </span>
                ))}
              </div>
              <p className={oneClickFailed ? "logError" : "progressCopy"}>
                {oneClickFailed
                  ? `一键分类未完成，失败步骤：${oneClickStages[oneClickStageIndex]?.label ?? "未知步骤"}`
                  : `一键分类进行中，步骤 ${oneClickStageIndex + 1}/${oneClickStages.length}：正在${oneClickStages[oneClickStageIndex]?.label}`}
              </p>
            </div>
          ) : null}
```

- [ ] **Step 6: Keep active progress counts below the tracker**

Keep the existing `activeProgressRun` block. It already shows extraction and classification counts. Update its cluster copy to align with one-click wording:

```ts
copy: "类别建议生成中，请等待模型返回。",
```

- [ ] **Step 7: Move manual actions into advanced operations**

After the primary one-click button, add an advanced section:

```tsx
          <details className="advancedActions">
            <summary>高级操作</summary>
            <div className="stack compactStack">
              {batch.workflowMode === "seed" ? (
                <div className="actionRow">
                  <AsyncStepButton
                    endpoint={`/api/tasks/${taskId}/batches/${batch.id}/extract`}
                    label={extractRun ? "重新提取" : "提取分析信号"}
                    className="secondaryButton"
                    disabled={Boolean(conflictReason)}
                    disabledReason={conflictReason ?? undefined}
                  />
                  {extractFailedCount > 0 ? (
                    <AsyncStepButton
                      endpoint={`/api/tasks/${taskId}/batches/${batch.id}/extract/retry-failed`}
                      label="提取失败重试"
                      className="ghostButton"
                      disabled={Boolean(conflictReason)}
                      disabledReason={conflictReason ?? undefined}
                    />
                  ) : null}
                  <AsyncStepButton
                    endpoint={`/api/tasks/${taskId}/batches/${batch.id}/cluster`}
                    label={clusterRun?.status === "failed" ? "重试类别建议" : "生成类别建议"}
                    className="secondaryButton"
                    disabled={Boolean(conflictReason)}
                    disabledReason={conflictReason ?? undefined}
                  />
                </div>
              ) : null}
              <div className="actionRow">
                <AsyncStepButton
                  endpoint={`/api/tasks/${taskId}/batches/${batch.id}/classify`}
                  label={hasClassifiedBefore ? "重新批量分类" : "批量分类"}
                  className="secondaryButton"
                  disabled={Boolean(conflictReason)}
                  disabledReason={conflictReason ?? undefined}
                />
                {classifyFailedCount > 0 ? (
                  <AsyncStepButton
                    endpoint={`/api/tasks/${taskId}/batches/${batch.id}/classify/retry-failed`}
                    label="分类失败重试"
                    className="ghostButton"
                    disabled={Boolean(conflictReason)}
                    disabledReason={conflictReason ?? undefined}
                  />
                ) : null}
              </div>
            </div>
          </details>
```

Keep the existing pending suggestion confirm/discard block so manual confirmation remains available when users generate suggestions manually.

- [ ] **Step 8: Remove the old `下一步` link path**

Delete the `showPostExtractActions` branch that renders the `下一步` link. The one-click path no longer needs `stage=cluster` as the default flow.

- [ ] **Step 9: Run lint**

Run:

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 10: Commit Tasks 3 and 4 together**

```bash
git add src/components/task-workspace-types.ts 'src/app/tasks/[taskId]/page.tsx' src/components/batch-detail-panel.tsx
git commit -m "Update batch UI for one-click classification"
```

---

## Task 5: Add CSS for Stage Progress

**Files:**
- Modify: `src/app/globals.css`

- [ ] **Step 1: Add stage tracker styles**

Append near the existing batch/progress styles:

```css
.oneClickProgressPanel {
  display: grid;
  gap: 10px;
}

.oneClickStageTrack {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.oneClickStage {
  border: 1px solid var(--surface-border);
  border-radius: 8px;
  color: var(--muted);
  font-size: 0.84rem;
  padding: 8px 10px;
  text-align: center;
}

.oneClickStageDone {
  border-color: var(--primary);
  color: var(--foreground);
}

.oneClickStageActive {
  border-color: var(--accent);
  color: var(--foreground);
}

.oneClickStageFailed {
  border-color: var(--danger);
  color: var(--danger);
}

.advancedActions {
  border-top: 1px solid var(--surface-border);
  padding-top: 12px;
}

.advancedActions summary {
  cursor: pointer;
  font-weight: 700;
}

@media (max-width: 760px) {
  .oneClickStageTrack {
    grid-template-columns: 1fr;
  }
}
```

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 3: Commit**

```bash
git add src/app/globals.css
git commit -m "Style one-click classification progress"
```

---

## Task 6: Reconcile Workflow Runs

**Files:**
- Modify: `src/lib/step-run-utils.ts`

- [ ] **Step 1: Include one-click runs in stalled reconciliation**

Update the candidate query:

```sql
AND sr.step_type IN (
  'extract_reasons',
  'classify',
  'classify_retry',
  'iterate_others_extract',
  'iterate_others_classify',
  'one_click_classify'
)
```

- [ ] **Step 2: Keep batch status mapping unchanged**

Do not map `one_click_classify` to a batch status in `mapRecoveredBatchStatus`. The sub-step run already owns the batch's operational status.

- [ ] **Step 3: Run existing tests**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/step-run-utils.ts
git commit -m "Reconcile stalled one-click workflow runs"
```

---

## Task 7: Final Verification

**Files:**
- Review all changed files.

- [ ] **Step 1: Run tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 2: Run lint**

Run:

```bash
npm run lint
```

Expected: no lint errors.

- [ ] **Step 3: Run build**

Run:

```bash
npm run build
```

Expected: production build completes successfully.

- [ ] **Step 4: Manual browser check**

Start the dev server:

```bash
npm run dev
```

Open the task page, select a batch, and verify:

- The primary button says `一键分类` or `重新一键分类`.
- Starting it shows the stage tracker.
- Extraction and classification show count progress.
- Manual controls are inside `高级操作`.
- A classify-only batch skips extraction and cluster stages.

- [ ] **Step 5: Check for verification fixes**

Run:

```bash
git status --short
```

Expected: no uncommitted files unless the verification steps produced a real fix. Commit any real fix with a specific message naming the fix, such as `git commit -m "Fix one-click progress stage inference"` after staging the exact files changed.

---

## Spec Coverage Check

- One-click default action: Task 4.
- Automatic category suggestion confirmation: Task 1.
- Empty cluster suggestions continue to classification: Task 1 tests and orchestrator confirm guard.
- Progress display: Tasks 3, 4, and 5.
- Existing manual controls preserved: Task 4 advanced operations.
- Stop on failure and show failed step: Task 1 workflow failure state and Task 4 failed tracker.
- API route: Task 2.
- Stalled workflow handling: Task 6.
- Verification: Task 7.
