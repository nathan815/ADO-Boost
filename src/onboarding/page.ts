import { CompanionSetupPage } from "../companion-setup/page";

type OnboardingDependencies = ConstructorParameters<typeof CompanionSetupPage>[1];

export function createOnboarding(root: HTMLElement, dependencies: OnboardingDependencies): CompanionSetupPage {
  root.innerHTML = `
    <div class="welcome-layout">
      <div class="welcome-overview">
        <header class="welcome-header">
          <img class="welcome-logo" src="./icons/ado-boost.svg" alt="" width="80" height="80">
          <h1>Welcome to ADO Boost</h1>
          <p class="welcome-lead">Less noise. More context. Make yourself at home in your Azure DevOps pull requests.</p>
        </header>
        <ul class="welcome-features" aria-label="What you can do with ADO Boost">
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg><h2>Your PR Home</h2><p>Keep your dashboard, profiles, and activity feed in one place.</p></li>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 12h10M4 19h6M18 10v10m-4-4 4 4 4-4"/></svg><h2>Find what matters</h2><p>See PR size at a glance and filter out file noise.</p></li>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 7 2 2 4-4m3 2h7M4 15h6m3 0h7M4 20h16"/></svg><h2>Keep your place</h2><p>Track reviewed files and save feedback as private drafts.</p></li>
          <li><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Zm2 4h10M7 12h6"/></svg><h2>Bring in Copilot <span>Optional</span></h2><p>Group related changes and ask questions about your PR.</p></li>
        </ul>
      </div>
      <div class="welcome-connection">
        <section class="welcome-setup" aria-label="Optional Copilot setup">
          <div class="copilot-connection"></div>
        </section>
        <footer class="welcome-footer">
          <span class="welcome-or welcome-alternative">OR</span>
          <a class="welcome-continue" href="./options.html">Continue to Settings <span aria-hidden="true">&rarr;</span></a>
          <p class="welcome-alternative">You can connect Copilot anytime.</p>
        </footer>
      </div>
    </div>`;
  const setupRoot = root.querySelector<HTMLElement>(".copilot-connection")!;
  const continueLink = root.querySelector<HTMLAnchorElement>(".welcome-continue")!;
  const alternatives = root.querySelectorAll<HTMLElement>(".welcome-alternative");
  const page = new CompanionSetupPage(setupRoot, {
    ...dependencies,
    onHealth: (health) => {
      const ready = health.connected && health.authenticated;
      continueLink.classList.toggle("primary", ready);
      for (const alternative of alternatives) alternative.hidden = ready;
      dependencies.onHealth?.(health);
    }
  });
  setupRoot.insertBefore(page.connection.element, setupRoot.querySelector(".setup-help"));
  return page;
}
