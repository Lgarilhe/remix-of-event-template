/**
 * Appels et lectures de la page « Bascule de la connexion », sans React.
 *
 * Tout passe par la fonction `unipile-migration` (réservée aux administrateurs de la plateforme) :
 * `access`, `readiness`, `remap_preview`, `remap_apply`, `remap_rollback`.
 *
 * Règles
 * - L'appel est injecté (`invokeEdgeFunction` en production) : le module se teste sans réseau.
 * - Un refus 403 (`admin_only`) est un résultat, `denied`, jamais une erreur affichée en toast.
 * - Une réponse de forme inconnue est un échec, jamais un résultat vide.
 * - Les textes montrés viennent de basculeCopy.ts (par code d'erreur d'abord, texte du serveur
 *   seulement s'il ne nomme pas de prestataire).
 * - `remap_apply` rend 200 même en échec partiel : un `batch_id` fait foi, pas `success`.
 * - Une erreur 5xx sans code métier (passerelle, délai, arrêt du serveur) est un résultat inconnu comme
 *   une réponse perdue : la conversion ou l'annulation a pu avoir lieu avant l'erreur.
 */

import { errorText, ROLLBACK_CONFIRM_WORD, shownText, UNEXPECTED_ANSWER, type CheckStatus } from './basculeCopy';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InvokeError {
  message: string;
  status?: number;
  code?: string;
}

/** Forme de `invokeEdgeFunction('unipile-migration', body)`. */
export type MigrationInvoke = (
  body: Record<string, unknown>,
) => Promise<{ data: Record<string, any> | null; error: InvokeError | null }>;

export type Failure = {
  ok: false;
  denied: boolean;
  /** Phrase montrable. */
  message: string;
  code: string | null;
  /** Vrai quand la réponse n'est jamais arrivée (réseau, délai, erreur de passerelle) : l'état réel est inconnu. */
  lost: boolean;
};
export type Outcome<T> = ({ ok: true } & T) | Failure;

/** Garde de type : le projet compile sans strictNullChecks, où `outcome.ok` ne départage pas l'union. */
export const isFailure = (outcome: { ok: boolean }): outcome is Failure => outcome.ok === false;

export interface ReadinessCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  unmapped: UnmappedRow[];
  unmappedTruncated: boolean;
}

export interface Readiness {
  checks: ReadinessCheck[];
  summary: { ok: number; warn: number; ko: number; ready: boolean };
  generatedAt: string | null;
}

export interface UnmappedRow {
  kind: string;
  label: string | null;
  ref: string;
  reason: string;
}

export interface KindCounts {
  total: number;
  already_v2: number;
  via_v1_account_id: number;
  via_email: number;
  unmapped: number;
}

export interface PreviewPair {
  kind: string;
  label: string | null;
  ref: string;
  via: string;
  totalRows: number;
  usageError: boolean;
  notes: string[];
}

/** Ancien identifiant présent dans la base sans compte relié : table, colonne, fin de l'identifiant, lignes. */
export interface OrphanRow {
  table: string;
  column: string;
  ref: string;
  rows: number;
}

export interface BatchRow {
  batchId: string;
  pairs: number;
  appliedAt: string | null;
  rolledBack: boolean;
}

export interface Preview {
  counts: Record<'all' | 'linkedin' | 'email' | 'whatsapp', KindCounts>;
  pairs: PreviewPair[];
  unmapped: UnmappedRow[];
  unmappedTruncated: boolean;
  truncated: boolean;
  sharedTargets: number;
  batches: BatchRow[];
  batchesError: boolean;
  /** Empreinte du plan montré, à renvoyer avec la conversion. */
  planFingerprint: string;
  orphans: OrphanRow[];
  orphansTruncated: boolean;
  orphansError: boolean;
}

export interface FailedPair {
  kind: string;
  label: string | null;
  ref: string;
  message: string;
}

/** Colonne que la conversion n'a pas réécrite alors qu'elle portait l'ancien identifiant. */
export interface SkippedColumn {
  /** Compte concerné (libellé masqué et fin de l'identifiant). */
  label: string | null;
  ref: string;
  table: string;
  column: string;
  status: string;
  rows: number;
}

export interface ApplyResult {
  batchId: string | null;
  applied: number;
  failed: number;
  rowsTotal: number;
  remaining: number;
  incomplete: boolean;
  unmappedLeft: number;
  failedPairs: FailedPair[];
  /** Lignes qui portent encore l'ancien identifiant dans des colonnes sautées. */
  skippedRows: number;
  skippedColumns: SkippedColumn[];
  success: boolean;
}

export interface RollbackResult {
  batchId: string;
  pairs: number;
  restoredRows: number;
  movedRows: number;
  /** Lignes créées depuis la conversion : elles portent encore le nouvel identifiant. */
  stillNewRows: number;
}

// ---------------------------------------------------------------------------
// Lecture des réponses
// ---------------------------------------------------------------------------

const isRecord = (value: unknown): value is Record<string, any> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) ? value : Number(value) || 0);
const text = (value: unknown): string => (typeof value === 'string' ? value : '');
const textOrNull = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

function failure(code: string | null, serverText: unknown, extra: Partial<Failure> = {}, fallback?: string): Failure {
  return { ok: false, denied: false, message: errorText(code, serverText, fallback), code, lost: false, ...extra };
}

/** Réponse reçue mais de forme inconnue. */
function unexpected(data: Record<string, any> | null): Failure {
  return failure(textOrNull(data?.error_code), data?.error, {}, UNEXPECTED_ANSWER);
}

/** Échec d'un appel : refus d'accès, réponse perdue, ou erreur du serveur. */
export function failureOf(data: Record<string, any> | null, error: InvokeError | null): Failure | null {
  const code = textOrNull(data?.error_code) ?? error?.code ?? null;
  if (error?.status === 403 || code === 'admin_only') {
    return failure('admin_only', null, { denied: true });
  }
  if (error) {
    return failure(code, data?.error ?? error.message, { lost: isUnknownOutcome(error, code) });
  }
  return null;
}

/**
 * L'action a-t-elle pu avoir lieu sans que la réponse le dise ? Sans statut HTTP, la réponse n'est jamais
 * arrivée. Une erreur 5xx sans code métier (passerelle, délai, arrêt du serveur) ou avec le code générique
 * `server` (exception après des écritures) ne dit pas non plus ce qui s'est passé. Un refus à code métier
 * (lecture impossible, confirmation, plan changé) est définitif : le serveur n'avait rien écrit.
 */
export function isUnknownOutcome(error: InvokeError, code: string | null): boolean {
  if (error.status === undefined) return true;
  return error.status >= 500 && (code === null || code === 'server');
}

export function readReadiness(data: Record<string, any> | null): Readiness | null {
  if (!isRecord(data) || !Array.isArray(data.checks) || !isRecord(data.summary)) return null;
  const checks: ReadinessCheck[] = [];
  for (const raw of data.checks) {
    if (!isRecord(raw) || (raw.status !== 'ok' && raw.status !== 'warn' && raw.status !== 'ko')) return null;
    const extra = isRecord(raw.data) ? raw.data : {};
    checks.push({
      id: text(raw.id),
      label: shownText(raw.label, 'Contrôle'),
      status: raw.status,
      detail: shownText(raw.detail, ''),
      unmapped: Array.isArray(extra.unmapped) ? extra.unmapped.filter(isRecord).map(readUnmapped) : [],
      unmappedTruncated: extra.unmapped_truncated === true,
    });
  }
  return {
    checks,
    summary: {
      ok: num(data.summary.ok), warn: num(data.summary.warn), ko: num(data.summary.ko), ready: data.summary.ready === true,
    },
    generatedAt: textOrNull(data.generated_at),
  };
}

function readUnmapped(raw: Record<string, any>): UnmappedRow {
  return { kind: text(raw.kind), label: textOrNull(raw.label), ref: text(raw.ref), reason: text(raw.reason) };
}

function readCounts(raw: unknown): KindCounts {
  const c = isRecord(raw) ? raw : {};
  return {
    total: num(c.total), already_v2: num(c.already_v2), via_v1_account_id: num(c.via_v1_account_id),
    via_email: num(c.via_email), unmapped: num(c.unmapped),
  };
}

export function readPreview(data: Record<string, any> | null): Preview | null {
  if (!isRecord(data) || !isRecord(data.counts) || !Array.isArray(data.pairs)) return null;
  const counts = data.counts;
  return {
    counts: {
      all: readCounts(counts.all), linkedin: readCounts(counts.linkedin),
      email: readCounts(counts.email), whatsapp: readCounts(counts.whatsapp),
    },
    pairs: data.pairs.filter(isRecord).map((pair) => ({
      kind: text(pair.kind),
      label: textOrNull(pair.label),
      ref: text(pair.ref),
      via: text(pair.via),
      totalRows: num(pair.total_rows),
      usageError: pair.usage_error === true,
      notes: Array.isArray(pair.notes) ? pair.notes.map((n: unknown) => shownText(n, '')).filter((n: string) => n !== '') : [],
    })),
    unmapped: Array.isArray(data.unmapped) ? data.unmapped.filter(isRecord).map(readUnmapped) : [],
    unmappedTruncated: data.unmapped_truncated === true,
    truncated: data.truncated === true,
    sharedTargets: num(data.shared_targets),
    batches: Array.isArray(data.previous_batches)
      ? data.previous_batches.filter(isRecord).map((b) => ({
        batchId: text(b.batch_id), pairs: num(b.pairs), appliedAt: textOrNull(b.applied_at), rolledBack: b.rolled_back === true,
      })).filter((b: BatchRow) => b.batchId !== '')
      : [],
    batchesError: data.previous_batches_error === true,
    planFingerprint: text(data.plan_fingerprint),
    orphans: Array.isArray(data.orphans)
      ? data.orphans.filter(isRecord).map((o) => ({ table: text(o.table), column: text(o.column), ref: text(o.ref), rows: num(o.rows) }))
      : [],
    orphansTruncated: data.orphans_truncated === true,
    orphansError: data.orphans_error === true,
  };
}

export function readApply(data: Record<string, any> | null): ApplyResult | null {
  if (!isRecord(data) || typeof data.applied !== 'number' || !Array.isArray(data.results)) return null;
  const failedPairs: FailedPair[] = data.results
    .filter((r: unknown) => isRecord(r) && r.status === 'failed')
    .map((r: Record<string, any>) => ({
      kind: text(r.kind),
      label: textOrNull(r.label),
      ref: text(r.ref),
      message: errorText(textOrNull(r.error_code), r.error),
    }));
  const skippedColumns: SkippedColumn[] = data.results
    .filter((r: unknown) => isRecord(r) && Array.isArray(r.skipped))
    .flatMap((r: Record<string, any>) =>
      r.skipped.filter(isRecord).map((c: Record<string, any>) => ({
        label: textOrNull(r.label), ref: text(r.ref), table: text(c.table), column: text(c.column), status: text(c.status), rows: num(c.rows),
      })));
  return {
    batchId: textOrNull(data.batch_id),
    applied: num(data.applied),
    failed: num(data.failed),
    rowsTotal: num(data.rows_total),
    remaining: num(data.remaining),
    incomplete: data.incomplete === true,
    unmappedLeft: num(data.unmapped_left),
    failedPairs,
    skippedRows: num(data.skipped_rows),
    skippedColumns,
    success: data.success === true,
  };
}

export function readRollback(data: Record<string, any> | null): RollbackResult | null {
  if (!isRecord(data) || data.success !== true || typeof data.batch_id !== 'string') return null;
  return {
    batchId: data.batch_id,
    pairs: num(data.pairs),
    restoredRows: num(data.restored_rows),
    movedRows: num(data.moved_rows),
    stillNewRows: num(data.still_new_rows),
  };
}

// ---------------------------------------------------------------------------
// Appels
// ---------------------------------------------------------------------------

async function call<T>(
  invoke: MigrationInvoke,
  body: Record<string, unknown>,
  read: (data: Record<string, any> | null) => T | null,
): Promise<Outcome<{ value: T }>> {
  let answer: Awaited<ReturnType<MigrationInvoke>>;
  try {
    answer = await invoke(body);
  } catch {
    return failure(null, null, { lost: true });
  }
  const { data, error } = answer;
  const failed = failureOf(data, error);
  if (failed) return failed;
  const value = read(data);
  return value === null ? unexpected(data) : { ok: true, value };
}

/** `granted` pour un administrateur, `denied` pour tout autre utilisateur. */
export async function checkAccess(invoke: MigrationInvoke): Promise<Outcome<{ value: true }>> {
  return call(invoke, { action: 'access' }, (data) => (isRecord(data) && data.success === true ? (true as const) : null));
}

export const fetchReadiness = (invoke: MigrationInvoke) => call(invoke, { action: 'readiness' }, readReadiness);

export const fetchPreview = (invoke: MigrationInvoke) => call(invoke, { action: 'remap_preview' }, readPreview);

export async function applyRemap(
  invoke: MigrationInvoke,
  confirm: string,
  allowUnmapped: boolean,
  planFingerprint: string,
): Promise<Outcome<{ value: ApplyResult }>> {
  let answer: Awaited<ReturnType<MigrationInvoke>>;
  try {
    answer = await invoke({ action: 'remap_apply', confirm, allow_unmapped: allowUnmapped, plan_fingerprint: planFingerprint });
  } catch {
    return failure(null, null, { lost: true });
  }
  const { data, error } = answer;
  // Un lot créé (échec partiel, temps écoulé) est un résultat à montrer, même avec success false.
  const result = readApply(data);
  if (result && !error) return { ok: true, value: result };
  return failureOf(data, error) ?? unexpected(data);
}

/** Le mot d'annulation est celui de la copie : le serveur exige exactement ce mot. */
export const rollbackRemap = (invoke: MigrationInvoke, batchId: string) =>
  call(invoke, { action: 'remap_rollback', batch_id: batchId, confirm: ROLLBACK_CONFIRM_WORD }, readRollback);
