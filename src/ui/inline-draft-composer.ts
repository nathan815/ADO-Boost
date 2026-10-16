import { renderAdoComment } from "./comment-content";

export class InlineDraftComposer {
  private body: string;
  private error = "";
  private saving = false;
  private previewOpen = false;

  constructor(
    readonly key: string,
    private readonly title: string,
    body: string,
    private readonly save: (body: string) => Promise<void>,
    private readonly close: () => void,
    private readonly onChange: () => void
  ) {
    this.body = body;
  }

  markup(): string {
    return `<section class="inline-composer" data-composer-key="${escapeHtml(this.key)}" aria-label="${escapeHtml(this.title)}">
      <label class="composer-label">${escapeHtml(this.title)}<textarea class="draft-body" rows="5" placeholder="Write Markdown feedback" ${this.saving ? "disabled" : ""}>${escapeHtml(this.body)}</textarea></label>
      <p class="muted">Private draft. Nothing is posted until Submit Review.</p>
      <details class="markdown-preview" ${this.previewOpen ? "open" : ""}><summary>Preview</summary><div class="preview draft-preview">${renderAdoComment(this.body)}</div></details>
      ${this.error ? `<p class="error" role="alert">${escapeHtml(this.error)}</p>` : ""}
      <div class="composer-actions"><button class="secondary cancel-draft" type="button" ${this.saving ? "disabled" : ""}>Cancel</button><button class="primary save-draft" type="button" ${this.saving || !this.body.trim() ? "disabled" : ""}>${this.saving ? "Saving..." : "Save draft"}</button></div>
    </section>`;
  }

  bind(element: HTMLElement): void {
    const preview = element.querySelector<HTMLDetailsElement>(".markdown-preview")!;
    preview.addEventListener("toggle", () => { this.previewOpen = preview.open; });
    const textarea = element.querySelector<HTMLTextAreaElement>(".draft-body")!;
    textarea.addEventListener("input", () => {
      this.body = textarea.value;
      element.querySelector<HTMLElement>(".draft-preview")!.innerHTML = renderAdoComment(this.body);
      element.querySelector<HTMLButtonElement>(".save-draft")!.disabled = !this.body.trim();
    });
    element.querySelector(".cancel-draft")!.addEventListener("click", () => { if (!this.saving) this.close(); });
    element.querySelector(".save-draft")!.addEventListener("click", () => void this.saveDraft());
  }

  private async saveDraft(): Promise<void> {
    if (this.saving || !this.body.trim()) return;
    this.saving = true;
    this.error = "";
    this.onChange();
    try {
      await this.save(this.body.trim());
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Draft could not be saved";
      this.saving = false;
      this.onChange();
      return;
    }
    this.saving = false;
    this.close();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] as string);
}
