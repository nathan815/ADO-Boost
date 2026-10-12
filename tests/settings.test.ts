import { describe, expect, it } from "vitest";
import { defaultSettings, migrateSettings, resolveFeature } from "../src/features/registry";
import { MemorySettingsStorage, SettingsService } from "../src/features/settings-service";

describe("feature settings", () => {
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
