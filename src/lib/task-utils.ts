import { createHash } from "node:crypto";

export function hashText(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function inferColumns(headers: string[]) {
  const idCandidates = ["id", "ID", "大用户ID", "user_id", "dialog_id"];
  const textCandidates = ["text", "文本", "完整的对话文本", "对话内容", "content"];

  const idColumn = headers.find((header) => idCandidates.includes(header));
  const textColumn = headers.find((header) => textCandidates.includes(header));

  return { idColumn, textColumn };
}

export function formatPercent(numerator: number, denominator: number) {
  if (!denominator) {
    return "0%";
  }

  return `${((numerator / denominator) * 100).toFixed(1)}%`;
}
