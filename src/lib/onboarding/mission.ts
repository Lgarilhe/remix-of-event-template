import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { PROCESS_TEMPLATES } from '@/components/missions/process/shared';
import { briefToFilters, briefToJobDetails, type BriefContext, type BriefDraft } from './brief';

/**
 * Création de la première mission depuis l'onboarding : la même ligne que le
 * parcours « brief » de la création de mission (brief structuré et filtres IA
 * enregistrés), plus les étapes d'entretien choisies.
 */

export type ProcessKey = 'fast' | 'standard' | 'senior';

export const PROCESS_CHOICES: Array<{ key: ProcessKey; label: string }> = [
  { key: 'fast', label: 'Rapide' },
  { key: 'standard', label: 'Standard' },
  { key: 'senior', label: 'Senior' },
];

export function processStepNames(key: ProcessKey): string[] {
  return PROCESS_TEMPLATES[key].steps.map((s) => s.name);
}

export interface FirstMissionInput {
  orgId: string;
  userId: string;
  draft: BriefDraft;
  context: BriefContext;
  processKey: ProcessKey;
}

export interface FirstMission {
  id: string;
  /** Faux quand les étapes d'entretien n'ont pas pu être posées : la mission existe, le process se fait depuis l'onglet dédié. */
  processApplied: boolean;
}

export async function createFirstMission(input: FirstMissionInput): Promise<FirstMission> {
  const { orgId, userId, draft, context, processKey } = input;
  const title = draft.title.trim();
  const jobDetails = briefToJobDetails(draft, context);
  const filtersSnapshot = { ...briefToFilters(draft), generated_at: new Date().toISOString(), brief_text: context.briefText, source: 'onboarding' };

  const { data, error } = await supabase
    .from('sourcing_projects')
    .insert({
      name: title,
      job_title: title,
      client_name: context.client,
      description: context.briefText,
      organization_id: orgId,
      created_by: userId,
      status: 'active',
      filters_snapshot: filtersSnapshot as unknown as Json,
      job_details: jobDetails as unknown as Json,
    })
    .select('id')
    .single();
  if (error || !data) throw error ?? new Error('Mission non créée');

  let processApplied = false;
  try {
    const { error: rpcError } = await supabase.rpc('replace_process_steps', {
      p_project_id: data.id,
      p_steps: PROCESS_TEMPLATES[processKey].steps as unknown as Json,
    });
    processApplied = !rpcError;
    if (rpcError) console.warn('[onboarding] étapes d\'entretien non posées :', rpcError.message);
  } catch (e) {
    console.warn('[onboarding] étapes d\'entretien non posées :', e);
  }
  return { id: data.id, processApplied };
}
