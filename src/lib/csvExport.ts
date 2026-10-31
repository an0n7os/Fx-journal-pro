/** CSV text is untrusted too; negative numeric cells remain numeric. */
export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
