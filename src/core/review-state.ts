import type { ChangedFile, ReviewRecord } from "./types";

export function reconcileReviewRecords(files: ChangedFile[], records: ReviewRecord[]): {
  retained: ReviewRecord[];
  invalidated: number[];
} {
  const byTrackingId = new Map(records.map((record) => [record.trackingId, record]));
  const retained: ReviewRecord[] = [];
  const invalidated: number[] = [];

  for (const file of files) {
    const record = byTrackingId.get(file.trackingId);
    if (!record) continue;
    const objectId = file.objectId ?? null;
    if (record.objectId === objectId) retained.push(record);
    else invalidated.push(file.trackingId);
  }
  return { retained, invalidated };
}
