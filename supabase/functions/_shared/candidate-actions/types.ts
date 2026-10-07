/** Contrat partagé du parcours réel. Les cibles et sources sont résolues côté serveur. */
export type CandidateActionService = 'linkedin' | 'whatsapp' | 'email' | 'gmail' | 'outlook' | 'call' | 'calendar' | 'calendly' | 'aircall' | 'google_meet';
export type CandidateActionChannel = 'linkedin' | 'email' | 'whatsapp';
export type CandidateActionEffectStatus = 'prepared' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'skipped';
export type CandidateActionPlanStatus = 'draft' | 'approved' | 'running' | 'completed' | 'partial' | 'needs_review' | 'dismissed';

export interface CandidateActionScope {
  organization_id: string;
  candidate_id: string;
  linkedin_url?: string | null;
  project_id?: string | null;
  account_id?: string | null;
  chat_id?: string | null;
}

export interface CandidateActionSource {
  id: string;
  type: string;
  title: string;
  author: string;
  timestamp: string;
  summary: string;
  detail: string;
  service?: CandidateActionService;
  projectId?: string | null;
  reference?: { table: string; id: string; version?: string | null };
}

export interface CandidateActionTarget {
  id: string;
  audience: 'candidate' | 'team';
  channel: CandidateActionChannel;
  service: CandidateActionService;
  label: string;
  recipient: string;
  senderAccountId: string;
  senderAddress: string;
  chatId?: string;
  recipientProviderId?: string;
  memberId?: string;
}

export interface CandidateActionEffectResult {
  referenceId?: string;
  referenceTable?: string;
  providerId?: string;
  providerThreadId?: string;
  providerReceipt?: Record<string, unknown>;
  completedAt?: string;
  message?: string;
  errorCode?: string;
  performedBy?: string;
  scheduledFor?: string;
}

interface CandidateActionEffectBase {
  id: string;
  label: string;
  content: string;
  status: CandidateActionEffectStatus;
  dedupeKey: string;
  result?: CandidateActionEffectResult;
}

export interface CandidateActionMessageEffect extends CandidateActionEffectBase {
  kind: 'message';
  targetId: string;
  audience: 'candidate' | 'team';
  channel: CandidateActionChannel;
  service: CandidateActionService;
  recipient: string;
  senderAccountId: string;
  senderAddress: string;
  subject?: string;
  chatId?: string;
  recipientProviderId?: string;
  memberId?: string;
}

export interface CandidateActionDocumentEffect extends CandidateActionEffectBase {
  kind: 'document';
  documentType: 'interview_brief' | 'scorecard_questions' | 'follow_up';
  destination: string;
  evaluationId?: string;
}

export interface CandidateActionCommentEffect extends CandidateActionEffectBase {
  kind: 'comment';
  destination: string;
  mentions: string[];
}

export type CandidateActionEffect = CandidateActionMessageEffect | CandidateActionDocumentEffect | CandidateActionCommentEffect;

export interface CandidateActionPlan {
  id: string;
  scope: CandidateActionScope;
  contextVersion: string;
  revision: number;
  intent: string;
  title: string;
  reason: string;
  status: CandidateActionPlanStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  sources: CandidateActionSource[];
  effects: CandidateActionEffect[];
  followUp?: { title: string; waitingFor: string; description: string };
}

export interface CandidateActionContext {
  scope: CandidateActionScope;
  candidateName: string;
  contextVersion: string;
  sources: CandidateActionSource[];
  /** Une source indisponible ou partielle ne constitue jamais une preuve d'absence. */
  sourceStates: Record<string, 'available' | 'partial' | 'unavailable'>;
  facts: Record<string, unknown>;
  targets: CandidateActionTarget[];
  members: Array<{ id: string; name: string }>;
  ownEvaluationIds: string[];
  warnings: string[];
}

export interface CandidateActionEdits {
  [effectId: string]: { content: string; subject?: string };
}

export interface CandidateActionsResponse {
  plans: CandidateActionPlan[];
  warnings?: string[];
  channels?: Array<{ channel: CandidateActionChannel; service: CandidateActionService; address: string }>;
}

export interface CandidateActionMessageOutcome {
  status: 'succeeded' | 'failed' | 'unknown';
  result: CandidateActionEffectResult;
}

/** Authorized ledger rows; personal incoming mail is not shared by membership. */
export interface CandidateActionMessageRecord {
  id: string;
  organization_id: string;
  candidate_id: string;
  project_id: string | null;
  owner_user_id: string;
  account_id: string;
  channel: CandidateActionChannel;
  service: CandidateActionService;
  audience: 'candidate' | 'team';
  direction: 'inbound' | 'outbound';
  provider_message_id: string;
  provider_thread_id: string | null;
  in_reply_to: string | null;
  counterpart: string;
  sender: string;
  recipient: string;
  subject: string | null;
  content: string;
  occurred_at: string;
  action_plan_id: string | null;
  effect_id: string | null;
  action_completed_at?: string | null;
  created_at: string;
}
