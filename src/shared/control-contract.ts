export type Role = "engineer" | "marketer" | "admin";
export type SourceMode = "live" | "manual" | "fixture";
export type Tab = "landing" | "dashboard" | "cases" | "persona" | "connections" | "controls";

export interface Evidence {
  id: string;
  label: string;
  detail: string;
  url?: string;
}
export interface Approval {
  id: string;
  kind: string;
  status: string;
  expiresAt?: number;
  expired?: boolean;
  role: string;
  slackUrl?: string;
  candidateHash?: string;
  replyText?: string;
  decisionActor?: string;
  simulated?: boolean;
}
export interface DemoRun {
  runId: string;
  caseId: string;
  status: "running" | "paused" | "completed";
  stepIndex: number;
  totalSteps: number;
  stepLabel: string;
  nextAt: number | null;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  stopReason?: string;
  events: { id: string; at: number; title: string; detail: string; phase: string }[];
}
export interface Publication {
  id: string;
  status: string;
  draftText: string;
  receiptUrl?: string;
  attested?: boolean;
  mode: string;
  account?: string;
  targetUrl?: string;
  version?: number;
  manualOnly?: boolean;
  supplementalToPublicationId?: string;
  resolutionCaseId?: string;
}
export interface CaseRecord {
  id: string;
  title: string;
  sourcePlatform: string;
  sourceMode: SourceMode;
  sourceUrl?: string;
  text: string;
  route: string;
  phase: string;
  blockingReason?: string;
  outcome?: string;
  createdAt: string;
  productionVerified: boolean;
  communicationStatus: string;
  canceledAt?: number;
  canceledBy?: string;
  cancellationReason?: string;
  classification?: { category: string; confidence: number; riskFlags: string[]; language: string };
  signals?: { authorId: string; originalUrl: string; text: string; platform: string; observedAt: number }[];
  repository?: string;
  scope?: string[];
  liveVerifiedAt?: number;
  evidence: Evidence[];
  approvals: Approval[];
  publications: Publication[];
  candidate?: {
    headSha: string;
    treeDigest: string;
    deploymentId: string;
    productionUrl?: string;
    checksPassed: boolean;
  };
  drafts?: {
    id: string;
    text: string;
    hash: string;
    version: number;
    status: string;
    personaId?: string;
  }[];
}
export interface Persona {
  id: string;
  name: string;
  version: number;
  status: string;
  objective: string;
  brandDescription: string;
  audience: string;
  formality: number;
  warmth: number;
  directness: number;
  slang: number;
  humorLevel: number;
  roastLevel: number;
  maxLength: number;
  maxEmoji: number;
  allowedCategories: string[];
  doNotEngage: string[];
  bannedPhrases: string[];
  hourlyCap: number;
  dailyCap: number;
  authorCooldownHours: number;
  expiresAt?: string;
  platforms: string[];
  autonomyEnabled: boolean;
  hash?: string;
  approvedVocabulary?: string[];
  examples?: string[];
  counterexamples?: string[];
  approvalId?: string;
  slackUrl?: string;
}
export interface Connection {
  id: string;
  platform: string;
  status: string;
  detail: string;
  account?: string;
  lastCheckedAt?: string;
  paused?: boolean;
}
export interface Snapshot {
  revision: number;
  mode: "demo" | "live";
  demoRun?: DemoRun;
  actor: { id: string; name: string; roles: Role[] };
  workspace: {
    paused: boolean;
    model: string;
    spendUsd: number;
    reservedUsd: number;
    infrastructureCommittedUsd?: number;
    capUsd: number;
  };
  readiness: { id: string; label: string; status: string; detail: string }[];
  cases: CaseRecord[];
  personas: Persona[];
  connections: Connection[];
  audit: {
    id: string;
    at: string;
    actor: string;
    role: string;
    action: string;
    detail: string;
  }[];
  suppressions?: {
    id: string;
    platform: string;
    author: string;
    reason: string;
  }[];
}
export interface TestResult {
  decision: string;
  reasons: string[];
  draft?: string;
  checks?: { label: string; passed: boolean; detail?: string }[];
}
export type Action = (
  action: string,
  payload?: Record<string, unknown>,
  success?: string,
) => Promise<boolean>;
