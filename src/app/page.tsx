import Link from "next/link";

import {
  createTaskAction,
  deleteTaskAction,
  updateAppSettingsAction,
  updatePromptSettingsAction,
} from "@/app/actions";
import { DeleteTaskForm } from "@/components/delete-task-form";
import { getAppSettings } from "@/lib/app-config";
import { db } from "@/lib/db";
import { getPromptSettings, promptReferences } from "@/lib/prompt-config";

type HomeProps = {
  searchParams?: Promise<{
    settingsSaved?: string;
    promptSaved?: string;
  }>;
};

export default async function Home({ searchParams }: HomeProps) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const settingsSaved = resolvedSearchParams?.settingsSaved === "1";
  const promptSaved = resolvedSearchParams?.promptSaved === "1";
  const settings = getAppSettings();
  const promptSettings = getPromptSettings();
  const tasks = db
    .prepare(`
      SELECT
        t.id,
        t.name,
        t.description,
        t.updated_at AS updatedAt,
        (
          SELECT COUNT(*)
          FROM batches b
          WHERE b.task_id = t.id
        ) AS batchCount,
        (
          SELECT COUNT(*)
          FROM dialogs d
          WHERE d.task_id = t.id
        ) AS dialogCount,
        (
          SELECT COUNT(*)
          FROM categories c
          WHERE c.task_id = t.id
        ) AS categoryCount
      FROM tasks t
      ORDER BY t.updated_at DESC
    `)
    .all() as Array<{
    id: string;
    name: string;
    description: string | null;
    updatedAt: string;
    batchCount: number;
    dialogCount: number;
    categoryCount: number;
  }>;

  return (
    <main className="shell">
      <section className="hero homeHero">
        <div className="homeHeroMain">
          <p className="eyebrow">Conversation Clustering Workbench</p>
          <h1>对话聚类分析工作台</h1>
          <p className="heroCopy">
            面向真实业务对话的本地分析台。先建立类别体系，再把后续批次直接归类，让信号提取、聚类、分类和收敛在同一套工作流里闭环。
          </p>
        </div>
      </section>

      <section className="homeLayout">
        <article className="panel homeSectionPanel homeTasksPanel" id="task-list">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Workspace</p>
              <h2>已有任务</h2>
            </div>
            <span className="badge">{tasks.length} 个任务</span>
          </div>
          <p className="hint sectionLead">
            从这里进入具体任务工作区。首页只做入口和全局配置，不承担分析过程本身。
          </p>
          <div className="homeTaskList">
            {tasks.length ? (
              tasks.map((task) => (
                <article key={task.id} className="taskCard homeTaskCard">
                  <div className="homeTaskCardBody">
                    <div className="homeTaskCardContent">
                      <div className="homeTaskCardMain">
                        <h3>{task.name}</h3>
                        <p>{task.description || "暂无任务说明"}</p>
                      </div>
                      <div className="taskStats">
                        <span>{task.batchCount} 个批次</span>
                        <span>{task.dialogCount} 条对话</span>
                        <span>{Math.max(task.categoryCount - 1, 0)} 个自定义类别</span>
                      </div>
                    </div>
                    <div className="homeTaskActions">
                      <Link href={`/tasks/${task.id}`} className="secondaryButton homeTaskLink">
                        进入工作台
                      </Link>
                      <DeleteTaskForm action={deleteTaskAction} taskId={task.id} taskName={task.name} />
                    </div>
                  </div>
                </article>
              ))
            ) : (
              <div className="emptyState">
                <h3>还没有任务</h3>
                <p>先创建一个任务，再在任务内上传 CSV、维护类别表和启动分析步骤。</p>
              </div>
            )}
          </div>
        </article>

        <article className="panel homeSectionPanel" id="create-task">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Task Setup</p>
              <h2>新建任务</h2>
            </div>
          </div>
          <details className="managementDetails homePromptDetails" open={tasks.length === 0}>
            <summary>{tasks.length === 0 ? "请先创建第一个任务" : "展开新建任务"}</summary>
            <p className="hint sectionLead">
              先定义一个业务场景，再在任务内持续演进类别表、上传批次并完成分析。
            </p>
            <form action={createTaskAction} className="stack">
              <label className="field">
                <span>任务名称</span>
                <input name="name" placeholder="例如：表达课客户反馈分析" required />
              </label>
              <label className="field">
                <span>任务说明</span>
                <textarea
                  name="description"
                  rows={4}
                  placeholder="描述这个任务对应的业务场景、时间范围或数据来源。"
                />
              </label>
              <label className="field">
                <span>分析目标</span>
                <input
                  name="analysisGoal"
                  defaultValue="分析对话中的关键模式"
                  placeholder="例如：分析客户认可服务的方面"
                  required
                />
              </label>
              <button type="submit" className="primaryButton">
                创建任务并进入工作台
              </button>
            </form>
          </details>
        </article>

        <article className="panel homeSectionPanel homeConfigPanel">
            <div className="sectionHeader">
              <div>
                <p className="eyebrow">App Settings</p>
                <h2>模型与并发配置</h2>
              </div>
            </div>
            <details className="managementDetails homePromptDetails">
              <summary>展开模型与并发配置</summary>
              <form action={updateAppSettingsAction} className="stack">
                <label className="field">
                  <span>OpenAI-compatible API Key</span>
                  <input
                    name="llmApiKey"
                    type="password"
                    defaultValue={settings.llmApiKey}
                    placeholder="未填写时自动使用 mock 模式"
                  />
                </label>
                <label className="field">
                  <span>Base URL</span>
                  <input name="llmBaseUrl" defaultValue={settings.llmBaseUrl} required />
                </label>
                <label className="field">
                  <span>模型名称</span>
                  <input name="llmModel" defaultValue={settings.llmModel} required />
                </label>
                <div className="grid twoColumns">
                  <label className="field">
                    <span>提取并发</span>
                    <input
                      name="extractionConcurrency"
                      type="number"
                      min={1}
                      max={50}
                      defaultValue={settings.extractionConcurrency}
                      required
                    />
                  </label>
                  <label className="field">
                    <span>分类并发</span>
                    <input
                      name="classifyConcurrency"
                      type="number"
                      min={1}
                      max={50}
                      defaultValue={settings.classifyConcurrency}
                      required
                    />
                  </label>
                </div>
                {settingsSaved ? <p className="successText">应用配置已保存并生效。</p> : null}
                <p className="hint">
                  这里按 OpenAI-compatible 接口方式调用模型。MiniMax 也可以作为兼容端点接入使用。未填写 API Key 时自动走 mock 模式。
                </p>
                <button type="submit" className="primaryButton">
                  保存应用配置
                </button>
              </form>
            </details>
        </article>

        <article className="panel homeSectionPanel homePromptPanel">
          <div className="sectionHeader">
            <div>
              <p className="eyebrow">Prompt Settings</p>
              <h2>LLM 提示词配置</h2>
            </div>
          </div>
          <details className="managementDetails homePromptDetails">
            <summary>展开 Prompt 维护</summary>
            <form action={updatePromptSettingsAction} className="stack">
              <div className="grid twoColumns">
                <label className="field">
                  <span>提取参考模板（只读）</span>
                  <textarea rows={8} value={promptReferences.extraction} readOnly />
                </label>
                <label className="field">
                  <span>提取实际生效 Prompt</span>
                  <textarea name="extractionSystemPrompt" rows={8} defaultValue={promptSettings.extractionSystemPrompt} required />
                </label>
              </div>
              <div className="grid twoColumns">
                <label className="field">
                  <span>聚类参考模板（只读）</span>
                  <textarea rows={8} value={promptReferences.clustering} readOnly />
                </label>
                <label className="field">
                  <span>聚类实际生效 Prompt</span>
                  <textarea name="clusteringSystemPrompt" rows={6} defaultValue={promptSettings.clusteringSystemPrompt} required />
                </label>
              </div>
              <div className="grid twoColumns">
                <label className="field">
                  <span>分类参考模板（只读）</span>
                  <textarea rows={10} value={promptReferences.classification} readOnly />
                </label>
                <label className="field">
                  <span>分类实际生效 Prompt</span>
                  <textarea
                    name="classificationSystemPrompt"
                    rows={10}
                    defaultValue={promptSettings.classificationSystemPrompt}
                    required
                  />
                </label>
              </div>
              <div className="grid twoColumns">
                <label className="field">
                  <span>合并类别参考模板（只读）</span>
                  <textarea rows={10} value={promptReferences.categoryMerge} readOnly />
                </label>
                <label className="field">
                  <span>合并类别实际生效 Prompt</span>
                  <textarea
                    name="categoryMergeSystemPrompt"
                    rows={10}
                    defaultValue={promptSettings.categoryMergeSystemPrompt}
                    required
                  />
                </label>
              </div>
              {promptSaved ? <p className="successText">Prompt 配置已保存并生效。</p> : null}
              <p className="hint">
                左侧是参考模板，只用于展示，不会被代码直接使用。右侧才是实际生效的 Prompt；如果你从未修改过，右侧默认值与左侧模板相同。
              </p>
              <p className="hint">
                实际生效 Prompt 支持变量：提取 <code>{"{{dialog_id}}"}</code> <code>{"{{dialog_text}}"}</code>；聚类{" "}
                <code>{"{{reasons_list}}"}</code>；分类 <code>{"{{category_list}}"}</code>{" "}
                <code>{"{{extracted_reason}}"}</code> <code>{"{{dialog_text}}"}</code>；合并类别{" "}
                <code>{"{{max_target_count}}"}</code> <code>{"{{merge_category_list}}"}</code>。
              </p>
              <button type="submit" className="primaryButton">
                保存 Prompt 配置
              </button>
            </form>
          </details>
        </article>
      </section>
    </main>
  );
}
