/**
 * Chiffre d'À traiter et signaux de la barre latérale (§6, D8, D9).
 *
 * Module pur, sans import : chargé tel quel par les tests (tests/ux). Les
 * classements qui vivent ailleurs (isActionable, jours ouvrés) arrivent déjà
 * calculés par les hooks, sauf la fenêtre des plans, recopiée ci-dessous.
 */

// ─── Pastille ────────────────────────────────────────────────────────────────

export const SIDEBAR_BADGE_CAP = 9;

/** Texte de la pastille : « 9+ » au-delà de 9. */
export function badgeLabel(n: number): string {
  return n > SIDEBAR_BADGE_CAP ? `${SIDEBAR_BADGE_CAP}+` : String(n);
}

/** Section Activité ouverte ou fermée (D36) : '1' ou absent. */
export const ACTIVITY_OPEN_STORAGE_KEY = 'konekt:nav:activity-open';

// ─── Réponses de candidats (§4.1, D26) ───────────────────────────────────────

/** Nombre de lignes de réponses affichées au plus, sauf réponses comptées (toutes affichées). */
export const REPLIES_DISPLAY_LIMIT = 8;

export interface ReplyRow {
  id: string;
  title: string;
  link: string | null;
  created_at: string;
  metadata: unknown;
}

export interface ReplyItem {
  /** null quand le groupe est formé sur l'id de la notification (conversation inconnue). */
  chatId: string | null;
  /** Notifications du groupe, pour les marquer lues d'un coup. */
  ids: string[];
  name: string;
  projectId: string | null;
  headline: string | null;
  link: string | null;
  lastAt: string;
  /** Dans les 3 derniers jours ouvrés : compte dans le chiffre (ligne en gras). */
  counted: boolean;
}

export interface GroupedReplies {
  candidates: ReplyItem[];
  /** Conversations hors recrutement (non candidates). */
  others: number;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;

const MESSAGE_PREFIX = 'Nouveau message de ';

const timeOf = (iso: string): number => {
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/**
 * Une ligne par conversation (metadata.chat_id, sinon id de la notification) ;
 * la plus récente du groupe fait foi. Candidat : une ligne au moins porte
 * metadata.is_candidate === true (inscrit à une séquence). Résultat trié du
 * plus récent au plus ancien ; `others` compte les conversations non candidates.
 */
export function groupReplies(rows: readonly ReplyRow[], cutoff: Date): GroupedReplies {
  const groups = new Map<string, { chatId: string | null; rows: ReplyRow[] }>();
  for (const row of rows) {
    const chatId = nonEmptyString(asRecord(row.metadata)?.chat_id);
    const key = chatId ? `chat:${chatId}` : `id:${row.id}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { chatId, rows: [row] });
  }

  const candidates: ReplyItem[] = [];
  let others = 0;
  for (const { chatId, rows: groupRows } of groups.values()) {
    const sorted = [...groupRows].sort((a, b) => timeOf(b.created_at) - timeOf(a.created_at));
    const metas = sorted.map((r) => asRecord(r.metadata));
    if (!metas.some((m) => m?.is_candidate === true)) {
      others += 1;
      continue;
    }
    const latest = sorted[0];
    const pick = (field: string): string | null => {
      for (const m of metas) {
        const v = nonEmptyString(m?.[field]);
        if (v) return v;
      }
      return null;
    };
    const titleName = latest.title.startsWith(MESSAGE_PREFIX)
      ? latest.title.slice(MESSAGE_PREFIX.length).trim()
      : latest.title.trim();
    candidates.push({
      chatId,
      ids: sorted.map((r) => r.id),
      name: pick('profile_name') ?? titleName,
      projectId: pick('project_id'),
      headline: pick('profile_headline'),
      link: latest.link,
      lastAt: latest.created_at,
      counted: timeOf(latest.created_at) >= cutoff.getTime(),
    });
  }
  candidates.sort((a, b) => timeOf(b.lastAt) - timeOf(a.lastAt));
  return { candidates, others };
}

/**
 * Lignes affichées : toutes les réponses comptées (un badge compte ce que sa
 * liste montre), puis les anciennes jusqu'à `limit` lignes au total.
 * Entrée déjà triée par groupReplies.
 */
export function repliesToShow<T extends { counted: boolean }>(candidates: readonly T[], limit = REPLIES_DISPLAY_LIMIT): T[] {
  const countedTotal = candidates.filter((c) => c.counted).length;
  let oldLeft = Math.max(0, limit - countedTotal);
  const shown: T[] = [];
  for (const c of candidates) {
    if (c.counted) shown.push(c);
    else if (oldLeft > 0) {
      shown.push(c);
      oldLeft -= 1;
    }
  }
  return shown;
}

/** Initiales d'un nom (deux lettres au plus), pour la pastille d'une ligne. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0][0] ?? '';
  const last = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : '';
  return `${first}${last}`.toUpperCase();
}

// ─── Chiffre d'À traiter (§6) ────────────────────────────────────────────────

export type SourceState<T> = { status: 'loading' | 'offline' | 'error' | 'ok'; data: T | undefined };

/**
 * count = L + R + V + P (D8) :
 * - L : 1 si la panne LinkedIn est active ;
 * - R : réponses de candidats comptées ;
 * - V : actions proposées + plans (déjà dédoublonnés par deriveAgentSignals) ;
 * - P : notifications « Pour vous » qui demandent une action.
 * Une source sans donnée (chargement, hors ligne, erreur) → null : pas de
 * pastille (D9). Une source en erreur qui garde ses données compte avec elles.
 * Additionne seulement : aucun dédoublonnage ici.
 */
export function todoCount(input: {
  replies: SourceState<{ candidates: Array<{ counted: boolean }> }>;
  signals: SourceState<{ actions: unknown[]; plans: unknown[] }>;
  forYouActionCount: SourceState<number>;
  linkedinOutage: SourceState<boolean>;
}): number | null {
  const { replies, signals, forYouActionCount, linkedinOutage } = input;
  if (
    replies.data === undefined ||
    signals.data === undefined ||
    forYouActionCount.data === undefined ||
    linkedinOutage.data === undefined
  ) {
    return null;
  }
  const l = linkedinOutage.data ? 1 : 0;
  const r = replies.data.candidates.filter((c) => c.counted).length;
  const v = signals.data.actions.length + signals.data.plans.length;
  const p = forYouActionCount.data;
  return l + r + v + p;
}

// ─── Signaux de l'assistant (§4.4, D29, D30) ─────────────────────────────────

/** Un agent qui n'a rien écrit depuis 60 minutes n'est plus « en cours » (D30). */
export const RUNNING_MAX_AGE_MS = 60 * 60_000;

/** Fenêtre des plans : 3 jours ouvrés, comme les actions proposées (D28). */
export const APPROVAL_BUSINESS_DAYS = 3;

// Copie de businessDaysCutoff (src/lib/businessDays.ts) : ce module reste sans
// import. Les tests vérifient que les deux donnent le même résultat.
function cutoffBusinessDays(now: Date, n: number): Date {
  const d = new Date(now.getTime());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() - 1);
    const w = d.getDay();
    if (w !== 0 && w !== 6) left -= 1;
  }
  return d;
}

/**
 * Seul lieu du dédoublonnage plan/action (D29) :
 * - plans : conversations plan_proposed des 3 derniers jours ouvrés, sans
 *   action proposée sur la même conversation ;
 * - running : conversations running mises à jour il y a moins de 60 minutes.
 */
export function deriveAgentSignals<C extends { id: string; status: string; updated_at: string }>(
  convs: readonly C[],
  actions: ReadonlyArray<{ conversation_id: string | null }>,
  now: Date,
): { plans: C[]; running: C[] } {
  const withAction = new Set(actions.map((a) => a.conversation_id).filter((id): id is string => !!id));
  const cutoff = cutoffBusinessDays(now, APPROVAL_BUSINESS_DAYS).getTime();
  const nowMs = now.getTime();
  const plans = convs.filter(
    (c) => c.status === 'plan_proposed' && timeOf(c.updated_at) >= cutoff && !withAction.has(c.id),
  );
  const running = convs.filter(
    (c) => c.status === 'running' && nowMs - timeOf(c.updated_at) < RUNNING_MAX_AGE_MS,
  );
  return { plans, running };
}

// ─── Heures ──────────────────────────────────────────────────────────────────

const pad2 = (n: number) => String(n).padStart(2, '0');

const startOfLocalDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/**
 * Même jour : « HH:MM » ; veille : « hier » ; moins de 7 jours : jour abrégé
 * (« lun. ») ; sinon « 12 sept. ».
 */
export function formatShortTime(iso: string, now: Date): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = Math.round((startOfLocalDay(now) - startOfLocalDay(d)) / 86_400_000);
  if (days === 0) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  if (days === 1) return 'hier';
  if (days > 1 && days < 7) return d.toLocaleDateString('fr-FR', { weekday: 'short' });
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' });
}

/** Sous-titre d'une notification (Pour vous, Activité) : le corps sur une ligne, puis l'heure. */
export function notificationSub(n: { body: string | null; created_at: string }, now: Date): string {
  const time = formatShortTime(n.created_at, now);
  const body = (n.body ?? '').replace(/\s+/g, ' ').trim();
  return body ? `${body} · ${time}` : time;
}

// ─── Entretiens (§4.5, D33) ──────────────────────────────────────────────────

/** Durée supposée d'un entretien sans heure de fin. */
export const DEFAULT_INTERVIEW_MS = 60 * 60_000;

/** « Rejoindre » s'affiche à partir de 15 minutes avant le début. */
export const JOIN_LEAD_MS = 15 * 60_000;

function interviewBounds(row: { event_start_at: string | null; event_end_at: string | null }): { start: number; end: number } | null {
  if (!row.event_start_at) return null;
  const start = new Date(row.event_start_at).getTime();
  if (Number.isNaN(start)) return null;
  const endRaw = row.event_end_at ? new Date(row.event_end_at).getTime() : Number.NaN;
  const end = Number.isNaN(endRaw) ? start + DEFAULT_INTERVIEW_MS : endRaw;
  return { start, end };
}

/** Lien de visio (http ou https) et maintenant entre début moins 15 minutes et la fin. */
export function canJoin(
  row: { event_location: string | null; event_start_at: string | null; event_end_at: string | null },
  now: Date,
): boolean {
  const loc = row.event_location?.trim() ?? '';
  if (!/^https?:\/\//i.test(loc)) return false;
  const b = interviewBounds(row);
  if (!b) return false;
  const t = now.getTime();
  return t >= b.start - JOIN_LEAD_MS && t <= b.end;
}

/**
 * Deux listes disjointes, entretiens non rendus (status différent de
 * 'completed') :
 * - today : début le jour local, fin pas encore passée, par heure croissante ;
 * - debriefs : fin passée, du plus récent au plus ancien.
 */
export function splitInterviews<T extends { event_start_at: string | null; event_end_at: string | null; status: string }>(
  rows: readonly T[],
  now: Date,
): { today: T[]; debriefs: T[] } {
  const t = now.getTime();
  const dayStart = startOfLocalDay(now);
  const dayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  const today: Array<{ row: T; start: number }> = [];
  const debriefs: Array<{ row: T; start: number }> = [];
  for (const row of rows) {
    if (row.status === 'completed') continue;
    const b = interviewBounds(row);
    if (!b) continue;
    if (b.end <= t) debriefs.push({ row, start: b.start });
    else if (b.start >= dayStart && b.start < dayEnd) today.push({ row, start: b.start });
  }
  today.sort((a, b) => a.start - b.start);
  debriefs.sort((a, b) => b.start - a.start);
  return { today: today.map((x) => x.row), debriefs: debriefs.map((x) => x.row) };
}

/** Clé du jour local (AAAA-MM-JJ), pour la clé de cache des entretiens. */
export function localDayKey(now: Date): string {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Vrai si la date ISO tombe le jour local de `now`. */
export function isSameLocalDay(iso: string | null, now: Date): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return startOfLocalDay(d) === startOfLocalDay(now);
}
