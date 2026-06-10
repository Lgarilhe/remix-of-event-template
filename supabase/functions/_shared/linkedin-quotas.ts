// ============================================================================
// LinkedIn quotas — helpers partagés (mutating tools agent + futurs callers)
// ============================================================================
// Source de vérité historique : process-sequences/index.ts (1359, 1388, 1728).
// Ce module isole les helpers safe-to-share (read-only, pas de side-effect)
// pour permettre aux mutating tools standalone (hors séquence) de respecter
// les mêmes garde-fous business hours + cap journalier.
//
// Conformité LinkedIn warning #260513-007211 (license sharing accusé) :
// toute nouvelle action LinkedIn visible DOIT passer par ces checks.
// ============================================================================

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
type SupabaseClient = ReturnType<typeof createClient>;

export interface UserQuotaConfig {
  business_hours_start: number;
  business_hours_end: number;
  max_actions_per_day: number;
  timezone: string;
  /** Daily cap on profile views (get_profile). Unipile reco ≈100/j. */
  max_profile_visits_per_day: number;
  /** Daily cap on search calls. */
  max_searches_per_day: number;
  /** Daily cap on InMails. Unipile reco 30–50/j. */
  max_inmails_per_day: number;
}

export const DEFAULT_USER_QUOTAS: UserQuotaConfig = {
  business_hours_start: 8,
  business_hours_end: 19,
  max_actions_per_day: 80,
  timezone: 'Europe/Paris',
  max_profile_visits_per_day: 100,
  max_searches_per_day: 100,
  max_inmails_per_day: 40,
};

// ============================================================================
// WARM-UP MODE — reprise douce après réinstauration d'un compte LinkedIn suspendu
// ============================================================================
// Le(s) compte(s) sortent d'une suspension (#260513-007211). Pendant la phase de
// reprise on plafonne TOUTES les actions bien en dessous des caps normaux, puis
// on remonte par paliers une fois le compte confirmé stable. Le clamp se fait par
// Math.min → il ne RELÈVE jamais un cap déjà plus bas (quotas custom users safe).
// Le mode expire AUTOMATIQUEMENT le 2026-06-16 (audit 2026-06-10 : le flag
// hard-codé sans garde-fou risquait de rester actif indéfiniment — sourcing
// à capacité réduite). Pour prolonger la reprise douce : repousser la date.
export const WARMUP_UNTIL = Date.parse('2026-06-16T00:00:00+02:00');
export const WARMUP_MODE = Date.now() < WARMUP_UNTIL;
export const WARMUP_CAPS = {
  max_actions_per_day: 20,         // actions visibles/j (normal : 80)
  max_profile_visits_per_day: 40,  // vues de profil/j (normal : 100)
  max_searches_per_day: 50,        // recherches/j (normal : 100)
  max_inmails_per_day: 15,         // InMails/j (normal : 40)
  weekly_invite_limit: 30,         // invitations/semaine (normal : 100)
};

/** Clamp warm-up : applique les caps de reprise par Math.min (pure, ne mute pas). */
function applyWarmupCaps(q: UserQuotaConfig): UserQuotaConfig {
  if (!WARMUP_MODE) return q;
  return {
    ...q,
    max_actions_per_day: Math.min(q.max_actions_per_day, WARMUP_CAPS.max_actions_per_day),
    max_profile_visits_per_day: Math.min(q.max_profile_visits_per_day, WARMUP_CAPS.max_profile_visits_per_day),
    max_searches_per_day: Math.min(q.max_searches_per_day, WARMUP_CAPS.max_searches_per_day),
    max_inmails_per_day: Math.min(q.max_inmails_per_day, WARMUP_CAPS.max_inmails_per_day),
  };
}

/**
 * Weekly invitation ceiling. LinkedIn's hard limit is ~200/week (Unipile docs);
 * we stay deliberately conservative at 100 (ou la valeur warm-up en reprise).
 * Shared so every send path agrees.
 */
export const WEEKLY_INVITE_LIMIT = WARMUP_MODE ? WARMUP_CAPS.weekly_invite_limit : 100;

/** Provider `usage` percentage at which we proactively pause the account. */
export const USAGE_PAUSE_THRESHOLD = 90;

/** All LinkedIn action types tracked by the unified ledger. */
export type LinkedInActionType =
  | 'connection_request'
  | 'message'
  | 'inmail'
  | 'smart_message'
  | 'profile_view'
  | 'search'
  | 'endorse';

/** Validate timezone, fallback to Europe/Paris if invalid (Intl.DateTimeFormat throws on bad IANA zone). */
export function safeTimezone(candidate: string | null | undefined): string {
  if (!candidate) return 'Europe/Paris';
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: candidate });
    return candidate;
  } catch {
    return 'Europe/Paris';
  }
}

/** Returns true if currently within Monday–Friday startHour ≤ h < endHour in the given timezone. */
export function isWithinBusinessHours(timezone: string, startHour = 8, endHour = 19): boolean {
  try {
    const tz = safeTimezone(timezone);
    const now = new Date();
    const hour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(now), 10);
    const day = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(now);
    return day !== 'Sat' && day !== 'Sun' && hour >= startHour && hour < endHour;
  } catch {
    return true;
  }
}

/**
 * Computes the next UTC ISO timestamp at which business hours open in the
 * given timezone. Returns now() if we are already within business hours.
 *
 * Algorithm :
 *   - Find startHour:00 in the user's timezone TODAY ; if it's still in the
 *     future, use it.
 *   - Otherwise advance day-by-day, skipping weekends, until startHour fits.
 *   - Cap at +7 days as a safety net.
 *
 * Returns ISO string (UTC).
 */
export function nextBusinessHoursStart(
  timezone: string,
  startHour = 8,
  endHour = 19,
): string {
  const tz = safeTimezone(timezone);
  const now = new Date();
  if (isWithinBusinessHours(tz, startHour, endHour)) {
    return now.toISOString();
  }

  // Iterate up to 7 days forward
  for (let offset = 0; offset <= 7; offset += 1) {
    const probe = new Date(now);
    probe.setUTCDate(probe.getUTCDate() + offset);
    // Get the weekday in target tz for this probe day at startHour
    // We construct "startHour:00:00 in tz" by formatting the probe date
    // and reading back the hour & weekday parts.
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
      hour: 'numeric',
      hour12: false,
    }).formatToParts(probe);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
    const year = get('year');
    const month = get('month');
    const day = get('day');
    const weekday = get('weekday');

    if (weekday === 'Sat' || weekday === 'Sun') continue;

    // Build a Date that represents `YYYY-MM-DD startHour:00:00` *in the user's tz*.
    // We do this by computing the offset of that local-tz time from UTC.
    const localTimestampMs = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      startHour,
      0,
      0,
      0,
    );
    // The localTimestampMs above is interpreted as if startHour was UTC. We need
    // to shift back by tz offset. Compute tz offset for that date:
    const tzStr = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(new Date(localTimestampMs));
    // tzStr is the same wall-clock interpreted as a different UTC instant.
    // Parse it back :
    const m = tzStr.match(/(\d+)\/(\d+)\/(\d+),\s*(\d+):(\d+):(\d+)/);
    if (!m) continue;
    // tzWallMs = the UTC instant at which UTC clock reads YYYY-MM-DD startHour in tz
    const tzWallMs = Date.UTC(
      Number(m[3]),
      Number(m[1]) - 1,
      Number(m[2]),
      Number(m[4]),
      Number(m[5]),
      Number(m[6]),
      0,
    );
    // tz offset = how far ahead of UTC the user is
    const tzOffsetMs = tzWallMs - localTimestampMs;
    // The actual UTC instant for "startHour:00 in tz" = localTimestampMs - tzOffsetMs
    const targetUtcMs = localTimestampMs - tzOffsetMs;
    if (targetUtcMs > now.getTime()) {
      // Anti-burst LinkedIn (2026-05-20) : décale le scheduled_for de 0 à
      // 45 min aléatoire pour qu'une vague d'actions approuvées hors plage
      // ne parte pas toutes à 8h00 pile (pattern bot évident). Chaque action
      // tirée indépendamment → spread naturel sur 45 min en début de plage.
      const jitterMs = Math.floor(Math.random() * 45 * 60 * 1000);
      return new Date(targetUtcMs + jitterMs).toISOString();
    }
  }
  // Fallback : 24h from now (better than throwing)
  return new Date(now.getTime() + 24 * 3600 * 1000).toISOString();
}

/** Load member_quotas row, falling back to DEFAULT_USER_QUOTAS for missing fields. */
export async function getUserQuotas(
  admin: SupabaseClient,
  userId: string | null | undefined,
): Promise<UserQuotaConfig> {
  if (!userId) return DEFAULT_USER_QUOTAS;
  try {
    const { data } = await admin
      .from('member_quotas')
      .select('business_hours_start, business_hours_end, max_actions_per_day, timezone, max_profile_visits_per_day, max_searches_per_day, max_inmails_per_day')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return DEFAULT_USER_QUOTAS;
    const row = data as Record<string, unknown>;
    return applyWarmupCaps({
      business_hours_start: row.business_hours_start as number ?? DEFAULT_USER_QUOTAS.business_hours_start,
      business_hours_end: row.business_hours_end as number ?? DEFAULT_USER_QUOTAS.business_hours_end,
      max_actions_per_day: row.max_actions_per_day as number ?? DEFAULT_USER_QUOTAS.max_actions_per_day,
      timezone: row.timezone as string ?? DEFAULT_USER_QUOTAS.timezone,
      max_profile_visits_per_day: row.max_profile_visits_per_day as number ?? DEFAULT_USER_QUOTAS.max_profile_visits_per_day,
      max_searches_per_day: row.max_searches_per_day as number ?? DEFAULT_USER_QUOTAS.max_searches_per_day,
      max_inmails_per_day: row.max_inmails_per_day as number ?? DEFAULT_USER_QUOTAS.max_inmails_per_day,
    });
  } catch {
    return applyWarmupCaps(DEFAULT_USER_QUOTAS);
  }
}

/**
 * Count today's "visible" LinkedIn actions issued by this user — across both
 * sequence steps (sequence_step_executions where status='sent') AND
 * standalone tool executions (agent_tool_executions where tool_name in the
 * VISIBLE_TOOL_NAMES list and status='executed').
 *
 * Approximative by design : the sequence counter is per-account_id; the tool
 * counter is per-user_id. We sum both — risk is a slight over-count if the
 * user has multiple LinkedIn accounts (favourable for safety).
 */
export const VISIBLE_AGENT_TOOL_NAMES = ['send_linkedin_message'] as const;

export async function countActionsToday(
  admin: SupabaseClient,
  userId: string,
  accountId: string | null,
): Promise<number> {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);
  const dayStartIso = dayStart.toISOString();

  // 1. Sequence step executions for this account (if known)
  let sequenceCount = 0;
  if (accountId) {
    const { data } = await admin
      .from('sequence_step_executions')
      .select('id, step:sequence_steps!inner(action_type), enrollment:sequence_enrollments!inner(account_id)')
      .eq('status', 'sent')
      .eq('enrollment.account_id', accountId)
      .in('step.action_type', ['message', 'smart_message', 'inmail', 'connection_request'])
      .gte('executed_at', dayStartIso);
    sequenceCount = (data?.length as number) || 0;
  }

  // 2. Standalone tool executions for this user
  const { data: toolData } = await admin
    .from('agent_tool_executions')
    .select('id')
    .eq('user_id', userId)
    .in('tool_name', VISIBLE_AGENT_TOOL_NAMES as unknown as string[])
    .eq('status', 'executed')
    .gte('executed_at', dayStartIso);
  const toolCount = (toolData?.length as number) || 0;

  return sequenceCount + toolCount;
}

export interface QuotaCheckResult {
  allowed: boolean;
  reason?: string;
  /** Number of visible actions performed today (sequence + standalone) */
  count_today: number;
  /** User's daily cap */
  max_per_day: number;
  /** Whether current time is within configured business hours */
  in_business_hours: boolean;
  /** User's configured timezone */
  timezone: string;
}

/**
 * One-stop quota check for standalone LinkedIn mutating tools.
 * Business-hours gate (kept here) + unified ledger gate (delegated to
 * enforceLinkedInAction, which is the single source of truth across ALL send
 * paths). Logs the action optimistically when allowed.
 */
export async function checkLinkedInQuota(
  admin: SupabaseClient,
  userId: string,
  accountId: string | null,
  actionType: LinkedInActionType = 'message',
  opts: { organizationId?: string | null; source?: string; log?: boolean } = {},
): Promise<QuotaCheckResult> {
  const quotas = await getUserQuotas(admin, userId);
  const inBh = isWithinBusinessHours(quotas.timezone, quotas.business_hours_start, quotas.business_hours_end);

  if (!inBh) {
    return {
      allowed: false,
      reason: `Hors plage horaire autorisée (${quotas.business_hours_start}h–${quotas.business_hours_end}h ${quotas.timezone}). Action différée.`,
      count_today: 0,
      max_per_day: quotas.max_actions_per_day,
      in_business_hours: false,
      timezone: quotas.timezone,
    };
  }

  const res = await enforceLinkedInAction(admin, {
    accountId,
    actionType,
    userId,
    organizationId: opts.organizationId ?? null,
    source: opts.source ?? 'agent_tool',
    quotas,
    mode: 'auto',
    log: opts.log ?? true,
  });

  return {
    allowed: res.allowed,
    reason: res.reason,
    count_today: res.count ?? 0,
    max_per_day: quotas.max_actions_per_day,
    in_business_hours: true,
    timezone: quotas.timezone,
  };
}

// ============================================================================
// UNIFIED LEDGER GATE — single source of truth for ALL LinkedIn send paths
// ============================================================================
// process-sequences, process-inmail-queue, agent-tools-mutations and
// unipile-search ALL funnel through enforceLinkedInAction so the daily/weekly
// caps are a real ceiling per LinkedIn account, regardless of origin.
// Conformité LinkedIn warning #260513-007211.

export interface EnforceOpts {
  accountId: string | null;
  actionType: LinkedInActionType;
  userId?: string | null;
  organizationId?: string | null;
  /** Provenance tag stored in the ledger: sequence | inmail_queue | agent_tool | manual_search | manual_inbox */
  source?: string;
  /** Pre-loaded quotas to avoid a re-query; loaded from member_quotas if omitted. */
  quotas?: UserQuotaConfig;
  /** 'manual' applies a 5% protective buffer (blocks near-limit, ~95%). 'auto' uses full caps. */
  mode?: 'auto' | 'manual';
  /** Whether to record the action in the ledger when allowed (default true). */
  log?: boolean;
}

export interface EnforceResult {
  allowed: boolean;
  reason?: string;
  /** weekly_invite | profile_view | search | inmail_daily | daily_visible | provider_pause | rpc_error */
  scope?: string;
  count?: number;
  /** True when within the soft-warning band (≥75% of the headline cap) — for UI nudges. */
  softWarn?: boolean;
}

/** Interpret Y-M-D H:M as wall-clock time in `tz`, return the UTC epoch ms. */
function localWallTimeToUtcMs(tz: string, year: number, month: number, day: number, hour: number, minute = 0): number {
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const str = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(new Date(asUtc));
  const m = str.match(/(\d+)\/(\d+)\/(\d+),\s*(\d+):(\d+):(\d+)/);
  if (!m) return asUtc;
  const wallMs = Date.UTC(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6]), 0);
  const offset = wallMs - asUtc;
  return asUtc - offset;
}

/** UTC ISO timestamp for 00:00 local-time today in the given timezone. */
export function startOfLocalDayUtc(timezone: string): string {
  const tz = safeTimezone(timezone);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return new Date(localWallTimeToUtcMs(tz, Number(get('year')), Number(get('month')), Number(get('day')), 0, 0)).toISOString();
}

/**
 * UTC ISO timestamp to pause an account until. Coarse 16h window — guaranteed
 * to skip the remainder of today's sending window; the business-hours gate
 * enforces the precise morning resume time.
 */
export function quotaPauseUntilTomorrow(_timezone?: string): string {
  return new Date(Date.now() + 16 * 3600 * 1000).toISOString();
}

/** Extract the provider `usage` percentage from a Unipile response body, if present. */
export function parseUsagePct(body: unknown): number | null {
  if (!body || typeof body !== 'object') return null;
  const u = (body as Record<string, unknown>).usage;
  return typeof u === 'number' && isFinite(u) ? u : null;
}

/**
 * Record the provider `usage` signal. When usage ≥ USAGE_PAUSE_THRESHOLD,
 * proactively pause the account (member_linkedin_accounts.quota_paused_until)
 * so every send path backs off until tomorrow. Non-fatal on error.
 */
export async function recordUsageSignal(
  admin: SupabaseClient,
  accountId: string | null,
  usagePct: number | null,
  timezone?: string,
): Promise<void> {
  if (!accountId || usagePct === null) return;
  try {
    const update: Record<string, unknown> = { last_usage_pct: Math.round(usagePct) };
    if (usagePct >= USAGE_PAUSE_THRESHOLD) {
      update.quota_paused_until = quotaPauseUntilTomorrow(timezone);
      console.warn(`[linkedin-quotas] usage ${usagePct}% ≥ ${USAGE_PAUSE_THRESHOLD}% — pausing account ${accountId} until ${update.quota_paused_until}`);
    }
    await admin.from('member_linkedin_accounts').update(update).eq('linkedin_account_id', accountId);
  } catch (e) {
    console.error('[linkedin-quotas] recordUsageSignal failed (non-fatal):', e);
  }
}

/**
 * The unified gate. Checks (atomically, via the check_linkedin_action_quota
 * RPC): provider pause, weekly invite cap, per-type daily caps, and the
 * cumulative visible daily cap — then optimistically logs the action.
 *
 * Fail behaviour on infra error:
 *   - mode 'auto'   → fail-CLOSED (block; the caller reschedules). Protects the
 *                     account from a silent over-send if the gate is down.
 *   - mode 'manual' → fail-OPEN (allow). A single human-initiated action on a
 *                     transient DB blip is negligible risk; blocking the user
 *                     mid-session would be worse UX.
 */
export async function enforceLinkedInAction(
  admin: SupabaseClient,
  opts: EnforceOpts,
): Promise<EnforceResult> {
  const { accountId, actionType } = opts;
  const manual = opts.mode === 'manual';

  if (!accountId) {
    // No account to key the ledger on — nothing to enforce (the caller will
    // fail downstream without an account anyway).
    return { allowed: true, count: 0 };
  }

  const quotas = opts.quotas ?? await getUserQuotas(admin, opts.userId ?? null);
  const factor = manual ? 0.95 : 1;
  const clamp = (n: number) => Math.max(1, Math.floor(n * factor));

  const daySince = startOfLocalDayUtc(quotas.timezone);
  const weekSince = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  let headlineCap = quotas.max_actions_per_day;
  if (actionType === 'profile_view') headlineCap = quotas.max_profile_visits_per_day;
  else if (actionType === 'search') headlineCap = quotas.max_searches_per_day;

  try {
    const { data, error } = await admin.rpc('check_linkedin_action_quota', {
      p_account_id: accountId,
      p_action_type: actionType,
      p_day_since: daySince,
      p_week_since: weekSince,
      p_daily_visible_cap: clamp(quotas.max_actions_per_day),
      p_weekly_invite_cap: clamp(WEEKLY_INVITE_LIMIT),
      p_profile_view_cap: clamp(quotas.max_profile_visits_per_day),
      p_search_cap: clamp(quotas.max_searches_per_day),
      p_inmail_daily_cap: clamp(quotas.max_inmails_per_day),
      p_user_id: opts.userId ?? null,
      p_organization_id: opts.organizationId ?? null,
      p_source: opts.source ?? null,
      p_log: opts.log ?? true,
    });

    if (error) {
      console.error('[linkedin-quotas] check_linkedin_action_quota RPC error:', error.message);
      return manual
        ? { allowed: true, scope: 'rpc_error', count: 0 }
        : { allowed: false, scope: 'rpc_error', reason: 'Contrôle de quota indisponible. Action différée.' };
    }

    const result = (data ?? {}) as { allowed?: boolean; reason?: string; scope?: string; count?: number };
    const count = typeof result.count === 'number' ? result.count : 0;
    const softWarn = result.allowed === true && headlineCap > 0 && (count + 1) >= Math.floor(headlineCap * 0.75);
    return { allowed: result.allowed === true, reason: result.reason, scope: result.scope, count, softWarn };
  } catch (e) {
    console.error('[linkedin-quotas] enforceLinkedInAction failed:', e);
    return manual
      ? { allowed: true, scope: 'exception', count: 0 }
      : { allowed: false, scope: 'exception', reason: 'Contrôle de quota en erreur. Action différée.' };
  }
}
