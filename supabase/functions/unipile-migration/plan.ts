/**
 * Plan de bascule des identifiants de compte : rapprochement des comptes de la base
 * (ancien format) avec ceux du service de connexion (acc_...), et règles de refus de
 * l'application.
 *
 * Entrées : les comptes reliés en base (tables member_*_accounts, voir `DbAccount`) et la
 * liste des comptes du service. Un compte de la base est :
 *  - `already_v2` : son identifiant a déjà le nouveau format ;
 *  - `mappable` : retrouvé par `metadata.v1_account_id` du compte du service, ou, pour une
 *    messagerie seulement, par son adresse e-mail ;
 *  - `unmapped` : aucune correspondance sûre (absent du service, revendiqué par deux comptes,
 *    fournisseur différent du type attendu). Jamais de deviner : un compte sans correspondance
 *    reste à reconnecter.
 *
 * Module pur : aucun réseau ni base. Les libellés rendus sont masqués (masking.ts).
 */

import { buildAccountMap, isV2AccountId, normalizeEmail } from '../_shared/unipile/index.ts';
import { idRef, maskLabel } from './masking.ts';

export type AccountKind = 'linkedin' | 'email' | 'whatsapp';
export const ACCOUNT_KINDS: readonly AccountKind[] = ['linkedin', 'email', 'whatsapp'];

/** Un compte relié en base (une ligne distincte par identifiant, tous organismes confondus). */
export interface DbAccount {
  kind: AccountKind;
  /** Identifiant tel que stocké. */
  storedId: string;
  /** Libellé brut (adresse, nom, numéro) : toujours masqué avant d'être rendu. */
  label: string | null;
  /** Adresse de la messagerie, pour le rapprochement des comptes e-mail. */
  email: string | null;
}

export type PlanStatus = 'already_v2' | 'mappable' | 'unmapped';
export type MapVia = 'v1_account_id' | 'email';
export type UnmappedReason = 'not_in_service' | 'ambiguous' | 'provider_mismatch';

export interface PlanItem {
  kind: AccountKind;
  oldId: string;
  newId: string | null;
  status: PlanStatus;
  via?: MapVia;
  reason?: UnmappedReason;
  /** Libellé masqué, jamais une adresse entière. */
  maskedLabel: string | null;
  /** Fin de l'ancien identifiant, pour distinguer deux libellés identiques. */
  ref: string;
}

export interface KindCounts {
  total: number;
  already_v2: number;
  via_v1_account_id: number;
  via_email: number;
  unmapped: number;
}

export interface Plan {
  items: PlanItem[];
  counts: Record<AccountKind | 'all', KindCounts>;
  /** Comptes du service examinés. */
  serviceAccounts: number;
  /** Nouveaux identifiants visés par plus d'un ancien identifiant (messagerie et agenda d'un même compte, ou doublon). */
  sharedTargets: number;
}

const KIND_RANK: Record<AccountKind, number> = { linkedin: 0, whatsapp: 1, email: 2 };

const EMAIL_PROVIDERS = new Set(['google', 'outlook', 'imap']);

/** Le fournisseur du compte du service correspond-il au type attendu ? */
export function providerMatchesKind(kind: AccountKind, provider: unknown): boolean {
  if (typeof provider !== 'string') return false;
  if (kind === 'linkedin') return provider === 'linkedin';
  if (kind === 'whatsapp') return provider === 'whatsapp';
  return EMAIL_PROVIDERS.has(provider);
}

function emptyCounts(): KindCounts {
  return { total: 0, already_v2: 0, via_v1_account_id: 0, via_email: 0, unmapped: 0 };
}

/**
 * Un compte par identifiant stocké. Un même identifiant lu dans plusieurs tables (messagerie et
 * agenda d'un même compte) donne une ligne ; le type retenu suit l'ordre linkedin, whatsapp,
 * messagerie, le libellé et l'adresse sont les premiers non vides.
 */
export function dedupeDbAccounts(accounts: readonly DbAccount[]): DbAccount[] {
  const byId = new Map<string, DbAccount>();
  for (const raw of accounts) {
    if (!raw || typeof raw.storedId !== 'string') continue;
    const storedId = raw.storedId.trim();
    if (storedId === '' || !ACCOUNT_KINDS.includes(raw.kind)) continue;
    const known = byId.get(storedId);
    if (!known) {
      byId.set(storedId, { kind: raw.kind, storedId, label: raw.label ?? null, email: normalizeEmail(raw.email) });
      continue;
    }
    if (KIND_RANK[raw.kind] < KIND_RANK[known.kind]) known.kind = raw.kind;
    if (!known.label && raw.label) known.label = raw.label;
    if (!known.email) known.email = normalizeEmail(raw.email);
  }
  return [...byId.values()];
}

/** Rapproche les comptes de la base de la liste des comptes du service. */
export function buildPlan(dbAccounts: readonly DbAccount[], serviceAccounts: readonly unknown[]): Plan {
  const map = buildAccountMap(serviceAccounts);
  const providerById = new Map<string, unknown>();
  for (const raw of serviceAccounts) {
    if (raw && typeof raw === 'object') {
      const account = raw as { id?: unknown; provider?: unknown };
      if (isV2AccountId(account.id)) providerById.set(account.id, account.provider);
    }
  }

  const items: PlanItem[] = [];
  for (const account of dedupeDbAccounts(dbAccounts)) {
    const base = {
      kind: account.kind,
      oldId: account.storedId,
      maskedLabel: maskLabel(account.email ?? account.label),
      ref: idRef(account.storedId),
    };
    if (isV2AccountId(account.storedId)) {
      items.push({ ...base, newId: account.storedId, status: 'already_v2' });
      continue;
    }
    let newId: string | null = null;
    let via: MapVia | undefined;
    let reason: UnmappedReason = 'not_in_service';
    const byV1 = map.byV1Id.get(account.storedId);
    if (byV1) {
      newId = byV1;
      via = 'v1_account_id';
    } else if (map.ambiguousV1Ids.has(account.storedId)) {
      reason = 'ambiguous';
    } else if (account.kind === 'email' && account.email) {
      if (map.ambiguousEmails.has(account.email)) reason = 'ambiguous';
      else {
        const byEmail = map.byEmail.get(account.email);
        if (byEmail) {
          newId = byEmail;
          via = 'email';
        }
      }
    }
    if (newId && !providerMatchesKind(account.kind, providerById.get(newId))) {
      newId = null;
      via = undefined;
      reason = 'provider_mismatch';
    }
    if (newId && via) items.push({ ...base, newId, status: 'mappable', via });
    else items.push({ ...base, newId: null, status: 'unmapped', reason });
  }

  const counts: Plan['counts'] = { all: emptyCounts(), linkedin: emptyCounts(), email: emptyCounts(), whatsapp: emptyCounts() };
  const targets = new Map<string, Set<string>>();
  for (const item of items) {
    for (const bucket of [counts.all, counts[item.kind]]) {
      bucket.total++;
      if (item.status === 'already_v2') bucket.already_v2++;
      else if (item.status === 'unmapped') bucket.unmapped++;
      else if (item.via === 'email') bucket.via_email++;
      else bucket.via_v1_account_id++;
    }
    if (item.status === 'mappable' && item.newId) {
      const set = targets.get(item.newId) ?? new Set<string>();
      set.add(item.oldId);
      targets.set(item.newId, set);
    }
  }
  const sharedTargets = [...targets.values()].filter((set) => set.size > 1).length;
  return { items, counts, serviceAccounts: serviceAccounts.length, sharedTargets };
}

/** Comptes à basculer : ceux qui ont une correspondance et un ancien format. */
export function mappableItems(plan: Plan): PlanItem[] {
  return plan.items.filter((item) => item.status === 'mappable' && item.newId !== null);
}

export function unmappedItems(plan: Plan): PlanItem[] {
  return plan.items.filter((item) => item.status === 'unmapped');
}

/** Phrase de bilan du rapprochement, sans identifiant ni libellé. */
export function summarizePlan(plan: Plan): string {
  const c = plan.counts.all;
  if (c.total === 0) return 'Aucun compte relié en base.';
  const parts = [
    `${c.total} compte${c.total > 1 ? 's' : ''} en base`,
    `${c.already_v2} déjà au nouveau format`,
    `${c.via_v1_account_id} retrouvé${c.via_v1_account_id > 1 ? 's' : ''} par leur ancien identifiant`,
    `${c.via_email} retrouvé${c.via_email > 1 ? 's' : ''} par leur adresse`,
    `${c.unmapped} sans correspondance`,
  ];
  return `${parts.join(', ')}.`;
}

// ---------------------------------------------------------------------------
// Règles de refus de l'application
// ---------------------------------------------------------------------------

export const CONFIRM_WORD = 'BASCULER';
/** Mot à saisir pour annuler un lot : l'annulation remet tous les comptes du lot à l'ancien format. */
export const ROLLBACK_CONFIRM_WORD = 'ANNULER';

/**
 * Empreinte du plan : SHA-256 des comptes à convertir et des comptes laissés tels quels (type, ancien
 * identifiant, nouvel identifiant), triés. La simulation la rend, la conversion la redemande : si les
 * comptes du service ou de la base ont changé entre les deux, l'empreinte diffère et la conversion est
 * refusée. Ne contient aucun identifiant lisible.
 */
export async function planFingerprint(plan: Plan): Promise<string> {
  const lines = plan.items
    .filter((item) => item.status !== 'already_v2')
    .map((item) => `${item.status === 'mappable' ? 'M' : 'U'}|${item.kind}|${item.oldId}|${item.newId ?? ''}`)
    .sort();
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(lines.join('\n')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export type ApplyRefusalCode =
  | 'confirmation_required'
  | 'key_missing'
  | 'service_unreachable'
  | 'list_truncated'
  | 'unmapped_accounts';

export interface ApplyRefusal {
  status: number;
  error_code: ApplyRefusalCode;
  error: string;
}

export interface ApplyPreconditions {
  confirm: unknown;
  allowUnmapped: unknown;
  keyConfigured: boolean;
  serviceReachable: boolean;
  listTruncated: boolean;
  unmappedCount: number;
}

/**
 * Premier refus applicable, dans l'ordre : confirmation exacte, clé configurée, service joignable,
 * liste complète, comptes sans correspondance (sauf `allow_unmapped === true`). `null` quand la
 * bascule peut partir.
 */
export function applyRefusal(input: ApplyPreconditions): ApplyRefusal | null {
  if (input.confirm !== CONFIRM_WORD) {
    return { status: 400, error_code: 'confirmation_required', error: `Saisissez ${CONFIRM_WORD} pour confirmer la bascule.` };
  }
  if (!input.keyConfigured) {
    return { status: 409, error_code: 'key_missing', error: "La clé API du service de connexion n'est pas configurée. La bascule est impossible." };
  }
  if (!input.serviceReachable) {
    return { status: 503, error_code: 'service_unreachable', error: 'Le service de connexion ne répond pas. Aucune bascule n\'est lancée.' };
  }
  if (input.listTruncated) {
    return { status: 409, error_code: 'list_truncated', error: 'La liste des comptes du service est incomplète. Aucune bascule n\'est lancée.' };
  }
  if (input.unmappedCount > 0 && input.allowUnmapped !== true) {
    const n = input.unmappedCount;
    const error = n > 1
      ? `${n} comptes n'ont pas de correspondance dans le service. Reconnectez-les ou acceptez de les laisser tels quels.`
      : "1 compte n'a pas de correspondance dans le service. Reconnectez-le ou acceptez de le laisser tel quel.";
    return { status: 409, error_code: 'unmapped_accounts', error };
  }
  return null;
}
