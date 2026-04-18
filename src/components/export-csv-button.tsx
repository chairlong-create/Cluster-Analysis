"use client";

import { useState } from "react";

type ExportCsvButtonProps = {
  href: string;
};

function getFilenameFromContentDisposition(contentDisposition: string | null) {
  const encodedMatch = contentDisposition?.match(/filename\*=UTF-8''([^;]+)/i);
  if (encodedMatch?.[1]) {
    return decodeURIComponent(encodedMatch[1]);
  }

  const quotedMatch = contentDisposition?.match(/filename="([^"]+)"/i);
  if (quotedMatch?.[1]) {
    return quotedMatch[1];
  }

  return "task-analysis.csv";
}

export function ExportCsvButton({ href }: ExportCsvButtonProps) {
  const [status, setStatus] = useState<"idle" | "loading" | "failed">("idle");

  async function downloadCsv() {
    setStatus("loading");

    try {
      const response = await fetch(href, {
        cache: "no-store",
        credentials: "same-origin",
      });

      if (!response.ok) {
        throw new Error(`导出失败: ${response.status}`);
      }

      const blob = await response.blob();
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = getFilenameFromContentDisposition(response.headers.get("Content-Disposition"));
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      setStatus("idle");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="exportButtonStack">
      <button type="button" className="primaryButton" onClick={downloadCsv} disabled={status === "loading"}>
        {status === "loading" ? "正在导出..." : "导出当前任务 CSV"}
      </button>
      {status === "failed" ? <span className="inlineErrorText">导出失败，请稍后重试</span> : null}
    </div>
  );
}
