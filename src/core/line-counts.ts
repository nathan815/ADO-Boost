export interface LineCountPart {
  kind: "minus" | "plus";
  text: string;
}

export function lineCountParts(additions: number, deletions: number): LineCountPart[] {
  const parts: LineCountPart[] = [];
  if (deletions > 0) parts.push({ kind: "minus", text: `\u2212${deletions}` });
  if (additions > 0) parts.push({ kind: "plus", text: `+${additions}` });
  return parts;
}
