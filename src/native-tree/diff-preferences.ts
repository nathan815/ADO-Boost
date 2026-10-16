import { z } from "zod";
import type { DiffPolicy } from "../core/types";

export const DIFF_PREFERENCES_CHANNEL = "adopp-diff-preferences-v1";

const pagePreferencesSchema = z.object({
  data: z.object({
    "ms.vss-code-web.versioncontrol-viewmodel-data-provider": z.object({
      vcUserPreferences: z.object({
        editorPreferences: z.object({ whiteSpaceEnabled: z.boolean() })
      })
    })
  })
});

export function readPageDiffPreference(root: ParentNode, logger: Pick<Console, "warn"> = console): boolean | null {
  const content = root.querySelector("#dataProviders")?.textContent;
  if (!content) return null;
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch (error) {
    logger.warn("ADO Boost could not parse the page's whitespace preference", error);
    return null;
  }
  const parsed = pagePreferencesSchema.safeParse(data);
  return parsed.success
    ? !parsed.data.data["ms.vss-code-web.versioncontrol-viewmodel-data-provider"].vcUserPreferences.editorPreferences.whiteSpaceEnabled
    : null;
}

export const diffPreferenceRequest = z.object({
  channel: z.literal(DIFF_PREFERENCES_CHANNEL),
  kind: z.literal("read"),
  session: z.string().uuid()
}).strict();

export const diffPreferenceResponse = z.object({
  channel: z.literal(DIFF_PREFERENCES_CHANNEL),
  kind: z.literal("preferences"),
  session: z.string().uuid(),
  ignoreTrimWhitespace: z.boolean().nullable()
}).strict();

export function describeDiffPolicy(policy: DiffPolicy | undefined): string {
  if (policy?.ignoreTrimWhitespace === undefined || policy.ignoreTrimWhitespace === null) return "whitespace setting unavailable";
  return policy.ignoreTrimWhitespace ? "whitespace ignored" : "whitespace included";
}

export class NativeDiffPreferencesClient {
  private readonly session = crypto.randomUUID();
  private timer = 0;
  private previous: boolean | null | undefined;

  constructor(private readonly changed: (ignoreTrimWhitespace: boolean | null) => void, private readonly scope = window) {}

  start(): void {
    this.scope.addEventListener("message", this.onMessage);
    this.read();
    this.timer = this.scope.setInterval(() => this.read(), 1000);
  }

  stop(): void {
    this.scope.clearInterval(this.timer);
    this.scope.removeEventListener("message", this.onMessage);
  }

  private read(): void {
    this.scope.postMessage({ channel: DIFF_PREFERENCES_CHANNEL, kind: "read", session: this.session }, this.scope.location.origin);
  }

  private readonly onMessage = (event: MessageEvent<unknown>): void => {
    if (event.source !== this.scope || event.origin !== this.scope.location.origin) return;
    const parsed = diffPreferenceResponse.safeParse(event.data);
    if (!parsed.success || parsed.data.session !== this.session) return;
    const value = parsed.data.ignoreTrimWhitespace;
    if (value === this.previous) return;
    this.previous = value;
    this.changed(value);
  };
}
