import { DIFF_PREFERENCES_CHANNEL, diffPreferenceRequest, readPageDiffPreference } from "./diff-preferences";
import { record } from "./protocol";

interface NativePreferenceService {
  getPreferences(): unknown;
  getEditorOptions(): unknown;
}

function preferenceService(value: unknown): value is NativePreferenceService {
  return record(value) && typeof value.getPreferences === "function" && typeof value.getEditorOptions === "function";
}

function discoverPreferenceService(root: ParentNode): NativePreferenceService | null {
  for (const element of root.querySelectorAll(".monaco-diff-editor, .repos-file-explorer-tree")) {
    // Monaco's DOM is below its React owner; the service lives on an ancestor component.
    for (let node: Element | null = element, level = 0; node && level < 10; node = node.parentElement, level++) {
      const key = Object.getOwnPropertyNames(node).find((name) => name.startsWith("__reactFiber$"));
      let fiber: unknown = key ? Reflect.get(node, key) : null;
      const visited = new Set<unknown>();
      for (let depth = 0; record(fiber) && depth < 80 && !visited.has(fiber); depth++) {
        visited.add(fiber);
        const instance = fiber.stateNode;
        const service = record(instance) ? instance.userPreferencesService : null;
        if (preferenceService(service)) return service;
        fiber = fiber.return;
      }
    }
  }
  return null;
}

export class NativeDiffPreferenceReader {
  private service: NativePreferenceService | null = null;

  constructor(private readonly root: ParentNode) {}

  read(): boolean | null {
    // Keep the live service across SPA remounts, not a snapshot of its last setting.
    this.service = discoverPreferenceService(this.root) ?? this.service;
    if (this.service) {
      const options = this.service.getEditorOptions();
      return record(options) && typeof options.ignoreTrimWhitespace === "boolean" ? options.ignoreTrimWhitespace : null;
    }
    return readPageDiffPreference(this.root);
  }
}

export function startNativeDiffPreferences(scope: Window): void {
  const reader = new NativeDiffPreferenceReader(scope.document);
  scope.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (event.source !== scope || event.origin !== scope.location.origin) return;
    const parsed = diffPreferenceRequest.safeParse(event.data);
    if (!parsed.success) return;
    let ignoreTrimWhitespace: boolean | null = null;
    try {
      ignoreTrimWhitespace = reader.read();
    } catch (error) {
      console.warn("ADO Boost could not read the native whitespace setting", error);
    }
    scope.postMessage({
      channel: DIFF_PREFERENCES_CHANNEL, kind: "preferences", session: parsed.data.session, ignoreTrimWhitespace
    }, scope.location.origin);
  });
}
