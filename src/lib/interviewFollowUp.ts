/**
 * Suite d'un entretien : quelle suite proposer d'après le compte rendu, qui peut
 * présenter un candidat au manager, d'où viennent le manager et le client.
 *
 * Le message au candidat et la présentation au manager sont rédigés par
 * generate-interview-followup puis envoyés par send-candidate-email, qui
 * re-vérifient côté serveur l'accord du candidat et le type d'organisation
 * (supabase/functions/_shared/interview-followup.ts).
 */

import { hasFeature, type OrgType } from '@/lib/featureGates';

export type FollowUpKind = 'follow_up' | 'manager_presentation';
export type FollowUpAction = 'next_step' | 'clarify' | 'decline';

export const FOLLOW_UP_ACTIONS: { value: FollowUpAction; label: string; hint: string }[] = [
  { value: 'next_step', label: 'Entretien suivant', hint: "Annoncer la suite et proposer un créneau" },
  { value: 'clarify', label: 'Précisions', hint: 'Poser les points restés ouverts' },
  { value: 'decline', label: 'Refus', hint: "Annoncer avec tact que la candidature n'est pas retenue" },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidEmail(value: string | null | undefined): boolean {
  return EMAIL_RE.test((value ?? '').trim());
}

function recommendationKey(recommendation: string | null | undefined): string {
  return (recommendation ?? '').trim().toUpperCase();
}

/** Suite proposée d'après la recommandation du compte rendu : GO, entretien suivant ; NO_GO, refus ; sinon, précisions. */
export function suggestedAction(recommendation: string | null | undefined): FollowUpAction {
  const key = recommendationKey(recommendation);
  if (key === 'GO') return 'next_step';
  if (key === 'NO_GO') return 'decline';
  return 'clarify';
}

/**
 * La présentation au manager est ouverte aux cabinets et aux freelances (les types
 * du portail client), et jamais pour une recommandation défavorable : on ne présente
 * pas un candidat que le compte rendu écarte.
 */
export function offersManagerPresentation(
  recommendation: string | null | undefined,
  orgType: OrgType | null,
): boolean {
  return hasFeature(orgType, 'client_portal') && recommendationKey(recommendation) !== 'NO_GO';
}

export interface HiringManager {
  name: string;
  title: string;
  email: string;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function clientOf(jobDetails: unknown): Record<string, unknown> {
  const jd = (jobDetails && typeof jobDetails === 'object' ? jobDetails : {}) as Record<string, unknown>;
  const client = jd.client;
  return client && typeof client === 'object' ? (client as Record<string, unknown>) : {};
}

/** Interlocuteur du client saisi dans le brief (« Qui recrute »). Champs vides s'il n'est pas renseigné. */
export function hiringManagerOf(jobDetails: unknown): HiringManager {
  const manager = clientOf(jobDetails).hiring_manager;
  const m = (manager && typeof manager === 'object' ? manager : {}) as Record<string, unknown>;
  return { name: textOf(m.name), title: textOf(m.title), email: textOf(m.email) };
}

export function clientNameOf(jobDetails: unknown): string {
  return textOf(clientOf(jobDetails).name);
}
