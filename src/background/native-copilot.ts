const HOST_NAME = "com.azuredevopsplusplus.copilot";
const PROTOCOL_VERSION = 1;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

export class NativeCopilotClient {
  private port: chrome.runtime.Port | null = null;
  private readonly pending = new Map<string, Pending>();
  private hello: Promise<void> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;

  async request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    await this.connect();
    const id = crypto.randomUUID();
    const result = new Promise<unknown>((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.port!.postMessage({ id, type, ...payload });
    this.scheduleIdle();
    return result;
  }

  disconnect(): void {
    for (const pending of this.pending.values()) pending.reject(new Error("Copilot companion was disabled or disconnected"));
    this.pending.clear();
    this.port?.disconnect();
    this.port = null;
    this.hello = null;
  }

  private async connect(): Promise<void> {
    if (this.port && this.hello) return this.hello;
    this.port = chrome.runtime.connectNative(HOST_NAME);
    this.port.onMessage.addListener((message: unknown) => this.onMessage(message));
    this.port.onDisconnect.addListener(() => {
      const detail = chrome.runtime.lastError?.message ?? "Native Copilot companion disconnected";
      for (const pending of this.pending.values()) pending.reject(new Error(detail));
      this.pending.clear();
      this.port = null;
      this.hello = null;
    });
    this.hello = new Promise<void>((resolve, reject) => {
      const id = crypto.randomUUID();
      this.pending.set(id, {
        resolve: (value) => {
          const version = (value as { version?: unknown })?.version;
          if (version !== PROTOCOL_VERSION) reject(new Error(`Native companion protocol ${String(version)} is incompatible`));
          else resolve();
        },
        reject
      });
      this.port!.postMessage({ id, type: "hello", version: PROTOCOL_VERSION, origin: chrome.runtime.getURL("") });
    });
    return this.hello;
  }

  private onMessage(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const response = value as { id?: unknown; ok?: unknown; data?: unknown; error?: { message?: unknown } };
    if (typeof response.id !== "string") return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (response.ok === true) pending.resolve(response.data);
    else pending.reject(new Error(typeof response.error?.message === "string" ? response.error.message : "Native companion request failed"));
  }

  private scheduleIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.pending.size) this.disconnect();
    }, 30_000);
  }
}
