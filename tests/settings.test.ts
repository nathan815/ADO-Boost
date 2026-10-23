import { describe, expect, it } from "vitest";
import { defaultSettings, FEATURE_REGISTRY, migrateSettings, resolveFeature } from "../src/features/registry";
import { MemorySettingsStorage, SettingsService } from "../src/features/settings-service";

describe("feature settings", () => {
  it("defaults Copilot semantic groups on without enabling automatic generation or chat", () => {
    const settings = defaultSettings();
    expect(resolveFeature(settings, "copilotSemanticGroups").enabled).toBe(true);
    expect(settings.features.autoGenerateCopilotGroups).toBe(false);
    expect(settings.features.confirmCopilotGroups).toBe(true);
    expect(settings.features.copilotChat).toBe(false);
  });

  it("enables missing Copilot semantic group preferences while preserving explicit choices and dependencies", () => {
    expect(resolveFeature(migrateSettings({ features: {} }), "copilotSemanticGroups").enabled).toBe(true);
    expect(resolveFeature(migrateSettings({ features: { copilotSemanticGroups: false } }), "copilotSemanticGroups").enabled).toBe(false);
    expect(resolveFeature(migrateSettings({ features: { groupedNavigation: false } }), "copilotSemanticGroups").enabled).toBe(false);
    expect(resolveFeature(migrateSettings({ masterEnabled: false }), "copilotSemanticGroups").enabled).toBe(false);
  });

  it("defaults automatic grouping off and manual confirmation on for existing settings", () => {
    const settings = migrateSettings({ features: { copilotSemanticGroups: true } });
    expect(settings.features.autoGenerateCopilotGroups).toBe(false);
    expect(settings.features.confirmCopilotGroups).toBe(true);
    const enabled = migrateSettings({ features: { copilotSemanticGroups: true, autoGenerateCopilotGroups: true, confirmCopilotGroups: false } });
    expect(resolveFeature(enabled, "autoGenerateCopilotGroups").enabled).toBe(true);
    expect(enabled.features.confirmCopilotGroups).toBe(false);
    enabled.features.copilotSemanticGroups = false;
    expect(resolveFeature(enabled, "autoGenerateCopilotGroups").enabled).toBe(false);
  });
  it("defaults comment timestamps on independently of drafts and the thread navigator", () => {
    const settings = migrateSettings({ features: { draftQueue: false, threadNavigator: false } });
    expect(resolveFeature(settings, "commentTimestamps").enabled).toBe(true);
    settings.features.commentTimestamps = false;
    expect(resolveFeature(settings, "commentTimestamps").enabled).toBe(false);
  });
  it.each([false, true])("retires the experimental native-tree preference set to %s without disabling enhancements", (nativeTreeIntegration) => {
    const settings = migrateSettings({ features: { nativeTreeIntegration, fileSearch: false, hideGenerated: true } });
    expect(settings.features.groupedNavigation).toBe(true);
    expect(settings.features.fileFilters).toBe(true);
    expect(settings.features.hideGenerated).toBe(true);
    expect(settings.features).not.toHaveProperty("nativeTreeIntegration");
    expect(settings.features).not.toHaveProperty("fileSearch");
    expect(FEATURE_REGISTRY.map((feature) => feature.id)).not.toContain("nativeTreeIntegration");
    expect(FEATURE_REGISTRY.map((feature) => feature.id)).not.toContain("fileSearch");
  });

  it("preserves existing disabled navigation preferences when retiring the experiment", () => {
    const settings = migrateSettings({ features: { nativeTreeIntegration: true, groupedNavigation: false, fileFilters: false } });
    expect(resolveFeature(settings, "groupedNavigation").enabled).toBe(false);
    expect(settings.features.fileFilters).toBe(false);
    expect(defaultSettings().features.groupedNavigation).toBe(true);
  });
  it("migrates partial settings and preserves explicit choices", () => {
    const migrated = migrateSettings({ masterEnabled: true, features: { prOverview: false } });
    expect(migrated.features.prOverview).toBe(false);
    expect(migrated.features.reviewProgress).toBe(true);
  });

  it("explains unmet dependencies without mutating preferences", () => {
    const settings = defaultSettings();
    settings.features.prOverview = false;
    expect(resolveFeature(settings, "groupedNavigation")).toEqual({ enabled: false, reason: "Requires PR size summary" });
    expect(settings.features.groupedNavigation).toBe(true);
  });

  it("notifies open surfaces when settings change", async () => {
    const storage = new MemorySettingsStorage();
    const service = new SettingsService(storage);
    const received: boolean[] = [];
    const unsubscribe = service.subscribe((settings) => received.push(settings.masterEnabled));
    const settings = await service.load();
    await service.save({ ...settings, masterEnabled: false });
    unsubscribe();
    expect(received.at(-1)).toBe(false);
  });
});
