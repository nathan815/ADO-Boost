import { z } from "zod";

// MAIN-world validation must work under ADO's CSP without unsafe-eval.
z.config({ jitless: true });

export const CHANNEL = "adopp-native-tree-v1";

const count = z.number().int().nonnegative().nullable();
export const fileSchema = z.object({
  path: z.string().min(1).max(8192),
  trackingId: z.number().int(),
  changeType: z.string().max(100),
  additions: count,
  deletions: count,
  state: z.enum(["exact", "partial", "binary", "unavailable", "error"]),
  generated: z.boolean(),
  lockfile: z.boolean()
}).strict();

export const filtersSchema = z.object({
  changeKind: z.enum(["all", "add", "edit", "delete", "rename"]),
  extension: z.string().max(100),
  hideGenerated: z.boolean(),
  hideLockfiles: z.boolean()
}).strict();

export const configurationSchema = z.object({
  channel: z.literal(CHANNEL),
  kind: z.literal("configure"),
  session: z.string().uuid(),
  page: z.string().url().max(8192),
  comparison: z.object({
    iteration: z.number().int().positive(),
    source: z.string().min(1).max(100),
    base: z.string().min(1).max(100)
  }).strict(),
  files: z.array(fileSchema).max(20000),
  filters: filtersSchema,
  countsEnabled: z.boolean(),
  countDescription: z.string().max(300).optional()
}).strict();

export const commandSchema = z.discriminatedUnion("kind", [
  configurationSchema,
  z.object({ channel: z.literal(CHANNEL), kind: z.literal("dispose"), session: z.string().uuid() }).strict()
]);

export const statusSchema = z.object({
  channel: z.literal(CHANNEL),
  kind: z.literal("status"),
  session: z.string().uuid(),
  state: z.enum(["waiting", "active", "unavailable", "counts-unavailable", "comparison-mismatch"]),
  detail: z.string().max(1000),
  fileCount: z.number().int().nonnegative().nullable(),
  filtersActive: z.boolean().optional()
}).strict();

export type TreeFile = z.infer<typeof fileSchema>;
export type TreeFilters = z.infer<typeof filtersSchema>;
export type TreeConfiguration = z.infer<typeof configurationSchema>;
export type TreeStatus = z.infer<typeof statusSchema>;

export function extensionOf(path: string): string {
  const name = path.split("/").at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

export function matchesFilters(file: TreeFile, filters: TreeFilters): boolean {
  return (filters.changeKind === "all" || file.changeType.toLowerCase().includes(filters.changeKind))
    && (filters.extension === "all" || extensionOf(file.path) === filters.extension)
    && (!filters.hideGenerated || !file.generated)
    && (!filters.hideLockfiles || !file.lockfile);
}

export function hasFilters(filters: TreeFilters): boolean {
  return filters.changeKind !== "all" || filters.extension !== "all" || filters.hideGenerated || filters.hideLockfiles;
}

export function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}
