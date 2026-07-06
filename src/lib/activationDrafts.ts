/**
 * activationDrafts — brouillons déterministes pour la checklist d'activation.
 *
 * Recycle l'enrichissement société déjà payé pendant l'onboarding
 * (organizations.enrichment_snapshot, écrit par enrich-company) et le profil
 * pour pré-rédiger les réglages consommés par les features :
 *  - contexte IA org (injecté dans 9+ fonctions IA via _shared/ai-context.ts)
 *  - signature email par défaut (utilisée par sequence-send-email)
 *
 * Aucun appel LLM : templates purs, l'utilisateur relit et ajuste dans Réglages.
 */

import type { AiContext } from '@/hooks/useAiContext';
import type { JobDetails } from '@/types/jobDetails';

type ClientSize = NonNullable<JobDetails['client']>['size'];

export interface EnrichmentSnapshot {
  enriched_at?: string;
  name?: string | null;
  domain?: string | null;
  industry?: string | null;
  size?: string | null;
  location?: string | null;
  funding?: string | null;
  description?: string | null;
  linkedinUrl?: string | null;
  websiteUrl?: string | null;
  logoUrl?: string | null;
  careersUrl?: string | null;
  techStack?: string[];
  keywords?: string[];
  openRoles?: { title: string; location?: string | null; url?: string | null; source?: string | null }[];
  structuredInsights?: { key?: string; title?: string; body?: string }[];
}

/** Brouillon de contexte IA org depuis le snapshot d'enrichissement.
 *  Garde une vraie structure même quand la fiche société est maigre
 *  (un brouillon réduit au nom de la boîte n'aide personne). */
export function buildAiContextDraft(
  snapshot: EnrichmentSnapshot | null | undefined,
  orgName: string,
): AiContext {
  const parts: string[] = [];
  const name = snapshot?.name || orgName;

  const identity: string[] = [];
  if (name) identity.push(`Nous sommes ${name}`);
  if (snapshot?.industry) identity.push(snapshot.industry);
  if (snapshot?.size) identity.push(`${snapshot.size} collaborateurs`);
  if (snapshot?.location) identity.push(snapshot.location);
  if (identity.length) parts.push(`${identity.join(' · ')}.`);

  if (snapshot?.description) parts.push(snapshot.description);
  if (snapshot?.funding) parts.push(`Financement : ${snapshot.funding}.`);
  if (snapshot?.techStack?.length) parts.push(`Stack technique : ${snapshot.techStack.slice(0, 8).join(', ')}.`);

  parts.push('Ton souhaité : professionnel, direct et chaleureux, sans superlatifs.');
  parts.push(
    snapshot?.industry
      ? `Points à mettre en avant : notre expertise ${snapshot.industry}, notre process et notre transparence avec les candidats.`
      : 'Points à mettre en avant : … (complétez avec vos mots : votre expertise, votre process, ce qui vous différencie).',
  );

  return {
    tone: 'vous',
    specialty: (snapshot?.industry || '').slice(0, 200),
    do: [],
    dont: [],
    // normalizeAiContext cappe à 1000 chars — on tronque proprement ici.
    free_text: parts.join('\n').slice(0, 1000),
  };
}

/** Signature email HTML par défaut depuis le profil + l'org. */
export function buildSignatureHtml(input: {
  displayName?: string | null;
  jobTitle?: string | null;
  orgName?: string | null;
  website?: string | null;
}): string {
  const lines: string[] = ['Cordialement,'];
  if (input.displayName) lines.push(`<strong>${escapeHtml(input.displayName)}</strong>`);
  const roleLine = [input.jobTitle, input.orgName].filter(Boolean).map((s) => escapeHtml(s!)).join(' — ');
  if (roleLine) lines.push(roleLine);
  if (input.website) {
    const href = input.website.startsWith('http') ? input.website : `https://${input.website}`;
    const label = input.website.replace(/^https?:\/\//, '');
    lines.push(`<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`);
  }
  return `<p>${lines.join('<br>')}</p>`;
}

/** Mappe la taille d'entreprise (nombre d'employés) vers l'enum du brief
 *  (type dérivé de JobDetails — pas de duplication de l'union). */
export function mapCompanySizeToClientSize(
  size?: string | null,
): ClientSize | undefined {
  const n = size ? parseInt(String(size).replace(/[^0-9]/g, ''), 10) : NaN;
  if (Number.isNaN(n)) return undefined;
  if (n < 50) return 'startup';
  if (n < 250) return 'scale-up';
  if (n < 1000) return 'mid-market';
  return 'enterprise';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
