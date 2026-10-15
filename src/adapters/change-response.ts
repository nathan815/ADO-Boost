import { z } from "zod";
import type { ChangeEntry } from "../core/types";
import type { ResponseWarning } from "./response-validation";

const trackingIdSchema = z.union([
  z.number().int().nonnegative(),
  z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().nonnegative())
]);

const changeSchema = z.object({
  changeTrackingId: trackingIdSchema.nullish(),
  changeType: z.string().nullish(),
  originalPath: z.string().nullish(),
  item: z.object({
    path: z.string().nullish(),
    objectId: z.string().nullish(),
    originalObjectId: z.string().nullish()
  }).passthrough().nullish()
}).passthrough();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonemptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function readChangeEntry(raw: unknown, index: number, warn: ResponseWarning): ChangeEntry {
  const validated = changeSchema.safeParse(raw);
  const record = isRecord(raw) ? raw : {};
  const item = isRecord(record.item) ? record.item : {};
  const id = trackingIdSchema.safeParse(record.changeTrackingId);
  const trackingId = id.success ? id.data : undefined;
  const changeType = nonemptyString(record.changeType);
  const originalPath = nonemptyString(record.originalPath);
  // A deleted file can be addressed by its old path; a renamed file needs its new path.
  const path = nonemptyString(item.path) ?? (changeType?.toLowerCase().includes("delete") ? originalPath : undefined);
  const objectId = nonemptyString(item.objectId);
  const originalObjectId = nonemptyString(item.originalObjectId);
  const problems: string[] = [];
  if (trackingId === undefined) problems.push("No usable change tracking ID");
  if (!changeType) problems.push("No usable change type");
  if (!path) problems.push("No usable file path");
  if (changeType?.toLowerCase().includes("rename") && record.originalPath != null && !originalPath) {
    problems.push("No usable original path for the rename");
  }

  if (problems.length > 0 || trackingId === undefined || !changeType || !path) {
    const detail = problems.join("; ");
    warn(`ADO Boost retained unresolved changeEntries[${index}]: ${detail}. Diff analysis needs this information.`, raw);
    return {
      unresolved: true,
      raw,
      detail,
      ...(trackingId !== undefined ? { trackingId } : {}),
      ...(path ? { path } : {}),
      ...(changeType ? { changeType } : {})
    };
  }

  if (!validated.success) {
    warn(`ADO Boost Azure DevOps response warning for changeEntries[${index}]; the change was retained: ${z.prettifyError(validated.error)}`, raw);
  }
  return {
    trackingId,
    path,
    changeType,
    ...(originalPath ? { originalPath } : {}),
    ...(objectId ? { objectId } : {}),
    ...(originalObjectId ? { originalObjectId } : {}),
    ...(!validated.success ? { rawEntry: raw } : {})
  };
}
