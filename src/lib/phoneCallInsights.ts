/**
 * Lecture et déclenchement de l'analyse des appels (phone_call_insights,
 * phone_call_transcripts). La RLS limite tout à l'organisation active : le
 * navigateur ne fait que lire, l'écriture est celle de la fonction
 * analyze-phone-call.
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import {
  insightFromRow,
  parseTranscript,
  toStatus,
  type CallInsight,
  type InsightLight,
  type TranscriptLine,
} from '@/lib/phoneCallInsightModel';

const PAGE = 1000;
const MAX_ROWS = 5000;

const INSIGHT_COLUMNS = 'call_id, status, reason, summary, tags, facts, next_steps, mission_id, mission_fit, analyzed_at';

/**
 * L'état et les étiquettes des appels analysés depuis `sinceIso`. On filtre sur
 * la date de l'analyse : elle suit l'appel de quelques minutes, jamais l'inverse.
 */
export async function fetchInsightLights(sinceIso: string): Promise<Map<string, InsightLight>> {
  const lights = new Map<string, InsightLight>();
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await supabase
      .from('phone_call_insights')
      .select('call_id, status, tags')
      .gte('created_at', sinceIso)
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    for (const row of data ?? []) lights.set(row.call_id, { status: toStatus(row.status), tags: row.tags ?? [] });
    if ((data?.length ?? 0) < PAGE) break;
  }
  return lights;
}

/** Les analyses de quelques appels (la fiche d'un candidat), par appel. */
export async function fetchInsightsForCalls(callIds: ReadonlyArray<string>): Promise<Map<string, CallInsight>> {
  const insights = new Map<string, CallInsight>();
  const ids = Array.from(new Set(callIds)).slice(0, 100);
  if (ids.length === 0) return insights;
  const { data, error } = await supabase.from('phone_call_insights').select(INSIGHT_COLUMNS).in('call_id', ids);
  if (error) throw error;
  for (const row of data ?? []) insights.set(row.call_id, insightFromRow(row));
  return insights;
}

export interface CallInsightDetail {
  insight: CallInsight | null;
  /** Nom de la mission que l'appel concerne, si l'analyse en a reconnu une. */
  missionName: string | null;
  hasTranscript: boolean;
}

/** L'analyse d'un appel, le nom de sa mission, et si une transcription est gardée. */
export async function fetchCallInsightDetail(callId: string): Promise<CallInsightDetail> {
  const [insightResult, transcriptResult] = await Promise.all([
    supabase.from('phone_call_insights').select(INSIGHT_COLUMNS).eq('call_id', callId).maybeSingle(),
    supabase.from('phone_call_transcripts').select('call_id', { count: 'exact', head: true }).eq('call_id', callId),
  ]);
  if (insightResult.error) throw insightResult.error;
  if (transcriptResult.error) throw transcriptResult.error;

  const insight = insightResult.data ? insightFromRow(insightResult.data) : null;
  let missionName: string | null = null;
  if (insight?.missionId) {
    const { data } = await supabase.from('sourcing_projects').select('name').eq('id', insight.missionId).maybeSingle();
    missionName = data?.name ?? null;
  }
  return { insight, missionName, hasTranscript: (transcriptResult.count ?? 0) > 0 };
}

/** La transcription d'un appel, une ligne par personne qui parle. */
export async function fetchCallTranscript(callId: string): Promise<TranscriptLine[]> {
  const { data, error } = await supabase.from('phone_call_transcripts').select('utterances').eq('call_id', callId).maybeSingle();
  if (error) throw error;
  return parseTranscript(data?.utterances);
}

export interface AnalysisRequestResult {
  /** done, skipped, failed, busy, no_transcript : l'état que la fonction a rendu. */
  status: string;
  reason?: string;
}

/**
 * Lance l'analyse d'un appel. `fetchTranscript` demande aussi la transcription à
 * l'opérateur quand elle n'est pas gardée (un appel reçu avant l'abonnement à
 * l'événement). Les crédits sont vérifiés avant, et débités par la fonction.
 */
export async function requestCallAnalysis(
  callId: string,
  options: { force?: boolean; fetchTranscript?: boolean } = {},
): Promise<AnalysisRequestResult> {
  const { data, error } = await invokeWithCredits<AnalysisRequestResult>(
    'analyze-phone-call',
    'phone_call_analysis',
    { call_id: callId, force: options.force === true, fetch_transcript: options.fetchTranscript === true },
    { description: "Analyse d'un appel" },
  );
  if (error) throw error;
  return { status: data.status, reason: data.reason };
}
