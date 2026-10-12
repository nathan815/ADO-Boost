import { diffLines, diffWordsWithSpace } from "diff";
import type { AdoApi } from "../adapters/ado-api";
import { MAX_FILE_BYTES } from "../core/diff";
import type { FileStat, PullRequestContext } from "../core/types";

const PREVIEW_ROWS = 500;
const MAX_RENDER_ROWS = 5000;

export interface DiffRow {
  kind: "context" | "add" | "remove";
  text: string;
  oldLine: number | null;
  newLine: number | null;
  emphasized?: string;
}

type DisplayRow = DiffRow | { kind: "collapsed"; count: number };

export class DiffDialog {
  constructor(
    private readonly api: AdoApi,
    private readonly context: PullRequestContext,
    private readonly onDraft?: (root: ShadowRoot, path: string, trackingId: number, line: number, side: "left" | "right") => void
  ) {}

  async open(root: ShadowRoot, file: FileStat): Promise<void> {
    const backdrop = document.createElement("div");
    backdrop.className = "dialog-backdrop";
    backdrop.innerHTML = `<section class="dialog diff-dialog" role="dialog" aria-modal="true"><h3>${escapeHtml(file.path)}</h3><p>Loading comparison…</p><div class="dialog-actions"><button class="secondary close-dialog" type="button">Close</button></div></section>`;
    root.append(backdrop);
    backdrop.querySelector(".close-dialog")?.addEventListener("click", () => backdrop.remove());
    try {
      const iterations = await this.api.getIterations(this.context);
      const previous = iterations.filter((iteration) => iteration.id < this.context.iterationId).at(-1);
      await this.loadComparison(root, backdrop, file, this.context.mergeBaseCommit, this.context.sourceCommit, "Merge base", previous);
    } catch (error) {
      const paragraph = backdrop.querySelector("p");
      if (paragraph) paragraph.textContent = error instanceof Error ? error.message : "Diff loading failed";
    }
  }

  private async loadComparison(root: ShadowRoot, backdrop: HTMLElement, file: FileStat, baseCommit: string, sourceCommit: string, label: string, previous?: { id: number; sourceCommit: string }): Promise<void> {
    const type = file.changeType.toLowerCase();
    const [before, after] = await Promise.all([
      type.includes("add") && baseCommit === this.context.mergeBaseCommit ? Promise.resolve({ text: "", size: 0 }) : this.api.getFileContent(this.context, file.originalPath ?? file.path, baseCommit),
      type.includes("delete") ? Promise.resolve({ text: "", size: 0 }) : this.api.getFileContent(this.context, file.path, sourceCommit)
    ]);
    if (before.size > MAX_FILE_BYTES || after.size > MAX_FILE_BYTES) throw new Error("Extension diff is unavailable because this file exceeds the 2 MiB limit");
    const rows = buildDiffRows(before.text, after.text);
    const section = backdrop.querySelector<HTMLElement>(".diff-dialog");
    if (!section) return;
    const large = rows.length > PREVIEW_ROWS;
    section.innerHTML = `<div class="diff-head"><div><h3>${escapeHtml(file.path)}</h3><p>${escapeHtml(label)} comparison · ${rows.length} rows · normalized line endings</p></div><div class="diff-options"><select class="select diff-comparison"><option value="merge-base" ${label === "Merge base" ? "selected" : ""}>Merge base</option>${previous ? `<option value="${previous.sourceCommit}" ${baseCommit === previous.sourceCommit ? "selected" : ""}>Since iteration ${previous.id}</option>` : ""}</select><select class="select diff-layout"><option value="unified">Unified</option><option value="split">Side by side</option></select><label><input class="collapse-context" type="checkbox" checked> Collapse unchanged</label><label><input class="whitespace" type="checkbox"> Whitespace</label></div></div>${large ? `<div class="delivery">Large diff preview shows the first ${PREVIEW_ROWS} rows.${rows.length <= MAX_RENDER_ROWS ? ` <button class="secondary load-full-diff" type="button">Render all ${rows.length}</button>` : ` Full rendering is disabled above ${MAX_RENDER_ROWS} rows; use the native ADO file view for the complete diff.`}</div>` : ""}<div class="diff-code" data-layout="unified">${renderRows(rows.slice(0, large ? PREVIEW_ROWS : rows.length), file)}</div><div class="dialog-actions"><button class="secondary close-dialog" type="button">Close</button></div>`;
    section.querySelector(".close-dialog")?.addEventListener("click", () => backdrop.remove());
    const render = (limit: number) => {
      const code = section.querySelector<HTMLElement>(".diff-code");
      const showWhitespace = section.querySelector<HTMLInputElement>(".whitespace")?.checked ?? false;
      const collapseContext = section.querySelector<HTMLInputElement>(".collapse-context")?.checked ?? true;
      const layout = section.querySelector<HTMLSelectElement>(".diff-layout")?.value ?? "unified";
      if (code) {
        code.dataset.layout = layout;
        code.innerHTML = renderRows(rows.slice(0, limit), file, showWhitespace, layout === "split", collapseContext);
        this.bindDraftButtons(root, code, file);
      }
    };
    section.querySelector<HTMLInputElement>(".whitespace")?.addEventListener("change", () => render(large ? PREVIEW_ROWS : rows.length));
    section.querySelector<HTMLInputElement>(".collapse-context")?.addEventListener("change", () => render(large ? PREVIEW_ROWS : rows.length));
    section.querySelector<HTMLSelectElement>(".diff-layout")?.addEventListener("change", () => render(large ? PREVIEW_ROWS : rows.length));
    section.querySelector<HTMLSelectElement>(".diff-comparison")?.addEventListener("change", (event) => {
      const value = (event.target as HTMLSelectElement).value;
      const base = value === "merge-base" ? this.context.mergeBaseCommit : value;
      const nextLabel = value === "merge-base" ? "Merge base" : `Since iteration ${previous?.id ?? ""}`;
      void this.loadComparison(root, backdrop, file, base, this.context.sourceCommit, nextLabel, previous);
    });
    section.querySelector(".load-full-diff")?.addEventListener("click", (event) => {
      (event.currentTarget as HTMLElement).closest(".delivery")?.remove();
      render(rows.length);
    });
    this.bindDraftButtons(root, section, file);
  }

  private bindDraftButtons(root: ShadowRoot, container: ParentNode, file: FileStat): void {
    for (const button of container.querySelectorAll<HTMLButtonElement>("[data-diff-line]")) {
      button.addEventListener("click", () => {
        const line = Number(button.dataset.diffLine);
        const side = button.dataset.diffSide as "left" | "right";
        this.onDraft?.(root, file.path, file.trackingId, line, side);
      });
    }
  }
}

export function buildDiffRows(before: string, after: string): DiffRow[] {
  const parts = diffLines(normalize(before), normalize(after), { ignoreNewlineAtEof: true });
  const rows: DiffRow[] = [];
  let oldLine = 1;
  let newLine = 1;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!;
    const lines = linesOf(part.value);
    if (part.removed && parts[index + 1]?.added) {
      const added = parts[index + 1]!;
      const addedLines = linesOf(added.value);
      const paired = Math.max(lines.length, addedLines.length);
      for (let lineIndex = 0; lineIndex < paired; lineIndex += 1) {
        const removedText = lines[lineIndex];
        const addedText = addedLines[lineIndex];
        if (removedText !== undefined) {
          rows.push({ kind: "remove", text: removedText, oldLine, newLine: null, ...(addedText !== undefined ? { emphasized: emphasize(removedText, addedText, "remove") } : {}) });
          oldLine += 1;
        }
        if (addedText !== undefined) {
          rows.push({ kind: "add", text: addedText, oldLine: null, newLine, ...(removedText !== undefined ? { emphasized: emphasize(addedText, removedText, "add") } : {}) });
          newLine += 1;
        }
      }
      index += 1;
      continue;
    }
    for (const text of lines) {
      if (part.added) {
        rows.push({ kind: "add", text, oldLine: null, newLine });
        newLine += 1;
      } else if (part.removed) {
        rows.push({ kind: "remove", text, oldLine, newLine: null });
        oldLine += 1;
      } else {
        rows.push({ kind: "context", text, oldLine, newLine });
        oldLine += 1;
        newLine += 1;
      }
    }
  }
  return rows;
}

function renderRows(rows: DiffRow[], file: FileStat, showWhitespace = false, split = false, collapseContext = true): string {
  const displayed = collapseContext ? collapseRows(rows) : rows;
  if (split) return renderSplit(displayed, file, showWhitespace);
  return displayed.map((row) => {
    if (row.kind === "collapsed") return `<div class="diff-collapsed">⋯ ${row.count} unchanged lines collapsed</div>`;
    const line = row.newLine ?? row.oldLine;
    const side = row.kind === "remove" ? "left" : "right";
    const text = row.emphasized ?? highlight(row.text, file.path, showWhitespace);
    return `<div class="diff-row diff-${row.kind}"><span class="line-number">${row.oldLine ?? ""}</span><span class="line-number">${row.newLine ?? ""}</span><button class="diff-comment" type="button" data-diff-line="${line}" data-diff-side="${side}" title="Draft feedback on line ${line}">+</button><code>${prefix(row.kind)} ${text}</code></div>`;
  }).join("");
}

function renderSplit(rows: DisplayRow[], file: FileStat, showWhitespace: boolean): string {
  const output: string[] = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index]!;
    if (row.kind === "collapsed") {
      output.push(`<div class="diff-collapsed">⋯ ${row.count} unchanged lines collapsed</div>`);
      continue;
    }
    if (row.kind === "remove" && rows[index + 1]?.kind === "add") {
      const added = rows[index + 1] as DiffRow;
      output.push(splitRow(row, added, file, showWhitespace));
      index += 1;
    } else if (row.kind === "add") output.push(splitRow(undefined, row, file, showWhitespace));
    else if (row.kind === "remove") output.push(splitRow(row, undefined, file, showWhitespace));
    else output.push(splitRow(row, row, file, showWhitespace));
  }

  return output.join("");
}

function collapseRows(rows: DiffRow[]): DisplayRow[] {
  const output: DisplayRow[] = [];
  for (let index = 0; index < rows.length;) {
    if (rows[index]?.kind !== "context") {
      output.push(rows[index]!);
      index += 1;
      continue;
    }
    let end = index;
    while (rows[end]?.kind === "context") end += 1;
    const run = rows.slice(index, end);
    if (run.length > 10) output.push(...run.slice(0, 3), { kind: "collapsed", count: run.length - 6 }, ...run.slice(-3));
    else output.push(...run);
    index = end;
  }
  return output;
}

function splitRow(left: DiffRow | undefined, right: DiffRow | undefined, file: FileStat, showWhitespace: boolean): string {
  return `<div class="diff-split-row"><div class="diff-${left?.kind ?? "blank"}"><span class="line-number">${left?.oldLine ?? ""}</span>${left?.oldLine ? `<button class="diff-comment" data-diff-line="${left.oldLine}" data-diff-side="left">+</button>` : ""}<code>${left ? highlight(left.text, file.path, showWhitespace) : ""}</code></div><div class="diff-${right?.kind ?? "blank"}"><span class="line-number">${right?.newLine ?? ""}</span>${right?.newLine ? `<button class="diff-comment" data-diff-line="${right.newLine}" data-diff-side="right">+</button>` : ""}<code>${right ? highlight(right.text, file.path, showWhitespace) : ""}</code></div></div>`;
}

function emphasize(value: string, counterpart: string, kind: "add" | "remove"): string {
  const parts = kind === "add" ? diffWordsWithSpace(counterpart, value) : diffWordsWithSpace(value, counterpart);
  return parts.filter((part) => kind === "add" ? !part.removed : !part.added).map((part) => {
    const changed = kind === "add" ? part.added : part.removed;
    return changed ? `<mark>${escapeHtml(part.value)}</mark>` : escapeHtml(part.value);
  }).join("");
}

function highlight(value: string, path: string, showWhitespace: boolean): string {
  const visible = showWhitespace ? value.replace(/ /g, "·").replace(/\t/g, "→   ") : value;
  const escaped = escapeHtml(visible);
  if (!/\.(ts|tsx|js|jsx|json|cs|java|py|go|rs|css|html?)$/i.test(path)) return escaped;
  return escaped
    .replace(/(&quot;[^&]*?&quot;|&#039;[^&]*?&#039;)/g, `<span class="syntax-string">$1</span>`)
    .replace(/\b(const|let|var|function|class|interface|type|return|if|else|for|while|async|await|import|export|public|private|new|true|false|null)\b/g, `<span class="syntax-keyword">$1</span>`);
}

function linesOf(value: string): string[] {
  if (!value) return [];
  const lines = value.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

function normalize(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function prefix(kind: DiffRow["kind"]): string {
  return kind === "add" ? "+" : kind === "remove" ? "−" : " ";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] as string);
}
