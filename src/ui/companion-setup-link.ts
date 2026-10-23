import { companionSetupUrl, openCompanionSetup } from "../core/companion-setup";

export function companionSetupLink(document: Document): HTMLAnchorElement {
  const link = document.createElement("a");
  link.className = "companion-setup-link";
  link.textContent = "Install or troubleshoot companion";
  link.href = companionSetupUrl();
  link.target = "_blank";
  link.rel = "noopener";
  link.addEventListener("click", (event) => {
    event.preventDefault();
    void openCompanionSetup().catch((error: unknown) => {
      link.textContent = error instanceof Error ? error.message : "Could not open companion setup";
      link.setAttribute("role", "alert");
    });
  });
  return link;
}
