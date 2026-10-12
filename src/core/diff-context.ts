import { diffLines } from "diff";
import type { AdoApi } from "../adapters/ado-api";
import type { CopilotExcerpt } from "./copilot-gateway";
import type { FileStat, PullRequestContext } from "./types";

export const MAX_COPILOT_FILES = 20;
export const MAX_COPILOT_EXCERPT_BYTES = 128 * 1024;
const MAX_FILE_EXCERPT_BYTES = 32_000;
const MAX_CHANGED_LINES_PER_FILE = 200;

export async function buildCopilotExcerpts(api: AdoApi, context: PullRequestContext, files: FileStat[]): Promise<CopilotExcerpt[]> {
  const excerpts: CopilotExcerpt[] = [];
  let remaining = MAX_COPILOT_EXCERPT_BYTES;
  for (const file of files.slice(0, MAX_COPILOT_FILES)) {
    if (remaining <= 0 || file.state === "binary" || file.state === "unavailable") {
      excerpts.push({ path: file.path, comparison: context.identity, omitted: true, text: "" });
      continue;
    }
    try {
      const type = file.changeType.toLowerCase();
      const [before, after] = await Promise.all([
        type.includes("add") ? Promise.resolve({ text: "" }) : api.getFileContent(context, file.originalPath ?? file.path, context.mergeBaseCommit),
        type.includes("delete") ? Promise.resolve({ text: "" }) : api.getFileContent(context, file.path, context.sourceCommit)
      ]);
      const text = changedLineExcerpt(before.text, after.text);
      const bytes = new TextEncoder().encode(text);
      const allowed = Math.min(MAX_FILE_EXCERPT_BYTES, remaining);
      const bounded = bytes.length <= allowed ? text : new TextDecoder().decode(bytes.subarray(0, allowed));
      remaining -= new TextEncoder().encode(bounded).length;
      excerpts.push({ path: file.path, comparison: context.identity, omitted: bounded.length < text.length, text: bounded });
    } catch {
      excerpts.push({ path: file.path, comparison: context.identity, omitted: true, text: "" });
    }
  }
  return excerpts;
}

export function changedLineExcerpt(before: string, after: string): string {
  let oldLine = 1;
  let newLine = 1;
  let changed = 0;
  const output: string[] = [];
  for (const part of diffLines(normalize(before), normalize(after), { ignoreNewlineAtEof: true })) {
    for (const text of linesOf(part.value)) {
      if (part.added) {
        if (changed < MAX_CHANGED_LINES_PER_FILE) output.push(`L${newLine}:right:+ ${text}`);
        newLine += 1;
        changed += 1;
      } else if (part.removed) {
        if (changed < MAX_CHANGED_LINES_PER_FILE) output.push(`L${oldLine}:left:- ${text}`);
        oldLine += 1;
        changed += 1;
      } else {
        oldLine += 1;
        newLine += 1;
      }
    }
  }
  if (changed > MAX_CHANGED_LINES_PER_FILE) output.push(`[${changed - MAX_CHANGED_LINES_PER_FILE} additional changed lines omitted]`);
  return output.join("\n");
}

function normalize(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function linesOf(value: string): string[] {
  if (!value) return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}
