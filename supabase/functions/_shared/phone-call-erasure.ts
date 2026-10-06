/**
 * Effacement des appels d'un candidat (RGPD art. 17) : quels numéros peut-on
 * effacer sans toucher à l'appel de quelqu'un d'autre.
 *
 * Fonction pure, sans importation de Deno ni de client : elle est lue par les
 * tests Node (tests/c1/telephonie-rgpd.test.mjs).
 *
 * Un appel se rattache à un candidat par le numéro (phone_calls.contact_number_e164
 * contre candidate_contacts.phone, normalisés). Deux candidats d'une même
 * organisation qui partagent un numéro (standard, numéro de famille) rendent
 * l'appel ambigu : on ne l'efface pas pour l'un, il peut être l'appel de l'autre.
 * Mieux vaut un appel gardé et signalé qu'un appel d'un tiers effacé.
 */
import { toE164 } from './phone.ts';

export interface ContactNumberRow {
  organization_id: string;
  candidate_id: string;
  phone: string | null;
}

export interface ErasedCandidate {
  organization_id: string;
  candidate_id: string;
}

export interface NumberToErase {
  organization_id: string;
  e164: string;
}

export interface ErasurePlan {
  /** Numéros dont les appels peuvent être effacés. */
  erase: NumberToErase[];
  /** Numéros gardés parce qu'un autre candidat de l'organisation les porte aussi. */
  sharedKept: NumberToErase[];
}

/**
 * `contacts` : les coordonnées de TOUTES les organisations concernées (pas
 * seulement celles du candidat), pour reconnaître un numéro partagé.
 */
export function planCallErasure(contacts: ReadonlyArray<ContactNumberRow>, erased: ReadonlyArray<ErasedCandidate>): ErasurePlan {
  const key = (org: string, id: string) => `${org}|${id}`;
  const erasedKeys = new Set(erased.map((e) => key(e.organization_id, e.candidate_id)));

  const wanted = new Map<string, NumberToErase>();
  const sharedWith = new Set<string>();
  for (const row of contacts) {
    const e164 = toE164(row.phone);
    if (!e164) continue;
    const numberKey = `${row.organization_id}|${e164}`;
    if (erasedKeys.has(key(row.organization_id, row.candidate_id))) {
      wanted.set(numberKey, { organization_id: row.organization_id, e164 });
    }
  }
  for (const row of contacts) {
    const e164 = toE164(row.phone);
    if (!e164) continue;
    const numberKey = `${row.organization_id}|${e164}`;
    if (wanted.has(numberKey) && !erasedKeys.has(key(row.organization_id, row.candidate_id))) sharedWith.add(numberKey);
  }

  const erase: NumberToErase[] = [];
  const sharedKept: NumberToErase[] = [];
  for (const [numberKey, number] of wanted) (sharedWith.has(numberKey) ? sharedKept : erase).push(number);
  return { erase, sharedKept };
}

/** Date limite avant laquelle une transcription est supprimée : 6 mois après l'appel. */
export const TRANSCRIPT_RETENTION_MONTHS = 6;
/** Date limite avant laquelle un appel et son analyse sont supprimés : 24 mois après l'appel. */
export const CALL_RETENTION_MONTHS = 24;

/**
 * Il y a `months` mois, un jour de marge en plus. Le jour du mois est ramené au
 * dernier jour du mois d'arrivée (31 août moins 6 mois : le 29 février, pas le
 * 2 mars) : la borne ne tombe jamais en deçà de la durée annoncée, un appel n'est
 * jamais supprimé avant l'heure.
 */
export function retentionCutoff(now: Date, months: number): Date {
  const cutoff = new Date(now);
  const day = cutoff.getUTCDate();
  cutoff.setUTCDate(1);
  cutoff.setUTCMonth(cutoff.getUTCMonth() - months);
  const lastDay = new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + 1, 0)).getUTCDate();
  cutoff.setUTCDate(Math.min(day, lastDay) - 1);
  return cutoff;
}
