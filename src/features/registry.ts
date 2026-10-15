export type FeatureGroup = "overview" | "navigation" | "review" | "diffs" | "discussions" | "copilot";

export type FeatureId =
  | "prOverview"
  | "prListBadges"
  | "groupedNavigation"
  | "fileFilters"
  | "reviewProgress"
  | "keyboardShortcuts"
  | "startReviewing"
  | "hideGenerated"
  | "hideLockfiles"
  | "extensionDiffView"
  | "threadNavigator"
  | "draftQueue"
  | "submitReview"
  | "feedbackExport"
  | "copilotSemanticGroups"
  | "copilotChat";

export interface FeatureDefinition {
  id: FeatureId;
  group: FeatureGroup;
  label: string;
  description: string;
  defaultEnabled: boolean;
  dependencies: FeatureId[];
}

export const FEATURE_REGISTRY: readonly FeatureDefinition[] = [
  { id: "prOverview", group: "overview", label: "PR size summary", description: "Show reliable overall and per-file line counts on pull request pages.", defaultEnabled: true, dependencies: [] },
  { id: "prListBadges", group: "overview", label: "PR list size badges", description: "Analyze visible pull requests with a bounded background queue.", defaultEnabled: true, dependencies: [] },
  { id: "groupedNavigation", group: "navigation", label: "Native file-tree enhancements", description: "Render diff counts through Azure DevOps' native tree and add review controls. Native search and reviewed-state filters remain owned by Azure DevOps.", defaultEnabled: true, dependencies: ["prOverview"] },
  { id: "fileFilters", group: "navigation", label: "Native file filters", description: "Filter Azure DevOps' native file model by change kind, extension, and optional noise heuristics, alongside its existing Filter control.", defaultEnabled: true, dependencies: ["groupedNavigation"] },
  { id: "reviewProgress", group: "review", label: "Azure DevOps reviewed state", description: "Use the native Azure DevOps reviewed checkboxes as the authoritative server-backed state.", defaultEnabled: true, dependencies: ["prOverview"] },
  { id: "keyboardShortcuts", group: "navigation", label: "Keyboard shortcuts", description: "Use N for next unreviewed and Shift+R to open discussions.", defaultEnabled: true, dependencies: ["groupedNavigation"] },
  { id: "startReviewing", group: "review", label: "Start Reviewing announcement", description: "Preview and explicitly post a normal PR comment announcing the current reviewer started.", defaultEnabled: true, dependencies: ["prOverview"] },
  { id: "hideGenerated", group: "navigation", label: "Hide generated files by default", description: "Start with generated-output heuristics hidden in the navigator. Overall totals never change.", defaultEnabled: false, dependencies: ["fileFilters"] },
  { id: "hideLockfiles", group: "navigation", label: "Hide lockfiles by default", description: "Start with dependency lockfiles hidden in the navigator. Overall totals never change.", defaultEnabled: false, dependencies: ["fileFilters"] },
  { id: "extensionDiffView", group: "diffs", label: "Extension diff view", description: "Open a bounded, syntax-neutral unified diff with word-level emphasis and whitespace controls.", defaultEnabled: true, dependencies: ["prOverview"] },
  { id: "threadNavigator", group: "discussions", label: "Thread navigator", description: "Browse active and resolved discussions with native file links.", defaultEnabled: true, dependencies: ["prOverview"] },
  { id: "draftQueue", group: "discussions", label: "Private feedback drafts", description: "Save local general and inline feedback drafts until an explicit review submission.", defaultEnabled: true, dependencies: ["reviewProgress"] },
  { id: "submitReview", group: "discussions", label: "Submit Review", description: "Preview selected drafts, publish feedback, then apply an optional Azure DevOps review decision.", defaultEnabled: true, dependencies: ["draftQueue"] },
  { id: "feedbackExport", group: "discussions", label: "Feedback export", description: "Copy or download queued feedback and discussion references as Markdown.", defaultEnabled: true, dependencies: ["draftQueue"] },
  { id: "copilotSemanticGroups", group: "copilot", label: "Copilot semantic groups", description: "Explicitly send changed-file metadata to the local native companion for intent-based grouping.", defaultEnabled: false, dependencies: ["groupedNavigation"] },
  { id: "copilotChat", group: "copilot", label: "Copilot PR questions", description: "Ask bounded PR questions through the local companion. Suggested feedback remains a private draft.", defaultEnabled: false, dependencies: ["copilotSemanticGroups", "draftQueue"] }
] as const;

export const FEATURE_BY_ID = new Map(FEATURE_REGISTRY.map((feature) => [feature.id, feature]));

export interface FeatureSettings {
  version: 1;
  masterEnabled: boolean;
  features: Record<FeatureId, boolean>;
  presentation: {
    theme: "system" | "light" | "dark";
    groupMode: "category" | "folder" | "flat";
  };
}

export function defaultSettings(): FeatureSettings {
  return {
    version: 1,
    masterEnabled: true,
    features: Object.fromEntries(FEATURE_REGISTRY.map((feature) => [feature.id, feature.defaultEnabled])) as Record<FeatureId, boolean>,
    presentation: { theme: "system", groupMode: "category" }
  };
}

export function migrateSettings(value: unknown): FeatureSettings {
  const defaults = defaultSettings();
  if (!value || typeof value !== "object") return defaults;
  const candidate = value as Partial<FeatureSettings>;
  const rawFeatures: Partial<Record<FeatureId, boolean>> = candidate.features && typeof candidate.features === "object" ? candidate.features : {};
  return {
    version: 1,
    masterEnabled: typeof candidate.masterEnabled === "boolean" ? candidate.masterEnabled : defaults.masterEnabled,
    features: Object.fromEntries(FEATURE_REGISTRY.map((feature) => [
      feature.id,
      typeof rawFeatures[feature.id] === "boolean" ? rawFeatures[feature.id] : feature.defaultEnabled
    ])) as Record<FeatureId, boolean>,
    presentation: {
      theme: ["system", "light", "dark"].includes(candidate.presentation?.theme ?? "") ? candidate.presentation!.theme : "system",
      groupMode: ["category", "folder", "flat"].includes(candidate.presentation?.groupMode ?? "") ? candidate.presentation!.groupMode : "category"
    }
  };
}

export function resolveFeature(settings: FeatureSettings, id: FeatureId): { enabled: boolean; reason?: string } {
  if (!settings.masterEnabled) return { enabled: false, reason: "ADO Boost is disabled" };
  if (!settings.features[id]) return { enabled: false, reason: "Disabled in settings" };
  const definition = FEATURE_BY_ID.get(id);
  const missing = definition?.dependencies.find((dependency) => !resolveFeature(settings, dependency).enabled);
  return missing ? { enabled: false, reason: `Requires ${FEATURE_BY_ID.get(missing)?.label ?? missing}` } : { enabled: true };
}
