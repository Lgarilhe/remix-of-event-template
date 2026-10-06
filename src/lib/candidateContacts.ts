/**
 * candidateContacts — helpers pour les contacts manuels d'un candidat.
 *
 * Email + phone du candidat saisis manuellement par le recruteur (ou
 * récupérés via enrichment automatique cascade waterfall).
 *
 * Stocké séparément de :
 *   - linkedin_profile_data (snapshot LinkedIn read-only)
 *   - job_candidate_status (per-job, alors que les contacts sont
 *     candidate-level dans une org)
 *
 * 1 row par (organization_id, candidate_id). Source = 'manual' par
 * défaut, peut être 'enriched_pdl' / 'enriched_apollo' / 'enriched_dropcontact'
 * pour tracer l'origine.
 */

import { supabase } from '@/integrations/supabase/client';
import { toE164 } from '@/lib/phone';

export interface CandidateContacts {
  organizationId: string;
  candidateId: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  source: string;
  updatedAt: string;
  updatedBy: string | null;
}

export interface CandidateContactsInput {
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  source?: string;
}

/**
 * Récupère les contacts manuels pour un candidat dans une org.
 * Retourne null si pas de row (jamais saisi).
 */
export async function getCandidateContacts(
  candidateId: string,
  organizationId: string,
): Promise<CandidateContacts | null> {
  const { data, error } = await supabase
    .from('candidate_contacts')
    .select('*')
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId)
    .maybeSingle();

  if (error) {
    console.warn('[candidateContacts] get error:', error);
    return null;
  }
  return data ? rowToContacts(data) : null;
}

/**
 * Upsert : crée la row si elle n'existe pas, met à jour sinon.
 * Vide les champs qui sont passés à null/undefined explicitement.
 *
 * Note : le trigger SQL trg_candidate_contacts_updated_at met à jour
 * updated_at automatiquement.
 */
export async function upsertCandidateContacts(
  candidateId: string,
  organizationId: string,
  input: CandidateContactsInput,
): Promise<CandidateContacts> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non authentifié');

  // Normalise les champs : trim + null si vide
  const cleanEmail = (input.email ?? '').trim() || null;
  const cleanPhone = (input.phone ?? '').trim() || null;
  const cleanNotes = (input.notes ?? '').trim() || null;

  const { data, error } = await supabase
    .from('candidate_contacts')
    .upsert(
      {
        candidate_id: candidateId,
        organization_id: organizationId,
        email: cleanEmail,
        phone: cleanPhone,
        notes: cleanNotes,
        source: input.source || 'manual',
        updated_by: user.id,
      },
      { onConflict: 'organization_id,candidate_id' },
    )
    .select()
    .single();

  if (error) throw error;
  return rowToContacts(data);
}

/**
 * Supprime tous les contacts d'un candidat (utile si l'user veut
 * remettre à zéro pour re-tenter un enrichissement auto par exemple).
 */
export async function clearCandidateContacts(
  candidateId: string,
  organizationId: string,
): Promise<void> {
  const { error } = await supabase
    .from('candidate_contacts')
    .delete()
    .eq('candidate_id', candidateId)
    .eq('organization_id', organizationId);

  if (error) throw error;
}

/**
 * Enregistre un numéro sur la fiche d'un candidat SANS toucher à son e-mail,
 * ses notes ni la provenance de la ligne (upsertCandidateContacts réécrit les
 * trois : il est fait pour le formulaire, qui les affiche tous).
 *
 * Un candidat n'a qu'un numéro. S'il en a déjà un autre, rien n'est écrit et le
 * résultat est `conflict` (avec ce numéro) : l'appelant le montre, puis rappelle
 * avec `replace: true`. Remplacer fait cesser de se rattacher à lui les appels
 * passés avec l'ancien numéro (le rapprochement se fait à la lecture).
 */
export type AttachPhoneResult =
  | { status: 'attached'; previousPhone: string | null }
  | { status: 'unchanged' }
  | { status: 'conflict'; previousPhone: string };

export async function attachPhoneToCandidate(
  candidateId: string,
  organizationId: string,
  phone: string,
  options: { replace?: boolean } = {},
): Promise<AttachPhoneResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Non authentifié');

  const { data: existing, error: readError } = await supabase
    .from('candidate_contacts')
    .select('phone')
    .eq('organization_id', organizationId)
    .eq('candidate_id', candidateId)
    .maybeSingle();
  if (readError) throw readError;

  const previousPhone = existing?.phone?.trim() || null;
  if (previousPhone && toE164(previousPhone) === phone) return { status: 'unchanged' };
  if (previousPhone && !options.replace) return { status: 'conflict', previousPhone };

  if (existing) {
    const { error } = await supabase
      .from('candidate_contacts')
      .update({ phone, updated_by: user.id })
      .eq('organization_id', organizationId)
      .eq('candidate_id', candidateId);
    if (error) throw error;
    return { status: 'attached', previousPhone };
  }

  const { error } = await supabase
    .from('candidate_contacts')
    .insert({ organization_id: organizationId, candidate_id: candidateId, phone, source: 'manual', updated_by: user.id });
  if (error) throw error;
  return { status: 'attached', previousPhone: null };
}

// ─── Internal ─────────────────────────────────────────────────────

function rowToContacts(row: any): CandidateContacts {
  return {
    organizationId: row.organization_id,
    candidateId: row.candidate_id,
    email: row.email,
    phone: row.phone,
    notes: row.notes,
    source: row.source,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}
