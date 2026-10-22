import { z } from "zod";

export const HOST_PORT = "ado-boost-workspace-host";
export const UI_PORT = "ado-boost-workspace-ui";
export const personSchema = z.object({ id: z.string().min(1), displayName: z.string(), imageUrl: z.string().optional() });
export type Person = z.infer<typeof personSchema>;
export const workspaceRouteSchema = z.object({
  view: z.enum(["dashboard", "people", "profile", "feed", "projects"]),
  subject: personSchema.nullable()
});
export const projectSchema = z.object({ id: z.string(), name: z.string() });
export type Project = z.infer<typeof projectSchema>;
export const repositorySchema = z.object({ id: z.string(), name: z.string(), project: projectSchema });
export type Repository = z.infer<typeof repositorySchema>;
export const prSchema = z.object({
  pullRequestId: z.number().int().positive(), title: z.string(), status: z.string(),
  creationDate: z.string(), closedDate: z.string().optional(), isDraft: z.boolean().optional(),
  repository: repositorySchema, createdBy: personSchema,
  reviewers: z.array(personSchema.extend({ vote: z.number().default(0) })).default([])
});
export type WorkspacePr = z.infer<typeof prSchema>;
export const prPageSchema = z.object({ items: z.array(prSchema), more: z.boolean() });
export const threadSchema = z.object({
  id: z.number(), publishedDate: z.string().optional(), isDeleted: z.boolean().optional(),
  properties: z.object({
    CodeReviewVotedByIdentity: z.unknown().optional(),
    CodeReviewVoteResult: z.unknown().optional()
  }).nullish(),
  identities: z.record(z.string(), personSchema).nullish(),
  comments: z.array(z.object({
    // Timelines need a preview, not entire bot reports in every cached comment.
    id: z.number(), author: personSchema, content: z.string().transform((content) => content.slice(0, 300)).optional(),
    publishedDate: z.string().optional(), commentType: z.union([z.string(), z.number()]).optional(),
    isDeleted: z.boolean().optional()
  })).default([])
});
export type WorkspaceThread = z.infer<typeof threadSchema>;
export const preferencesSchema = z.object({
  projects: z.array(projectSchema).max(10),
  follows: z.array(personSchema).max(50),
  favorites: z.array(z.string()).max(1000)
});
export type Preferences = z.infer<typeof preferencesSchema>;
export const emptyPreferences = (): Preferences => ({ projects: [], follows: [], favorites: [] });
export const readSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("identity") }),
  z.object({ kind: z.literal("projects"), continuation: z.string().max(2048).optional() }),
  z.object({ kind: z.literal("repositories"), project: z.string().min(1).max(256) }),
  z.object({
    kind: z.literal("prs"), project: z.string().min(1).max(256),
    creator: z.string().max(256).optional(), reviewer: z.string().max(256).optional(),
    status: z.enum(["all", "active", "completed", "abandoned"]),
    skip: z.number().int().min(0), since: z.string().datetime(),
    until: z.string().datetime().optional(), top: z.number().int().min(1).max(500).optional(),
    range: z.enum(["created", "closed"]).default("created")
  }),
  z.object({
    kind: z.literal("threads"), project: z.string().min(1).max(256), repository: z.string().min(1).max(256), pr: z.number().int().positive(),
    closedDate: z.string().datetime().optional()
  }),
  z.object({ kind: z.literal("people"), query: z.string().min(2).max(100) })
]);
export type ReadRequest = z.infer<typeof readSchema>;
export const requestSchema = z.object({
  id: z.string().min(1).max(100),
  request: z.discriminatedUnion("type", [
    z.object({ type: z.literal("read"), query: readSchema }),
    z.object({ type: z.literal("preferences"), value: preferencesSchema.optional() }),
    z.object({
      type: z.literal("cache"), key: z.string().max(4000), value: z.unknown().optional(),
      retention: z.enum(["recent", "history"]).optional(), permanent: z.boolean().optional()
    }),
    z.object({ type: z.literal("clear-cache") }),
    z.object({ type: z.literal("navigate"), view: z.enum(["dashboard", "people", "profile", "feed", "projects"]), person: personSchema.optional() }),
    z.object({ type: z.literal("close") }),
    z.object({ type: z.literal("ping") }),
    z.object({ type: z.literal("ready") })
  ])
});
export type WorkspaceRequest = z.infer<typeof requestSchema>["request"];
export interface WorkspaceContext { origin: string; organization: string; base: string }
export interface Session { context: WorkspaceContext; viewer: Person; theme: Record<string, string> }
export type WorkspaceRoute = z.infer<typeof workspaceRouteSchema>;
export type WorkspaceView = WorkspaceRoute["view"];
export interface WorkspaceSession extends Session {
  view: WorkspaceView;
  subject: Person | null;
  preferences: Preferences;
}
export interface Page<T> { items: T[]; more: boolean; continuation?: string }

export function workspaceRoute(url: URL): WorkspaceRoute {
  let subject: Person | null = null;
  try {
    subject = personSchema.safeParse(JSON.parse(url.searchParams.get("adoBoostPerson") ?? "null")).data ?? null;
  } catch { /* Invalid profile links open the viewer's profile instead. */ }
  return workspaceRouteSchema.safeParse({ view: url.searchParams.get("adoBoostPrHome"), subject }).data ?? { view: "dashboard", subject };
}

export function organizationContext(url: URL): WorkspaceContext | null {
  if (url.protocol !== "https:") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (url.hostname === "dev.azure.com" && parts[0]) {
    if (/%(?![a-f0-9]{2})/i.test(parts[0])) return null;
    let organization: string;
    try { organization = decodeURIComponent(parts[0]); } catch { return null; }
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(organization)) return null;
    return { origin: url.origin, organization, base: `${url.origin}/${encodeURIComponent(organization)}` };
  }
  const match = /^([a-z0-9-]+)\.visualstudio\.com$/i.exec(url.hostname);
  return match?.[1] ? { origin: url.origin, organization: match[1], base: url.origin } : null;
}

export function prKey(pr: WorkspacePr): string {
  return `${pr.repository.project.id}/${pr.repository.id}/${pr.pullRequestId}`;
}

export function prUrl(context: WorkspaceContext, pr: WorkspacePr): string {
  return `${context.base}/${encodeURIComponent(pr.repository.project.name)}/_git/${encodeURIComponent(pr.repository.name)}/pullrequest/${pr.pullRequestId}`;
}
