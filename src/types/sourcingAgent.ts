export type SourcingAgentSource = 'linkedin' | 'pool';
export type SourcingAgentApi = 'classic' | 'recruiter' | 'sales_navigator';
export type SourcingAgentState = 'draft' | 'calibrating' | 'active' | 'paused' | 'blocked' | 'awaiting_review' | 'stopped';
export type SourcingAgentAction = 'get' | 'configure' | 'start_calibration' | 'review' | 'approve_calibration' | 'pause' | 'resume' | 'stop' | 'skip_uncertain';

export interface SourcingAgentSettings {
  cadence_hours: 2 | 6 | 12 | 24;
  daily_profile_limit: number;
  daily_credit_limit: number;
  max_pending: number;
  min_score: number;
  model_id: string;
}

export const DEFAULT_SOURCING_AGENT_SETTINGS: SourcingAgentSettings = {
  cadence_hours: 6, daily_profile_limit: 20, daily_credit_limit: 100,
  max_pending: 10, min_score: 70, model_id: 'claude-sonnet-5-5',
};

export interface SourcingAgent {
  id: string; organization_id: string; project_id: string; created_by: string;
  source: SourcingAgentSource; account_id: string | null; api: SourcingAgentApi | null;
  settings: SourcingAgentSettings; status: SourcingAgentState; revision: number;
  approved_context_key: string | null; context_snapshot: Record<string, unknown>;
  search_filters_snapshot: Record<string, unknown>; checkpoint: Record<string, unknown>;
  next_run_at: string | null; last_run_at: string | null;
  lease_token: string | null; lease_until: string | null;
  last_reason: string | null; last_error: string | null; daily_date: string;
  profiles_used: number; credits_reserved: number; credits_used: number;
  created_at: string; updated_at: string;
}

export interface SourcingAgentCandidate {
  id: string; agent_id: string; organization_id: string; project_id: string; created_by: string;
  person_key: string; candidate_id: string | null;
  profile: Record<string, unknown>; result: Record<string, unknown>; provenance: Record<string, unknown>;
  score: number | null; context_key: string;
  state: 'discovered' | 'scored' | 'proposed' | 'reviewed' | 'skipped';
  decision: 'fit' | 'reject' | null; reason: string | null;
  source_aliases: unknown; credits_reserved: number; credits_used: number;
  created_at: string; updated_at: string;
}

export interface SourcingAgentSnapshot {
  agent: SourcingAgent | null;
  candidates: SourcingAgentCandidate[];
  context_key: string;
  eligibility: { allowed: boolean; reasons: string[] };
  accounts: { id: string; name: string; apis: SourcingAgentApi[]; status: string }[];
  accounts_error?: string | null;
  /** Management was confirmed without reading live prerequisites. */
  requires_refresh?: boolean;
  credits_estimate: { per_profile: number; daily_limit: number; reserved: number; used: number; remaining: number };
}

export interface SourcingAgentConfiguration {
  settings: SourcingAgentSettings;
  source: SourcingAgentSource;
  account_id: string | null;
  api: SourcingAgentApi | null;
}

export interface SourcingAgentCommand {
  action: Exclude<SourcingAgentAction, 'get'>;
  settings?: SourcingAgentSettings;
  source?: SourcingAgentSource;
  account_id?: string | null;
  api?: SourcingAgentApi | null;
  candidate_id?: string;
  decision?: 'fit' | 'reject';
  reason?: string;
  save_calibration_profiles?: true;
  confirm_uncertain?: true;
  expected_revision?: number;
  expected_context_key?: string;
}

export function validSourcingAgentSettings(settings: SourcingAgentSettings): boolean {
  return [2, 6, 12, 24].includes(settings.cadence_hours)
    && typeof settings.model_id === 'string' && Boolean(settings.model_id.trim())
    && Number.isInteger(settings.daily_profile_limit) && settings.daily_profile_limit >= 5 && settings.daily_profile_limit <= 100
    && Number.isInteger(settings.daily_credit_limit) && settings.daily_credit_limit >= 12 && settings.daily_credit_limit <= 500
    && Number.isInteger(settings.max_pending) && settings.max_pending >= 5 && settings.max_pending <= 50
    && Number.isInteger(settings.min_score) && settings.min_score >= 0 && settings.min_score <= 100;
}

export function readSourcingAgentSnapshot(value: unknown, organizationId: string, projectId: string): SourcingAgentSnapshot {
  const record = (item: unknown): item is Record<string, unknown> => Boolean(item && typeof item === 'object' && !Array.isArray(item));
  const apis = ['classic', 'recruiter', 'sales_navigator'];
  const data = value as Partial<SourcingAgentSnapshot> | null;
  if (!data || typeof data.context_key !== 'string' || !Array.isArray(data.candidates)
    || !Array.isArray(data.accounts) || typeof data.eligibility?.allowed !== 'boolean'
    || !Array.isArray(data.eligibility.reasons) || data.eligibility.reasons.some((reason) => typeof reason !== 'string')
    || !record(data.credits_estimate) || ['per_profile', 'daily_limit', 'reserved', 'used', 'remaining'].some((key) => typeof data.credits_estimate?.[key] !== 'number' || !Number.isFinite(data.credits_estimate[key]) || data.credits_estimate[key] < 0)
    || data.accounts.some((account) => !account || typeof account.id !== 'string' || typeof account.name !== 'string' || typeof account.status !== 'string' || !Array.isArray(account.apis) || account.apis.some((api) => !apis.includes(api)))
    || (data.accounts_error !== undefined && data.accounts_error !== null && typeof data.accounts_error !== 'string')
    || (data.requires_refresh !== undefined && typeof data.requires_refresh !== 'boolean')
    || !Object.prototype.hasOwnProperty.call(data, 'agent') || (data.agent !== null && (!data.agent
      || data.agent.organization_id !== organizationId || data.agent.project_id !== projectId
      || typeof data.agent.id !== 'string' || !Number.isInteger(data.agent.revision) || data.agent.revision < 0
      || !record(data.agent.context_snapshot) || !record(data.agent.settings) || !validSourcingAgentSettings(data.agent.settings)
      || !['linkedin', 'pool'].includes(data.agent.source) || !['draft', 'calibrating', 'active', 'paused', 'blocked', 'awaiting_review', 'stopped'].includes(data.agent.status)))
    || data.candidates.some((candidate) => !candidate || candidate.organization_id !== organizationId || candidate.project_id !== projectId
      || typeof candidate.id !== 'string' || typeof candidate.context_key !== 'string'
      || !record(candidate.profile) || !record(candidate.result) || !record(candidate.provenance)
      || !['discovered', 'scored', 'proposed', 'reviewed', 'skipped'].includes(candidate.state)
      || (candidate.reason !== null && typeof candidate.reason !== 'string')
      || (candidate.decision !== null && !['fit', 'reject'].includes(candidate.decision))
      || (candidate.score !== null && (typeof candidate.score !== 'number' || !Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 100)))) {
    throw new Error('La réponse de l’agent n’a pas pu être vérifiée. Réessayez.');
  }
  const snapshot = data as SourcingAgentSnapshot;
  const uncertain = sourcingUncertainCandidates(snapshot);
  const uncertainIds = new Set(uncertain.map((candidate) => candidate.id));
  const otherCandidates = snapshot.candidates.filter((candidate) => !uncertainIds.has(candidate.id)).slice(0, Math.max(0, 50 - uncertain.length));
  return { ...snapshot, candidates: [...uncertain, ...otherCandidates] };
}

export function sourcingCalibration(snapshot: SourcingAgentSnapshot | undefined) {
  const current = snapshot?.candidates.filter((candidate) => candidate.context_key === snapshot.context_key) ?? [];
  const reviewed = current.filter((candidate) => candidate.state === 'reviewed' && (candidate.decision === 'fit' || candidate.decision === 'reject') && (candidate.reason?.trim().length ?? 0) >= 5);
  const fits = reviewed.filter((candidate) => candidate.decision === 'fit').slice(0, 5);
  return { reviewed: reviewed.length, fits, canApprove: reviewed.length >= 3 && fits.length >= 1 };
}

export function sourcingUncertainCandidates(snapshot: SourcingAgentSnapshot | undefined): SourcingAgentCandidate[] {
  return snapshot?.candidates.filter((candidate) => candidate.state === 'discovered'
    && (candidate.credits_reserved > 0 || Boolean(candidate.provenance.scoring_started_at) || Boolean(candidate.provenance.reservation_recovered))) ?? [];
}

export function sourcingVisibleUncertainCandidates(snapshot: SourcingAgentSnapshot | undefined, now = Date.now()): SourcingAgentCandidate[] {
  const agent = snapshot?.agent;
  const leased = Boolean(agent?.lease_until && new Date(agent.lease_until).getTime() > now);
  return agent && ['paused', 'blocked', 'stopped'].includes(agent.status) && !leased ? sourcingUncertainCandidates(snapshot) : [];
}

export function sourcingCanResume(snapshot: SourcingAgentSnapshot | undefined): boolean {
  const agent = snapshot?.agent;
  return Boolean(agent && snapshot && ['paused', 'blocked', 'awaiting_review'].includes(agent.status)
    && !snapshot.requires_refresh && snapshot.eligibility.allowed && Boolean(agent.approved_context_key) && agent.approved_context_key === snapshot.context_key
    && !(agent.source === 'linkedin' && snapshot.accounts_error)
    && sourcingUncertainCandidates(snapshot).length === 0);
}

export function sourcingLinkedInUrl(profile: Record<string, unknown>): string | null {
  const value = profile.profile_url ?? profile.profileUrl ?? profile.public_profile_url;
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password
      && (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')) ? url.href : null;
  } catch { return null; }
}

/** Only readable, recorded profile fields are shown; never stringify raw data. */
export function sourcingProfileDetails(candidate: SourcingAgentCandidate) {
  const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const string = (value: unknown) => typeof value === 'string' ? value.trim() : '';
  const name = (value: unknown) => string(value) || string(record(value).name);
  const list = (value: unknown) => Array.isArray(value) ? value.map(name).filter(Boolean) : [];
  const date = (value: unknown) => {
    const data = record(value);
    if (typeof data.year === 'number' && Number.isInteger(data.year) && data.year >= 1900 && data.year <= 2300) return String(data.year);
    const text = string(value);
    return /^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(text) ? text : '';
  };
  const profile = candidate.profile;
  const rawExperience = Array.isArray(profile.work_experience) ? profile.work_experience
    : Array.isArray(profile.workExperience) ? profile.workExperience
      : Array.isArray(profile.experiences) ? profile.experiences
        : [...(Array.isArray(profile.current_positions) ? profile.current_positions : []), ...(Array.isArray(profile.past_positions) ? profile.past_positions : [])];
  const experience = rawExperience.slice(0, 8).map((item) => {
    if (typeof item === 'string') return { title: item.trim(), company: '', period: '', description: '' };
    const entry = record(item);
    return {
      title: string(entry.role) || string(entry.position) || string(entry.title),
      company: name(entry.company) || string(entry.company_name),
      period: string(entry.duration) || [date(entry.start ?? entry.startDate), date(entry.end ?? entry.endDate) || (entry.current === true || entry.isCurrent === true ? 'Aujourd’hui' : '')].filter(Boolean).join(' → '),
      description: string(entry.description),
    };
  }).filter((item) => item.title || item.company || item.description);
  const education = (Array.isArray(profile.education) ? profile.education : []).slice(0, 6).map((item) => {
    if (typeof item === 'string') return item.trim();
    const entry = record(item);
    const school = name(entry.school) || string(entry.school_name) || name(entry.school_details);
    return [school, string(entry.degree) || string(entry.degree_name), string(entry.field_of_study) || string(entry.field), date(entry.end)].filter(Boolean).join(' · ');
  }).filter(Boolean);
  const confidence = candidate.result.confidenceScore;
  return {
    summary: string(profile.summary) || string(profile.about),
    location: name(profile.location), skills: list(profile.skills).slice(0, 20), experience, education,
    strengths: list(candidate.result.strengths).slice(0, 5), concerns: list(candidate.result.concerns).slice(0, 5),
    confidence: typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 100 ? Math.round(confidence) : null,
  };
}

const REASONS: Record<string, string> = {
  CONTEXT_CHANGED: 'Le cadrage ou les règles ont changé. Revoyez les critères avant de reprendre.',
  MEMORY_CONFLICT: 'Des règles de recherche se contredisent. Vérifiez les mémoires appliquées.',
  CALIBRATION_REQUIRED: 'Votre avis est nécessaire pour calibrer la recherche.',
  WAITING_REVIEW: 'Les propositions attendent votre avis.',
  DAILY_BUDGET: 'Le budget cible du jour est atteint.',
  QUOTA_REACHED: 'La limite LinkedIn de votre compte est atteinte.',
  OUTSIDE_HOURS: 'La recherche reprendra dans vos horaires LinkedIn.',
  ACCOUNT_RECONNECT: 'Votre compte LinkedIn doit être reconnecté.',
  ACCOUNT_FORBIDDEN: 'Ce compte LinkedIn ne peut pas être utilisé pour votre recherche.',
  LICENSE_UNAVAILABLE: 'Cette licence LinkedIn n’est plus disponible.',
  PLAN_REQUIRED: 'Votre abonnement ne permet pas cette recherche.',
  ACCESS_REVOKED: 'Les droits de cet agent ont changé.',
  SEARCH_EXHAUSTED: 'Cette recherche ne trouve plus de nouveaux profils.',
  SCORING_UNCERTAIN: 'Une évaluation a été interrompue. Traitez le profil concerné avant de reprendre.',
  RETRY_LATER: 'Le dernier passage a échoué. Vérifiez l’agent avant de reprendre.',
  USER_PAUSED: 'La recherche est mise en pause à votre demande.',
  USER_STOPPED: 'La recherche est arrêtée à votre demande.',
  FILTERS_UNRESOLVED: 'Certains filtres doivent être précisés avant de rechercher.',
  FILTERS_UNSUPPORTED: 'Certains filtres ne sont pas disponibles avec cette licence LinkedIn.',
  FILTERS_INVALID: 'Vérifiez les filtres de recherche avant de poursuivre.',
  FILTERS_MEMORY_STALE: 'Les mémoires de recherche ont changé. Revoyez les filtres de recherche avant de recalibrer l’agent.',
  PRIVACY_CHANGED: 'Les données de ce profil ont été supprimées. Actualisez les propositions avant de poursuivre.',
  AGENT_LEASE_CHANGED: 'L’état du passage en cours a changé. Actualisez l’agent avant de continuer.',
  MISSION_INACTIVE: 'La mission est inactive. Réactivez-la avant de reprendre la recherche.',
};
export function sourcingAgentReason(code: string | null | undefined): string | null {
  return code ? REASONS[code] ?? 'Une vérification est nécessaire avant de poursuivre.' : null;
}

const STATE_LABELS: Record<SourcingAgentState, string> = {
  draft: 'À configurer', calibrating: 'Calibrage en cours', active: 'Recherche planifiée',
  paused: 'En pause', blocked: 'À vérifier', awaiting_review: 'Votre avis est attendu', stopped: 'Arrêté',
};
export function sourcingAgentStateLabel(agent: SourcingAgent) {
  const running = agent.lease_until && new Date(agent.lease_until).getTime() > Date.now();
  return agent.status === 'active' && running ? 'Recherche en cours' : STATE_LABELS[agent.status] ?? 'À vérifier';
}

export function sourcingAgentDate(date: string | null | undefined): string | null {
  if (!date || Number.isNaN(new Date(date).getTime())) return null;
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(date));
}
