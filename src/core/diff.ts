import { diffLines } from "diff";
import type { FileStat, ChangedFile } from "./types";

export const MAX_FILE_BYTES = 2 * 1024 * 1024;

export interface TextPair {
  before: string | null;
  after: string | null;
  beforeSize?: number;
  afterSize?: number;
}

function normalize(text: string): string {
  return text.replace(/\r\n?/g, "\n");
}

function lineCount(value: string): number {
  if (!value) return 0;
  const newlines = value.match(/\n/g)?.length ?? 0;
  return newlines + (value.endsWith("\n") ? 0 : 1);
}

export function looksBinary(text: string): boolean {
  return text.includes("\0");
}

export function countChangedLines(file: ChangedFile, pair: TextPair): FileStat {
  const path = file.path.toLowerCase();
  const base = {
    ...file,
    generated: isGeneratedPath(path),
    lockfile: isLockfile(path)
  };

  if ((pair.beforeSize ?? 0) > MAX_FILE_BYTES || (pair.afterSize ?? 0) > MAX_FILE_BYTES) {
    return { ...base, additions: null, deletions: null, state: "unavailable", detail: "File exceeds the 2 MiB analysis limit" };
  }

  if ((pair.before && looksBinary(pair.before)) || (pair.after && looksBinary(pair.after))) {
    return { ...base, additions: null, deletions: null, state: "binary", detail: "Binary content" };
  }

  if (pair.before === null && file.changeType.toLowerCase().includes("delete")) {
    return { ...base, additions: 0, deletions: null, state: "partial", detail: "Base content was unavailable" };
  }
  if (pair.after === null && !file.changeType.toLowerCase().includes("delete")) {
    return { ...base, additions: null, deletions: 0, state: "partial", detail: "Source content was unavailable" };
  }

  const before = normalize(pair.before ?? "");
  const after = normalize(pair.after ?? "");
  let additions = 0;
  let deletions = 0;

  for (const part of diffLines(before, after, { newlineIsToken: false, ignoreNewlineAtEof: true })) {
    if (part.added) additions += lineCount(part.value);
    if (part.removed) deletions += lineCount(part.value);
  }

  return { ...base, additions, deletions, state: "exact" };
}

export function unavailableStat(file: ChangedFile, detail: string): FileStat {
  const path = file.path.toLowerCase();
  return {
    ...file,
    additions: null,
    deletions: null,
    state: "error",
    detail,
    generated: isGeneratedPath(path),
    lockfile: isLockfile(path)
  };
}

export function isGeneratedPath(path: string): boolean {
  return /(^|\/)(dist|build|out|coverage|generated|vendor)\//i.test(path)
    || /\.(min\.(js|css)|designer\.cs|g\.cs|generated\.[^.]+)$/i.test(path);
}

export function isLockfile(path: string): boolean {
  return /(^|\/)(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|cargo\.lock|poetry\.lock|composer\.lock|packages\.lock\.json)$/i.test(path);
}

export function totalStats(files: FileStat[], unresolvedChanges = 0): { additions: number; deletions: number; exact: boolean; incomplete: number } {
  let additions = 0;
  let deletions = 0;
  let incomplete = unresolvedChanges;
  for (const file of files) {
    if (file.additions === null || file.deletions === null || file.state !== "exact") incomplete += 1;
    additions += file.additions ?? 0;
    deletions += file.deletions ?? 0;
  }
  return { additions, deletions, exact: incomplete === 0, incomplete };
}
