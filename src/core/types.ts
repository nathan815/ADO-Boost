export type CountState = "exact" | "partial" | "binary" | "unavailable" | "error";

export interface PrRoute {
  origin: string;
  organization: string;
  project: string;
  repository: string;
  pullRequestId: number;
}

export interface PullRequestContext extends PrRoute {
  repositoryId: string;
  title: string;
  sourceCommit: string;
  targetCommit: string;
  mergeBaseCommit: string;
  iterationId: number;
  identity: string;
  reviewer: {
    id: string;
    displayName: string;
  };
}

export interface ChangedFile {
  trackingId: number;
  path: string;
  originalPath?: string;
  changeType: string;
  objectId?: string;
  originalObjectId?: string;
}

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
}

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
}

export interface PullRequestThread {
  id: number;
  status: string;
  path?: string;
  line?: number;
  comments: Array<{
    id: number;
    content: string;
    author: string;
    isDeleted: boolean;
  }>;
}

export interface SemanticGroupProposal {
  title: string;
  rationale: string;
  paths: string[];
}
