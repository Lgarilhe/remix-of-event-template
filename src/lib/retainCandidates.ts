/**
 * Candidats retenus dans une mission : le seul site du navigateur qui crée la
 * ligne d'un candidat dans la mission (profil entier, sans colonne d'étape) et
 * la fait passer en Retenu. Deux gestes l'appellent : « Présélectionner sans
 * message » (aperçu d'inscription) et la règle de l'inscription (un candidat
 * inscrit dans une séquence passe en Retenu, jamais en arrière).
 *
 * L'étape ne s'écrit que par setCandidateStages (origine user, lots de 200,
 * étapes de départ admises) : un candidat déjà contacté ou plus loin garde son
 * étape. Le serveur pose l'étape suivante au premier envoi réel.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import type { LinkedInProfile } from '@/components/outreach/types';
import { serializeProfileForStorage } from '@/lib/serializeProfile';
import { setCandidateStages, type GeneralStage, type StageBatchOutcome } from '@/lib/candidateStage';

type Client = SupabaseClient<Database>;

export interface RetainOutcome {
  /** Lignes passées en Retenu ou déjà Retenu (selon les étapes de départ admises). */
  saved: number;
  /** Lignes laissées à leur étape : plus loin que Retenu (contacté, répondu, entretien), jamais rétrogradées. */
  skipped: number;
  /** Lignes lues ou créées qui n'ont pas pu être enregistrées. */
  failed: number;
  /** Premier échec de l'étape (appel entier ou refus d'une ligne), pour choisir le message. */
  failure: { hint?: string | null } | null;
}

/**
 * Crée la ligne des candidats absents de la mission (sous l'une des deux
 * formes de job_id, « project:<uuid> » ou l'uuid nu), puis les fait passer en
 * Retenu. Lève si la lecture ou l'écriture des lignes échoue : rien n'est alors
 * retenu. Un échec de l'étape elle-même ne lève pas, il est rendu dans
 * `failed` et `failure`.
 */
export async function retainCandidates(params: {
  supabase: Client;
  organizationId: string;
  userId: string;
  job: { id: string };
  profiles: LinkedInProfile[];
  fromStages: GeneralStage[];
  surface: string;
}): Promise<RetainOutcome> {
  const { supabase, organizationId, userId, job, profiles } = params;

  // Clé des lignes du Sourcing de mission : job.id tel quel (« project:<uuid> »
  // depuis une mission), comme useJobCandidateStatus. Une ligne déjà présente
  // sous l'une des deux formes (avec ou sans préfixe) est reprise, jamais
  // doublée : set_candidate_stages porte sur les lignes réelles du candidat.
  const jobIdForms = job.id.startsWith('project:')
    ? [job.id, job.id.slice('project:'.length)]
    : [job.id];
  const { data: existingRows, error: readError } = await supabase
    .from('job_candidate_status')
    .select('id, candidate_id')
    .in('job_id', jobIdForms)
    .eq('created_by', userId)
    .in('candidate_id', profiles.map(p => p.id));
  if (readError) throw readError;
  const existingCandidates = new Set((existingRows ?? []).map(r => r.candidate_id));

  const missingProfiles = profiles.filter(profile => !existingCandidates.has(profile.id));
  const rows = missingProfiles.map(profile => ({
    job_id: job.id,
    candidate_id: profile.id,
    candidate_name: profile.name || null,
    candidate_headline: profile.headline || null,
    linkedin_profile_url: profile.profile_url || profile.public_profile_url || null,
    // Profil entier, photo comprise (lot P, P-0b) : jamais une photo seule.
    linkedin_profile_data: serializeProfileForStorage(profile),
    created_by: userId,
    organization_id: organizationId, // requis par RLS org_members_all
  }));

  let written: { id: string }[] = [];
  if (rows.length > 0) {
    const { data, error: writeError } = await supabase
      .from('job_candidate_status')
      .upsert(rows, { onConflict: 'job_id,candidate_id,created_by' })
      .select('id');
    if (writeError) throw writeError;
    written = data ?? [];
  }

  const ids = [...(existingRows ?? []).map(r => r.id), ...written.map(r => r.id)];
  const outcome: StageBatchOutcome = await setCandidateStages(
    ids, { stage: 'retained' }, params.fromStages, { surface: params.surface },
  );
  const saved = outcome.updated + outcome.unchanged;
  const failure = outcome.error ?? outcome.rows.find(r => r.result === 'error') ?? null;
  if (failure) console.error('[retainCandidates] stage failed:', failure);
  return {
    saved,
    skipped: outcome.skipped,
    failed: (existingRows ?? []).length + rows.length - saved - outcome.skipped,
    failure,
  };
}
