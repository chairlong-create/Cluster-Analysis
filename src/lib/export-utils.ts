function escapeCsvCell(value: string | null | undefined) {
  const text = value ?? "";
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, "\"\"")}"`;
  }

  return text;
}

export function toCsv(rows: string[][]) {
  return rows.map((row) => row.map((cell) => escapeCsvCell(cell)).join(",")).join("\n");
}
