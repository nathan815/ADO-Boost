import type { AnnouncementRecord, ReviewDraft, ReviewRecord, SubmissionReceipt } from "../core/types";
import { SerialExecutor } from "../core/serial-executor";

export type DraftMutation =
  | { kind: "append"; draft: ReviewDraft }
  | { kind: "update"; id: string; changes: Partial<ReviewDraft> }
  | { kind: "remove"; id: string }
  | { kind: "replace"; drafts: ReviewDraft[] };

export interface BrowserStore {
  getReviewRecords(prKey: string): Promise<ReviewRecord[]>;
  saveReviewRecords(prKey: string, records: ReviewRecord[]): Promise<void>;
  getAnnouncement(key: string): Promise<AnnouncementRecord | null>;
  saveAnnouncement(record: AnnouncementRecord): Promise<void>;
  removeAnnouncement(key: string): Promise<void>;
  getDrafts(key: string): Promise<ReviewDraft[]>;
  saveDrafts(key: string, drafts: ReviewDraft[]): Promise<void>;
  mutateDrafts(key: string, mutation: DraftMutation): Promise<ReviewDraft[]>;
  subscribeDrafts(key: string, listener: (drafts: ReviewDraft[]) => void): () => void;
  getReceipts(key: string): Promise<SubmissionReceipt[]>;
  saveReceipts(key: string, receipts: SubmissionReceipt[]): Promise<void>;
}

export class ChromeBrowserStore implements BrowserStore {
  constructor(private readonly coordinatedDrafts = true) {}
  async getReviewRecords(prKey: string): Promise<ReviewRecord[]> {
    const key = `review:${prKey}`;
    const value = await chrome.storage.local.get(key);
    return Array.isArray(value[key]) ? value[key] as ReviewRecord[] : [];
  }

  async saveReviewRecords(prKey: string, records: ReviewRecord[]): Promise<void> {
    await chrome.storage.local.set({ [`review:${prKey}`]: records });
  }

  async getAnnouncement(key: string): Promise<AnnouncementRecord | null> {
    const storageKey = `announcement:${key}`;
    const value = await chrome.storage.local.get(storageKey);
    return (value[storageKey] as AnnouncementRecord | undefined) ?? null;
  }

  async saveAnnouncement(record: AnnouncementRecord): Promise<void> {
    await chrome.storage.local.set({ [`announcement:${record.key}`]: record });
  }

  async removeAnnouncement(key: string): Promise<void> {
    await chrome.storage.local.remove(`announcement:${key}`);
  }

  async getDrafts(key: string): Promise<ReviewDraft[]> {
    const storageKey = `drafts:${key}`;
    const value = await chrome.storage.local.get(storageKey);
    return Array.isArray(value[storageKey]) ? value[storageKey] as ReviewDraft[] : [];
  }

  async saveDrafts(key: string, drafts: ReviewDraft[]): Promise<void> {
    await chrome.storage.local.set({ [`drafts:${key}`]: drafts });
  }

  async mutateDrafts(key: string, mutation: DraftMutation): Promise<ReviewDraft[]> {
    if (!this.coordinatedDrafts) {
      const drafts = applyDraftMutation(await this.getDrafts(key), mutation);
      await this.saveDrafts(key, drafts);
      return drafts;
    }
    const response = await chrome.runtime.sendMessage({ channel: "adopp-storage", key, mutation }) as { ok: true; data: ReviewDraft[] } | { ok: false; error: string };
    if (!response.ok) throw new Error(response.error);
    return response.data;
  }

  subscribeDrafts(key: string, listener: (drafts: ReviewDraft[]) => void): () => void {
    const storageKey = `drafts:${key}`;
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !changes[storageKey]) return;
      const value = changes[storageKey].newValue;
      listener(Array.isArray(value) ? value as ReviewDraft[] : []);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  }

  async getReceipts(key: string): Promise<SubmissionReceipt[]> {
    const storageKey = `receipts:${key}`;
    const value = await chrome.storage.local.get(storageKey);
    return Array.isArray(value[storageKey]) ? value[storageKey] as SubmissionReceipt[] : [];
  }

  async saveReceipts(key: string, receipts: SubmissionReceipt[]): Promise<void> {
    await chrome.storage.local.set({ [`receipts:${key}`]: receipts });
  }
}

export class MemoryBrowserStore implements BrowserStore {
  private readonly reviews = new Map<string, ReviewRecord[]>();
  private readonly announcements = new Map<string, AnnouncementRecord>();
  private readonly drafts = new Map<string, ReviewDraft[]>();
  private readonly receipts = new Map<string, SubmissionReceipt[]>();
  private readonly mutations = new SerialExecutor();
  private readonly draftListeners = new Map<string, Set<(drafts: ReviewDraft[]) => void>>();

  async getReviewRecords(prKey: string): Promise<ReviewRecord[]> {
    return this.reviews.get(prKey) ?? [];
  }

  async saveReviewRecords(prKey: string, records: ReviewRecord[]): Promise<void> {
    this.reviews.set(prKey, records);
  }

  async getAnnouncement(key: string): Promise<AnnouncementRecord | null> {
    return this.announcements.get(key) ?? null;
  }

  async saveAnnouncement(record: AnnouncementRecord): Promise<void> {
    this.announcements.set(record.key, record);
  }

  async removeAnnouncement(key: string): Promise<void> {
    this.announcements.delete(key);
  }

  async getDrafts(key: string): Promise<ReviewDraft[]> {
    return this.drafts.get(key) ?? [];
  }

  async saveDrafts(key: string, drafts: ReviewDraft[]): Promise<void> {
    this.drafts.set(key, drafts);
    for (const listener of this.draftListeners.get(key) ?? []) listener(drafts);
  }

  async mutateDrafts(key: string, mutation: DraftMutation): Promise<ReviewDraft[]> {
    return this.mutations.run(key, async () => {
      const drafts = applyDraftMutation(await this.getDrafts(key), mutation);
      await this.saveDrafts(key, drafts);
      return drafts;
    });
  }

  subscribeDrafts(key: string, listener: (drafts: ReviewDraft[]) => void): () => void {
    const listeners = this.draftListeners.get(key) ?? new Set();
    listeners.add(listener);
    this.draftListeners.set(key, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.draftListeners.delete(key);
    };
  }

  async getReceipts(key: string): Promise<SubmissionReceipt[]> {
    return this.receipts.get(key) ?? [];
  }

  async saveReceipts(key: string, receipts: SubmissionReceipt[]): Promise<void> {
    this.receipts.set(key, receipts);
  }
}

export function applyDraftMutation(drafts: ReviewDraft[], mutation: DraftMutation): ReviewDraft[] {
  if (mutation.kind === "append") return [...drafts, mutation.draft];
  if (mutation.kind === "update") return drafts.map((draft) => {
    if (draft.id !== mutation.id) return draft;
    if (draft.delivery === "sending" || draft.delivery === "posted") throw new Error("A draft cannot be edited while it is being delivered or after it was posted");
    return { ...draft, ...mutation.changes };
  });
  if (mutation.kind === "remove") {
    const draft = drafts.find((candidate) => candidate.id === mutation.id);
    if (draft?.delivery === "sending" || draft?.delivery === "posted") throw new Error("A draft cannot be deleted while it is being delivered or after it was posted");
    return drafts.filter((candidate) => candidate.id !== mutation.id);
  }
  return mutation.drafts;
}
