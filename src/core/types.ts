export type CountState = "exact" | "partial" | "binary" | "unavailable" | "error";

export interface PrRoute {
  origin: string;
  organization: string;
  project: string;
  repository: string;
  pullRequestId: number;
}

export interface PullRequestComparison extends PrRoute {
  repositoryId: string;
  sourceCommit: string;
  targetCommit: string;
  mergeBaseCommit: string;
  iterationId: number;
  identity: string;
}

export interface PullRequestContext extends PullRequestComparison {
  title: string;
  reviewer: {
    id: string;
    displayName: string;
  };
}

export interface ChangedFile {
  unresolved?: false;
  trackingId: number;
  path: string;
  originalPath?: string;
  changeType: string;
  objectId?: string;
  originalObjectId?: string;
  rawEntry?: unknown;
}

export interface UnresolvedChange {
  unresolved: true;
  raw: unknown;
  detail: string;
  trackingId?: number;
  path?: string;
  changeType?: string;
}

export type ChangeEntry = ChangedFile | UnresolvedChange;

export interface FileStat extends ChangedFile {
  additions: number | null;
  deletions: number | null;
  state: CountState;
  detail?: string;
  generated: boolean;
  lockfile: boolean;
}

export interface ReviewGroup {
  id: string;
  title: string;
  rationale: string;
  source: "local" | "copilot";
  files: FileStat[];
}

export interface ThreadSummary {
  active: number;
  resolved: number;
  total: number;
}

export interface ThreadOverview extends ThreadSummary {
  state: "available" | "error";
  detail?: string;
}

export interface PullRequestAnalysis {
  context: PullRequestContext;
  files: FileStat[];
  unresolvedChanges?: UnresolvedChange[];
  groups: ReviewGroup[];
  threads: ThreadOverview;
  completedTrackingIds: Set<number>;
}

export interface ReviewRecord {
  trackingId: number;
  objectId: string | null;
  reviewedAt: string;
}

export interface AnnouncementRecord {
  key: string;
  status: "posting" | "posted" | "ambiguous";
  threadId?: number;
  commentId?: number;
  postedAt?: string;
  body: string;
  completions?: AnnouncementCompletion[];
}

export type ReviewVote = 10 | 5 | -5 | -10;

export type ReviewCompletionTrigger =
  | { kind: "vote" }
  | { kind: "submission"; submissionId: string; commentCount: number };

export type AnnouncementCompletion = {
  id: string;
  at: string;
  status: "posting" | "posted" | "ambiguous" | "closed";
  commentId?: number;
} & (
  | { kind: "vote"; vote: ReviewVote }
  | { kind: "submission"; commentCount: number }
);

export type DraftKind = "general" | "inline" | "reply";

export interface ReviewDraft {
  id: string;
  operationId: string;
  kind: DraftKind;
  body: string;
  path?: string;
  line?: number;
  side?: "left" | "right";
  trackingId?: number;
  threadId?: number;
  comparisonIdentity: string;
  createdAt: string;
  updatedAt: string;
  delivery: "pending" | "sending" | "posted" | "ambiguous" | "failed";
  serverThreadId?: number;
  serverCommentId?: number;
  error?: string | undefined;
}

export type ReviewDecision = "comment" | "approve" | "approve-suggestions" | "wait-author" | "reject";

export interface SubmissionReceipt {
  id: string;
  startedAt: string;
  completedAt?: string;
  decision: ReviewDecision;
  existingVote: number;
  postedDraftIds: string[];
  failedDraftIds: string[];
  voteApplied: boolean;
  voteError?: string | undefined;
  announcementError?: string | undefined;
}

export interface PullRequestThread {
  id: number;
  status: string;
  publishedDate?: string;
  path?: string;
  line?: number;
  comments: Array<{
    id: number;
    content: string;
    author: string;
    authorImageUrl?: string;
    isVoteUpdate?: boolean;
    isDeleted: boolean;
    publishedDate?: string;
  }>;
}

export interface SemanticGroupProposal {
  title: string;
  rationale: string;
  paths: string[];
}
