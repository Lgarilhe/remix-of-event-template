// Refonte mission, lot 5f-2b : onglet « Contactés » du panneau Prise de contact.
// Une ligne par candidat de la mission, rangée dans l'un de quatre groupes :
//   - « A répondu » : inscription répondue (ou arrêtée parce qu'il a répondu
//     ailleurs), ou candidat à l'étape Répondu du Pipeline ;
//   - « Bloqués » : l'envoi ne peut pas repartir sans geste (compte
//     déconnecté, abonnement requis, plafond atteint, échec d'envoi, candidat
//     injoignable, message rédigé par l'IA à relire) ;
//   - « En attente » : en cours, ou en pause voulue (pause manuelle, séquence en pause) ;
//   - « Sans suite » : terminée sans réponse, arrêtée, annulée, non distribuée,
//     ou données effacées.
//
// Module pur, testé sous Node (tests/ux/lot5f2b-contactes.test.mjs) : aucune
// lecture, aucune écriture. Le statut de chaque ligne vient de
// enrollmentStatusLine (une seule règle pour tous les écrans de séquences).

import {
  enrollmentStatusLine,
  type EnrollmentStatusLine,
  type StatusLineContext,
  type StatusLineEnrollment,
} from './enrollmentStatusLine.ts';
import { isGdprErasedEnrollment } from './sequenceErrorMessages.ts';

export type ContactedGroupKey = 'replied' | 'blocked' | 'waiting' | 'closed';

export const CONTACTED_GROUPS: ReadonlyArray<{ key: ContactedGroupKey; label: string }> = [
  { key: 'replied', label: 'A répondu' },
  { key: 'blocked', label: 'Bloqués' },
  { key: 'waiting', label: 'En attente' },
  { key: 'closed', label: 'Sans suite' },
];

/** Inscription d'une séquence de la mission, telle que lue par useMissionContacted. */
export interface ContactedEnrollment extends StatusLineEnrollment {
  id: string;
  sequenceId: string;
  sequenceName: string | null;
  /** État de la séquence : une pause de séquence ne se lève qu'en la réactivant. */
  sequenceActive: boolean | null;
  profileId: string;
  providerId: string | null;
  resolvedProfileId: string | null;
  profileName: string | null;
  profileHeadline: string | null;
  profileUrl: string | null;
  createdBy: string | null;
  accountId: string | null;
  createdAt: string;
}

/** Ligne du Pipeline de la mission (mission_candidate_rows) utile à la liste. */
export interface ContactedRow {
  id: string;
  candidateId: string;
  name: string | null;
  headline: string | null;
  linkedinUrl: string | null;
  pictureUrl: string | null;
  stage: string;
  contactedAt: string | null;
  repliedAt: string | null;
}

export interface ContactedEntry {
  /** Identifiant stable : l'inscription retenue, sinon la ligne du Pipeline. */
  key: string;
  group: ContactedGroupKey;
  name: string;
  headline: string | null;
  /** Identifiant du profil (copie privée de la photo, PersonAvatar). */
  candidateId: string | null;
  pictureUrl: string | null;
  /** Ligne du Pipeline, pour ouvrir la fiche ; null si le candidat n'y est pas. */
  rowId: string | null;
  profileUrl: string | null;
  enrollment: ContactedEnrollment | null;
  /** Statut de l'inscription retenue ; null pour un candidat contacté hors séquence. */
  line: EnrollmentStatusLine | null;
  /** « Contacté hors séquence le 02/10 » ; null quand il y a une inscription. */
  manualLabel: string | null;
  /** Instant du dernier fait connu (tri dans le groupe, du plus récent au plus ancien). */
  activityAt: number;
}

export interface ContactedGroupView {
  key: ContactedGroupKey;
  label: string;
  entries: ContactedEntry[];
}

export interface ContactedView {
  entries: ContactedEntry[];
  groups: ContactedGroupView[];
  counts: Record<ContactedGroupKey, number>;
  total: number;
}

export interface ContactedContext {
  now?: Date;
  memberName?: StatusLineContext['memberName'];
  /** Propriétaire ou administrateur : « Réactiver la séquence » lui est proposé. */
  canManageSequence?: boolean;
  /** Compte LinkedIn relié à la personne connectée : « Reconnecter le compte » lui est proposé. */
  myAccountId?: string | null;
}

// ─── Identité d'un candidat ────────────────────────────────────────────────

/** « https://www.linkedin.com/in/marc-moreau-1a2b/ » → « in:marc-moreau-1a2b ». */
function slugKey(url: string | null | undefined): string | null {
  const m = /linkedin\.com\/in\/([^/?#\s]+)/i.exec(url ?? '');
  if (!m) return null;
  let slug = m[1];
  try {
    slug = decodeURIComponent(slug);
  } catch {
    // Adresse mal encodée : le texte brut sert de clé.
  }
  return `in:${slug.toLowerCase()}`;
}

const idKey = (value: string | null | undefined): string | null => (value ? `id:${value}` : null);

/** Clés qui rapprochent une inscription et une ligne du Pipeline : identifiants du profil et adresse. */
function enrollmentKeys(e: ContactedEnrollment): string[] {
  return [idKey(e.profileId), idKey(e.providerId), idKey(e.resolvedProfileId), slugKey(e.profileUrl)].filter((k): k is string => !!k);
}

function rowKeys(r: ContactedRow): string[] {
  return [idKey(r.candidateId), slugKey(r.linkedinUrl)].filter((k): k is string => !!k);
}

const time = (iso: string | null | undefined): number => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : 0;
};

// ─── Groupe d'une ligne ────────────────────────────────────────────────────

/** Pauses qui demandent un geste (hors échecs d'envoi, que la puce « En échec » range déjà). */
const BLOCKING_PAUSES: ReadonlySet<string> = new Set([
  'account_disconnected',
  'subscription_required',
  'quota_reached',
  'blocked_by_candidate',
]);

/**
 * Groupe d'une ligne. L'effacement RGPD ferme toujours : plus rien n'est à
 * faire. Une réponse prime ensuite sur tout le reste, y compris sur une
 * inscription restée active.
 */
export function contactedGroupOf(
  enrollment: Pick<ContactedEnrollment, 'status' | 'pause_reason' | 'tracking_data' | 'executions'> | null,
  line: EnrollmentStatusLine | null,
  pipelineReplied: boolean,
): ContactedGroupKey {
  if (enrollment && isGdprErasedEnrollment(asRecord(enrollment.tracking_data)?.gdpr_erased_at, enrollment.executions)) return 'closed';
  if (pipelineReplied || line?.chip === 'a-repondu' || line?.action?.kind === 'conversation') return 'replied';
  if (!enrollment || !line) return 'waiting';
  if (line.chip === 'en-echec' || line.action?.kind === 'review') return 'blocked';
  if (enrollment.status === 'paused' && BLOCKING_PAUSES.has(enrollment.pause_reason ?? '')) return 'blocked';
  if (line.chip === 'terminees') return 'closed';
  return 'waiting';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

const pad = (n: number) => String(n).padStart(2, '0');
const dayMonth = (iso: string) => {
  const d = new Date(iso);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

// ─── Construction de la liste ──────────────────────────────────────────────

/** Instant du dernier fait connu d'une inscription, selon son groupe. */
function enrollmentActivity(e: ContactedEnrollment, group: ContactedGroupKey): number {
  if (group === 'replied') return Math.max(time(e.replied_at), time(e.updated_at), time(e.createdAt));
  if (group === 'closed') return Math.max(time(e.completed_at), time(e.updated_at), time(e.createdAt));
  if (group === 'blocked') return Math.max(time(e.updated_at), time(e.createdAt));
  return time(e.createdAt);
}

/**
 * Inscription qui représente un candidat dans plusieurs séquences : la réponse
 * la plus récente s'il y en a une (c'est le fait qui compte), sinon la dernière
 * inscription de la mission.
 */
function representative(group: ContactedEnrollment[]): ContactedEnrollment {
  const byRecent = [...group].sort((a, b) => time(b.createdAt) - time(a.createdAt) || b.id.localeCompare(a.id));
  const replied = byRecent.filter((e) => e.status === 'replied').sort((a, b) => time(b.replied_at) - time(a.replied_at));
  return replied[0] ?? byRecent[0];
}

/**
 * Candidats contactés d'une mission : une ligne par candidat (la dernière
 * inscription, ou la réponse), plus les candidats que le Pipeline range en
 * Contacté ou Répondu sans inscription (message écrit à la main). Les
 * inscriptions du même candidat sous plusieurs identifiants (profil, fournisseur,
 * profil résolu, adresse) sont réunies.
 */
export function buildContacted(
  enrollments: readonly ContactedEnrollment[],
  rows: readonly ContactedRow[],
  ctx: ContactedContext = {},
): ContactedView {
  // Réunion des inscriptions par clé d'identité (union-find sur les indices).
  const parent = enrollments.map((_, i) => i);
  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    for (let node = i; parent[node] !== root;) {
      const next = parent[node];
      parent[node] = root;
      node = next;
    }
    return root;
  };
  const owner = new Map<string, number>();
  enrollments.forEach((e, i) => {
    for (const key of enrollmentKeys(e)) {
      const seen = owner.get(key);
      if (seen === undefined) owner.set(key, i);
      else parent[find(i)] = find(seen);
    }
  });
  const groups = new Map<number, ContactedEnrollment[]>();
  enrollments.forEach((e, i) => {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(e);
    else groups.set(root, [e]);
  });

  // Ligne du Pipeline de chaque candidat inscrit (par n'importe quelle clé du groupe).
  const rowByKey = new Map<string, ContactedRow>();
  for (const row of rows) for (const key of rowKeys(row)) if (!rowByKey.has(key)) rowByKey.set(key, row);
  const usedRows = new Set<string>();

  const now = ctx.now ?? new Date();
  const entries: ContactedEntry[] = [];

  for (const members of groups.values()) {
    const chosen = representative(members);
    const keys = new Set(members.flatMap(enrollmentKeys));
    let row: ContactedRow | null = null;
    for (const key of keys) {
      const found = rowByKey.get(key);
      if (found) {
        row = found;
        break;
      }
    }
    if (row) usedRows.add(row.id);

    const line = enrollmentStatusLine(chosen, {
      now,
      memberName: ctx.memberName,
      sequenceActive: chosen.sequenceActive,
      canManageSequence: ctx.canManageSequence,
      isAccountHolder: !!ctx.myAccountId && chosen.accountId === ctx.myAccountId,
    });
    const group = contactedGroupOf(chosen, line, row?.stage === 'replied');
    const erased = isGdprErasedEnrollment(asRecord(chosen.tracking_data)?.gdpr_erased_at, chosen.executions);
    entries.push({
      key: chosen.id,
      group,
      name: erased ? 'Profil effacé' : row?.name || chosen.profileName || 'Candidat sans nom',
      headline: erased ? null : row?.headline || chosen.profileHeadline || null,
      candidateId: erased ? null : row?.candidateId ?? chosen.profileId,
      pictureUrl: erased ? null : row?.pictureUrl ?? null,
      rowId: row?.id ?? null,
      profileUrl: erased ? null : chosen.profileUrl ?? row?.linkedinUrl ?? null,
      enrollment: chosen,
      line,
      manualLabel: null,
      activityAt: Math.max(enrollmentActivity(chosen, group), group === 'replied' ? time(row?.repliedAt) : 0),
    });
  }

  // Contactés ou répondus sans inscription : le message a été écrit hors d'une séquence.
  for (const row of rows) {
    if (usedRows.has(row.id)) continue;
    if (row.stage !== 'contacted' && row.stage !== 'replied') continue;
    // Une même ligne peut avoir été rapprochée par une seconde clé : vérifiée ci-dessus par id.
    const replied = row.stage === 'replied';
    const at = replied ? row.repliedAt ?? row.contactedAt : row.contactedAt;
    entries.push({
      key: `row:${row.id}`,
      group: replied ? 'replied' : 'waiting',
      name: row.name || 'Candidat sans nom',
      headline: row.headline,
      candidateId: row.candidateId,
      pictureUrl: row.pictureUrl,
      rowId: row.id,
      profileUrl: row.linkedinUrl,
      enrollment: null,
      line: null,
      manualLabel: replied
        ? `A répondu${at ? ` le ${dayMonth(at)}` : ''}, hors séquence`
        : `Contacté hors séquence${at ? ` le ${dayMonth(at)}` : ''}`,
      activityAt: time(at),
    });
  }

  const counts: Record<ContactedGroupKey, number> = { replied: 0, blocked: 0, waiting: 0, closed: 0 };
  for (const entry of entries) counts[entry.group] += 1;
  const byActivity = (a: ContactedEntry, b: ContactedEntry) => b.activityAt - a.activityAt || a.key.localeCompare(b.key);
  return {
    entries,
    groups: CONTACTED_GROUPS.map(({ key, label }) => ({
      key,
      label,
      entries: entries.filter((entry) => entry.group === key).sort(byActivity),
    })),
    counts,
    total: entries.length,
  };
}

const repliesText = (n: number) => (n === 1 ? '1 réponse' : `${n} réponses`);
const blockedText = (n: number) => (n === 1 ? '1 bloqué' : `${n} bloqués`);

export interface ContactBadge {
  /** Texte visible de la pastille : les réponses d'abord, sinon les bloqués. */
  text: string;
  tone: 'brand' | 'warning';
  /** Lecture complète pour les lecteurs d'écran (réponses et bloqués ensemble). */
  description: string;
}

/**
 * Pastille du bouton « Prise de contact » : « 2 réponses » (réponses non
 * traitées sur votre compte LinkedIn, get_mission_attention), sinon « 1 bloqué »
 * (groupe Bloqués de l'onglet Contactés). Jamais de zéro : null quand il n'y a
 * rien, ou quand aucune des deux lectures n'a encore abouti (nombre inconnu).
 */
export function contactBadge(replies: number | null | undefined, blocked: number | null | undefined): ContactBadge | null {
  const r = typeof replies === 'number' && Number.isFinite(replies) && replies > 0 ? Math.floor(replies) : 0;
  const b = typeof blocked === 'number' && Number.isFinite(blocked) && blocked > 0 ? Math.floor(blocked) : 0;
  if (r === 0 && b === 0) return null;
  const description = [r > 0 ? repliesText(r) : null, b > 0 ? blockedText(b) : null].filter(Boolean).join(', ');
  return r > 0
    ? { text: repliesText(r), tone: 'brand', description }
    : { text: blockedText(b), tone: 'warning', description };
}
