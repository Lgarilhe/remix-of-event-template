/**
 * Textes de la page d'administration « Bascule de la connexion »
 * (/settings/admin/bascule, page cachée, réservée aux administrateurs de la plateforme).
 *
 * Règles (docs/design/01-direction.md) : français, vouvoiement, phrases courtes, pas de tiret
 * cadratin, jamais le nom du prestataire (on dit « service de connexion »). Un message du serveur
 * n'est affiché que s'il ne nomme pas de prestataire (`shownText`) ; sinon le texte de repli.
 *
 * Module pur, sans React : testé par tests/ux/admin-bascule.test.mjs.
 */

import { mentionsVendor } from '@/lib/connectionCopy';

/** Mot à saisir pour confirmer la conversion (le serveur exige exactement ce mot). */
export const CONFIRM_WORD = 'BASCULER';
/** Mot à saisir pour annuler un lot (le serveur exige exactement ce mot). */
export const ROLLBACK_CONFIRM_WORD = 'ANNULER';

export const PAGE = {
  title: 'Bascule de la connexion',
  subtitle: 'Vérifiez que la nouvelle connexion est bien branchée, puis convertissez les comptes reliés.',
  seoTitle: 'Bascule de la connexion',
  seoDescription: 'Page d’administration de la plateforme.',
  checking: 'Vérification de votre accès',
} as const;

export const DENIED = {
  title: 'Accès réservé',
  body: 'Cette page est réservée aux administrateurs de la plateforme.',
  back: 'Retour à l’accueil',
} as const;

export const ACCESS_ERROR = {
  title: 'Impossible de vérifier votre accès',
  body: 'Réessayez dans quelques instants.',
} as const;

export const READINESS = {
  heading: '1. Vérifier',
  intro: 'Contrôle la clé, le service, les notifications et les comptes. Ne modifie rien.',
  button: 'Vérifier',
  readyTitle: 'Prêt pour la conversion',
  notReadyTitle: 'Pas encore prêt',
  errorTitle: 'La vérification a échoué',
  retry: 'Réessayer',
  emptyTitle: 'Aucune vérification lancée',
  emptyBody: 'Cliquez sur « Vérifier » pour contrôler la connexion.',
  unmappedHeading: 'Comptes sans correspondance',
} as const;

export const STATUS_LABEL = {
  ok: 'OK',
  warn: 'À surveiller',
  ko: 'Bloquant',
} as const;

export type CheckStatus = keyof typeof STATUS_LABEL;

export const STATUS_BADGE: Record<CheckStatus, 'success' | 'warning' | 'danger'> = {
  ok: 'success',
  warn: 'warning',
  ko: 'danger',
};

export function readinessCounts(summary: { ok: number; warn: number; ko: number }): string {
  const part = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;
  return [
    part(summary.ok, 'contrôle réussi', 'contrôles réussis'),
    part(summary.warn, 'à surveiller', 'à surveiller'),
    part(summary.ko, 'bloquant', 'bloquants'),
  ].join(', ');
}

export function checkedAtText(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `Vérifié le ${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
}

export const KIND_LABEL = {
  linkedin: 'LinkedIn',
  email: 'Messagerie',
  whatsapp: 'WhatsApp',
} as const;

export function kindLabel(kind: unknown): string {
  return typeof kind === 'string' && kind in KIND_LABEL ? KIND_LABEL[kind as keyof typeof KIND_LABEL] : 'Autre';
}

export const VIA_LABEL = {
  v1_account_id: 'Ancien identifiant',
  email: 'Adresse e-mail',
} as const;

export function viaLabel(via: unknown): string {
  return typeof via === 'string' && via in VIA_LABEL ? VIA_LABEL[via as keyof typeof VIA_LABEL] : 'Non précisé';
}

export const UNMAPPED_REASON = {
  not_in_service: 'Absent du service',
  ambiguous: 'Plusieurs correspondances',
  provider_mismatch: 'Type de compte différent',
} as const;

export function unmappedReasonLabel(reason: unknown): string {
  return typeof reason === 'string' && reason in UNMAPPED_REASON ? UNMAPPED_REASON[reason as keyof typeof UNMAPPED_REASON] : 'Sans correspondance';
}

export const PREVIEW = {
  heading: '2. Simuler',
  intro: 'Montre quels comptes seraient convertis et combien de lignes seraient réécrites. N’écrit rien.',
  button: 'Simuler la conversion des comptes',
  errorTitle: 'La simulation a échoué',
  retry: 'Réessayer',
  emptyTitle: 'Aucune simulation lancée',
  emptyBody: 'Cliquez sur « Simuler la conversion des comptes » pour voir ce qui changerait.',
  nothingTitle: 'Aucun compte à convertir',
  nothingNoAccounts: 'Aucun compte n’est relié en base.',
  nothingAllConverted: 'Tous les comptes sont déjà au nouveau format.',
  nothingNoMatch: 'Aucun compte n’a de correspondance dans le service.',
  nothingRestConverted: 'Tous les comptes qui ont une correspondance sont déjà convertis.',
  truncated: 'La liste des comptes du service est tronquée. La conversion est refusée tant qu’elle est incomplète.',
  sharedTargets: (n: number) =>
    `${n} compte${n > 1 ? 's' : ''} du service ${n > 1 ? 'sont visés' : 'est visé'} par plusieurs anciens identifiants. C’est attendu pour une messagerie et son agenda, à vérifier sinon.`,
  usageUnread: 'Effectifs non lus',
  listTruncated: 'La liste est tronquée.',
  unmappedHeading: 'Comptes sans correspondance',
  unmappedIntro: 'Ces comptes ne seront pas convertis. Leurs propriétaires devront les reconnecter. Les lignes qui leur sont liées restent sur l’ancien identifiant.',
  heldNone: 'Aucune ligne liée à ce compte.',
  heldUnread: 'Lignes liées non lues.',
  /** Lignes qui restent sur l'ancien identifiant, par type de donnée (libellés de whereLabel). */
  heldLine: (rows: number, parts: string[]) =>
    `${rowsText(rows)} ${rows > 1 ? 'resteront' : 'restera'} sur l’ancien identifiant : ${parts.join(', ')}.`,
  pairsHeading: 'Comptes à convertir',
  orphansHeading: 'Anciens identifiants sans compte relié',
  orphansIntro: 'Ces identifiants figurent dans la base mais ne correspondent à aucun compte relié (compte reconnecté ou supprimé). Ils ne seront pas convertis et le code final ne les reconnaîtra pas.',
  orphansUnread: 'La recherche des anciens identifiants sans compte relié a échoué. Relancez la simulation avant de convertir.',
  orphansTruncated: 'La liste est tronquée : d’autres identifiants existent.',
  orphansColumns: { where: 'Table et colonne', ref: 'Identifiant', rows: 'Lignes' },
  countsHeading: 'Résumé par type',
  columns: {
    kind: 'Type',
    total: 'En base',
    already: 'Déjà convertis',
    toConvert: 'À convertir',
    unmapped: 'Non trouvés',
    account: 'Compte',
    via: 'Retrouvé par',
    rows: 'Lignes à réécrire',
    notes: 'À savoir',
  },
  totalRow: 'Total',
} as const;

export function previewSummary(t: { total: number; already: number; toConvert: number; unmapped: number }): string {
  const s = (n: number) => (n > 1 ? 's' : '');
  return `${t.total} compte${s(t.total)} en base : ${t.already} déjà converti${s(t.already)}, ${t.toConvert} à convertir, ${t.unmapped} sans correspondance.`;
}

/** Ligne d'un type de compte (téléphone) : les quatre chiffres du tableau, nommés. */
export function countsLine(c: { total: number; already_v2: number; via_v1_account_id: number; via_email: number; unmapped: number }): string {
  const s = (n: number) => (n > 1 ? 's' : '');
  return `${c.total} en base, ${c.already_v2} déjà converti${s(c.already_v2)}, ${c.via_v1_account_id + c.via_email} à convertir, ${c.unmapped} non trouvé${s(c.unmapped)}.`;
}

export function rowsText(n: number): string {
  return `${n} ligne${n > 1 ? 's' : ''}`;
}

/**
 * Où se trouvent des lignes qui portent un identifiant de compte, dit pour le propriétaire : jamais le nom d'une
 * table ni d'une colonne. Une table inconnue donne « autres données ».
 */
const WHERE_LABEL: Record<string, string> = {
  'sequence_enrollments.assigned_sender_id': 'expéditeurs tirés des inscriptions de séquence',
  sequence_enrollments: 'inscriptions de séquence',
  sequence_steps: 'étapes de séquence',
  outreach_sequences: 'rotations d’expéditeurs des séquences',
  inmail_queue: 'file des InMails',
  linkedin_action_log: 'registre des plafonds',
  mission_conversations: 'conversations de mission',
  candidate_action_messages: 'messages d’actions sur un candidat',
  profile_enrichment_queue: 'file d’enrichissement des profils',
  nurturing_opportunities: 'suggestions de relance',
  sourcing_agents: 'agents de recherche continue',
  chat_categories: 'catégories de conversations',
  message_analysis_cache: 'analyses de messages',
  internal_config: 'réglage de l’annuaire des entreprises',
  member_calendar_accounts: 'liaison d’agenda',
  member_whatsapp_accounts: 'liaison WhatsApp',
  member_email_accounts: 'liaison de messagerie',
  member_linkedin_accounts: 'liaison LinkedIn',
};

export function whereLabel(table: unknown, column?: unknown): string {
  const t = typeof table === 'string' ? table : '';
  const c = typeof column === 'string' ? column : '';
  return WHERE_LABEL[`${t}.${c}`] ?? WHERE_LABEL[t] ?? 'autres données';
}

/** Première lettre en majuscule (début de ligne). */
export function capitalize(text: string): string {
  return text === '' ? text : text.charAt(0).toUpperCase() + text.slice(1);
}

/** « inscriptions de séquence (1), file des InMails (1) » : les lignes d'un compte, par type de donnée, sans nom de table. */
export function heldParts(held: ReadonlyArray<{ table: string; column: string; rows: number }>): string[] {
  const byLabel = new Map<string, number>();
  for (const row of held) {
    const label = whereLabel(row.table, row.column);
    byLabel.set(label, (byLabel.get(label) ?? 0) + row.rows);
  }
  return [...byLabel.entries()].map(([label, rows]) => `${label} (${rows})`);
}

/** Ligne d'un compte sans correspondance : ce qui reste sur son ancien identifiant. */
export function heldText(row: { held: ReadonlyArray<{ table: string; column: string; rows: number }>; heldRows: number; heldUnread: boolean }): string {
  if (row.heldUnread) return PREVIEW.heldUnread;
  return row.heldRows > 0 ? PREVIEW.heldLine(row.heldRows, heldParts(row.held)) : PREVIEW.heldNone;
}

/** Phrase d'une simulation qui n'a aucun compte à convertir : la raison dépend de ce que la base contient. */
export function nothingToConvertText(c: { total: number; already_v2: number }): string {
  if (c.total === 0) return PREVIEW.nothingNoAccounts;
  if (c.already_v2 === c.total) return PREVIEW.nothingAllConverted;
  // Des comptes déjà convertis et d'autres sans correspondance : ceux qui ont une correspondance sont faits.
  if (c.already_v2 > 0) return PREVIEW.nothingRestConverted;
  return PREVIEW.nothingNoMatch;
}

/**
 * Ce que la page propose pour un lot de la liste : déjà annulé, sans ligne réécrite (rien à annuler), à annuler
 * après un lot plus récent (`blocked`), ou annulable. La base applique la même règle et refuse sinon.
 */
export function batchRollbackState(batch: { rolledBack: boolean; rows: number | null; newerOpen: boolean }): 'done' | 'empty' | 'blocked' | 'available' {
  if (batch.rolledBack) return 'done';
  if (batch.rows === 0) return 'empty';
  return batch.newerOpen ? 'blocked' : 'available';
}

export const BATCHES = {
  heading: 'Conversions précédentes',
  applied: 'Appliquée',
  rolledBack: 'Annulée',
  pairs: (n: number) => `${n} compte${n > 1 ? 's' : ''}`,
  rows: (n: number) => `${rowsText(n)} réécrite${n > 1 ? 's' : ''}`,
  /** Un lot sans ligne réécrite n'a rien à annuler : pas de bouton. */
  empty: 'Aucune ligne réécrite : rien à annuler.',
  /** Un lot plus récent, non annulé, est à annuler avant celui-ci. */
  blockedByNewer: 'Annulez d’abord la conversion plus récente.',
  unreadable: 'La liste des conversions précédentes n’a pas pu être lue.',
  rollbackButton: 'Annuler la conversion',
  rollbackAria: (id: string) => `Annuler la conversion du lot ${id}`,
} as const;

export const APPLY = {
  heading: '3. Convertir',
  intro: 'Remplace l’ancien identifiant de chaque compte par le nouveau, dans toute la base. Une sauvegarde permet d’annuler.',
  button: 'Convertir les comptes',
  needPreview: 'Lancez d’abord la simulation.',
  nothing: 'Rien à convertir.',
  running: 'Conversion en cours. Gardez cette page ouverte.',
  dialogTitle: 'Convertir les comptes ?',
  dialogLines: (accounts: number, rows: number) => [
    `${accounts} compte${accounts > 1 ? 's' : ''} ${accounts > 1 ? 'seront convertis' : 'sera converti'} et ${rowsText(rows)} ${rows > 1 ? 'seront réécrites' : 'sera réécrite'} dans la base.`,
    'Cela concerne toutes les organisations.',
    'Chaque compte est traité séparément. Si l’un échoue, il reste inchangé.',
    'Une sauvegarde est gardée : vous pourrez annuler la conversion.',
    'Après la conversion, les anciens identifiants ne sont plus reconnus : mettez les envois automatiques en pause avant de convertir.',
  ],
  unreadyWarning: (n: number) =>
    `La dernière vérification signale ${n} point${n > 1 ? 's' : ''} bloquant${n > 1 ? 's' : ''}.`,
  allowUnmapped: (n: number) =>
    `Laisser ${n} compte${n > 1 ? 's' : ''} sans correspondance tel${n > 1 ? 's' : ''} quel${n > 1 ? 's' : ''}. ${n > 1 ? 'Ils devront' : 'Il devra'} être reconnecté${n > 1 ? 's' : ''}.`,
  /** Lignes des comptes laissés tels quels, dites avant la case : elles restent sur l'ancien identifiant. */
  unmappedHeld: (rows: number, exact: boolean) => {
    if (rows === 0) {
      return exact ? 'Aucune ligne n’est liée à ces comptes.' : 'Le nombre de lignes liées à ces comptes n’a pas pu être lu en entier.';
    }
    return `${exact ? '' : 'Au moins '}${rowsText(rows)} liée${rows > 1 ? 's' : ''} à ces comptes ${rows > 1 ? 'resteront' : 'restera'} sur l’ancien identifiant (détail dans la simulation).`;
  },
  typeLabel: `Saisissez ${CONFIRM_WORD} pour confirmer.`,
  typePlaceholder: CONFIRM_WORD,
  cancel: 'Annuler',
  confirm: 'Convertir les comptes',
  doneTitle: 'Conversion terminée',
  partialTitle: 'Conversion partielle',
  failedTitle: 'La conversion n’a pas eu lieu',
  /** Réponse perdue : on ne sait pas si la conversion a eu lieu. */
  unknownTitle: 'Résultat inconnu',
  resultLabel: 'Résultat de la conversion',
  nothingDone: 'Rien à convertir : aucun lot créé.',
  summary: (applied: number, rows: number) =>
    `${applied} compte${applied > 1 ? 's' : ''} converti${applied > 1 ? 's' : ''}, ${rowsText(rows)} réécrite${rows > 1 ? 's' : ''}.`,
  failedPairs: (n: number) => `${n} compte${n > 1 ? 's' : ''} en échec. ${n > 1 ? 'Ils sont restés inchangés' : 'Il est resté inchangé'}.`,
  remaining: (n: number) =>
    `Le temps imparti est écoulé : ${n} compte${n > 1 ? 's' : ''} ${n > 1 ? 'restent' : 'reste'} à convertir. Relancez la simulation, puis la conversion.`,
  skippedHeading: 'Colonnes non converties',
  skippedRows: (n: number) =>
    `${rowsText(n)} ${n > 1 ? 'portent' : 'porte'} encore l’ancien identifiant dans des colonnes que la conversion ne réécrit pas. Le code final ne ${n > 1 ? 'les' : 'la'} reconnaîtra pas.`,
  skippedLine: (where: string, reason: string, n: number) => `${where} : ${rowsText(n)}, ${reason}.`,
  unmappedLeft: (n: number) => `${n} compte${n > 1 ? 's' : ''} sans correspondance ${n > 1 ? 'restent' : 'reste'} à reconnecter.`,
  batchLabel: 'Numéro du lot',
  copy: 'Copier',
  copied: 'Copié',
  copyAria: 'Copier le numéro du lot',
  failedHeading: 'Comptes en échec',
  rollbackHint: 'Pour revenir en arrière, annulez la conversion de ce lot.',
  /** Réponse perdue (réseau, délai) : l'état réel est inconnu. */
  lostAnswer: 'La réponse n’est pas arrivée. La conversion a peut-être eu lieu : lancez la simulation, puis consultez les conversions précédentes.',
} as const;

export const ROLLBACK = {
  heading: 'Annulation d’une conversion',
  title: 'Annuler la conversion ?',
  lines: [
    'Les anciens identifiants du lot seront restaurés depuis la sauvegarde, pour toutes les organisations.',
    'Si plusieurs conversions ont eu lieu, annulez la plus récente en premier.',
    'Une ligne modifiée depuis la conversion n’est pas écrasée. Une ligne créée depuis la conversion garde le nouvel identifiant.',
    'Tant que la conversion n’est pas refaite, les appels du code final échoueront sur les anciens identifiants.',
  ],
  typeLabel: `Saisissez ${ROLLBACK_CONFIRM_WORD} pour confirmer.`,
  typePlaceholder: ROLLBACK_CONFIRM_WORD,
  lotLine: (id: string) => `Lot concerné : ${id}`,
  cancel: 'Garder la conversion',
  confirm: 'Annuler la conversion',
  doneTitle: 'Conversion annulée',
  summary: (pairs: number, restored: number) =>
    `${pairs} compte${pairs > 1 ? 's' : ''} restauré${pairs > 1 ? 's' : ''}, ${rowsText(restored)} remise${restored > 1 ? 's' : ''} à l’ancien identifiant.`,
  moved: (n: number) => `${rowsText(n)} ${n > 1 ? 'avaient' : 'avait'} changé depuis la conversion : ${n > 1 ? 'elles n’ont' : 'elle n’a'} pas été restaurée${n > 1 ? 's' : ''}.`,
  stillNew: (n: number) =>
    `${rowsText(n)} créée${n > 1 ? 's' : ''} depuis la conversion ${n > 1 ? 'portent' : 'porte'} encore le nouvel identifiant : ${n > 1 ? 'elles ne sont pas restaurées' : 'elle n’est pas restaurée'}.`,
  /** Où se trouvent les lignes restées au nouvel identifiant (libellés de whereLabel, avec leur effectif). */
  stillNewWhere: (n: number, parts: string[]) => `${n > 1 ? 'Elles se trouvent' : 'Elle se trouve'} dans : ${parts.join(', ')}.`,
  failedTitle: 'L’annulation a échoué',
  /** Réponse perdue : on ne sait pas si l'annulation a eu lieu. */
  unknownTitle: 'Résultat inconnu',
  lostAnswer: 'La réponse n’est pas arrivée. L’annulation a peut-être eu lieu : lancez la simulation, puis consultez les conversions précédentes.',
  running: 'Annulation en cours',
  statusLabel: 'État de l’annulation',
} as const;

/** Phrases par code d'erreur du serveur : prioritaires sur le texte du serveur, qui peut être réécrit par le navigateur. */
export const ERROR_BY_CODE: Record<string, string> = {
  admin_only: DENIED.body,
  confirmation_required: `Saisissez ${CONFIRM_WORD} pour confirmer.`,
  rollback_confirmation_required: `Saisissez ${ROLLBACK_CONFIRM_WORD} pour confirmer.`,
  plan_changed: 'La simulation n’est plus à jour : des comptes ont changé. Rien n’a été modifié. Relancez la simulation.',
  key_missing: 'La clé du service de connexion n’est pas configurée.',
  service_unreachable: 'Le service de connexion ne répond pas. Rien n’a été modifié.',
  list_truncated: 'La liste des comptes du service est incomplète. Rien n’a été modifié.',
  unmapped_accounts: 'Des comptes n’ont pas de correspondance dans le service. Cochez la case pour les laisser tels quels, ou reconnectez-les.',
  database_unavailable: 'Les comptes de la base n’ont pas pu être lus. Rien n’a été modifié.',
  not_installed: 'Les fonctions de bascule ne sont pas installées ou pas vérifiables. Rien n’a été modifié.',
  validation: 'Identifiant de lot invalide.',
  batch_unknown: 'Ce lot est introuvable.',
  batch_already_rolled_back: 'Ce lot a déjà été restauré.',
  batch_newer_open: 'Une conversion plus récente n’est pas annulée. Annulez d’abord la plus récente, puis celle-ci.',
  batch_empty: 'Cette conversion n’a réécrit aucune ligne : il n’y a rien à annuler.',
  unknown_action: 'Action inconnue.',
  server: 'L’opération a échoué. Réessayez.',
};

export const GENERIC_ERROR = 'L’opération a échoué. Réessayez dans quelques instants.';
export const UNEXPECTED_ANSWER = 'La réponse du serveur est inattendue. Réessayez.';

/**
 * Texte du serveur montrable : non vide, sans nom de prestataire. Sinon le repli.
 * Les textes des contrôles viennent du serveur (déjà sans prestataire) : ce filtre est un filet.
 */
export function shownText(text: unknown, fallback: string): string {
  if (typeof text !== 'string') return fallback;
  const trimmed = text.trim();
  // Les textes du serveur ont des apostrophes droites : même typographie que la copie de la page.
  return trimmed === '' || mentionsVendor(trimmed) ? fallback : trimmed.replace(/(\p{L})'(\p{L})/gu, '$1’$2');
}

export const SKIPPED_REASON = {
  no_primary_key: 'sans clé primaire',
  unsupported_type: 'type de colonne inattendu',
} as const;

export function skippedReasonLabel(status: unknown): string {
  return typeof status === 'string' && status in SKIPPED_REASON ? SKIPPED_REASON[status as keyof typeof SKIPPED_REASON] : 'colonne non réécrite';
}

/** Phrase d'une erreur : le code d'abord, puis le texte du serveur s'il est montrable. */
export function errorText(code: string | null | undefined, serverText: unknown, fallback = GENERIC_ERROR): string {
  if (code && Object.prototype.hasOwnProperty.call(ERROR_BY_CODE, code)) return ERROR_BY_CODE[code];
  return shownText(serverText, fallback);
}

/** Fin d'un identifiant de compte (quatre derniers caractères), comme la vue masquée du serveur. */
export function shortRef(id: unknown): string {
  return typeof id === 'string' && id !== '' ? `…${id.slice(-4)}` : '…';
}
