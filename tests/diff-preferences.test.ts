// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeDiffPreferenceReader } from "../src/native-tree/diff-preferences-host";
import { DIFF_PREFERENCES_CHANNEL, NativeDiffPreferencesClient, describeDiffPolicy, readPageDiffPreference } from "../src/native-tree/diff-preferences";

function pageData(value: unknown): void {
  const script = document.createElement("script");
  script.id = "dataProviders";
  script.type = "application/json";
  script.textContent = JSON.stringify(value);
  document.body.append(script);
}

function preferences(whiteSpaceEnabled: unknown): unknown {
  return { data: { "ms.vss-code-web.versioncontrol-viewmodel-data-provider": {
    vcUserPreferences: { editorPreferences: { whiteSpaceEnabled } }
  } } };
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("native whitespace preference discovery", () => {
  it.each([true, false])("reads whitespace display %s directly from server page data without an editor", (enabled) => {
    pageData(preferences(enabled));
    expect(readPageDiffPreference(document)).toBe(!enabled);
    expect(new NativeDiffPreferenceReader(document).read()).toBe(!enabled);
  });

  it("does not guess when the provider or setting is missing or malformed", () => {
    expect(readPageDiffPreference(document)).toBeNull();
    pageData({});
    expect(readPageDiffPreference(document)).toBeNull();
    document.body.innerHTML = "";
    pageData(preferences("false"));
    expect(readPageDiffPreference(document)).toBeNull();
    document.querySelector("#dataProviders")!.textContent = "{";
    const logger = { warn: vi.fn() };
    expect(readPageDiffPreference(document, logger)).toBeNull();
    expect(logger.warn).toHaveBeenCalledOnce();
  });

  it("reads the validated native service through arbitrary React owners and detects changes", () => {
    pageData(preferences(true));
    const wrapper = document.createElement("section");
    wrapper.innerHTML = '<div class="monaco-diff-editor"></div>';
    document.body.append(wrapper);
    let ignoreTrimWhitespace = true;
    Reflect.set(wrapper, "__reactFiber$random", {
      return: {
        stateNode: { userPreferencesService: {
          getPreferences: () => ({}),
          getEditorOptions: () => ({ ignoreTrimWhitespace })
        } }
      }
    });
    const reader = new NativeDiffPreferenceReader(document);
    expect(reader.read()).toBe(true);
    ignoreTrimWhitespace = false;
    expect(reader.read()).toBe(false);
    wrapper.remove();
    ignoreTrimWhitespace = true;
    expect(reader.read()).toBe(true);
    expect(readPageDiffPreference(document)).toBe(false);
  });

  it("rejects unsupported settings rather than guessing", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "monaco-diff-editor";
    document.body.append(wrapper);
    Reflect.set(wrapper, "__reactFiber$other", {
      stateNode: { userPreferencesService: { getPreferences: () => ({}), getEditorOptions: () => ({ ignoreTrimWhitespace: "true" }) } }
    });
    expect(new NativeDiffPreferenceReader(document).read()).toBeNull();
    expect(describeDiffPolicy({ ignoreTrimWhitespace: true })).toBe("whitespace ignored");
    expect(describeDiffPolicy({ ignoreTrimWhitespace: false })).toBe("whitespace included");
    expect(describeDiffPolicy({ ignoreTrimWhitespace: null })).toBe("whitespace setting unavailable");
    expect(describeDiffPolicy(undefined)).toBe("whitespace setting unavailable");
  });
});

describe("native whitespace preference bridge", () => {
  it("validates origin, source, session and shape, polls changes and stops cleanly", () => {
    vi.useFakeTimers();
    const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
    const changed = vi.fn();
    const client = new NativeDiffPreferencesClient(changed);
    client.start();
    const request = post.mock.calls[0]![0] as { session: string };
    const response = { channel: DIFF_PREFERENCES_CHANNEL, kind: "preferences", session: request.session, ignoreTrimWhitespace: true };
    const send = (data: unknown, source: MessageEventSource | null = window, origin = location.origin) =>
      window.dispatchEvent(new MessageEvent("message", { data, source, origin }));
    try {
      send(response, null);
      send(response, window, "https://other.example");
      send({ ...response, session: crypto.randomUUID() });
      send({ ...response, ignoreTrimWhitespace: "true" });
      send({ ...response, extra: true });
      expect(changed).not.toHaveBeenCalled();
      send(response);
      send(response);
      expect(changed).toHaveBeenCalledExactlyOnceWith(true);
      vi.advanceTimersByTime(1000);
      expect(post).toHaveBeenCalledTimes(2);
      send({ ...response, ignoreTrimWhitespace: false });
      send({ ...response, ignoreTrimWhitespace: null });
      expect(changed.mock.calls).toEqual([[true], [false], [null]]);
    } finally {
      client.stop();
    }
    vi.advanceTimersByTime(2000);
    send(response);
    expect(post).toHaveBeenCalledTimes(2);
    expect(changed).toHaveBeenCalledTimes(3);
  });
});
