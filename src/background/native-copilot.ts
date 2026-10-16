const HOST_NAME = "com.adoboost.copilot";
const PROTOCOL_VERSION = 1;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

type NativeRuntime = Pick<typeof chrome.runtime, "connectNative" | "getURL" | "lastError">;

export class NativeCopilotClient {
  private port: chrome.runtime.Port | null = null;
  private readonly pending = new Map<string, Pending>();
  private hello: Promise<void> | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private inferenceRequests = 0;

  constructor(private readonly runtime: NativeRuntime = chrome.runtime, private readonly timeoutMs = 15_000) {}

  get hasActiveInference(): boolean {
    return this.inferenceRequests > 0;
  }

  async request(type: string, payload: Record<string, unknown> = {}): Promise<unknown> {
    const inference = type !== "health";
    if (inference) this.inferenceRequests++;
    try {
      await this.connect();
      return await this.send(type, payload, type === "health" ? this.timeoutMs : undefined);
    } finally {
      if (inference) this.inferenceRequests--;
    }
  }

  disconnect(): void {
    const port = this.port;
    this.port = null;
    this.hello = null;
    this.clearIdle();
    this.rejectPending(new Error("Copilot companion was disabled or disconnected"));
    port?.disconnect();
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      if (pending.timer) clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private async connect(): Promise<void> {
    if (this.port && this.hello) return this.hello;
    const port = this.runtime.connectNative(HOST_NAME);
    this.port = port;
    port.onMessage.addListener((message: unknown) => {
      if (this.port === port) this.onMessage(message);
    });
    port.onDisconnect.addListener(() => {
      const detail = this.runtime.lastError?.message ?? "Native Copilot companion disconnected";
      if (this.port !== port) return;
      this.clearIdle();
      this.rejectPending(new Error(detail));
      this.port = null;
      this.hello = null;
    });
    this.hello = this.send("hello", { version: PROTOCOL_VERSION, origin: this.runtime.getURL("") }, this.timeoutMs).then((value) => {
      const version = (value as { version?: unknown })?.version;
      if (version !== PROTOCOL_VERSION) throw new Error(`Native companion protocol ${String(version)} is incompatible`);
    }).catch((error: unknown) => {
      if (this.port === port) this.disconnect();
      throw error;
    });
    return this.hello;
  }

  private send(type: string, payload: Record<string, unknown>, timeoutMs?: number): Promise<unknown> {
    const port = this.port;
    if (!port) return Promise.reject(new Error("Native Copilot companion is disconnected"));
    this.clearIdle();
    const id = crypto.randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timer = timeoutMs === undefined ? null : setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Copilot companion ${type} request timed out. Refresh to try again.`));
        this.scheduleIdle();
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try {
        port.postMessage({ id, type, ...payload });
      } catch (error) {
        if (timer) clearTimeout(timer);
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error("Unable to send native companion request"));
        this.scheduleIdle();
      }
    });
  }

  private onMessage(value: unknown): void {
    if (!value || typeof value !== "object") return;
    const response = value as { id?: unknown; ok?: unknown; data?: unknown; error?: { message?: unknown } };
    if (typeof response.id !== "string") return;
    const pending = this.pending.get(response.id);
    if (!pending) return;
    this.pending.delete(response.id);
    if (pending.timer) clearTimeout(pending.timer);
    if (response.ok === true) pending.resolve(response.data);
    else pending.reject(new Error(typeof response.error?.message === "string" ? response.error.message : "Native companion request failed"));
    this.scheduleIdle();
  }

  private clearIdle(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }

  private scheduleIdle(): void {
    this.clearIdle();
    if (this.pending.size) return;
    this.idleTimer = setTimeout(() => {
      if (!this.pending.size) this.disconnect();
    }, 30_000);
  }
}
