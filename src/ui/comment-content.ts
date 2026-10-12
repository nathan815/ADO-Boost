import DOMPurify from "dompurify";
import type { Config } from "dompurify";
import { marked } from "marked";

const sanitizeOptions: Config = {
  USE_PROFILES: { html: true },
  FORBID_TAGS: ["button", "embed", "form", "iframe", "input", "object", "option", "select", "style", "textarea"],
  FORBID_ATTR: ["class", "id", "style"]
};

export function renderAdoComment(content: string): string {
  const rendered = marked.parse(content, { async: false, breaks: true, gfm: true });
  return DOMPurify.sanitize(rendered, sanitizeOptions);
}
