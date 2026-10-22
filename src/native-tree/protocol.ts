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

export const semanticViewSchema = z.object({
  mode: z.enum(["all", "inline", "group"]),
  groupId: z.string().min(1).max(1024).nullable()
}).strict().refine((value) => value.mode === "group" ? value.groupId !== null : value.groupId === null);

export const semanticSchema = z.object({
  revision: z.number().int().nonnegative(),
  groups: z.array(z.object({
    id: z.string().min(1).max(1024),
    title: z.string().min(1).max(300),
    rationale: z.string().max(8000),
    paths: z.array(z.string().min(1).max(8192)).min(1).max(20000)
  }).strict()).max(200),
  view: semanticViewSchema,
  busy: z.boolean(),
  stale: z.boolean().optional(),
  autoGenerate: z.boolean().optional(),
  showConfirmation: z.boolean().optional(),
  error: z.string().max(1000)
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
  countDescription: z.string().max(300).optional(),
  semantic: semanticSchema.optional()
}).strict().refine((value) => {
  if (!value.semantic) return true;
  const files = new Set(value.files.map((file) => file.path));
  const paths = new Set<string>();
  const ids = new Set<string>();
  for (const group of value.semantic.groups) {
    if (ids.has(group.id)) return false;
    ids.add(group.id);
    for (const path of group.paths) {
      if (!files.has(path) || paths.has(path)) return false;
      paths.add(path);
    }
  }
  return (!ids.size || paths.size === files.size)
    && (value.semantic.view.mode === "all" || ids.size > 0)
    && (value.semantic.view.mode !== "group" || ids.has(value.semantic.view.groupId!));
}, "Semantic groups must uniquely cover the analyzed comparison and identify a valid selection.");

export const semanticActionSchema = z.object({
  channel: z.literal(CHANNEL),
  kind: z.literal("semantic-action"),
  session: z.string().uuid(),
  action: z.enum(["regenerate", "select", "view-session", "toggle-auto-generate", "toggle-confirmation"]),
  view: semanticViewSchema
}).strict();

export const commandSchema = z.discriminatedUnion("kind", [
  configurationSchema,
  z.object({ channel: z.literal(CHANNEL), kind: z.literal("dispose"), session: z.string().uuid() }).strict()
]);

export const statusSchema = z.object({
  channel: z.literal(CHANNEL),
  kind: z.literal("status"),
  session: z.string().uuid(),
  state: z.enum(["waiting", "active", "unavailable", "counts-unavailable", "comparison-mismatch", "groups-unavailable"]),
  detail: z.string().max(1000),
  fileCount: z.number().int().nonnegative().nullable(),
  filtersActive: z.boolean().optional(),
  comparison: z.object({
    iteration: z.number().int().positive(),
    baseIteration: z.number().int().nonnegative()
  }).strict().optional()
}).strict();

export type TreeFile = z.infer<typeof fileSchema>;
export type TreeFilters = z.infer<typeof filtersSchema>;
export type TreeConfiguration = z.infer<typeof configurationSchema>;
export type TreeStatus = z.infer<typeof statusSchema>;
export type TreeSemantic = z.infer<typeof semanticSchema>;
export type TreeGroup = TreeSemantic["groups"][number];

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
