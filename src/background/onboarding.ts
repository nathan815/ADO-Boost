interface OnboardingDependencies {
  getURL(path: string): string;
  open(url: string): Promise<unknown>;
}

export async function openOnboarding(reason: string, dependencies: OnboardingDependencies): Promise<void> {
  if (reason === "install") await dependencies.open(dependencies.getURL("onboarding.html"));
}
