import { renderAdoComment } from "./comment-content";

export class InlineDraftComposer {
  private body: string;
  private error = "";
  private action: "save" | "post" | null = null;
  private previewOpen = false;

  constructor(
    readonly key: string,
    private readonly title: string,
    body: string,
    private readonly save: (body: string) => Promise<void>,
    private readonly close: () => void,
    private readonly onChange: () => void,
    private readonly posting?: { enabled: () => boolean; post: (body: string) => Promise<void> }
  ) {
    this.body = body;
  }

  markup(): string {
    const busy = this.action !== null;
    const canPost = this.posting?.enabled() === true;
    const disabled = busy || !this.body.trim();
    return `<section class="inline-composer" data-composer-key="${escapeHtml(this.key)}" aria-label="${escapeHtml(this.title)}">
      <label class="composer-label">${escapeHtml(this.title)}<textarea class="draft-body" rows="5" placeholder="Write Markdown feedback" ${busy ? "disabled" : ""}>${escapeHtml(this.body)}</textarea></label>
      <p class="muted">${canPost ? "Add to review keeps this reply private. Post publishes it immediately without changing your vote." : "Private draft. Nothing is posted until Submit Review."}</p>
      <details class="markdown-preview" ${this.previewOpen ? "open" : ""}><summary>Preview</summary><div class="preview draft-preview">${renderAdoComment(this.body)}</div></details>
      ${this.error ? `<p class="error" role="alert">${escapeHtml(this.error)}</p>` : ""}
      <div class="composer-actions"><button class="secondary cancel-draft" type="button" ${busy ? "disabled" : ""}>Cancel</button><button class="${canPost ? "secondary" : "primary"} save-draft" type="button" ${disabled ? "disabled" : ""}>${this.action === "save" ? "Saving..." : this.posting ? "Add to review" : "Save draft"}</button>${canPost ? `<button class="primary post-comment" type="button" ${disabled ? "disabled" : ""}>${this.action === "post" ? "Posting..." : "Post"}</button>` : ""}</div>
    </section>`;
  }

  bind(element: HTMLElement): void {
    const preview = element.querySelector<HTMLDetailsElement>(".markdown-preview")!;
    preview.addEventListener("toggle", () => { this.previewOpen = preview.open; });
    const textarea = element.querySelector<HTMLTextAreaElement>(".draft-body")!;
    textarea.addEventListener("input", () => {
      this.body = textarea.value;
      element.querySelector<HTMLElement>(".draft-preview")!.innerHTML = renderAdoComment(this.body);
      for (const button of element.querySelectorAll<HTMLButtonElement>(".save-draft,.post-comment")) {
        button.disabled = this.action !== null || !this.body.trim();
      }
    });
    element.querySelector(".cancel-draft")!.addEventListener("click", () => { if (!this.action) this.close(); });
    element.querySelector(".save-draft")!.addEventListener("click", () => void this.perform("save"));
    element.querySelector(".post-comment")?.addEventListener("click", () => void this.perform("post"));
  }

  private async perform(action: "save" | "post"): Promise<void> {
    if (this.action || !this.body.trim()) return;
    this.action = action;
    this.error = "";
    this.onChange();
    try {
      if (action === "post") {
        if (!this.posting?.enabled()) throw new Error("Posting replies is disabled in settings");
        await this.posting.post(this.body.trim());
      } else {
        await this.save(this.body.trim());
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : action === "post" ? "Reply could not be posted" : "Draft could not be saved";
      this.action = null;
      this.onChange();
      return;
    }
    this.action = null;
    this.close();
  }
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character] as string);
}
