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
}

export const DEFAULT_USER_QUOTAS: UserQuotaConfig = {
  business_hours_start: 8,
  business_hours_end: 19,
  max_actions_per_day: 80,
  timezone: 'Europe/Paris',
};

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

/** Load member_quotas row, falling back to DEFAULT_USER_QUOTAS for missing fields. */
export async function getUserQuotas(
  admin: SupabaseClient,
  userId: string | null | undefined,
): Promise<UserQuotaConfig> {
  if (!userId) return DEFAULT_USER_QUOTAS;
  try {
    const { data } = await admin
      .from('member_quotas')
      .select('business_hours_start, business_hours_end, max_actions_per_day, timezone')
      .eq('user_id', userId)
      .maybeSingle();
    if (!data) return DEFAULT_USER_QUOTAS;
    return {
      business_hours_start: (data as Record<string, unknown>).business_hours_start as number ?? DEFAULT_USER_QUOTAS.business_hours_start,
      business_hours_end: (data as Record<string, unknown>).business_hours_end as number ?? DEFAULT_USER_QUOTAS.business_hours_end,
      max_actions_per_day: (data as Record<string, unknown>).max_actions_per_day as number ?? DEFAULT_USER_QUOTAS.max_actions_per_day,
      timezone: (data as Record<string, unknown>).timezone as string ?? DEFAULT_USER_QUOTAS.timezone,
    };
  } catch {
    return DEFAULT_USER_QUOTAS;
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
 * Returns allowed=false if either (a) outside business hours or (b) at/over cap.
 */
export async function checkLinkedInQuota(
  admin: SupabaseClient,
  userId: string,
  accountId: string | null,
): Promise<QuotaCheckResult> {
  const quotas = await getUserQuotas(admin, userId);
  const inBh = isWithinBusinessHours(quotas.timezone, quotas.business_hours_start, quotas.business_hours_end);
  const count = await countActionsToday(admin, userId, accountId);

  if (!inBh) {
    return {
      allowed: false,
      reason: `Hors plage horaire autorisée (${quotas.business_hours_start}h–${quotas.business_hours_end}h ${quotas.timezone}). Action différée.`,
      count_today: count,
      max_per_day: quotas.max_actions_per_day,
      in_business_hours: false,
      timezone: quotas.timezone,
    };
  }
  if (count >= quotas.max_actions_per_day) {
    return {
      allowed: false,
      reason: `Cap journalier atteint (${count}/${quotas.max_actions_per_day} actions LinkedIn aujourd'hui).`,
      count_today: count,
      max_per_day: quotas.max_actions_per_day,
      in_business_hours: true,
      timezone: quotas.timezone,
    };
  }
  return {
    allowed: true,
    count_today: count,
    max_per_day: quotas.max_actions_per_day,
    in_business_hours: true,
    timezone: quotas.timezone,
  };
}
