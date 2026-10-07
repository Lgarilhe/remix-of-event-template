/**
 * Filtres de la liste « Tous les appels » et libellés d'un appel.
 *
 * Fonctions pures, sans importation à l'exécution : lues telles quelles par les
 * tests Node (tests/c1/telephonie-statistiques.test.mjs).
 */
import type { PhoneCall } from './phoneCalls';

export type DirectionFilter = 'all' | 'inbound' | 'outbound';
export type OutcomeFilter = 'all' | 'done' | 'missed' | 'voicemail';
export type MatchedFilter = 'all' | 'attached' | 'unattached';

export interface CallFilters {
  query: string;
  direction: DirectionFilter;
  outcome: OutcomeFilter;
  matched: MatchedFilter;
  /** « all », ou la clé d'un recruteur (identifiant du membre, ou « aircall:<nom> »). */
  recruiter: string;
  /** « all », ou une étiquette posée par l'analyse de l'appel (lot A5). */
  tag: string;
}

export const NO_FILTERS: CallFilters = { query: '', direction: 'all', outcome: 'all', matched: 'all', recruiter: 'all', tag: 'all' };

/** Minuscules sans accents : « Valérie » se retrouve en tapant « valerie ». */
export function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

/** +33612345678 → ['33612345678', '0612345678'] : se retrouve en tapant le format international ou français. */
export function numberDigits(e164: string | null | undefined): string[] {
  const digits = (e164 ?? '').replace(/\D/g, '');
  if (!digits) return [];
  return digits.startsWith('33') && digits.length === 11 ? [digits, `0${digits.slice(2)}`] : [digits];
}

export interface FilterContext {
  /** Nom du candidat auquel le numéro est rattaché, par numéro E.164 ; absent : numéro non rattaché. */
  attached: ReadonlyMap<string, { name: string | null }>;
  /** Clé du recruteur d'un appel ; null sans agent. */
  recruiterKey: (call: PhoneCall) => string | null;
  /** Étiquettes d'analyse d'un appel ; absent : aucun appel n'en a. */
  tagsOf?: (call: PhoneCall) => ReadonlyArray<string>;
}

export function filterCalls(calls: ReadonlyArray<PhoneCall>, filters: CallFilters, ctx: FilterContext): PhoneCall[] {
  const q = fold(filters.query);
  const queryDigits = filters.query.replace(/\D/g, '');
  return calls.filter((call) => {
    if (filters.direction !== 'all' && call.direction !== filters.direction) return false;
    if (filters.outcome !== 'all' && call.outcome !== filters.outcome) return false;
    const attached = call.numberE164 ? ctx.attached.get(call.numberE164) : undefined;
    if (filters.matched === 'attached' && !attached) return false;
    if (filters.matched === 'unattached' && attached) return false;
    if (filters.recruiter !== 'all' && ctx.recruiterKey(call) !== filters.recruiter) return false;
    if (filters.tag !== 'all' && !(ctx.tagsOf?.(call) ?? []).includes(filters.tag)) return false;
    if (!q) return true;
    const text = fold([call.contactName, attached?.name, call.contactNumber].filter(Boolean).join(' '));
    if (text.includes(q)) return true;
    return queryDigits.length >= 3 && numberDigits(call.numberE164).some((d) => d.includes(queryDigits));
  });
}

/** « Reçu », « Émis », « Manqué », « Sans réponse », « Messagerie ». */
export function callStatusLabel(call: Pick<PhoneCall, 'direction' | 'outcome'>): string {
  if (call.outcome === 'voicemail') return 'Messagerie';
  if (call.outcome === 'missed') return call.direction === 'outbound' ? 'Sans réponse' : 'Manqué';
  return call.direction === 'inbound' ? 'Reçu' : 'Émis';
}
