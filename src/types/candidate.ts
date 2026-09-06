/**
 * Canonical Candidate types — source de vérité unique (I4).
 *
 * Le codebase actuel a plusieurs représentations d'un candidat héritées de
 * phases différentes (Airtable sync, LinkedIn scraping, ATS kanban, Notion,
 * pipeline scoring). Ce fichier centralise les types clés pour permettre une
 * migration progressive et éviter les bugs de mapping.
 *
 * Mapping des types existants :
 * - `Candidate` (types/shortlist.ts) — **legacy**, vue table Notion (ex-page Candidates)
 * - `ATSCandidate` (hooks/useATSData.ts) — vue kanban/table enrichie
 * - `JobCandidateStatus` (hooks/useJobCandidateStatus.ts) — row DB brute
 * - `LinkedInProfile` (components/outreach/types.ts) — profil LinkedIn riche
 * - `CandidateFullProfile` (hooks/useCandidateFullProfile.ts) — agrégat détail
 *
 * Stratégie de migration (I3) :
 * 1. Nouveaux composants → utiliser `Candidate` (core) depuis ce fichier
 * 2. Mappers (`fromLinkedInProfile`, `fromATSCandidate`) normalisent au fur et à mesure
 * 3. Suppression progressive des types dupliqués après migration des call sites
 */

// =============================================================================
// Enums & statuts
// =============================================================================

/**
 * Statut machine d'un candidat pour un job — stockage technique.
 * Source : `job_candidate_status.status` (col DB enum).
 */
export type CandidateStatus =
  | 'discovered'   // profil trouvé via search, pas encore traité
  | 'scored'       // scoré par l'IA (via scoring-batch)
  | 'dismissed'    // écarté par le recruteur
  | 'messaged'     // premier contact envoyé (sequence/inmail/email)
  | 'replied'      // a répondu au premier contact
  | 'shortlisted'; // ajouté à la shortlist mission

/**
 * Stage business kanban (lisible, traduit FR) — vue recruteur dans /pipeline.
 * Source : `job_candidate_status.pipeline_stage` (col DB text, valeur libre).
 *
 * ⚠️ Ces valeurs sont utilisées telles quelles dans ATS_STAGES (useATSData.ts).
 * Ne pas renommer sans plan de migration DB + code.
 */
export type CandidatePipelineStage =
  | 'Nouveau'
  | 'Contacté'
  | 'Répondu'
  | 'Pressenti'
  | 'Pré-qualif'
  | 'CV envoyé'
  | 'ITW en cours'
  | 'Offre'
  | 'Gagné'
  | 'Perdu';

export const CANDIDATE_PIPELINE_STAGES: readonly CandidatePipelineStage[] = [
  'Nouveau',
  'Contacté',
  'Répondu',
  'Pressenti',
  'Pré-qualif',
  'CV envoyé',
  'ITW en cours',
  'Offre',
  'Gagné',
  'Perdu',
] as const;

/**
 * Sources connues d'un candidat (d'où vient-il dans le funnel).
 */
export type CandidateSource =
  | 'linkedin_search'   // scraping Unipile
  | 'apollo_search'     // Apollo People API
  | 'pdl_search'        // People Data Labs
  | 'database_local'    // vivier interne / prospects
  | 'sequence'          // ajouté via enrollment séquence
  | 'inmail'            // ajouté via BulkInMail
  | 'shortlist'         // ajouté manuellement via shortlist
  | 'imported'          // CSV / upload direct
  | 'referral'          // recommandation
  | 'unknown';

// =============================================================================
// Core Candidate
// =============================================================================

/**
 * Représentation canonique minimale d'un candidat. Tous les champs sont
 * optionnels sauf `id` — le modèle d'un candidat varie beaucoup selon la source
 * (LinkedIn = pas d'email, DB = email mais pas de profil LinkedIn, etc.).
 *
 * Pour les vues détail, utiliser `CandidateDetail` qui hérite de ce type.
 */
export interface Candidate {
  /** Identifiant interne (UUID si persisté, sinon ID provider) */
  id: string;

  /** Prénom + nom (format d'affichage) */
  name: string | null;

  /** Titre / headline (ex. "Senior React Developer @ Doctolib") */
  headline: string | null;

  /** Photo de profil (URL publique) */
  avatarUrl: string | null;

  /** URL profil LinkedIn (si disponible) */
  linkedinUrl: string | null;

  /** Email (peut venir d'Apollo enrichment, Unipile contact_info, ou saisie manuelle) */
  email: string | null;

  /** Téléphone (même logique que email) */
  phone: string | null;

  /** Localisation (format texte libre, ex. "Paris, France") */
  location: string | null;

  /** Entreprise actuelle (dernière expérience en cours) */
  currentCompany: string | null;

  /** Rôle actuel (dernière position en cours) */
  currentRole: string | null;

  /** Années d'expérience totale (calculé depuis work_experience) */
  yearsOfExperience: number | null;

  /** Liste plate de compétences (depuis LinkedIn skills OU job_details) */
  skills: string[];

  /** D'où vient ce candidat dans le funnel */
  source: CandidateSource;

  /** Date de création / première découverte (ISO 8601) */
  createdAt: string | null;

  /** Date de dernière activité (message, stage change, note…) */
  lastActivityAt: string | null;
}

/**
 * Vue complète d'un candidat avec contexte mission — utilisée par le kanban,
 * la table pipeline, et le modal de détail.
 *
 * Hérite de `Candidate` et ajoute le scoring + stage + flags UI.
 */
export interface CandidateDetail extends Candidate {
  /** ID interne du status DB (job_candidate_status.id) */
  statusRowId: string | null;

  /** Job/mission associé (null si candidat hors contexte) */
  jobId: string | null;
  jobTitle: string | null;

  /** Status machine (voir CandidateStatus) */
  status: CandidateStatus;

  /** Stage kanban business (voir CandidatePipelineStage) */
  pipelineStage: CandidatePipelineStage | null;

  /** Score IA 0-100 (depuis score-profile-job) */
  score: number | null;

  /** Recommandation textuelle IA (ex. "Fortement recommandé") */
  recommendation: string | null;

  /** Raison de dismissal (si status === 'dismissed') */
  skipReason: string | null;

  /** Tags libres (badges UI) */
  tags: string[];

  /** Flag UI : y a-t-il des notes pour ce candidat ? */
  hasNotes: boolean;

  /** Flag UI : y a-t-il un rappel en attente ? */
  hasReminder: boolean;

  /** Données brutes du provider (LinkedIn JSON, Apollo JSON, etc.) */
  rawProfileData: Record<string, unknown> | null;
}

// =============================================================================
// Type guards & helpers
// =============================================================================

/**
 * Vérifie qu'une string est un CandidatePipelineStage valide.
 * Usage : `if (isPipelineStage(x)) { ... }`
 */
export function isPipelineStage(value: unknown): value is CandidatePipelineStage {
  return typeof value === 'string'
    && CANDIDATE_PIPELINE_STAGES.includes(value as CandidatePipelineStage);
}

const CANDIDATE_STATUSES: readonly CandidateStatus[] = [
  'discovered', 'scored', 'dismissed', 'messaged', 'replied', 'shortlisted',
];

export function isCandidateStatus(value: unknown): value is CandidateStatus {
  return typeof value === 'string'
    && CANDIDATE_STATUSES.includes(value as CandidateStatus);
}

/**
 * Normalise un stage inconnu (venant d'une ancienne DB) vers une valeur
 * canonique. Fallback sur 'Nouveau' si illisible.
 */
export function normalizePipelineStage(value: unknown): CandidatePipelineStage {
  if (isPipelineStage(value)) return value;
  // Mappings legacy (anciennes valeurs DB sans accents, etc.)
  if (typeof value === 'string') {
    const lower = value.toLowerCase().trim();
    if (lower === 'contacte' || lower === 'contacted') return 'Contacté';
    if (lower === 'repondu' || lower === 'replied') return 'Répondu';
    if (lower === 'pre-qualif' || lower === 'prequalif' || lower === 'pre_qualif') return 'Pré-qualif';
    if (lower === 'cv_sent' || lower === 'cv envoye' || lower === 'cv-sent') return 'CV envoyé';
    if (lower === 'itw' || lower === 'interview' || lower === 'in_interview') return 'ITW en cours';
    if (lower === 'offer' || lower === 'offre_envoyee') return 'Offre';
    if (lower === 'won' || lower === 'hired' || lower === 'placed') return 'Gagné';
    if (lower === 'lost' || lower === 'rejected' || lower === 'perdu') return 'Perdu';
  }
  return 'Nouveau';
}

/**
 * Derive le stage kanban depuis un status machine (fallback par défaut).
 * Utile quand un candidat vient d'être scoré mais pas encore placé sur le board.
 */
export function statusToDefaultStage(status: CandidateStatus): CandidatePipelineStage {
  switch (status) {
    case 'messaged':     return 'Contacté';
    case 'replied':      return 'Répondu';
    case 'shortlisted':  return 'Pressenti';
    case 'dismissed':    return 'Perdu';
    case 'discovered':
    case 'scored':
    default:             return 'Nouveau';
  }
}

// =============================================================================
// Adapters — anciennes formes → Candidate canonique
// =============================================================================

/** Shape minimale d'un profil LinkedIn à mapper vers Candidate */
type LinkedInProfileLike = {
  id?: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  profile_picture_url?: string;
  profile_picture_url_large?: string;
  profile_url?: string;
  public_profile_url?: string;
  location?: string;
  contact_info?: { emails?: string[]; phones?: string[] };
  skills?: Array<{ name: string } | string>;
  work_experience?: Array<{
    company?: string;
    role?: string;
    position?: string;
    current?: boolean;
    start?: string | { year?: number; month?: number } | null;
    end?: string | { year?: number; month?: number } | null;
  }>;
};

/**
 * Convertit un LinkedInProfile en Candidate canonique. Tolérant aux champs
 * manquants. Source présumée : 'linkedin_search'.
 */
export function fromLinkedInProfile(
  profile: LinkedInProfileLike,
  overrides: Partial<Candidate> = {},
): Candidate {
  const name = profile.name
    || [profile.first_name, profile.last_name].filter(Boolean).join(' ')
    || null;

  const currentExp = profile.work_experience?.find((w) => w.current);
  const firstExp = profile.work_experience?.[0];

  const skills = (profile.skills ?? [])
    .map((s) => (typeof s === 'string' ? s : s?.name))
    .filter((s): s is string => typeof s === 'string' && s.length > 0);

  const email = profile.contact_info?.emails?.[0] ?? null;
  const phone = profile.contact_info?.phones?.[0] ?? null;

  return {
    id: profile.id ?? profile.public_profile_url ?? profile.profile_url ?? '',
    name: name || null,
    headline: profile.headline ?? null,
    avatarUrl: profile.profile_picture_url_large ?? profile.profile_picture_url ?? null,
    linkedinUrl: profile.public_profile_url ?? profile.profile_url ?? null,
    email,
    phone,
    location: profile.location ?? null,
    currentCompany: currentExp?.company ?? firstExp?.company ?? null,
    currentRole: currentExp?.role ?? currentExp?.position ?? firstExp?.role ?? firstExp?.position ?? null,
    yearsOfExperience: null, // computé en aval si besoin
    skills,
    source: 'linkedin_search',
    createdAt: null,
    lastActivityAt: null,
    ...overrides,
  };
}

/** Shape minimale d'un ATSCandidate (hooks/useATSData) */
type ATSCandidateLike = {
  id: string;
  candidateId?: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  linkedin?: string | null;
  headline?: string | null;
  expertise?: string[];
  stage?: string;
  source?: string;
  jobId?: string | null;
  jobTitle?: string | null;
  lastActivity?: string | null;
  createdAt?: string;
  notesCount?: number;
  hasReminder?: boolean;
  score?: number | null;
  recommendation?: string | null;
  tags?: string[];
  scoringDetails?: unknown;
  linkedinProfileData?: unknown;
};

/**
 * Convertit un ATSCandidate (legacy hook shape) en CandidateDetail canonique.
 */
export function fromATSCandidate(ats: ATSCandidateLike): CandidateDetail {
  const source: CandidateSource = ats.source === 'sequence'
    ? 'sequence'
    : ats.source === 'inmail'
      ? 'inmail'
      : ats.source === 'local'
        ? 'database_local'
        : 'unknown';

  return {
    id: ats.id,
    name: ats.name ?? null,
    headline: ats.headline ?? null,
    avatarUrl: null,
    linkedinUrl: ats.linkedin ?? null,
    email: ats.email ?? null,
    phone: ats.phone ?? null,
    location: null,
    currentCompany: null,
    currentRole: null,
    yearsOfExperience: null,
    skills: ats.expertise ?? [],
    source,
    createdAt: ats.createdAt ?? null,
    lastActivityAt: ats.lastActivity ?? null,

    statusRowId: null,
    jobId: ats.jobId ?? null,
    jobTitle: ats.jobTitle ?? null,
    status: 'discovered',
    pipelineStage: normalizePipelineStage(ats.stage),
    score: ats.score ?? null,
    recommendation: ats.recommendation ?? null,
    skipReason: null,
    tags: ats.tags ?? [],
    hasNotes: (ats.notesCount ?? 0) > 0,
    hasReminder: ats.hasReminder ?? false,
    rawProfileData: (ats.linkedinProfileData as Record<string, unknown> | null) ?? null,
  };
}
