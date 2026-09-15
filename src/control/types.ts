import type { ApprovalRequest } from "../core/approvals";
import type { Classification, NormalizedSignal, SolvedIssue } from "../core/signals";
import type { CaseRecord, Connection, DemoRun, Persona, Publication, Role, Snapshot } from "../shared/control-contract";

export interface Actor { id: string; name: string; roles: Role[]; slackTeamId?: string; slackUserId?: string }
export interface InternalPublication extends Publication {
  textHash: string; targetId: string; sourceKey: string; personaId: string; personaVersion: number;
  purpose: "resolution" | "known_fix" | "workaround" | "instructions" | "engagement";
  authorityId?: string; authorityKind?: "candidate_go" | "reply_approval" | "persona_policy";
  attemptedAt?: number; confirmedAt?: number; contextHash: string; authorId: string;
  manualOnly?: boolean; supplementalToPublicationId?: string; resolutionCaseId?: string;
  reconciliationHistory?: { at: number; operatorId: string; outcome: "unknown" | "confirmed" | "definitely_not_sent"; reason: string; attested: boolean; receiptUrl?: string; residualUncertainty?: boolean }[];
}
export interface InternalCase extends CaseRecord {
  classification: Classification; signals: NormalizedSignal[]; publications: InternalPublication[];
  version: number; planVersion: number; baseSha: string; repository: string;
  scope: string[]; liveVerifiedAt?: number; workflowId?: string; activeJobId?: string;
  testRevision?: string; buildConfigRevision?: string; previousDeploymentId?: string;
  releaseSubstage?: string; mergeSha?: string; linearId?: string; slackThreadTs?: string;
  draftedByModel?: boolean; validatedByModel?: boolean;
  productionIdentityCheckedAt?: number; productionDeploymentId?: string; productionTreeDigest?: string;
  buildAttemptNumber?: number;
  canceledAt?: number; canceledBy?: string; cancellationReason?: string;
}
export interface InternalConnection extends Connection {
  version: number; paused: boolean; permission: "unverified" | "granted" | "blocked";
  cursor?: string; lastPolledAt?: number;
}
export interface Authority {
  request: ApprovalRequest; caseId?: string; personaId?: string; payload: Record<string, unknown>;
  slackUrl?: string;
}
export interface Task {
  id: string; caseId?: string; kind: string; status: "pending" | "running" | "completed" | "failed" | "unknown";
  payload: Record<string, unknown>; attemptId: string; inputRevision: number; createdAt: number;
  workflowId?: string; dispatchedAt?: number; completedAt?: number; error?: string; receipt?: unknown;
  resultDigest?: string; lateResults?: { receivedAt: number; digest: string; status: string; sideEffectPossible: boolean }[];
}
export interface CostReservation {
  id: string; caseId: string; maximumUsd: number; status: "reserved" | "settled" | "unknown";
  actualUsd?: number; createdAt: number;
}
export interface ControlState {
  schemaVersion: 1; workspaceId: string; version: number; sequence: number; paused: boolean;
  mode: "demo" | "live"; model: "gpt-5-mini"; demoRole: Role;
  demoRun?: DemoRun; demoRunHistory?: DemoRun[];
  cases: InternalCase[]; personas: Persona[]; connections: InternalConnection[];
  authorities: Authority[]; tasks: Task[]; audit: Snapshot["audit"];
  suppressions: { id: string; platform: string; author: string; reason: string }[];
  costs: CostReservation[]; infrastructureCommittedUsd: number;
  solvedIssues: SolvedIssue[]; sourceKeys: string[];
}
export type Command = { action: string } & Record<string, unknown>;
export interface RuntimeConfig {
  infrastructureCommittedUsd?: number;
  mode: "demo" | "live"; repository: string; baseSha: string;
  openaiConfigured: boolean; accessConfigured: boolean; convexConfigured: boolean;
  slackConfigured: boolean; linearConfigured: boolean; githubConfigured: boolean;
  vercelConfigured: boolean; workerConfigured: boolean; redditConfigured: boolean;
}
export function publicError(error: unknown): string {
  if (error instanceof Error && /^[a-z_][a-z_0-9: -]{0,150}$/i.test(error.message)) return error.message;
  return "request_failed";
}
