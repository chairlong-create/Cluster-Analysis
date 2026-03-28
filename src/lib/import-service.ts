import { parse } from "csv-parse/sync";
import { randomUUID } from "node:crypto";

import { db } from "@/lib/db";
import { hashText } from "@/lib/task-utils";

async function importSingleBatch(taskId: string, file: File) {
  if (!file.name.toLowerCase().endsWith(".csv")) {
    throw new Error(`文件 ${file.name} 不是 CSV`);
  }

  const buffer = await file.arrayBuffer();
  let csvText = "";

  try {
    csvText = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    throw new Error(`文件 ${file.name} 编码不是 UTF-8`);
  }

  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  }) as Record<string, string>[];

  if (!records.length) {
    throw new Error(`文件 ${file.name} 中没有可导入的数据`);
  }

  const headers = Object.keys(records[0] ?? {});
  const idColumn = headers[0];
  const textColumn = headers[1];

  if (!idColumn || !headers.includes(idColumn)) {
    throw new Error(`文件 ${file.name} 缺少第 1 列，无法识别 id 列`);
  }

  if (!textColumn || !headers.includes(textColumn)) {
    throw new Error(`文件 ${file.name} 缺少第 2 列，无法识别 text 列`);
  }

  const fileHash = hashText(csvText);
  const existingHashes = new Set(
    (
      db.prepare(`SELECT content_hash AS contentHash FROM dialogs WHERE task_id = ?`).all(taskId) as Array<{
        contentHash: string;
      }>
    ).map((dialog) => dialog.contentHash),
  );

  const rows = records
    .map((row) => ({
      sourceDialogId: String(row[idColumn] ?? "").trim(),
      sourceText: String(row[textColumn] ?? "").trim(),
    }))
    .filter((row) => row.sourceDialogId && row.sourceText);

  if (!rows.length) {
    throw new Error(`文件 ${file.name} 没有找到有效的前两列 id/text 数据`);
  }

  const toCreate: Array<{
    sourceDialogId: string;
    sourceText: string;
    contentHash: string;
  }> = [];
  let duplicateCount = 0;

  for (const row of rows) {
    const contentHash = hashText(row.sourceText);

    if (existingHashes.has(contentHash)) {
      duplicateCount += 1;
      continue;
    }

    existingHashes.add(contentHash);
    toCreate.push({
      ...row,
      contentHash,
    });
  }

  const now = new Date().toISOString();
  const batchId = randomUUID();
  const existingBatchCountRow = db
    .prepare(`SELECT COUNT(*) AS count FROM batches WHERE task_id = ?`)
    .get(taskId) as { count: number };
  const workflowMode = existingBatchCountRow.count === 0 ? "seed" : "classify_only";

  const insertBatch = db.prepare(`
    INSERT INTO batches (
      id, task_id, file_name, file_hash, source_id_column, source_text_column,
      row_count, imported_count, duplicate_count, status, workflow_mode, created_at, updated_at
    ) VALUES (
      @id, @taskId, @fileName, @fileHash, @sourceIdColumn, @sourceTextColumn,
      @rowCount, @importedCount, @duplicateCount, 'imported', @workflowMode, @createdAt, @updatedAt
    )
  `);
  const insertDialog = db.prepare(`
    INSERT INTO dialogs (
      id, task_id, batch_id, source_dialog_id, source_text, content_hash, created_at
    ) VALUES (
      @id, @taskId, @batchId, @sourceDialogId, @sourceText, @contentHash, @createdAt
    )
  `);
  const touchTask = db.prepare(`UPDATE tasks SET updated_at = ? WHERE id = ?`);

  db.transaction(() => {
    insertBatch.run({
      id: batchId,
      taskId,
      fileName: file.name,
      fileHash,
      sourceIdColumn: idColumn,
      sourceTextColumn: textColumn,
      rowCount: rows.length,
      importedCount: toCreate.length,
      duplicateCount,
      workflowMode,
      createdAt: now,
      updatedAt: now,
    });

    for (const row of toCreate) {
      insertDialog.run({
        id: randomUUID(),
        taskId,
        batchId,
        sourceDialogId: row.sourceDialogId,
        sourceText: row.sourceText,
        contentHash: row.contentHash,
        createdAt: now,
      });
    }

    touchTask.run(now, taskId);
  })();

  return { taskId, batchId, fileName: file.name };
}

export async function importBatchesFromFormData(formData: FormData) {
  const taskId = String(formData.get("taskId") || "").trim();
  const files = formData.getAll("files").filter((value): value is File => value instanceof File && value.size > 0);

  if (!taskId) {
    throw new Error("任务不存在");
  }

  if (!files.length) {
    throw new Error("请选择至少一个 CSV 文件");
  }

  if (files.length > 10) {
    throw new Error("一次最多上传 10 个批次文件");
  }

  const batchIds: string[] = [];
  const fileNames: string[] = [];

  for (const file of files) {
    const result = await importSingleBatch(taskId, file);
    batchIds.push(result.batchId);
    fileNames.push(result.fileName);
  }

  return { taskId, batchIds, fileNames };
}
