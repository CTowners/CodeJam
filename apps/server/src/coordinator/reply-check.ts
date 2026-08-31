export function lastNonEmptyLine(text: string): string | null {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.length > 0 ? lines[lines.length - 1]! : null;
}

/** No pattern set means every reply passes. */
export function matchesReplyPattern(reply: string, pattern: string | undefined): boolean {
  if (!pattern) return true;
  const line = lastNonEmptyLine(reply);
  if (line === null) return false;
  return new RegExp(pattern).test(line);
}
