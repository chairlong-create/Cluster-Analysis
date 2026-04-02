import Link from "next/link";
import { notFound } from "next/navigation";

import { db } from "@/lib/db";
import { reconcileStalledStepRuns } from "@/lib/step-run-utils";
import { getCurrentUser } from "@/lib/current-user";

type LogsPageProps = {
  params: Promise<{
    taskId: string;
  }>;
  searchParams?: Promise<{
    batchId?: string;
  }>;
};

type RunRow = {
  id: string;
  batchId: string | null;
  batchFileName: string | null;
  stepType: string;
  roundNo: number;
  status: string;
  inputCount: number;
  successCount: number;
  failedCount: number;
  startedAt: string;
  finishedAt: string | null;
};

function prettyJson(value: string | null) {
  if (!value) {
    return "";
  }

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export default async function TaskLogsPage({ params, searchParams }: LogsPageProps) {
  const { userId } = await getCurrentUser();
  reconcileStalledStepRuns();

  const { taskId } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const selectedBatchId = resolvedSearchParams?.batchId;
  const backHref = selectedBatchId ? `/tasks/${taskId}?batchId=${selectedBatchId}` : `/tasks/${taskId}`;

  const task = db
    .prepare(`
      SELECT id, name, description
      FROM tasks
      WHERE id = ? AND user_id = ?
    `)
    .get(taskId, userId) as { id: string; name: string; description: string | null } | undefined;

  if (!task) {
    notFound();
  }

  const runs = db
    .prepare(`
      SELECT
        sr.id,
        sr.batch_id AS batchId,
        b.file_name AS batchFileName,
        sr.step_type AS stepType,
        sr.round_no AS roundNo,
        sr.status,
        sr.input_count AS inputCount,
        sr.success_count AS successCount,
        sr.failed_count AS failedCount,
        sr.started_at AS startedAt,
        sr.finished_at AS finishedAt
      FROM step_runs sr
      LEFT JOIN batches b ON b.id = sr.batch_id
      WHERE sr.task_id = ?
      ORDER BY sr.started_at DESC
      LIMIT 30
    `)
    .all(taskId) as RunRow[];

  const runIds = runs.map((run) => run.id);
  const items = runIds.length
    ? (db
        .prepare(`
          SELECT
            id,
            step_run_id AS stepRunId,
            dialog_id AS dialogId,
            raw_output_json AS rawOutputJson,
            parsed_status AS parsedStatus,
            error_message AS errorMessage,
            created_at AS createdAt
          FROM step_run_items
          WHERE step_run_id IN (${runIds.map(() => "?").join(",")})
          ORDER BY created_at DESC
        `)
        .all(...runIds) as Array<{
        id: string;
        stepRunId: string;
        dialogId: string | null;
        rawOutputJson: string | null;
        parsedStatus: string;
        errorMessage: string | null;
        createdAt: string;
      }>)
    : [];

  const llmLogs = runIds.length
    ? (db
        .prepare(`
          SELECT
            id,
            step_run_id AS stepRunId,
            dialog_id AS dialogId,
            call_type AS callType,
            provider,
            model,
            prompt_text AS promptText,
            response_text AS responseText,
            status,
            latency_ms AS latencyMs,
            created_at AS createdAt
          FROM llm_call_logs
          WHERE step_run_id IN (${runIds.map(() => "?").join(",")})
          ORDER BY created_at DESC
        `)
        .all(...runIds) as Array<{
        id: string;
        stepRunId: string;
        dialogId: string | null;
        callType: string;
        provider: string;
        model: string | null;
        promptText: string | null;
        responseText: string | null;
        status: string;
        latencyMs: number | null;
        createdAt: string;
      }>)
    : [];

  const itemsByRun = new Map<string, typeof items>();
  for (const item of items) {
    const group = itemsByRun.get(item.stepRunId) ?? [];
    group.push(item);
    itemsByRun.set(item.stepRunId, group);
  }

  const logsByRun = new Map<string, typeof llmLogs>();
  for (const log of llmLogs) {
    const group = logsByRun.get(log.stepRunId) ?? [];
    group.push(log);
    logsByRun.set(log.stepRunId, group);
  }

  return (
    <main className="workspaceShell">
      <header className="workspaceHeader">
        <div>
          <Link href={backHref} className="backLink" scroll={false}>
            返回任务工作台
          </Link>
          <p className="eyebrow">Task Logs</p>
          <h1>{task.name} 日志查看页</h1>
          <p className="heroCopy">
            按步骤运行查看执行状态、解析结果、原始 prompt 和 response，优先服务排查和回溯。
          </p>
        </div>
      </header>

      <section className="contentPanel">
        <article className="panel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Run History</p>
              <h2>最近步骤运行</h2>
            </div>
            <span className="badge">{runs.length} 个 run</span>
          </div>

          {runs.length ? (
            <div className="stack">
              {runs.map((run) => {
                const runItems = itemsByRun.get(run.id) ?? [];
                const runLogs = logsByRun.get(run.id) ?? [];
                const failedItems = runItems.filter(
                  (item) => item.parsedStatus === "failed" || Boolean(item.errorMessage),
                );
                const failedLogs = runLogs.filter((log) => log.status === "failed");
                const successfulItems = runItems.filter(
                  (item) => item.parsedStatus !== "failed" && !item.errorMessage,
                );
                const successfulLogs = runLogs.filter((log) => log.status !== "failed");
                const tracedCount = Math.max(runItems.length, runLogs.length);
                const missingTraceCount = Math.max(run.inputCount - tracedCount, 0);
                const hasInvisibleFailures = run.failedCount > 0 && failedItems.length === 0 && failedLogs.length === 0;

                return (
                  <article key={run.id} className="logRunCard">
                    <div className="taskCardHeader">
                      <div>
                        <h3>
                          {run.stepType} · round {run.roundNo}
                        </h3>
                        <p>{run.batchFileName || "任务级运行"}</p>
                      </div>
                      <span className="badge">{run.status}</span>
                    </div>

                    <div className="taskStats">
                      <span>输入 {run.inputCount}</span>
                      <span>成功 {run.successCount}</span>
                      <span>失败 {run.failedCount}</span>
                      <span>
                        开始于{" "}
                        {new Intl.DateTimeFormat("zh-CN", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        }).format(new Date(run.startedAt))}
                      </span>
                      {run.finishedAt ? (
                        <span>
                          结束于{" "}
                          {new Intl.DateTimeFormat("zh-CN", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          }).format(new Date(run.finishedAt))}
                        </span>
                      ) : null}
                    </div>

                    {hasInvisibleFailures || missingTraceCount > 0 ? (
                      <article className="logFailureGroup">
                        <div className="taskCardHeader">
                          <div>
                            <h3>未完整落库的失败 case</h3>
                            <p>这轮运行存在失败计数，但没有完整的失败 item / LLM log 明细，通常表示执行过程中有 case 提前中断。</p>
                          </div>
                          <span className="badge">{Math.max(run.failedCount, missingTraceCount)} 条</span>
                        </div>
                        <p className="logError">
                          当前 run 记录为输入 {run.inputCount} 条、失败 {run.failedCount} 条，但只落库了 {runItems.length} 条结构化 item、{runLogs.length} 条
                          LLM 调用日志。
                          {missingTraceCount > 0 ? ` 其中至少有 ${missingTraceCount} 条没有生成完整追踪记录。` : ""}
                        </p>
                      </article>
                    ) : null}

                    <div className="logColumns">
                      <section className="logPanel">
                        <div className="sectionHeader compactHeader">
                          <div>
                            <p className="eyebrow">Parsed Items</p>
                            <h2>结构化输出</h2>
                          </div>
                          <span className="badge">{runItems.length}</span>
                        </div>
                        <div className="stack compactStack">
                          {failedItems.length ? (
                            <article className="logFailureGroup">
                              <div className="taskCardHeader">
                                <div>
                                  <h3>失败的结构化输出</h3>
                                  <p>这些 item 解析失败或写入时抛错，优先排查。</p>
                                </div>
                                <span className="badge">{failedItems.length}</span>
                              </div>
                              <div className="stack compactStack">
                                {failedItems.map((item) => (
                                  <article key={`failed-item-${item.id}`} className="logEntry logFailureCard">
                                    <div className="taskStats">
                                      <span>{item.parsedStatus}</span>
                                      <span>{item.dialogId || "无 dialog id"}</span>
                                    </div>
                                    {item.errorMessage ? <p className="logError">{item.errorMessage}</p> : null}
                                    {item.rawOutputJson ? (
                                      <pre className="logCode">{prettyJson(item.rawOutputJson)}</pre>
                                    ) : null}
                                  </article>
                                ))}
                              </div>
                            </article>
                          ) : null}
                          {runItems.length ? (
                            successfulItems.slice(0, 6).map((item) => (
                              <article key={item.id} className="logEntry">
                                <div className="taskStats">
                                  <span>{item.parsedStatus}</span>
                                  <span>{item.dialogId || "无 dialog id"}</span>
                                </div>
                                {item.errorMessage ? <p className="logError">{item.errorMessage}</p> : null}
                                {item.rawOutputJson ? (
                                  <pre className="logCode">{prettyJson(item.rawOutputJson)}</pre>
                                ) : null}
                              </article>
                            ))
                          ) : (
                            <div className="emptyState">
                              <h3>没有 item</h3>
                              <p>当前 run 没有结构化 item 输出。</p>
                            </div>
                          )}
                        </div>
                      </section>

                      <section className="logPanel">
                        <div className="sectionHeader compactHeader">
                          <div>
                            <p className="eyebrow">LLM Calls</p>
                            <h2>调用日志</h2>
                          </div>
                          <span className="badge">{runLogs.length}</span>
                        </div>
                        <div className="stack compactStack">
                          {failedLogs.length ? (
                            <article className="logFailureGroup">
                              <div className="taskCardHeader">
                                <div>
                                  <h3>失败的 LLM 调用</h3>
                                  <p>这些调用返回失败，建议优先查看 response 和错误上下文。</p>
                                </div>
                                <span className="badge">{failedLogs.length}</span>
                              </div>
                              <div className="stack compactStack">
                                {failedLogs.map((log) => (
                                  <article key={`failed-log-${log.id}`} className="logEntry logFailureCard">
                                    <div className="taskStats">
                                      <span>{log.callType}</span>
                                      <span>{log.provider}</span>
                                      <span>{log.model || "unknown model"}</span>
                                      <span>{log.status}</span>
                                      {log.latencyMs !== null ? <span>{log.latencyMs} ms</span> : null}
                                    </div>
                                    <details className="logDetails" open>
                                      <summary>失败 Response</summary>
                                      <pre className="logCode">{prettyJson(log.responseText)}</pre>
                                    </details>
                                    <details className="logDetails">
                                      <summary>Prompt</summary>
                                      <pre className="logCode">{log.promptText || "空"}</pre>
                                    </details>
                                  </article>
                                ))}
                              </div>
                            </article>
                          ) : null}
                          {runLogs.length ? (
                            successfulLogs.slice(0, 4).map((log) => (
                              <article key={log.id} className="logEntry">
                                <div className="taskStats">
                                  <span>{log.callType}</span>
                                  <span>{log.provider}</span>
                                  <span>{log.model || "unknown model"}</span>
                                  <span>{log.status}</span>
                                  {log.latencyMs !== null ? <span>{log.latencyMs} ms</span> : null}
                                </div>
                                <details className="logDetails">
                                  <summary>Prompt</summary>
                                  <pre className="logCode">{log.promptText || "空"}</pre>
                                </details>
                                <details className="logDetails">
                                  <summary>Response</summary>
                                  <pre className="logCode">{prettyJson(log.responseText)}</pre>
                                </details>
                              </article>
                            ))
                          ) : (
                            <div className="emptyState">
                              <h3>没有 LLM 日志</h3>
                              <p>当前 run 没有原始调用记录。</p>
                            </div>
                          )}
                        </div>
                      </section>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className="emptyState">
              <h3>还没有日志</h3>
              <p>先在任务工作台执行一次提取、聚类或分类，日志页才会有内容。</p>
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
