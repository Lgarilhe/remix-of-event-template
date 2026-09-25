// Heures d'envoi des séquences (process-sequences) : créneaux calculés dans le
// fuseau de l'expéditeur, sans accès base ni réseau.
//
// Audit séquences 2026-09-25, lot E2.
//  - SEQ-038 : setLocalHour posait l'heure locale sur la date UTC. Résultat :
//    créneau dans le passé (relance partie une minute après le message), jour
//    sauté, créneau un samedi. Les calculs lisent maintenant la date LOCALE et
//    avancent les jours sur le calendrier local.
//  - SEQ-088 : un 429 passager sur un InMail ou un smart_message reportait
//    l'étape au 1er du mois suivant. Le report mensuel est réservé aux erreurs
//    qui citent explicitement les crédits InMail d'un envoi en InMail.
//
//   deno test --no-check supabase/functions/_shared/sequence-schedule-time.test.ts

import { safeTimeZone } from './sequence-engine-rules.ts';

export interface LocalDateTime {
  year: number;
  /** 1 à 12 */
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = dimanche … 6 = samedi */
  weekday: number;
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Date et heure murales de `instant` dans le fuseau (Europe/Paris si invalide). */
export function localDateTime(instant: Date, tz: string | null | undefined): LocalDateTime {
  const zone = safeTimeZone(tz);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone, hourCycle: 'h23', weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: Number(get('hour')) % 24,
    minute: Number(get('minute')),
    weekday: WEEKDAYS[get('weekday')] ?? 0,
  };
}

/** Décalage du fuseau à cet instant (heure murale moins heure UTC), en ms. */
function offsetMs(instantMs: number, zone: string): number {
  const p = localDateTime(new Date(instantMs), zone);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return wall - Math.floor(instantMs / 60_000) * 60_000;
}

/**
 * Instant de la date locale (année, mois 1-12, jour) à h:min dans le fuseau.
 * Le jour peut déborder (32 janvier = 1er février). Deux passes sur le
 * décalage : le résultat reste juste les jours de changement d'heure.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, tz: string | null | undefined): Date {
  const zone = safeTimeZone(tz);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall - offsetMs(wall, zone);
  guess = wall - offsetMs(guess, zone);
  return new Date(guess);
}

/** Même date locale que `instant`, à h:min locales. */
export function atLocalTime(instant: Date, tz: string | null | undefined, hour: number, minute = 0): Date {
  const p = localDateTime(instant, tz);
  return zonedTimeToUtc(p.year, p.month, p.day, hour, minute, tz);
}

/** Date locale de `instant` avancée de `days` jours du calendrier local, à h:min locales. */
export function addLocalDays(instant: Date, tz: string | null | undefined, days: number, hour: number, minute = 0): Date {
  const p = localDateTime(instant, tz);
  return zonedTimeToUtc(p.year, p.month, p.day + days, hour, minute, tz);
}

/** Jour ouvré (lundi à vendredi) et heure locale dans [startHour, endHour[. */
export function isWithinSendingHours(now: Date, tz: string | null | undefined, startHour = 8, endHour = 19): boolean {
  const p = localDateTime(now, tz);
  return p.weekday !== 0 && p.weekday !== 6 && p.hour >= startHour && p.hour < endHour;
}

/** Garde-fou : un créneau recalculé qui ne serait pas dans le futur repart de maintenant + 15 min. */
export const SLOT_GUARD_MS = 15 * 60_000;

/**
 * Prochain créneau d'envoi à partir de `now` : maintenant s'il est dans la
 * plage, sinon le début de plage (plus `jitterMinutes`) du prochain jour ouvré
 * local. Un créneau calculé antérieur ou égal à maintenant n'est jamais rendu.
 */
export function nextSendingSlot(now: Date, tz: string | null | undefined, startHour = 8, endHour = 19, jitterMinutes = 0): Date {
  const compute = (from: Date): { slot: Date; moved: boolean } => {
    let slot = from;
    let moved = false;
    for (let i = 0; i < 8; i++) {
      const p = localDateTime(slot, tz);
      if (p.weekday === 0 || p.weekday === 6 || p.hour >= endHour) {
        slot = addLocalDays(slot, tz, 1, startHour, jitterMinutes);
        moved = true;
        continue;
      }
      if (p.hour < startHour) {
        slot = atLocalTime(slot, tz, startHour, jitterMinutes);
        moved = true;
        continue;
      }
      break;
    }
    return { slot, moved };
  };
  const first = compute(now);
  if (!first.moved || first.slot.getTime() > now.getTime()) return first.slot;
  return compute(new Date(now.getTime() + SLOT_GUARD_MS)).slot;
}

// ─── SEQ-088 : report après un 429 ──────────────────────────────────────────

export type RateLimitDeferral = 'next_monday' | 'next_month' | 'next_business_day';

const INMAIL_CREDITS_RE = /(insufficient|not enough|no remaining|no more|out of|zero)\s+(inmail\s+)?credits?|credits?\s+(are\s+)?(exhausted|depleted)|cr[ée]dits?\s+(inmail\s+)?[ée]puis[ée]s?/i;

/** L'erreur cite explicitement l'épuisement des crédits InMail. */
export function isInMailCreditsError(error: string | null | undefined): boolean {
  const e = (error ?? '').toLowerCase();
  if (!e) return false;
  if (e.includes('inmail_credits_exhausted')) return true;
  return e.includes('inmail') && INMAIL_CREDITS_RE.test(e);
}

/**
 * Report d'une étape refusée par un 429 : invitation au lundi suivant (plafond
 * hebdomadaire), 1er du mois suivant seulement pour un envoi en InMail dont
 * l'erreur cite les crédits InMail, sinon jour ouvré suivant (limite du jour).
 * `sentAsInMail` : mode réellement utilisé par l'envoi (false pour un
 * smart_message parti en message direct).
 */
export function rateLimitDeferral(
  actionType: string,
  opts: { error?: string | null; sentAsInMail?: boolean | null } = {},
): RateLimitDeferral {
  if (actionType === 'connection_request') return 'next_monday';
  const inMailCapable = actionType === 'inmail' || actionType === 'smart_message';
  if (inMailCapable && opts.sentAsInMail !== false && isInMailCreditsError(opts.error)) return 'next_month';
  return 'next_business_day';
}

/** Date du report, à `hour` heure locale (9 h par défaut) dans le fuseau. */
export function rateLimitRetryAt(deferral: RateLimitDeferral, now: Date, tz: string | null | undefined, hour = 9): Date {
  const p = localDateTime(now, tz);
  if (deferral === 'next_monday') {
    const days = ((8 - p.weekday) % 7) || 7;
    return addLocalDays(now, tz, days, hour);
  }
  if (deferral === 'next_month') {
    const year = p.month === 12 ? p.year + 1 : p.year;
    const month = p.month === 12 ? 1 : p.month + 1;
    return zonedTimeToUtc(year, month, 1, hour, 0, tz);
  }
  const days = p.weekday === 5 ? 3 : p.weekday === 6 ? 2 : 1;
  return addLocalDays(now, tz, days, hour);
}
