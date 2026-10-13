// Refonte mission, lot 5f-2c : groupes du panneau Contacter.
// Range chaque candidat de la sélection dans l'un de trois groupes, avec la
// raison écrite en toutes lettres :
//   - « prêts » : peuvent être inscrits tels quels ;
//   - « à compléter » : un geste de la personne les débloque (lien LinkedIn à
//     ajouter, message rédigé par l'IA à relire) ;
//   - « exclus » : ne seront pas inscrits, avec une dérogation quand la règle
//     en offre une (contact récent, hors réseau, déjà en relation).
//
// La première règle qui s'applique décide du groupe, dans cet ordre :
//   1. sans profil LinkedIn ;
//   2. déjà dans la séquence, ou déjà passé par elle (aucune dérogation) ;
//   3. données effacées sur demande du candidat (aucune dérogation) ;
//   4. contact de moins de 90 jours, puis incompatible avec la séquence
//      (dérogation possible ; tant qu'une raison n'est pas levée, le candidat
//      reste exclu) ;
//   5. message rédigé par l'IA à relire avant l'inscription.
//
// Module pur, testé sous Node (tests/ux/lot5f2c-libs.test.mjs) : aucune lecture,
// aucune écriture. Les informations d'éligibilité (anti-doublon, compatibilité
// avec le réseau, effacements) sont lues par l'appelant.

import { plural } from './plural.ts';

export type ContactReason =
  | 'no_linkedin'
  | 'ai_review'
  | 'in_sequence'
  | 'passed_sequence'
  | 'erased'
  | 'recent_contact'
  | 'too_far'
  | 'connection_only';

/** Catégorie d'une dérogation : le contact récent, ou l'incompatibilité avec la séquence. */
export type ContactOverride = 'recent_contact' | 'incompatible';

export interface FlowEntryInput {
  id: string;
  name: string;
  hasLinkedIn: boolean;
}

export interface ContactEligibility {
  blocking: ReadonlyMap<string, 'in_sequence' | 'passed'>;
  erased: ReadonlySet<string>;
  /** Identifiant vers le libellé exact, par exemple « Déjà contacté par Marie le 03/10/2026 ». */
  recent: ReadonlyMap<string, string>;
  incompatible: ReadonlyMap<string, 'too_far' | 'connection_only_already_connected'>;
  warnings: ReadonlyMap<string, 'connection_already_connected' | 'inmail_wasted'>;
}

export interface ContactClassifyOptions {
  /** La séquence a un message rédigé par l'IA : tous les candidats prêts sont à compléter. */
  aiReview: boolean;
  /** Seuls les propriétaires et les administrateurs peuvent inscrire un contact récent. */
  canOverrideRecent: boolean;
  /** Dérogations choisies par la personne. */
  overrides: ReadonlySet<ContactOverride>;
}

export interface ContactEntry<T extends FlowEntryInput> {
  source: T;
  reason: ContactReason | null;
  label: string | null;
  /** Dérogation qui débloque ce candidat exclu, ou null s'il n'en a pas (ou s'il n'est pas exclu). */
  override: ContactOverride | null;
  /** Vrai quand une raison a été levée par une dérogation et que le candidat est inscrit quand même. */
  overridden: boolean;
}

export interface ContactGroups<T extends FlowEntryInput> {
  ready: ContactEntry<T>[];
  incomplete: ContactEntry<T>[];
  excluded: ContactEntry<T>[];
  /** Phrases d'information sur les candidats prêts (déjà en relation...), dans un ordre stable. */
  notes: string[];
}

/** Libellé d'un contact récent quand l'anti-doublon n'en a pas fourni. */
const RECENT_CONTACT_FALLBACK = 'Déjà contacté par votre organisation';

export const LABEL_BY_REASON: Record<ContactReason, string> = {
  no_linkedin: 'Sans profil LinkedIn',
  ai_review: "Message rédigé par l'IA à relire avant l'inscription",
  in_sequence: 'Déjà dans cette séquence',
  passed_sequence: 'Déjà passé par cette séquence (terminée, réponse ou arrêt)',
  erased: "A demandé l'effacement de ses données",
  recent_contact: RECENT_CONTACT_FALLBACK,
  too_far: "Hors de votre réseau LinkedIn, seul un InMail peut l'atteindre",
  connection_only: "Déjà en relation, et la séquence ne contient qu'une invitation",
};

export const OVERRIDE_LABEL: Record<ContactOverride, string> = {
  recent_contact: 'Inscrire quand même',
  incompatible: 'Inclure quand même',
};

/** Catégorie de dérogation d'une raison, ou null si la raison n'en admet aucune. */
export function overrideOfReason(reason: ContactReason | null): ContactOverride | null {
  if (reason === 'recent_contact') return 'recent_contact';
  if (reason === 'too_far' || reason === 'connection_only') return 'incompatible';
  return null;
}

type Warning = 'connection_already_connected' | 'inmail_wasted';
type GroupKey = 'ready' | 'incomplete' | 'excluded';

/** Ordre stable des phrases d'information. */
const WARNING_ORDER: readonly Warning[] = ['connection_already_connected', 'inmail_wasted'];

const WARNING_TEXT: Record<Warning, (count: number) => string> = {
  connection_already_connected: (count) =>
    `${plural(count, 'candidat déjà en relation', 'candidats déjà en relation')} : l'invitation sera sautée, les messages suivants partiront.`,
  inmail_wasted: (count) =>
    `${plural(count, 'candidat déjà en relation', 'candidats déjà en relation')} : un message direct serait gratuit, l'InMail consomme un crédit.`,
};

interface Verdict<T extends FlowEntryInput> {
  group: GroupKey;
  entry: ContactEntry<T>;
}

/** Raison à dérogation encore en cause pour un candidat. */
interface OverridableReason {
  reason: 'recent_contact' | 'too_far' | 'connection_only';
  label: string;
  category: ContactOverride;
}

function verdict<T extends FlowEntryInput>(
  group: GroupKey,
  source: T,
  reason: ContactReason | null,
  label: string | null,
  override: ContactOverride | null,
  overridden: boolean,
): Verdict<T> {
  return { group, entry: { source, reason, label, override, overridden } };
}

function classifyOne<T extends FlowEntryInput>(
  source: T,
  eligibility: ContactEligibility,
  options: ContactClassifyOptions,
): Verdict<T> {
  const id = source.id;

  // 1. Un candidat sans lien de profil LinkedIn n'est jamais laissé de côté en silence.
  if (!source.hasLinkedIn) {
    return verdict('incomplete', source, 'no_linkedin', LABEL_BY_REASON.no_linkedin, null, false);
  }

  // 2 et 3. Raisons sans dérogation.
  const blocking = eligibility.blocking.get(id);
  if (blocking === 'in_sequence') {
    return verdict('excluded', source, 'in_sequence', LABEL_BY_REASON.in_sequence, null, false);
  }
  if (blocking === 'passed') {
    return verdict('excluded', source, 'passed_sequence', LABEL_BY_REASON.passed_sequence, null, false);
  }
  if (eligibility.erased.has(id)) {
    return verdict('excluded', source, 'erased', LABEL_BY_REASON.erased, null, false);
  }

  // 4. Raisons à dérogation : le contact récent d'abord, puis l'incompatibilité.
  const causes: OverridableReason[] = [];
  if (eligibility.recent.has(id)) {
    causes.push({
      reason: 'recent_contact',
      label: eligibility.recent.get(id) || RECENT_CONTACT_FALLBACK,
      category: 'recent_contact',
    });
  }
  const incompatible = eligibility.incompatible.get(id);
  if (incompatible !== undefined) {
    const reason = incompatible === 'too_far' ? 'too_far' : 'connection_only';
    causes.push({ reason, label: LABEL_BY_REASON[reason], category: 'incompatible' });
  }
  // La dérogation pour un contact récent n'existe que pour les propriétaires et les administrateurs.
  const offered = (category: ContactOverride): boolean => category !== 'recent_contact' || options.canOverrideRecent;
  const lifted = (category: ContactOverride): boolean => offered(category) && options.overrides.has(category);

  const remaining = causes.find((cause) => !lifted(cause.category));
  if (remaining) {
    return verdict(
      'excluded',
      source,
      remaining.reason,
      remaining.label,
      offered(remaining.category) ? remaining.category : null,
      false,
    );
  }

  // Toutes les raisons à dérogation (s'il y en avait) sont levées : la première reste affichée.
  const kept = causes[0] ?? null;
  const overridden = kept !== null;

  // 5. Message rédigé par l'IA : à relire avant l'inscription.
  if (options.aiReview) {
    return verdict('incomplete', source, 'ai_review', LABEL_BY_REASON.ai_review, null, overridden);
  }

  // 6. Prêt (la raison levée, s'il y en a une, sert à écrire « inscrit quand même »).
  return verdict('ready', source, kept?.reason ?? null, kept?.label ?? null, null, overridden);
}

/**
 * Range les candidats en trois groupes. Chaque groupe garde l'ordre d'entrée ;
 * pour deux entrées de même identifiant, la première seule compte.
 */
export function classifyContactEntries<T extends FlowEntryInput>(
  entries: readonly T[],
  eligibility: ContactEligibility,
  options: ContactClassifyOptions,
): ContactGroups<T> {
  const groups: ContactGroups<T> = { ready: [], incomplete: [], excluded: [], notes: [] };
  const seen = new Set<string>();
  for (const source of entries) {
    if (seen.has(source.id)) continue;
    seen.add(source.id);
    const { group, entry } = classifyOne(source, eligibility, options);
    groups[group].push(entry);
  }

  // Les phrases d'information ne parlent que des candidats qui seront inscrits.
  const counts = new Map<Warning, number>();
  for (const { source } of groups.ready) {
    const warning = eligibility.warnings.get(source.id);
    if (warning) counts.set(warning, (counts.get(warning) ?? 0) + 1);
  }
  for (const warning of WARNING_ORDER) {
    const count = counts.get(warning) ?? 0;
    if (count > 0) groups.notes.push(WARNING_TEXT[warning](count));
  }
  return groups;
}

/** « 2 prêts · 1 à compléter · 2 exclus » ; les zéros sont omis. */
export function contactSummary(groups: ContactGroups<FlowEntryInput>): string {
  const parts: string[] = [];
  if (groups.ready.length > 0) parts.push(plural(groups.ready.length, 'prêt'));
  if (groups.incomplete.length > 0) parts.push(plural(groups.incomplete.length, 'à compléter', 'à compléter'));
  if (groups.excluded.length > 0) parts.push(plural(groups.excluded.length, 'exclu'));
  return parts.length > 0 ? parts.join(' · ') : 'Aucun candidat';
}
