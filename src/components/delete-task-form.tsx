"use client";

type DeleteTaskFormProps = {
  action: (formData: FormData) => void | Promise<void>;
  taskId: string;
  taskName: string;
};

export function DeleteTaskForm({ action, taskId, taskName }: DeleteTaskFormProps) {
  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const confirmed = window.confirm(
      `确认删除任务“${taskName}”吗？\n\n删除后会清除该任务下的全部批次、对话、类别、分析结果和日志数据，此操作不可恢复。`,
    );

    if (!confirmed) {
      event.preventDefault();
    }
  }

  return (
    <form action={action} onSubmit={handleSubmit} className="deleteTaskForm">
      <input type="hidden" name="taskId" value={taskId} />
      <button type="submit" className="textDangerButton" aria-label={`删除任务 ${taskName}`} title="删除任务">
        删除任务
      </button>
    </form>
  );
}
