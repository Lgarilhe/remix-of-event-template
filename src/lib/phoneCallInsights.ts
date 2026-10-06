/**
 * Résumé, transcription et tâches proposées des appels (tables
 * phone_call_insights et phone_call_task_suggestions, remplies par la fonction
 * serveur phone-call-insights). Lecture sous la RLS de l'organisation active.
 *
 * Le navigateur n'écrit que deux choses : l'état d'une suggestion (acceptée ou
 * ignorée, une seule fois, la base le refuse sinon) et la tâche créée à
 * l'acceptation, ligne de candidate_reminders comme pour toute tâche.
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { getActiveOrganizationId } from '@/lib/orgContext';
import { suggestionDescription, suggestionDueAt, type InsightStatus } from '@/lib/callTaskSuggestion';

export interface TranscriptLine {
  speaker: 'agent' | 'contact' | 'unknown';
  text: string;
}

export type SuggestionState = 'proposed' | 'accepted' | 'dismissed';

export interface CallTaskSuggestion {
  id: string;
  title: string;
  reason: string | null;
  dueInDays: number;
  state: SuggestionState;
}

export interface CallInsight {
  callId: string;
  status: InsightStatus;
  summary: string | null;
  errorCode: string | null;
  transcript: TranscriptLine[];
  suggestions: CallTaskSuggestion[];
}

const STATUSES: readonly string[] = ['pending', 'transcribed', 'ready', 'unavailable', 'failed'];

function toTranscript(value: unknown): TranscriptLine[] {
  if (!Array.isArray(value)) return [];
  const lines: TranscriptLine[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const { speaker, text } = item as { speaker?: unknown; text?: unknown };
    if (typeof text !== 'string' || !text.trim()) continue;
    lines.push({ speaker: speaker === 'agent' || speaker === 'contact' ? speaker : 'unknown', text });
  }
  return lines;
}

/** Résumés des appels donnés, en deux requêtes (insights, puis tâches proposées). */
export async function fetchCallInsights(callIds: readonly string[]): Promise<Map<string, CallInsight>> {
  const ids = Array.from(new Set(callIds)).slice(0, 100);
  const out = new Map<string, CallInsight>();
  if (ids.length === 0) return out;

  const [insightsRes, suggestionsRes] = await Promise.all([
    supabase
      .from('phone_call_insights')
      .select('phone_call_id, status, summary, error_code, transcript')
      .in('phone_call_id', ids),
    supabase
      .from('phone_call_task_suggestions')
      .select('id, phone_call_id, title, reason, due_in_days, state, created_at')
      .in('phone_call_id', ids)
      .order('created_at', { ascending: true }),
  ]);
  if (insightsRes.error) throw insightsRes.error;
  if (suggestionsRes.error) throw suggestionsRes.error;

  for (const r of insightsRes.data ?? []) {
    out.set(r.phone_call_id, {
      callId: r.phone_call_id,
      status: (STATUSES.includes(r.status) ? r.status : 'pending') as InsightStatus,
      summary: r.summary,
      errorCode: r.error_code,
      transcript: toTranscript(r.transcript),
      suggestions: [],
    });
  }
  for (const s of suggestionsRes.data ?? []) {
    const insight = out.get(s.phone_call_id) ?? {
      callId: s.phone_call_id, status: 'ready' as InsightStatus, summary: null, errorCode: null, transcript: [], suggestions: [],
    };
    insight.suggestions.push({
      id: s.id,
      title: s.title,
      reason: s.reason,
      dueInDays: s.due_in_days,
      state: s.state === 'accepted' || s.state === 'dismissed' ? s.state : 'proposed',
    });
    out.set(s.phone_call_id, insight);
  }
  return out;
}

/** Demande à la fonction serveur de récupérer la transcription et de la résumer (ou de recommencer). */
export async function requestCallInsights(phoneCallId: string, force = false): Promise<void> {
  const { data, error } = await invokeEdgeFunction<{ status?: string }>('phone-call-insights', {
    phone_call_id: phoneCallId,
    force,
  });
  if (error) throw new Error(error.message || "Le résumé n'a pas pu être demandé. Réessayez.");
  if (data?.error && !data?.status) throw new Error(data.error);
}

/**
 * Accepte une suggestion : crée la tâche, puis marque la suggestion acceptée.
 * Si la suggestion a déjà été traitée entre-temps (autre onglet, autre membre),
 * la base ne modifie aucune ligne : la tâche qui vient d'être créée est
 * retirée et la fonction rend 'already'.
 */
export async function acceptCallTaskSuggestion(args: {
  suggestion: CallTaskSuggestion;
  callStartedAt: string | null;
  candidate?: { id: string; name?: string | null } | null;
}): Promise<'created' | 'already'> {
  const { suggestion, callStartedAt, candidate } = args;
  const organizationId = await getActiveOrganizationId();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !organizationId) throw new Error('Session expirée. Reconnectez-vous, puis réessayez.');

  const now = new Date();
  const { data: reminder, error: insertError } = await supabase
    .from('candidate_reminders')
    .insert({
      organization_id: organizationId,
      created_by: user.id,
      title: suggestion.title,
      description: suggestionDescription(suggestion.reason, callStartedAt),
      category: 'follow_up',
      due_at: suggestionDueAt(suggestion.dueInDays, now).toISOString(),
      candidate_id: candidate?.id ?? null,
      candidate_name: candidate?.name ?? null,
      auto_generated: true,
    })
    .select('id')
    .single();
  if (insertError || !reminder) throw insertError ?? new Error("La tâche n'a pas pu être créée. Réessayez.");

  const { data: claimed, error: claimError } = await supabase
    .from('phone_call_task_suggestions')
    .update({ state: 'accepted', reminder_id: reminder.id, resolved_at: now.toISOString() })
    .eq('id', suggestion.id)
    .eq('state', 'proposed')
    .select('id');
  if (claimError || !claimed || claimed.length === 0) {
    await supabase.from('candidate_reminders').delete().eq('id', reminder.id);
    if (claimError) throw claimError;
    return 'already';
  }
  return 'created';
}

/** Ignore une suggestion (définitif : la base ne laisse pas la remettre à « proposée »). */
export async function dismissCallTaskSuggestion(suggestionId: string): Promise<void> {
  const { error } = await supabase
    .from('phone_call_task_suggestions')
    .update({ state: 'dismissed', resolved_at: new Date().toISOString() })
    .eq('id', suggestionId)
    .eq('state', 'proposed');
  if (error) throw error;
}
