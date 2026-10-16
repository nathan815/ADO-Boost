import type { DiscussionConfiguration } from "./protocol";

type Draft = DiscussionConfiguration["drafts"][number];

interface ViewZone {
  afterLineNumber: number;
  heightInPx: number;
  domNode: HTMLElement;
  suppressMouseDown: boolean;
}

interface ZoneAccessor {
  addZone(zone: ViewZone): string;
  removeZone(id: string): void;
  layoutZone(id: string): void;
}

interface CodeEditor {
  changeViewZones(callback: (accessor: ZoneAccessor) => void): void;
  getModel(): { getLineCount(): number } | null;
}

interface DiffEditor {
  getOriginalEditor(): unknown;
  getModifiedEditor(): unknown;
}

interface MountedZone {
  editor: CodeEditor;
  id: string;
  zone: ViewZone;
  content: HTMLElement;
  signature: string;
  observer: ResizeObserver | null;
}

export class InlineDraftSurface {
  private readonly zones = new Map<string, MountedZone>();
  private readonly accessibilityRoots = new Set<HTMLElement>();

  render(drafts: Draft[], createCard: (draft: Draft) => HTMLElement): boolean {
    const host = document.querySelector(".repos-diff-editor");
    const diff = host ? discoverDiffEditor(host) : null;
    const groups = new Map<string, Draft[]>();
    for (const draft of drafts) {
      const key = `${draft.side ?? "right"}:${draft.line}`;
      const group = groups.get(key) ?? [];
      group.push(draft);
      groups.set(key, group);
    }
    let available = true;
    const retained = new Set<string>();
    for (const [key, group] of groups) {
      const first = group[0]!;
      const candidate = first.side === "left" ? diff?.getOriginalEditor() : diff?.getModifiedEditor();
      const line = first.line;
      if (!isCodeEditor(candidate) || !line || line > (candidate.getModel()?.getLineCount() ?? 0)) {
        available = false;
        continue;
      }
      retained.add(key);
      const signature = JSON.stringify(group);
      const existing = this.zones.get(key);
      if (existing?.editor === candidate && existing.signature === signature && existing.zone.domNode.isConnected) continue;
      if (existing) this.remove(key, existing);
      const content = document.createElement("div");
      content.className = "repos-editor-discussion-host adopp-inline-draft-content";
      content.append(...group.map(createCard));
      const domNode = document.createElement("div");
      domNode.className = "adopp-inline-draft-zone";
      domNode.append(content);
      const zone: ViewZone = { afterLineNumber: line, heightInPx: 120, domNode, suppressMouseDown: false };
      let id = "";
      candidate.changeViewZones((accessor) => { id = accessor.addZone(zone); });
      const root = domNode.parentElement;
      if (root?.getAttribute("aria-hidden") === "true") {
        this.accessibilityRoots.add(root);
        root.setAttribute("aria-hidden", "false");
      }
      const updateHeight = (): void => {
        const height = Math.ceil(content.getBoundingClientRect().height);
        // Monaco hides offscreen zones, so zero is not the content's actual height.
        if (!height) return;
        if (zone.heightInPx === height) return;
        zone.heightInPx = height;
        candidate.changeViewZones((accessor) => accessor.layoutZone(id));
      };
      const observer = typeof ResizeObserver === "function" ? new ResizeObserver(updateHeight) : null;
      observer?.observe(content);
      this.zones.set(key, { editor: candidate, id, zone, content, signature, observer });
      updateHeight();
    }
    for (const [key, mounted] of this.zones) {
      if (!retained.has(key)) this.remove(key, mounted);
    }
    this.restoreAccessibilityRoots();
    return available;
  }

  clear(): void {
    for (const [key, mounted] of this.zones) this.remove(key, mounted);
    this.restoreAccessibilityRoots();
  }

  private remove(key: string, mounted: MountedZone): void {
    mounted.observer?.disconnect();
    mounted.editor.changeViewZones((accessor) => accessor.removeZone(mounted.id));
    this.zones.delete(key);
  }

  private restoreAccessibilityRoots(): void {
    for (const root of this.accessibilityRoots) {
      if ([...this.zones.values()].some((mounted) => mounted.zone.domNode.parentElement === root)) continue;
      if (root.getAttribute("aria-hidden") === "false") root.setAttribute("aria-hidden", "true");
      this.accessibilityRoots.delete(root);
    }
  }
}

function discoverDiffEditor(element: Element): DiffEditor | null {
  const key = Object.getOwnPropertyNames(element).find((name) => name.startsWith("__reactFiber$"));
  let fiber: unknown = key ? Reflect.get(element, key) : null;
  const seen = new Set<unknown>();
  for (let depth = 0; isRecord(fiber) && depth < 40 && !seen.has(fiber); depth++) {
    seen.add(fiber);
    const instance = fiber.stateNode;
    if (isRecord(instance)) {
      for (const candidate of [instance.editor, instance.diffEditor]) {
        if (isDiffEditor(candidate)) return candidate;
      }
    }
    fiber = fiber.return;
  }
  return null;
}

function isCodeEditor(value: unknown): value is CodeEditor {
  return isRecord(value) && typeof value.changeViewZones === "function" && typeof value.getModel === "function";
}

function isDiffEditor(value: unknown): value is DiffEditor {
  return isRecord(value) && typeof value.getOriginalEditor === "function" && typeof value.getModifiedEditor === "function";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
