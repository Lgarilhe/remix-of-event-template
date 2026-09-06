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

import type { createClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
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
// MONTÉE EN CHARGE PAR COMPTE (lot P0-D, docs/p0-plan-2026-09-06.md, section 2)
// ============================================================================
// Un compte LinkedIn nouvellement rattaché n'a droit qu'à une part de ses
// plafonds : 25 % la première semaine depuis linked_at, 50 % la deuxième,
// 75 % la troisième, 100 % ensuite. Même table que linkedin_ramp_factor(...)
// côté SQL (migration 20260906193347) : comptes rattachés avant la mise en
// prod (2026-09-14, pivot avec marge) ou sans linked_at = matures ; la première
// action journalisée compte aussi (un compte dissocié puis rattaché garde son ancienneté). Une reconnexion ne remet pas
// linked_at à zéro (upsert sans toucher la colonne), donc pas de retour au palier 1.

/** Comptes rattachés avant cet instant : matures (borne identique au SQL). */
export const RAMP_MATURITY_CUTOFF_MS = Date.parse('2026-09-14T00:00:00Z');

const DAY_MS = 24 * 3600 * 1000;

/** Paliers (borne haute exclusive en jours depuis linked_at, part des plafonds). */
export const RAMP_STAGES: ReadonlyArray<{ maxDays: number; factor: number }> = [
  { maxDays: 7, factor: 0.25 },
  { maxDays: 14, factor: 0.5 },
  { maxDays: 21, factor: 0.75 },
];

/**
 * Part des plafonds applicable à un compte selon l'ancienneté de son
 * rattachement. Pure : `now` est injectable pour les tests.
 */
export function linkedInRampFactor(
  linkedAt: string | Date | null | undefined,
  now: number = Date.now(),
): number {
  if (!linkedAt) return 1;
  const linkedMs = linkedAt instanceof Date ? linkedAt.getTime() : Date.parse(linkedAt);
  if (!Number.isFinite(linkedMs)) return 1;
  if (linkedMs < RAMP_MATURITY_CUTOFF_MS) return 1;
  const ageMs = now - linkedMs;
  for (const stage of RAMP_STAGES) {
    if (ageMs < stage.maxDays * DAY_MS) return stage.factor;
  }
  return 1;
}

/** Plafond effectif après palier : Math.ceil(cap × facteur), jamais 0 pour un cap > 0. */
export function rampCap(cap: number, factor: number): number {
  return Math.ceil(cap * factor);
}

/**
 * Facteur de montée en charge du compte, lu dans member_linkedin_accounts.
 * Compte inconnu ou lecture en erreur : 1 (même repli que le SQL sur NULL).
 */
async function getAccountRampFactor(admin: SupabaseClient, accountId: string): Promise<number> {
  try {
    const { data, error } = await admin
      .from('member_linkedin_accounts')
      .select('linked_at')
      .eq('linkedin_account_id', accountId)
      .order('linked_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.warn('[linkedin-quotas] linked_at read failed, ramp factor 1:', error.message);
      return 1;
    }
    const linkedAt = (data as { linked_at?: string | null } | null)?.linked_at ?? null;
    // Ancienneté réelle : la première action journalisée si elle précède linked_at
    // (compte dissocié puis rattaché). Même règle que get_linkedin_quota_status.
    const { data: firstAction } = await admin
      .from('linkedin_action_log')
      .select('created_at')
      .eq('account_id', accountId)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    const firstActionAt = (firstAction as { created_at?: string | null } | null)?.created_at ?? null;
    const anchor = [linkedAt, firstActionAt].filter((v): v is string => !!v).sort()[0] ?? null;
    return linkedInRampFactor(anchor);
  } catch (e) {
    console.warn('[linkedin-quotas] linked_at read failed, ramp factor 1:', e);
    return 1;
  }
}

/**
 * Weekly invitation ceiling. LinkedIn's hard limit is ~200/week (Unipile docs);
 * we stay deliberately conservative at 100 (réduit par le palier de montée en
 * charge du compte). Shared so every send path agrees.
 */
export const WEEKLY_INVITE_LIMIT = 100;

/** Raison de pause posée sur sequence_enrollments.pause_reason quand le compte LinkedIn est déconnecté. */
export const ACCOUNT_DISCONNECTED_PAUSE_REASON = 'account_disconnected';
/** Raison posée sur l'exécution annulée à la mise en pause ; le webhook la re-planifie à la reconnexion. */
export const ACCOUNT_DISCONNECTED_SKIP_REASON = 'Compte LinkedIn déconnecté, reprise automatique à la reconnexion';

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
      // Libre-service : un membre de plusieurs organisations peut avoir plusieurs
      // lignes ; on prend la plus récente au lieu d'échouer sur maybeSingle.
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!data) return DEFAULT_USER_QUOTAS;
    const row = data as Record<string, unknown>;
    return {
      business_hours_start: row.business_hours_start as number ?? DEFAULT_USER_QUOTAS.business_hours_start,
      business_hours_end: row.business_hours_end as number ?? DEFAULT_USER_QUOTAS.business_hours_end,
      max_actions_per_day: row.max_actions_per_day as number ?? DEFAULT_USER_QUOTAS.max_actions_per_day,
      timezone: row.timezone as string ?? DEFAULT_USER_QUOTAS.timezone,
      max_profile_visits_per_day: row.max_profile_visits_per_day as number ?? DEFAULT_USER_QUOTAS.max_profile_visits_per_day,
      max_searches_per_day: row.max_searches_per_day as number ?? DEFAULT_USER_QUOTAS.max_searches_per_day,
      max_inmails_per_day: row.max_inmails_per_day as number ?? DEFAULT_USER_QUOTAS.max_inmails_per_day,
    };
  } catch {
    return DEFAULT_USER_QUOTAS;
  }
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
  /** Part des plafonds applicable au compte (montée en charge), 1 = mature */
  ramp_factor?: number;
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
    ramp_factor: res.ramp_factor,
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
  /** Part des plafonds appliquée au compte (montée en charge) : 0.25 / 0.5 / 0.75 / 1. */
  ramp_factor?: number;
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
    return { allowed: true, count: 0, ramp_factor: 1 };
  }

  const quotas = opts.quotas ?? await getUserQuotas(admin, opts.userId ?? null);
  // Montée en charge du compte (25 / 50 / 75 / 100 %) appliquée à chaque
  // plafond par Math.ceil, puis marge de 5 % en mode manuel.
  const rampFactor = await getAccountRampFactor(admin, accountId);
  const manualFactor = manual ? 0.95 : 1;
  const clamp = (n: number) => Math.max(1, Math.floor(rampCap(n, rampFactor) * manualFactor));

  const daySince = startOfLocalDayUtc(quotas.timezone);
  const weekSince = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  let headlineCap = rampCap(quotas.max_actions_per_day, rampFactor);
  if (actionType === 'profile_view') headlineCap = rampCap(quotas.max_profile_visits_per_day, rampFactor);
  else if (actionType === 'search') headlineCap = rampCap(quotas.max_searches_per_day, rampFactor);

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
        ? { allowed: true, scope: 'rpc_error', count: 0, ramp_factor: rampFactor }
        : { allowed: false, scope: 'rpc_error', reason: 'Contrôle de quota indisponible. Action différée.', ramp_factor: rampFactor };
    }

    const result = (data ?? {}) as { allowed?: boolean; reason?: string; scope?: string; count?: number };
    const count = typeof result.count === 'number' ? result.count : 0;
    const softWarn = result.allowed === true && headlineCap > 0 && (count + 1) >= Math.floor(headlineCap * 0.75);
    return { allowed: result.allowed === true, reason: result.reason, scope: result.scope, count, softWarn, ramp_factor: rampFactor };
  } catch (e) {
    console.error('[linkedin-quotas] enforceLinkedInAction failed:', e);
    return manual
      ? { allowed: true, scope: 'exception', count: 0, ramp_factor: rampFactor }
      : { allowed: false, scope: 'exception', reason: 'Contrôle de quota en erreur. Action différée.', ramp_factor: rampFactor };
  }
}
