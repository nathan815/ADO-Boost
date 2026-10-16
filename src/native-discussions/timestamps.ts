import type { CommentDates } from "../core/comment-timestamps";
import { commentTimestampMarkup } from "../ui/comment-timestamps";

interface TimestampMount {
  original: HTMLElement;
  replacement: HTMLElement;
  markup: string;
}

export class NativeCommentTimestamps {
  private readonly mounts = new Map<HTMLElement, TimestampMount>();
  private timer: number | undefined;
  private style: HTMLStyleElement | null = null;

  constructor(
    private readonly root: Document = document,
    private readonly scope: Window = window,
    private readonly readDates = readNativeCommentDates,
    private readonly now = Date.now
  ) {}

  update(enabled: boolean): void {
    if (!enabled) {
      this.stop();
      return;
    }
    if (!this.style) {
      this.style = this.root.createElement("style");
      this.style.textContent = "[data-adopp-original-comment-time]{display:none!important}[data-adopp-comment-timestamps]{display:inline-flex;flex-wrap:wrap;gap:0 4px;white-space:normal}[data-adopp-comment-timestamps] time{white-space:nowrap}";
      this.root.head.append(this.style);
    }
    this.timer ??= this.scope.setInterval(() => this.reconcile(), 30000);
    this.reconcile();
  }

  stop(): void {
    this.scope.clearInterval(this.timer);
    this.timer = undefined;
    for (const header of this.mounts.keys()) this.remove(header);
    this.style?.remove();
    this.style = null;
  }

  private remove(header: HTMLElement): void {
    const mount = this.mounts.get(header);
    mount?.original.removeAttribute("data-adopp-original-comment-time");
    mount?.replacement.remove();
    this.mounts.delete(header);
  }

  private reconcile(): void {
    for (const [header, mount] of this.mounts) {
      if (!header.isConnected || !header.contains(mount.original) || !header.contains(mount.replacement)) this.remove(header);
    }
    for (const header of this.root.querySelectorAll<HTMLElement>(".repos-discussion-comment-header")) {
      if (header.closest("[data-adopp-native-draft]")) continue;
      const dates = this.readDates(header);
      const markup = dates ? commentTimestampMarkup(dates, this.now()) : "";
      if (!markup) {
        this.remove(header);
        continue;
      }
      let mount = this.mounts.get(header);
      if (!mount) {
        const time = header.querySelector<HTMLTimeElement>("time[datetime]");
        const original = time?.parentElement;
        if (!original || original === header) continue;
        const replacement = this.root.createElement("span");
        replacement.className = time.className.replace("white-space-nowrap", "");
        replacement.dataset.adoppNativeCommentTimestamps = "";
        original.after(replacement);
        original.setAttribute("data-adopp-original-comment-time", "");
        mount = { original, replacement, markup: "" };
        this.mounts.set(header, mount);
      }
      if (mount.markup !== markup) {
        mount.replacement.innerHTML = markup;
        mount.markup = markup;
      }
    }
  }
}

export function readNativeCommentDates(element: HTMLElement): CommentDates | null {
  const key = Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = key ? Reflect.get(element, key) : null;
  const seen = new Set<unknown>();
  for (let depth = 0; isRecord(fiber) && depth < 60 && !seen.has(fiber); depth++) {
    seen.add(fiber);
    const props = fiber.memoizedProps;
    if (isRecord(props) && isRecord(props.comment)) {
      const model = props.comment;
      const comment = isRecord(model.originalComment) ? model.originalComment : model;
      if (comment.commentType !== 1 && comment.commentType !== "text") return null;
      if (comment.isDeleted === true || model.deleted === true) return null;
      const publishedDate = readDate(comment.publishedDate);
      const lastContentUpdatedDate = readDate(comment.lastContentUpdatedDate);
      return publishedDate ? { publishedDate, ...(lastContentUpdatedDate ? { lastContentUpdatedDate } : {}) } : null;
    }
    fiber = fiber.return;
  }
  return null;
}

function readDate(value: unknown): string | undefined {
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : undefined;
  return typeof value === "string" && Number.isFinite(Date.parse(value)) ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
