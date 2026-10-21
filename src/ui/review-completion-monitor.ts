export class ReviewCompletionMonitor {
  private active = false;
  private checking = false;
  private generation = 0;
  private lastError = "";

  constructor(
    private readonly check: () => Promise<boolean>,
    private readonly onError: (message: string, error: unknown) => void,
    private readonly scope: Window = window
  ) {}

  start(): void {
    if (this.active) return;
    this.active = true;
    this.generation++;
    this.scope.addEventListener("focus", this.onFocus);
    this.scope.document.addEventListener("visibilitychange", this.onVisibility);
    this.refresh();
  }

  stop(): void {
    this.active = false;
    this.generation++;
    this.scope.removeEventListener("focus", this.onFocus);
    this.scope.document.removeEventListener("visibilitychange", this.onVisibility);
  }

  refresh(): void {
    if (this.active && !this.checking) void this.checkCompletion();
  }

  private async checkCompletion(): Promise<void> {
    const generation = this.generation;
    this.checking = true;
    try {
      const finished = await this.check();
      if (!this.active || generation !== this.generation) return;
      this.lastError = "";
      if (finished) this.stop();
    } catch (error) {
      if (!this.active || generation !== this.generation) return;
      const message = error instanceof Error ? error.message : "Review completion check failed";
      if (message !== this.lastError) {
        this.lastError = message;
        this.onError(message, error);
      }
    } finally {
      this.checking = false;
      if (this.active && generation !== this.generation) this.refresh();
    }
  }

  private readonly onFocus = (): void => this.refresh();
  private readonly onVisibility = (): void => {
    if (this.scope.document.visibilityState === "visible") this.refresh();
  };
}
