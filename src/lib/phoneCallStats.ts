/**
 * Statistiques des appels : tout se calcule ici, à partir des appels déjà lus
 * (table phone_calls), sans requête ni migration.
 *
 * Fonctions pures, sans importation à l'exécution : lues telles quelles par les
 * tests Node (tests/c1/telephonie-statistiques.test.mjs). Les jours et les
 * heures se comptent à l'heure de Paris, jamais à celle du serveur ou du
 * navigateur.
 *
 * Définitions (à garder alignées avec les libellés de l'écran) :
 *   - décroché : l'appel a eu une conversation (outcome « done ») ;
 *   - manqué : personne n'a décroché (« missed »), reçu ou émis ;
 *   - messagerie : un message vocal a été laissé (« voicemail »), compté à part ;
 *   - taux de réponse : appels reçus décrochés / appels reçus ;
 *   - taux de joignabilité : appels émis décrochés par le correspondant / appels émis.
 * Un taux sans appel à diviser vaut null : l'écran n'affiche pas de zéro inventé.
 */
import type { PhoneCall } from './phoneCalls';

export const PARIS = 'Europe/Paris';

/** « 2026-10-06 » : le jour calendaire, à Paris. */
export function dayKey(iso: string, timeZone: string = PARIS): string {
  return new Date(iso).toLocaleDateString('sv-SE', { timeZone });
}

/** 0 à 23 : l'heure, à Paris. */
export function hourOf(iso: string, timeZone: string = PARIS): number {
  const h = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso));
  return Number(h);
}

export interface DayBucket {
  day: string;
  answered: number;
  missed: number;
  voicemail: number;
  total: number;
}

export interface HourBucket {
  hour: number;
  outbound: number;
  reached: number;
}

export interface CallStats {
  total: number;
  inbound: number;
  outbound: number;
  answered: number;
  missed: number;
  voicemail: number;
  /** Appels reçus décrochés / appels reçus (0 à 1), null sans appel reçu. */
  answerRate: number | null;
  /** Appels émis décrochés / appels émis (0 à 1), null sans appel émis. */
  reachRate: number | null;
  talkSeconds: number;
  /** Durée moyenne d'une conversation, null sans appel décroché. */
  avgTalkSeconds: number | null;
  perDay: DayBucket[];
  perHour: HourBucket[];
}

const toTime = (iso: string | null): number | null => {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
};

/** Les jours « AAAA-MM-JJ » de `days` jours se terminant au jour de `now`, du plus ancien au plus récent. */
export function lastDays(days: number, now: Date, timeZone: string = PARIS): string[] {
  const out: string[] = [];
  // Midi UTC évite tout saut d'heure d'été en remontant jour par jour.
  const base = Date.parse(`${dayKey(now.toISOString(), timeZone)}T12:00:00Z`);
  for (let i = days - 1; i >= 0; i -= 1) {
    out.push(new Date(base - i * 24 * 3600 * 1000).toISOString().slice(0, 10));
  }
  return out;
}

export function computeStats(calls: ReadonlyArray<PhoneCall>, input: { days: number; now?: Date; timeZone?: string }): CallStats {
  const timeZone = input.timeZone ?? PARIS;
  const now = input.now ?? new Date();
  const dayList = lastDays(input.days, now, timeZone);
  const inPeriod = new Set(dayList);
  const buckets = new Map<string, DayBucket>(dayList.map((day) => [day, { day, answered: 0, missed: 0, voicemail: 0, total: 0 }]));
  const hours: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({ hour, outbound: 0, reached: 0 }));

  const stats: CallStats = {
    total: 0, inbound: 0, outbound: 0, answered: 0, missed: 0, voicemail: 0,
    answerRate: null, reachRate: null, talkSeconds: 0, avgTalkSeconds: null,
    perDay: [], perHour: hours,
  };
  let inboundAnswered = 0;
  let outboundAnswered = 0;

  for (const call of calls) {
    if (!call.startedAt || toTime(call.startedAt) === null) continue;
    const day = dayKey(call.startedAt, timeZone);
    if (!inPeriod.has(day)) continue;
    stats.total += 1;
    const bucket = buckets.get(day)!;
    bucket.total += 1;
    if (call.outcome === 'done') { stats.answered += 1; bucket.answered += 1; }
    else if (call.outcome === 'voicemail') { stats.voicemail += 1; bucket.voicemail += 1; }
    else { stats.missed += 1; bucket.missed += 1; }
    if (call.direction === 'inbound') {
      stats.inbound += 1;
      if (call.outcome === 'done') inboundAnswered += 1;
    } else if (call.direction === 'outbound') {
      stats.outbound += 1;
      const h = hours[hourOf(call.startedAt, timeZone)];
      h.outbound += 1;
      if (call.outcome === 'done') { outboundAnswered += 1; h.reached += 1; }
    }
    if (call.outcome === 'done') stats.talkSeconds += Math.max(0, call.talkSeconds);
  }

  stats.answerRate = stats.inbound > 0 ? inboundAnswered / stats.inbound : null;
  stats.reachRate = stats.outbound > 0 ? outboundAnswered / stats.outbound : null;
  stats.avgTalkSeconds = stats.answered > 0 ? Math.round(stats.talkSeconds / stats.answered) : null;
  stats.perDay = dayList.map((day) => buckets.get(day)!);
  return stats;
}

/**
 * Les créneaux où les appels émis sont le plus souvent décrochés : au moins
 * `minCalls` appels sur l'heure pour qu'un taux veuille dire quelque chose, et
 * au moins un décroché (« 0 % » n'est pas un bon créneau). Du meilleur taux au
 * moins bon, puis du plus fourni au moins fourni.
 */
export function bestHours(perHour: ReadonlyArray<HourBucket>, minCalls = 3, limit = 3): Array<{ hour: number; rate: number; calls: number }> {
  return perHour
    .filter((h) => h.outbound >= minCalls && h.reached > 0)
    .map((h) => ({ hour: h.hour, rate: h.reached / h.outbound, calls: h.outbound }))
    .sort((a, b) => b.rate - a.rate || b.calls - a.calls || a.hour - b.hour)
    .slice(0, limit);
}

export interface RecruiterStatsRow {
  /** Identifiant du membre, ou « aircall:<nom> » pour un agent hors équipe, ou « none » sans agent. */
  key: string;
  name: string;
  isMember: boolean;
  calls: number;
  answered: number;
  outbound: number;
  inbound: number;
  talkSeconds: number;
  avgTalkSeconds: number | null;
}

type Resolve = (email: string | null | undefined, name: string | null | undefined) => { userId: string | null; name: string; isMember: boolean } | null;

/** Les chiffres par recruteur, du plus d'appels au moins d'appels. Les appels sans agent n'y figurent pas. */
export function statsByRecruiter(calls: ReadonlyArray<PhoneCall>, resolve: Resolve): RecruiterStatsRow[] {
  const rows = new Map<string, RecruiterStatsRow>();
  for (const call of calls) {
    const recruiter = resolve(call.agentEmail, call.agentName);
    if (!recruiter) continue;
    const key = recruiter.userId ?? `aircall:${recruiter.name}`;
    let row = rows.get(key);
    if (!row) {
      row = { key, name: recruiter.name, isMember: recruiter.isMember, calls: 0, answered: 0, outbound: 0, inbound: 0, talkSeconds: 0, avgTalkSeconds: null };
      rows.set(key, row);
    }
    row.calls += 1;
    if (call.direction === 'outbound') row.outbound += 1;
    if (call.direction === 'inbound') row.inbound += 1;
    if (call.outcome === 'done') {
      row.answered += 1;
      row.talkSeconds += Math.max(0, call.talkSeconds);
    }
  }
  for (const row of rows.values()) row.avgTalkSeconds = row.answered > 0 ? Math.round(row.talkSeconds / row.answered) : null;
  return [...rows.values()].sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name, 'fr'));
}

export interface MissedToCallBack {
  numberE164: string;
  contactName: string | null;
  missedCount: number;
  lastMissedAt: string;
}

/**
 * Les appels reçus manqués qui attendent un rappel : un numéro dont le dernier
 * appel manqué date de moins de `withinDays` jours et qui n'a reçu AUCUN appel
 * émis depuis (une tentative suffit, décrochée ou non). Les numéros masqués
 * n'y sont pas : il n'y a rien à rappeler. Le plus récent d'abord.
 */
export function missedToCallBack(calls: ReadonlyArray<PhoneCall>, input: { withinDays?: number; now?: Date } = {}): MissedToCallBack[] {
  const now = (input.now ?? new Date()).getTime();
  const since = now - (input.withinDays ?? 7) * 24 * 3600 * 1000;
  const lastOutbound = new Map<string, number>();
  for (const call of calls) {
    if (call.direction !== 'outbound' || !call.numberE164) continue;
    const t = toTime(call.startedAt);
    if (t === null) continue;
    if (t > (lastOutbound.get(call.numberE164) ?? Number.NEGATIVE_INFINITY)) lastOutbound.set(call.numberE164, t);
  }
  const byNumber = new Map<string, MissedToCallBack & { t: number }>();
  for (const call of calls) {
    if (call.direction !== 'inbound' || call.outcome !== 'missed' || !call.numberE164 || !call.startedAt) continue;
    const t = toTime(call.startedAt);
    if (t === null || t < since || t > now) continue;
    const row = byNumber.get(call.numberE164);
    if (!row) {
      byNumber.set(call.numberE164, { numberE164: call.numberE164, contactName: call.contactName, missedCount: 1, lastMissedAt: call.startedAt, t });
    } else {
      row.missedCount += 1;
      row.contactName = row.contactName ?? call.contactName;
      if (t > row.t) { row.t = t; row.lastMissedAt = call.startedAt; }
    }
  }
  return [...byNumber.values()]
    .filter((row) => (lastOutbound.get(row.numberE164) ?? Number.NEGATIVE_INFINITY) <= row.t)
    .sort((a, b) => b.t - a.t)
    .map(({ t: _t, ...row }) => row);
}

/** 372 → « 6 min 12 s », 45 → « 45 s », 3720 → « 1 h 02 », 0 → « 0 s ». */
export function formatTalkTime(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min${s % 60 > 0 ? ` ${String(s % 60).padStart(2, '0')} s` : ''}`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
}

/** 0.4286 → « 43 % ». null reste null : l'écran n'invente pas de pourcentage. */
export function formatPercent(rate: number | null): string | null {
  return rate === null ? null : `${Math.round(rate * 100)} %`;
}
