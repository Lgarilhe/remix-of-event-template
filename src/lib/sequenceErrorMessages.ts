// Traduit les codes d'erreur techniques venant des edge functions séquence
// (sequence-send-email, process-sequences) vers du français user-facing.
// Le but est de masquer les noms de fournisseurs (Unipile, Microsoft Graph,
// Anthropic, etc.) qui ne doivent jamais apparaître côté utilisateur.
//
// Ce module porte aussi le vocabulaire du suivi des séquences (statuts
// d'exécution, types d'action, raisons de saut, taux de réponse, résultats
// A/B) : une seule table pour le Journal, la fiche candidat, le panneau des
// inscrits et les statistiques. Il reste sans import pour être testé tel quel.

const ERROR_CODE_LABELS: Record<string, string> = {
  email_provider_not_configured: "Compte e-mail non connecté à Konekt",
  email_send_failed: "Échec de l'envoi (service d'envoi e-mail indisponible)",
  no_email_method_available: "Aucun moyen d'envoyer l'e-mail",
  rate_limit: "Limite du service d'envoi atteinte, réessayez plus tard",
  unauthorized: "Accès au service d'envoi expiré, reconnectez le compte",
  not_found: "Destinataire introuvable",
  internal_error: "Erreur interne",
  suppression_check_failed: "Vérification de désinscription impossible, envoi reporté",
  // Codes du moteur (SEQ-005). Seuls, sans la phrase française qui les suit
  // d'ordinaire (« code: phrase »).
  send_uncertain: 'Envoi incertain : vérifiez la conversation avant de relancer',
  profile_read_unavailable: 'Lecture du profil LinkedIn momentanément indisponible, nouvel essai plus tard',
  inmail_balance_unavailable: 'Contrôle des crédits InMail momentanément indisponible, nouvel essai plus tard',
  inmail_credits_exhausted: "Crédits InMail épuisés : l'envoi reprendra quand des crédits seront disponibles",
  inmail_subject_missing: "Objet manquant pour un InMail : ajoutez un objet à l'étape",
};

/** « code: phrase française » écrit par le moteur : on n'affiche que la phrase. */
const ENGINE_CODE_WITH_PHRASE = /^(send_uncertain|profile_read_unavailable|inmail_balance_unavailable|inmail_credits_exhausted|inmail_subject_missing)\b\s*:?\s*([\s\S]*)$/;

// ─── Refus de la base (HINT des déclencheurs, SEQ-214 / SEQ-056) ───────────

const FOREIGN_ELEMENT_REFUSAL = 'Action refusée : cet élément appartient à une autre séquence ou organisation.';

export const SEQUENCE_WRITE_REFUSALS: Record<string, string> = {
  EXECUTION_ALREADY_DONE: "Cette étape est déjà envoyée ou en cours d'envoi : elle ne peut plus être modifiée.",
  EXECUTION_NOT_SCHEDULED: 'Seul un message encore programmé peut être modifié.',
  EXECUTION_IMMUTABLE: FOREIGN_ELEMENT_REFUSAL,
  SEQUENCE_ORG_MISMATCH: FOREIGN_ELEMENT_REFUSAL,
  PROJECT_ORG_MISMATCH: FOREIGN_ELEMENT_REFUSAL,
  STEP_SEQUENCE_MISMATCH: FOREIGN_ELEMENT_REFUSAL,
};

/**
 * Phrase française d'un refus posé par la base sur une écriture du navigateur
 * (erreur Supabase portant `hint`, ou le code seul). null si ce n'est pas un
 * de ces refus : l'appelant garde alors son propre message.
 */
export function sequenceWriteRefusal(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === 'string') return SEQUENCE_WRITE_REFUSALS[error] ?? null;
  const { hint, message } = error as { hint?: unknown; message?: unknown };
  if (typeof hint === 'string' && SEQUENCE_WRITE_REFUSALS[hint]) return SEQUENCE_WRITE_REFUSALS[hint];
  const text = typeof message === 'string' ? message : '';
  const code = Object.keys(SEQUENCE_WRITE_REFUSALS).find((key) => text.includes(key));
  return code ? SEQUENCE_WRITE_REFUSALS[code] : null;
}

// Strip des noms de vendors (règle branding : jamais user-facing).
function stripVendors(text: string): string {
  return text
    .replace(/\bUnipile(\s+WhatsApp)?(\s+\d+)?\s*:?/gi, '')
    .replace(/\bMicrosoft Graph(\s+API)?(\s+\d+)?\s*:?/gi, '')
    .replace(/\bMICROSOFT_GRAPH_TOKEN\b/g, '')
    .replace(/\bAnthropic\b/gi, 'IA')
    .replace(/\bResend\b/gi, '')
    .trim();
}

/** « 26 septembre à 14:05 », en heure locale du navigateur. */
function formatRetryDate(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });
  const time = date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  return `${day} à ${time}`;
}

function rateLimitLabel(actionType: string | undefined, retryIso: string | undefined): string {
  const channel = actionType === 'email'
    ? "Limite d'envoi e-mail atteinte"
    : actionType === 'whatsapp_message'
      ? "Limite d'envoi WhatsApp atteinte"
      : 'Limite LinkedIn atteinte';
  const when = retryIso ? formatRetryDate(retryIso) : null;
  return when ? `${channel}, nouvel essai le ${when}` : `${channel}, nouvel essai automatique`;
}

export function formatSequenceError(error: string | null | undefined): string {
  if (!error) return '';

  // Code d'erreur générique connu → label FR
  if (ERROR_CODE_LABELS[error]) return ERROR_CODE_LABELS[error];
  if (SEQUENCE_WRITE_REFUSALS[error]) return SEQUENCE_WRITE_REFUSALS[error];

  // « inmail_credits_exhausted: Crédits InMail épuisés : … » → la phrase seule.
  const engineCodeMatch = error.match(ENGINE_CODE_WITH_PHRASE);
  if (engineCodeMatch) {
    return stripVendors(engineCodeMatch[2].trim()) || ERROR_CODE_LABELS[engineCodeMatch[1]];
  }

  // Tentative intermédiaire : « Retry 1/3: <erreur> ». On retire le préfixe et
  // on traduit l'erreur qui suit (avant, le JSON du fournisseur partait brut).
  const retryMatch = error.match(/^Retry (\d+)\/(\d+):\s*([\s\S]*)$/);
  if (retryMatch) {
    const inner = formatSequenceError(retryMatch[3]) || ERROR_CODE_LABELS.internal_error;
    return `Nouvel essai ${retryMatch[1]} sur ${retryMatch[2]} : ${inner}`;
  }

  // « Rate limit (inmail) → rescheduled to 2026-09-26T14:05:00.000Z » (moteur)
  const rateLimitMatch = error.match(/^Rate limit \(([^)]+)\)\s*→\s*rescheduled to\s+(\S+)/);
  if (rateLimitMatch) return rateLimitLabel(rateLimitMatch[1], rateLimitMatch[2]);
  // « Rate limit, rescheduled: … » (envoi e-mail)
  if (/^Rate limit, rescheduled/.test(error)) return rateLimitLabel('email', undefined);

  // Récupération du nettoyage : l'e-mail est bien parti, seul le statut n'avait
  // pas été écrit. Ce n'est pas une erreur.
  if (/^Recovered: email was sent/.test(error)) return 'Envoyé';

  // ── Formats RÉELS produits par le moteur (audit 2026-07, Frontend M5) ─────
  // Les regex étaient ancrées en fin (`..._\d+$`) alors que le moteur appende
  // le corps de la réponse fournisseur : `linkedin_send_failed_429: {...}`.
  // Résultat : tous les labels FR ci-dessous étaient du code mort et l'user
  // voyait le JSON technique brut. On matche désormais par PRÉFIXE.

  // email_send_failed_<status_code>[: body]
  if (/^email_send_failed_\d+/.test(error)) {
    return ERROR_CODE_LABELS.email_send_failed;
  }
  // linkedin_send_failed_<status_code>[: body]
  const linkedinMatch = error.match(/^linkedin_send_failed_(\d+)/);
  if (linkedinMatch) {
    const code = linkedinMatch[1];
    if (code === '429') return 'Limite LinkedIn atteinte, les envois sont ralentis';
    if (code === '401' || code === '403') return 'Compte LinkedIn déconnecté, reconnectez-le';
    return "Échec de l'envoi LinkedIn";
  }
  // whatsapp_send_failed_<status_code>[: body]
  if (/^whatsapp_send_failed_\d+/.test(error)) {
    return "Échec de l'envoi WhatsApp";
  }
  // `Invite <status>: <body>` (envoi d'invitation refusé par le provider)
  const inviteMatch = error.match(/^Invite (\d+)/);
  if (inviteMatch) {
    if (inviteMatch[1] === '429') return "Limite d'invitations LinkedIn atteinte, les envois sont ralentis";
    return "Échec de l'envoi de l'invitation LinkedIn";
  }
  // `Profile visit <status>: <body>`
  if (/^Profile visit \d+/.test(error)) {
    return "Échec de la visite de profil LinkedIn";
  }
  // `sequence-send-email <status>: <body>` (échec de la fonction d'envoi email)
  if (/^sequence-send-email \d+/.test(error)) {
    return ERROR_CODE_LABELS.email_send_failed;
  }
  // `Account status: CREDENTIALS|ERROR|...`
  const accountStatusMatch = error.match(/^Account status:\s*(\w+)/);
  if (accountStatusMatch) {
    return "Compte LinkedIn à reconnecter (envoi en pause)";
  }
  // `no_email: ...`
  if (/^no_email/.test(error)) {
    return "Pas d'adresse e-mail pour ce candidat";
  }
  // Limites dures fournisseur
  if (/limit_exceeded|cannot_resend_yet|cannot_resend_within_24hrs/i.test(error)) {
    return "Limite LinkedIn atteinte, envoi en pause jusqu'à demain";
  }
  // Message du nettoyage (déjà en français) : envoi peut-être parti.
  if (/^Interrompu pendant l'envoi/.test(error)) {
    return "Interrompu pendant l'envoi : pas de nouvel essai automatique, pour éviter un doublon";
  }
  if (/^Failed after 3 retries/.test(error)) {
    return "Échec après 3 tentatives, action abandonnée";
  }
  // Solde InMail épuisé (message moteur déjà FR mais avec détails techniques)
  if (/Quota InMail épuisé/i.test(error)) {
    return "Crédits InMail épuisés : rechargez-les ou changez de mode d'envoi";
  }
  if (/InMail balance check/i.test(error)) {
    return "Vérification des crédits InMail impossible, envoi reporté";
  }
  // Timeout IA
  if (/API timeout/i.test(error)) {
    return "Génération IA trop lente, nouvel essai au prochain passage";
  }

  // JSON-encoded errors : extraire un champ lisible (vendor-strippé —
  // audit 2026-07 M5 : parsed.detail/title partait brut vers l'UI)
  try {
    const parsed = JSON.parse(error);
    if (parsed.detail) return stripVendors(String(parsed.detail)) || ERROR_CODE_LABELS.internal_error;
    if (parsed.title) return stripVendors(String(parsed.title)) || ERROR_CODE_LABELS.internal_error;
    if (parsed.message) return stripVendors(String(parsed.message)) || ERROR_CODE_LABELS.internal_error;
  } catch {
    if (error.startsWith('{') || error.startsWith('[')) {
      const titleMatch = error.match(/"title"\s*:\s*"([^"]+)"/);
      const detailMatch = error.match(/"detail"\s*:\s*"([^"]+)"/);
      if (detailMatch) return stripVendors(detailMatch[1]) || ERROR_CODE_LABELS.internal_error;
      if (titleMatch) return stripVendors(titleMatch[1]) || ERROR_CODE_LABELS.internal_error;
    }
  }

  // Strip vendor names si on en trouve dans des messages legacy
  const sanitized = stripVendors(error);

  return sanitized || ERROR_CODE_LABELS.internal_error;
}

// ─── Raisons de saut ou d'annulation (skip_reason) ─────────────────────────
//
// Les motifs sont écrits par le moteur, les webhooks et le navigateur. On ne
// les change pas en base (des filtres en dépendent) : on les traduit ici, par
// préfixe, avec un repli neutre pour les motifs futurs.

type SkipReasonRule = [RegExp, string | ((match: RegExpMatchArray) => string)];

const SKIP_REASON_RULES: SkipReasonRule[] = [
  [/^Enrollment inactive/i, "Candidat en pause au moment de l'envoi"],
  [/^Enrollment became (\w+)/i, (m) => (
    m[1] === 'replied'
      ? 'Réponse détectée'
      : m[1] === 'paused'
        ? "Candidat mis en pause au moment de l'envoi"
        : "Séquence arrêtée pour ce candidat au moment de l'envoi"
  )],
  // Relecture après un envoi accepté (SEQ-003) : l'exécution est « envoyée ».
  [/^Inscription devenue (\w+) pendant l'envoi/, (m) => (
    m[1] === 'replied'
      ? "Message envoyé ; le candidat a répondu pendant l'envoi"
      : m[1] === 'paused'
        ? "Message envoyé ; candidat mis en pause pendant l'envoi"
        : "Message envoyé ; la séquence s'est terminée pour ce candidat pendant l'envoi"
  )],
  // « Inscription close avant l'envoi (…) » (E1) et « Inscription close (…) :
  // attente annulée » (check_timeouts, E2).
  [/^Inscription close/, 'Séquence terminée pour ce candidat'],
  [/^Adresse en liste de suppression/, 'Adresse bloquée pour les envois e-mail'],
  [/^Aucune adresse e-mail connue/, "Pas d'adresse e-mail, étape passée"],
  [/^Sequence missing/i, 'Séquence introuvable'],
  [/^no_previous_message/, 'Pas de message précédent à relancer'],
  [/^Timeout (\d+)d/, (m) => `Délai d'attente dépassé (${m[1]} jour${m[1] === '1' ? '' : 's'})`],
  [/^Condition:/, 'Condition non remplie'],
  [/^(Email )?reply detected/i, 'Réponse détectée'],
  [/^Candidate replied/i, 'Réponse détectée'],
  [/^Réponse détectée/, 'Réponse détectée'],
  [/^(Marqué comme répondu|Réponse marquée manuellement)/, 'Marqué comme ayant répondu'],
  [/^No email/i, "Pas d'adresse e-mail, étape passée"],
  [/^No LinkedIn account/i, 'Pas de compte LinkedIn, étape passée'],
  [/^No phone number/i, 'Pas de numéro de téléphone, étape passée'],
  [/^Auto-paused/i, "Séquence mise en pause automatiquement : trop d'échecs d'envoi"],
  [/^Recovered: email was sent/i, 'Envoyé'],
  [/^Stop condition: link clicked/i, 'Arrêt : le candidat a cliqué sur le lien'],
  [/^Stop condition: unsubscribed/i, "Arrêt : le candidat s'est désinscrit"],
  [/^Stop condition: meeting booked/i, 'Arrêt : un rendez-vous a été pris'],
  [/booking detected/i, 'Arrêt : un rendez-vous a été pris'],
  [/^Email bounced/i, 'Adresse e-mail invalide (message revenu en erreur)'],
  [/^Manuellement sautée/, 'Étape sautée manuellement'],
  [/^Annulé manuellement/, 'Étape annulée manuellement'],
  [/^(Arrêt manuel|Arrêt groupé|Stoppé depuis Inbox|Inscription en pause)/, 'Candidat mis en pause'],
  [/^Séquence désactivée/, 'Séquence désactivée'],
  [/^Limite hebdo invitations/, "Reporté : limite hebdomadaire d'invitations atteinte"],
  [/^Cap journalier/, 'Reporté : limite LinkedIn du jour atteinte'],
  [/^Compte en pause quota/, 'Reporté : LinkedIn limite temporairement ce compte'],
  [/^Hors plage horaire/, "Reporté : en dehors des horaires d'envoi"],
  [/^(Contrôle de quota|Quota check)/i, 'Reporté : vérification des limites indisponible'],
  [/^Candidat a bloqué/, 'Candidat injoignable sur LinkedIn'],
];

/** Motifs déjà rédigés en français pour l'utilisateur : affichés tels quels. */
const FRENCH_SKIP_REASON_PREFIXES = [
  'Compte LinkedIn',
  "Compte d'envoi non rattaché",
  'Abonnement requis',
  'Étape déjà envoyée',
  'Étape incohérente',
  "Étape d'une autre séquence",
  'Inscription supprimée',
  "Type d'action non supporté",
  'Adresse bloquée pour les envois e-mail',
  'Déjà en relation',
  'Invitation déjà en attente',
  'Invitation déjà envoyée récemment',
  'Profil LinkedIn introuvable',
  'Crédits InMail',
  'Contrôle des crédits InMail',
  'Tous les expéditeurs',
  'Le candidat a répondu',
  'Rendez-vous pris',
  'Effacement des données demandé',
];

export function formatSkipReason(reason: string | null | undefined): string {
  if (!reason) return '';
  const text = reason.trim();
  for (const [pattern, label] of SKIP_REASON_RULES) {
    const match = text.match(pattern);
    if (match) return typeof label === 'string' ? label : label(match);
  }
  if (FRENCH_SKIP_REASON_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    return stripVendors(text) || 'Étape non envoyée';
  }
  return 'Étape non envoyée';
}

// ─── Statuts d'exécution ───────────────────────────────────────────────────

export const EXECUTION_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Programmé',
  sending: "En cours d'envoi",
  waiting_event: "En attente d'une réponse ou d'une acceptation",
  quota_blocked: 'Reporté (limite LinkedIn du jour atteinte)',
  sent: 'Envoyé',
  opened: 'Ouvert',
  clicked: 'Lien cliqué',
  replied: 'Répondu',
  bounced: 'Adresse invalide',
  skipped: 'Ignoré',
  failed: 'Échoué',
  cancelled: 'Annulé',
};

export function executionStatusLabel(status: string | null | undefined): string {
  return (status && EXECUTION_STATUS_LABELS[status]) || 'Statut inconnu';
}

/** Exécutions réellement parties chez le candidat (l'ouverture et le clic ne concernent que l'e-mail). */
export const SENT_EXECUTION_STATUSES = ['sent', 'opened', 'clicked', 'replied'] as const;

export function isSentExecutionStatus(status: string | null | undefined): boolean {
  return !!status && (SENT_EXECUTION_STATUSES as readonly string[]).includes(status);
}

/**
 * Un error_message ne se lit que sur un échec ou une étape reprogrammée après
 * une tentative : sur une étape envoyée, c'est la trace d'un essai précédent.
 */
export function shouldShowExecutionError(status: string | null | undefined): boolean {
  return status === 'failed' || status === 'scheduled';
}

/** Verbe affiché devant la date de traitement d'une étape (fiche candidat, Journal). */
export function executionDoneVerb(status: string | null | undefined): string | null {
  if (isSentExecutionStatus(status)) return 'Envoyé';
  if (status === 'failed') return 'Échec';
  if (status === 'skipped') return 'Ignoré';
  if (status === 'cancelled') return 'Annulé';
  if (status === 'bounced') return 'Revenu en erreur';
  return null;
}

// ─── Types d'action ────────────────────────────────────────────────────────

// Mêmes noms que STEP_TYPE_LABELS de l'éditeur (sequence/sequenceGraph.ts),
// recopiés parce que ce module reste sans import ; tests/ux/seq-audit-f3
// vérifie qu'ils concordent (SEQ-245). Les écrans du suivi appellent
// stepTypeLabel directement ; cette table sert aux autres appelants.
export const ACTION_TYPE_LABELS: Record<string, string> = {
  message: 'Message LinkedIn',
  smart_message: 'Message IA',
  inmail: 'InMail',
  email: 'E-mail',
  whatsapp_message: 'WhatsApp',
  connection_request: 'Invitation LinkedIn',
  profile_visit: 'Visite de profil',
  check_connection: 'Vérifier la connexion',
  wait_connection: 'Attendre la connexion',
  wait_reply: 'Attendre une réponse',
  wait_profile_visit: 'Attendre une visite',
  wait_for_event: 'Attente',
  condition_branch: 'Branchement',
};

export function actionTypeLabel(actionType: string | null | undefined): string {
  return (actionType && ACTION_TYPE_LABELS[actionType]) || 'Action';
}

/** Étapes internes (attentes, contrôles, conditions) : rien ne part chez le candidat. */
export const HIDDEN_ACTION_TYPES = [
  'wait_connection',
  'check_connection',
  'wait_reply',
  'wait_for_event',
  'wait_profile_visit',
  'condition_branch',
] as const;

export function isHiddenActionType(actionType: string | null | undefined): boolean {
  return !!actionType && (HIDDEN_ACTION_TYPES as readonly string[]).includes(actionType);
}

// ─── Taux de réponse ───────────────────────────────────────────────────────

/** En dessous de ce nombre de candidats contactés, aucun taux n'est jugé bas ou excellent. */
export const RESPONSE_RATE_MIN_CONTACTED = 5;

export interface ResponseRate {
  replied: number;
  contacted: number;
  /** Pourcentage arrondi, null tant que personne n'a été contacté. */
  rate: number | null;
}

/** Taux de réponse = répondus / contactés. Un candidat qui a répondu compte comme contacté. */
export function computeResponseRate({ replied, contacted }: { replied: number; contacted: number }): ResponseRate {
  const safeContacted = Math.max(contacted, replied, 0);
  return {
    replied,
    contacted: safeContacted,
    rate: safeContacted > 0 ? Math.round((replied / safeContacted) * 100) : null,
  };
}

export interface ContactableEnrollment {
  status: string;
  /** Statuts des exécutions de l'inscription, quand ils ont été chargés. */
  execution_statuses?: readonly (string | null)[] | null;
}

/**
 * Contacté = au moins une étape envoyée. Sans les exécutions, repli sur les
 * inscriptions terminées ou répondues.
 */
export function isContactedEnrollment(enrollment: ContactableEnrollment): boolean {
  if (enrollment.status === 'replied') return true;
  if (enrollment.execution_statuses) {
    return enrollment.execution_statuses.some((s) => isSentExecutionStatus(s));
  }
  return enrollment.status === 'completed';
}

export function countContactedEnrollments(rows: readonly ContactableEnrollment[]): { replied: number; contacted: number } {
  let replied = 0;
  let contacted = 0;
  for (const row of rows) {
    if (row.status === 'replied') replied++;
    if (isContactedEnrollment(row)) contacted++;
  }
  return { replied, contacted };
}

// ─── Test A/B ──────────────────────────────────────────────────────────────

export interface VariantExecutionRow {
  variant_assigned: string | null;
  status: string;
  /** Statut de l'inscription : la réponse LinkedIn n'est portée que par elle. */
  enrollment_status?: string | null;
}

export interface VariantResult {
  variant: string;
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

const AB_SENT_STATUSES = ['sent', 'executed', 'opened', 'clicked', 'replied'];
const AB_OPENED_STATUSES = ['opened', 'clicked', 'replied'];
const AB_CLICKED_STATUSES = ['clicked', 'replied'];

/**
 * Comptage cumulatif : un e-mail cliqué a aussi été ouvert et envoyé. La
 * réponse vient du statut de l'inscription (seules les réponses e-mail
 * marquent l'exécution), et n'est comptée que si la variante est partie.
 */
export function aggregateVariantResults(rows: readonly VariantExecutionRow[]): VariantResult[] {
  const byVariant = new Map<string, VariantResult>();
  for (const row of rows) {
    const variant = row.variant_assigned;
    if (!variant || !AB_SENT_STATUSES.includes(row.status)) continue;
    const current = byVariant.get(variant) ?? { variant, sent: 0, opened: 0, clicked: 0, replied: 0 };
    current.sent++;
    if (AB_OPENED_STATUSES.includes(row.status)) current.opened++;
    if (AB_CLICKED_STATUSES.includes(row.status)) current.clicked++;
    if (row.enrollment_status === 'replied' || row.status === 'replied') current.replied++;
    byVariant.set(variant, current);
  }
  return Array.from(byVariant.values()).sort((a, b) => a.variant.localeCompare(b.variant));
}

// ─── Périmètre d'une mission ───────────────────────────────────────────────

/**
 * Valeurs possibles de sequence_enrollments.job_id pour une mission : l'id de
 * la mission (inscription depuis le sourcing, id normalisé), l'ancien id
 * synthétique « project:{id} » et le job rattaché à la mission.
 */
export function missionEnrollmentJobIds(projectId: string | null | undefined, projectJobId?: string | null): string[] {
  if (!projectId) return [];
  return Array.from(new Set([projectId, `project:${projectId}`, projectJobId].filter((v): v is string => !!v)));
}

// ─── Bilan d'une reprise (action serveur resume_enrollments) ───────────────

export type ResumeOutcome = 'resumed' | 'nothing_to_resume' | 'account_unlinked' | 'not_paused' | 'error';

export interface ResumeCounts {
  resumed: number;
  nothing_to_resume: number;
  account_unlinked: number;
  not_paused: number;
  error: number;
}

export interface ResumeResponse {
  success?: boolean;
  results?: Array<{ enrollment_id?: string; outcome?: string; message?: string }> | null;
  counts?: Partial<ResumeCounts> | null;
  message?: string;
  error?: string;
}

export interface ResumeSummary {
  tone: 'success' | 'info' | 'error';
  message: string;
  resumed: number;
}

const ACCOUNT_UNLINKED_MESSAGE = "Ce compte LinkedIn n'est plus relié. Reliez-le avant de reprendre la séquence.";

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** Message à afficher après une reprise, d'après le résultat réel de chaque inscription. */
export function summarizeResumeResponse(response: ResumeResponse | null | undefined, candidateName?: string | null): ResumeSummary {
  const counts: ResumeCounts = { resumed: 0, nothing_to_resume: 0, account_unlinked: 0, not_paused: 0, error: 0 };
  if (response?.counts) {
    for (const key of Object.keys(counts) as ResumeOutcome[]) {
      counts[key] = Number(response.counts[key] ?? 0) || 0;
    }
  } else if (response?.results) {
    for (const r of response.results) {
      const key = (r.outcome && r.outcome in counts ? r.outcome : 'error') as ResumeOutcome;
      counts[key]++;
    }
  }

  if (!response || response.success === false) {
    return { tone: 'error', message: response?.message || 'La reprise a échoué. Réessayez.', resumed: 0 };
  }

  const total = counts.resumed + counts.nothing_to_resume + counts.account_unlinked + counts.not_paused + counts.error;
  const forName = candidateName ? ` pour ${candidateName}` : '';

  if (total === 0) return { tone: 'error', message: 'Aucune séquence à reprendre.', resumed: 0 };
  if (counts.resumed === total) {
    return {
      tone: 'success',
      message: total === 1 ? `Séquence reprise${forName}` : `${total} séquences reprises${forName}`,
      resumed: counts.resumed,
    };
  }
  if (counts.account_unlinked === total) return { tone: 'error', message: ACCOUNT_UNLINKED_MESSAGE, resumed: 0 };
  if (counts.nothing_to_resume === total) {
    return {
      tone: 'info',
      message: `Rien à reprendre : cette séquence est terminée${forName}`,
      resumed: 0,
    };
  }
  if (counts.not_paused === total) {
    return { tone: 'info', message: total === 1 ? "Cette séquence n'était plus en pause." : "Ces séquences n'étaient plus en pause.", resumed: 0 };
  }
  if (counts.error === total) {
    const detail = response.results?.find((r) => r.outcome === 'error' && r.message)?.message;
    return { tone: 'error', message: detail || 'La reprise a échoué. Réessayez.', resumed: 0 };
  }

  const parts = [plural(counts.resumed, 'séquence reprise', 'séquences reprises')];
  if (counts.nothing_to_resume) parts.push(plural(counts.nothing_to_resume, 'déjà terminée', 'déjà terminées'));
  if (counts.not_paused) parts.push(plural(counts.not_paused, "qui n'était plus en pause", "qui n'étaient plus en pause"));
  if (counts.account_unlinked) parts.push(`${counts.account_unlinked} bloquée${counts.account_unlinked > 1 ? 's' : ''} : compte LinkedIn non relié`);
  if (counts.error) parts.push(`${counts.error} en erreur`);
  return { tone: counts.resumed > 0 ? 'info' : 'error', message: parts.join(', '), resumed: counts.resumed };
}
