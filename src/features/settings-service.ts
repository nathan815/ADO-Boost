import type { FeatureSettings } from "./registry";
import { defaultSettings, migrateSettings } from "./registry";

export const SETTINGS_KEY = "settings:v1";

export interface SettingsStorage {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
  onChanged(listener: (key: string, value: unknown) => void): () => void;
}

export class ChromeSettingsStorage implements SettingsStorage {
  async get(key: string): Promise<unknown> {
    return (await chrome.storage.local.get(key))[key];
  }

  async set(key: string, value: unknown): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }

  onChanged(listener: (key: string, value: unknown) => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === "local") {
        for (const [key, change] of Object.entries(changes)) listener(key, change.newValue);
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }
}

export class MemorySettingsStorage implements SettingsStorage {
  private readonly values = new Map<string, unknown>();
  private readonly listeners = new Set<(key: string, value: unknown) => void>();

  async get(key: string): Promise<unknown> {
    return this.values.get(key);
  }

  async set(key: string, value: unknown): Promise<void> {
    this.values.set(key, value);
    for (const listener of this.listeners) listener(key, value);
  }

  async remove(key: string): Promise<void> {
    this.values.delete(key);
    for (const listener of this.listeners) listener(key, undefined);
  }

  onChanged(listener: (key: string, value: unknown) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}

export class SettingsService {
  constructor(private readonly storage: SettingsStorage) {}

  async load(): Promise<FeatureSettings> {
    const settings = migrateSettings(await this.storage.get(SETTINGS_KEY));
    await this.storage.set(SETTINGS_KEY, settings);
    return settings;
  }

  save(settings: FeatureSettings): Promise<void> {
    return this.storage.set(SETTINGS_KEY, migrateSettings(settings));
  }

  restoreDefaults(): Promise<void> {
    return this.storage.set(SETTINGS_KEY, defaultSettings());
  }

  subscribe(listener: (settings: FeatureSettings) => void): () => void {
    return this.storage.onChanged((key, value) => {
      if (key === SETTINGS_KEY) listener(migrateSettings(value));
    });
  }
}
