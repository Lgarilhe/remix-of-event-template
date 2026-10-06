/**
 * « Proposer avec l'IA » de la relecture après l'inscription (refonte
 * mission, lot 5a-2) : même génération d'aperçu que la préparation
 * (generate-outreach-message, crédits débités par la fonction), pour ce
 * candidat et cette étape.
 *
 * Lectures seulement, sous la RLS de l'appelant : le texte proposé reste
 * modifiable et n'est écrit (final_message, final_subject) qu'à
 * « Enregistrer », par EditScheduledMessageModal. Jamais de tracking_data.
 */
import { supabase } from '@/integrations/supabase/client';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { normalizeNetworkDistance } from '@/lib/sequenceCompatibility';
import type { EdgeFunctionError } from '@/lib/invokeEdgeFunction';
import { missionIdOfJob, normalizeMissionJobId, PREVIEW_NOT_COMPLIANT_CODE } from '@/hooks/useEnrollmentPreview';

const SENT_STATUSES = ['sent', 'opened', 'clicked', 'replied'];

export const PROPOSAL_FAILED_MESSAGE = "La proposition de l'IA a échoué. Réessayez, ou écrivez le message vous-même.";

interface ExecutionForProposal {
  id: string;
  enrollment_id: string;
  step_order: number;
  sequence_steps: {
    action_type: string;
    message_template: string | null;
    subject_template: string | null;
    ai_tone: string | null;
  } | null;
  sequence_enrollments: {
    profile_id: string;
    provider_id: string | null;
    profile_name: string | null;
    profile_headline: string | null;
    profile_url: string | null;
    job_title: string | null;
    company_name: string | null;
    network_distance: string | null;
    job_id: string | null;
    account_id: string | null;
  } | null;
}

/** Message proposé par l'IA pour une étape programmée, ou une erreur en français. */
export async function proposeAiMessage(
  executionId: string,
  senderName?: string,
): Promise<{ subject: string; message: string }> {
  const { data, error } = await supabase
    .from('sequence_step_executions')
    .select('id, enrollment_id, step_order, sequence_steps(action_type, message_template, subject_template, ai_tone), sequence_enrollments(profile_id, provider_id, profile_name, profile_headline, profile_url, job_title, company_name, network_distance, job_id, account_id)')
    .eq('id', executionId)
    .maybeSingle();
  const exec = data as unknown as ExecutionForProposal | null;
  if (error || !exec?.sequence_steps || !exec.sequence_enrollments) {
    throw new Error("Cette étape n'a pas pu être relue. Réessayez dans un instant.");
  }
  const step = exec.sequence_steps;
  const enrollment = exec.sequence_enrollments;

  // Messages déjà partis chez ce candidat : la proposition tient compte de la
  // place de l'étape (premier message, relance), comme la préparation.
  const { data: sentRows } = await supabase
    .from('sequence_step_executions')
    .select('step_order, final_message, sequence_steps(action_type)')
    .eq('enrollment_id', exec.enrollment_id)
    .in('status', SENT_STATUSES)
    .lt('step_order', exec.step_order)
    .order('step_order', { ascending: true });
  const prevSentSteps = ((sentRows ?? []) as unknown as Array<{ step_order: number; final_message: string | null; sequence_steps: { action_type: string } | null }>)
    .filter(r => !!r.sequence_steps)
    .map(r => ({ actionType: r.sequence_steps!.action_type, finalMessage: r.final_message ?? '', stepOrder: r.step_order }));

  // Poste de la mission (titre, client, compétences) ; le serveur relit ses
  // réglages d'approche (mode, anonymisation) par missionId.
  let job: Record<string, unknown> = { title: '' };
  const jobKey = normalizeMissionJobId(enrollment.job_id);
  if (jobKey) {
    const base = supabase.from('sourcing_projects').select('name, client_name, job_details');
    const missionUuid = missionIdOfJob(jobKey);
    const { data: mission } = await (missionUuid
      ? base.or(`id.eq.${missionUuid},job_id.eq.${missionUuid}`)
      : base.eq('job_id', jobKey)
    ).limit(1).maybeSingle();
    const jd = ((mission as { job_details?: Record<string, unknown> | null } | null)?.job_details ?? {}) as Record<string, unknown>;
    const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    const clientName = (mission as { client_name?: string | null } | null)?.client_name
      ?? ((jd.client as Record<string, unknown> | undefined)?.name as string | undefined)
      ?? null;
    job = {
      id: enrollment.job_id,
      title: (jd.title as string | undefined) || (mission as { name?: string | null } | null)?.name || '',
      client: clientName ? { name: clientName } : undefined,
      skills: [...strings(jd.skills_must_have), ...strings(jd.skills_should_have)],
      description: (jd.mission_description as string | undefined) || undefined,
      location: (jd.location as string | undefined) || undefined,
    };
  }

  const { data: generated, error: genError } = await invokeWithCredits<{ subject?: string; message?: string }>(
    'generate-outreach-message',
    'outreach_message',
    {
      profile: {
        name: enrollment.profile_name || '',
        headline: enrollment.profile_headline || undefined,
        currentRole: enrollment.job_title || undefined,
        currentCompany: enrollment.company_name || undefined,
        networkDistance: normalizeNetworkDistance(enrollment.network_distance),
      },
      job,
      tone: step.ai_tone || 'professional',
      senderName,
      accountId: enrollment.account_id || undefined,
      profileId: enrollment.provider_id || enrollment.profile_id,
      candidateLinkedInUrl: enrollment.profile_url || undefined,
      messageTemplate: step.message_template || undefined,
      subjectTemplate: step.subject_template || undefined,
      sequenceContext: { currentActionType: step.action_type, prevSentSteps },
      missionId: enrollment.job_id || undefined,
    },
  );
  if (genError || !generated?.message?.trim()) {
    // Aperçu refusé par les garde-fous (rémunération, signature, posture) : la
    // phrase du serveur, à régénérer ; sinon l'échec générique.
    const e = genError as EdgeFunctionError | null;
    throw new Error(e?.code === PREVIEW_NOT_COMPLIANT_CODE && e.message ? e.message : PROPOSAL_FAILED_MESSAGE);
  }
  return { subject: generated.subject || '', message: generated.message };
}
