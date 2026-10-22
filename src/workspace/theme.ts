export const workspaceThemeTokens = [
  "--background-color", "--text-primary-color", "--text-secondary-color",
  "--communication-background", "--palette-neutral-8", "--focus-border-color"
] as const;

export function workspaceColorScheme(background: unknown): "dark" | "light" | undefined {
  if (typeof background !== "string") return undefined;
  const channels = background.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (channels) return Number(channels[1]) + Number(channels[2]) + Number(channels[3]) < 384 ? "dark" : "light";
  return undefined;
}

export function applyWorkspaceTheme(theme: unknown, root = document.documentElement): void {
  if (!theme || typeof theme !== "object") return;
  for (const key of workspaceThemeTokens) {
    const color: unknown = Reflect.get(theme, key);
    if (typeof color === "string" && color.length < 100 && /^[a-z0-9(),.%#\s-]+$/i.test(color)) root.style.setProperty(key, color);
  }
  const scheme = workspaceColorScheme(Reflect.get(theme, "--background-color"));
  if (scheme) root.style.colorScheme = scheme;
}
