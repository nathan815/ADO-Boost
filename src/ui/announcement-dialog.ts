import { renderAdoComment } from "./comment-content";

interface AnnouncementDialogOptions {
  pullRequestId: number;
  body: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

let nextDialogId = 0;

export class AnnouncementDialog {
  private readonly portal = document.createElement("div");
  private readonly cancel: HTMLButtonElement;
  private readonly confirm: HTMLButtonElement;
  private readonly error: HTMLElement;
  private readonly dialog: HTMLElement;
  private previousFocus: HTMLElement | null = null;
  private posting = false;

  constructor(private readonly options: AnnouncementDialogOptions) {
    const titleId = `adopp-announcement-title-${++nextDialogId}`;
    this.portal.dataset.adoppAnnouncementDialog = "true";
    this.portal.className = "adopp-announcement-portal bolt-portal bolt-callout-modal";
    this.portal.innerHTML = `
      <style>${styles}</style>
      <div class="bolt-callout bolt-dialog-callout flex-column">
        <div class="bolt-callout-content bolt-dialog-callout-content bolt-callout-shadow bolt-callout-medium relative scroll-auto">
          <section class="bolt-dialog bolt-dialog-root flex-column flex-grow scroll-hidden" role="dialog" aria-modal="true" aria-labelledby="${titleId}" tabindex="-1">
            <header class="bolt-panel-header bolt-header bolt-header-condensed flex-row flex-noshrink flex-start bolt-default-horizontal-spacing">
              <div class="bolt-header-content-area flex-row flex-grow flex-self-stretch">
                <div class="bolt-header-title-area flex-column flex-grow">
                  <div class="bolt-header-title-row flex-row flex-baseline">
                    <div class="bolt-header-title title-xs s" id="${titleId}" role="heading" aria-level="2">Announce review start?</div>
                  </div>
                </div>
              </div>
            </header>
            <div class="bolt-dialog-content flex-column flex-grow bolt-default-horizontal-spacing">
              <p>This posts one normal comment to PR ${options.pullRequestId}. It does not change your vote or guarantee a notification.</p>
              <div class="adopp-announcement-preview">${renderAdoComment(options.body)}</div>
              <p class="adopp-announcement-error" role="alert" hidden></p>
            </div>
            <footer class="bolt-panel-footer flex-center bolt-default-horizontal-spacing">
              <div class="bolt-button-group bolt-panel-footer-buttons flex-row flex-grow">
                <button class="bolt-button enabled flex-row flex-center bolt-focus-treatment" type="button" data-action="cancel"><span class="bolt-button-text">Cancel</span></button>
                <button class="bolt-button enabled primary flex-row flex-center bolt-focus-treatment" type="button" data-action="confirm"><span class="bolt-button-text">Post announcement</span></button>
              </div>
            </footer>
          </section>
        </div>
      </div>`;
    this.cancel = this.portal.querySelector<HTMLButtonElement>('[data-action="cancel"]')!;
    this.confirm = this.portal.querySelector<HTMLButtonElement>('[data-action="confirm"]')!;
    this.error = this.portal.querySelector<HTMLElement>('[role="alert"]')!;
    this.dialog = this.portal.querySelector<HTMLElement>('[role="dialog"]')!;
    this.cancel.addEventListener("click", () => this.close());
    this.confirm.addEventListener("click", () => void this.post());
    for (const type of ["pointerdown", "pointerup", "mousedown", "mouseup"]) {
      this.portal.addEventListener(type, (event) => {
        event.stopPropagation();
      });
    }
    this.portal.addEventListener("click", (event) => {
      event.stopPropagation();
      const content = this.portal.querySelector(".bolt-dialog-callout-content")!;
      if (event.target instanceof Node && !content.contains(event.target)) {
        event.preventDefault();
        if (!this.posting) this.close();
      }
    });
  }

  open(): void {
    if (!this.portal.isConnected) {
      this.previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      // Native ADO styles cannot cross the review panel's shadow boundary.
      document.body.append(this.portal);
      window.addEventListener("keydown", this.onKeyDown, true);
      document.addEventListener("focusin", this.onFocusIn, true);
    }
    this.focus();
  }

  close(): void {
    if (!this.portal.isConnected) return;
    this.portal.remove();
    window.removeEventListener("keydown", this.onKeyDown, true);
    document.removeEventListener("focusin", this.onFocusIn, true);
    if (this.previousFocus?.isConnected) this.previousFocus.focus();
    this.options.onClose();
  }

  private focus(): void {
    if (this.posting) this.dialog.focus();
    else this.cancel.focus();
  }

  private async post(): Promise<void> {
    if (this.posting) return;
    this.setPosting(true);
    this.error.hidden = true;
    try {
      await this.options.onConfirm();
      this.close();
    } catch (error) {
      if (!this.portal.isConnected) return;
      this.setPosting(false);
      this.confirm.querySelector(".bolt-button-text")!.textContent = "Retry after checking";
      this.error.textContent = `${error instanceof Error ? error.message : "Announcement failed"}. ADO Boost will check the PR before retrying to prevent a duplicate.`;
      this.error.hidden = false;
      this.confirm.focus();
    }
  }

  private setPosting(posting: boolean): void {
    this.posting = posting;
    this.dialog.setAttribute("aria-busy", String(posting));
    for (const button of [this.cancel, this.confirm]) {
      button.disabled = posting;
      button.classList.toggle("enabled", !posting);
      button.classList.toggle("disabled", posting);
    }
    this.confirm.querySelector(".bolt-button-text")!.textContent = posting ? "Posting…" : "Post announcement";
    if (posting) this.dialog.focus();
  }

  private readonly onFocusIn = (event: FocusEvent): void => {
    if (event.target instanceof Node && !this.portal.contains(event.target)) this.focus();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    // Keep native PR shortcuts from acting on the page behind the modal.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      if (!this.posting) this.close();
      return;
    }
    if (event.key !== "Tab") return;
    const elements = [...this.dialog.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),[tabindex="0"]')];
    const next = event.shiftKey ? elements.at(-1) : elements[0];
    const boundary = event.shiftKey ? elements[0] : elements.at(-1);
    if (!elements.length || document.activeElement === boundary || document.activeElement === this.dialog) {
      event.preventDefault();
      (next ?? this.dialog).focus();
    }
  };
}

const styles = `
.adopp-announcement-portal{position:fixed;inset:0;z-index:2147483001;display:flex;align-items:center;justify-content:center;pointer-events:auto}
.adopp-announcement-portal .bolt-dialog-callout-content{max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px)}
.adopp-announcement-portal .bolt-dialog-content>p:first-child{margin-top:0}
.adopp-announcement-preview{padding:12px;border:1px solid var(--palette-black-alpha-20);border-radius:2px;background:var(--background-color);overflow-wrap:anywhere}
.adopp-announcement-preview>:first-child{margin-top:0}.adopp-announcement-preview>:last-child{margin-bottom:0}
.adopp-announcement-preview a{color:var(--communication-foreground);text-decoration:underline;text-underline-offset:2px}
.adopp-announcement-error{color:var(--status-error-foreground)}
`;
