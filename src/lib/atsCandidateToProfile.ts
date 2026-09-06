/**
 * atsCandidateToProfile — adaptateur ATSCandidate → LinkedInProfile
 *
 * Pourquoi : la sourcing card et son ProfileDetailSheet consomment un
 * LinkedInProfile (shape rich avec work_experience, education, skills...).
 * Un ATSCandidate (récupéré depuis job_candidate_status pour le pipeline)
 * porte les mêmes données dans son champ `linkedinProfileData` (JSONB
 * snapshot) — il suffit de l'extraire et de mapper les fallbacks.
 *
 * Permet d'ouvrir le ProfileDetailSheet de sourcing depuis le pipeline
 * sans dupliquer le composant (la modale unifiée demandée par l'user).
 */

import { LinkedInProfile } from '@/components/outreach/types';
import { ATSCandidate } from '@/hooks/useATSData';

/**
 * Profil issu du pipeline : un LinkedInProfile enrichi de l'identifiant
 * candidat (job_candidate_status.candidate_id). Sert à rattacher un
 * enrichissement de contact à la fiche pipeline (candidate_contacts).
 */
export type PipelineProfile = LinkedInProfile & {
  candidateId?: string;
};

/** Premier mot = prénom, le reste = nom. */
function splitName(name: string | null | undefined): { first_name?: string; last_name?: string } {
  const clean = (name || '').trim().replace(/\s+/g, ' ');
  if (!clean) return {};
  const idx = clean.indexOf(' ');
  if (idx === -1) return { first_name: clean };
  return { first_name: clean.slice(0, idx), last_name: clean.slice(idx + 1) };
}

/**
 * Convertit un ATSCandidate en LinkedInProfile-shape utilisable par
 * ProfileDetailSheet et tous les composants sourcing.
 *
 * Fallbacks si linkedinProfileData manque :
 *  - id, name, headline depuis ATSCandidate
 *  - first_name / last_name dérivés de name (premier mot / reste)
 *  - email/phone depuis contact_info synthétisé
 *  - profile_url depuis ATSCandidate.linkedin
 */
export function atsCandidateToProfile(candidate: ATSCandidate): PipelineProfile {
  const raw = candidate.linkedinProfileData as Record<string, unknown> | null | undefined;
  const candidateId = candidate.candidateId || undefined;

  // Construit contact_info synthétique (les champs email/phone du candidat
  // ATS ne sont pas dans le linkedinProfileData mais dans le candidat lui-même).
  const contactInfo = (() => {
    const emails: string[] = [];
    const phones: string[] = [];
    if (candidate.email) emails.push(candidate.email);
    if (candidate.phone) phones.push(candidate.phone);
    // Si linkedinProfileData a déjà des contact_info, on merge.
    const rawContact = raw?.contact_info as { emails?: string[]; phones?: string[] } | undefined;
    if (rawContact?.emails) {
      for (const e of rawContact.emails) if (e && !emails.includes(e)) emails.push(e);
    }
    if (rawContact?.phones) {
      for (const p of rawContact.phones) if (p && !phones.includes(p)) phones.push(p);
    }
    return emails.length || phones.length ? { emails, phones } : undefined;
  })();

  if (raw && typeof raw === 'object') {
    // On a un snapshot LinkedIn complet → on l'utilise comme base + on
    // override avec les champs ATS qui ont la priorité (nom/headline
    // peuvent avoir été corrigés manuellement côté pipeline).
    const name = candidate.name || (raw.name as string) || 'Candidat';
    const derived = splitName(name);
    return {
      ...raw,
      id: candidate.candidateId || (raw.id as string) || '',
      candidateId,
      name,
      first_name: (raw.first_name as string) || derived.first_name,
      last_name: (raw.last_name as string) || derived.last_name,
      headline: candidate.headline || (raw.headline as string) || undefined,
      profile_url: candidate.linkedin || (raw.profile_url as string) || undefined,
      contact_info: contactInfo || (raw.contact_info as any),
    } as PipelineProfile;
  }

  // Pas de snapshot LinkedIn → on construit un profile minimal depuis
  // les champs ATS. Le ProfileDetailSheet gérera gracefully les
  // sections vides (work_experience/skills absents).
  const name = candidate.name || 'Candidat';
  const derived = splitName(name);
  return {
    id: candidate.candidateId || candidate.id || '',
    candidateId,
    name,
    first_name: derived.first_name,
    last_name: derived.last_name,
    headline: candidate.headline || undefined,
    profile_url: candidate.linkedin || undefined,
    public_profile_url: candidate.linkedin || undefined,
    contact_info: contactInfo,
    skills: candidate.expertise?.map(s => ({ name: s })) || [],
  } as unknown as PipelineProfile;
}
