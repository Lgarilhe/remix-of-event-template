/**
 * Bascule des identifiants de compte du service de connexion (API v1 vers API v2).
 *
 * Fonction réservée aux administrateurs de la plateforme (gate.ts). Actions :
 *  - access         : ne lit rien, répond { success: true } à un administrateur (la page d'administration
 *                     s'en sert pour distinguer « Accès réservé » d'une panne, sans rien charger) ;
 *  - readiness      : contrôles de préparation (clé, service, domaine, notifications, secrets, comptes) ;
 *  - remap_preview  : correspondances ancien/nouvel identifiant et effectifs par table, sans écriture ;
 *  - remap_apply    : { confirm: 'BASCULER', plan_fingerprint, allow_unmapped? } réécrit la base compte par
 *                     compte ; refusée si l'empreinte de la simulation n'est plus celle du plan courant ;
 *  - remap_rollback : { batch_id, confirm: 'ANNULER' } restaure un lot depuis la sauvegarde.
 *
 * Les écritures sont des appels aux fonctions SQL remap_provider_account_id et
 * rollback_provider_account_id_remap (une transaction par compte, voir la migration). Rien de secret
 * ne sort : les secrets sont des booléens, les libellés de comptes sont masqués, aucun identifiant
 * de compte n'est rendu en entier (quatre derniers caractères seulement), les erreurs de la base sont
 * réduites à un code. Aucun texte rendu ne nomme le prestataire. CORS : liste d'origines de _shared/cors.ts.
 *
 * Pas de fenêtre à deux identifiants : après la conversion, un ancien identifiant n'est plus reconnu
 * nulle part. Les moteurs planifiés restent en pause et les anciennes notifications sont retirées avant
 * de convertir (l'écran de confirmation le rappelle).
 *
 * `handleRequest` reçoit ses dépendances (authentification, client de base, port du prestataire,
 * environnement, horloge) pour être joué sans réseau.
 */

import { buildCorsHeaders } from '../_shared/cors.ts';
import {
  describeForLog,
  hostedDomain,
  isReceiverEndpoint,
  isUnipileConfigured,
  RECEIVER_FUNCTION_PATH,
  userSafeMessage,
  V2_TRIGGER_EVENTS,
  errorKindOf,
  isUnipileError,
} from '../_shared/unipile/index.ts';
import { classifyDbError, isMissingFunctionError, remapErrorMessage, type DbError, type RemapErrorCode } from './db-errors.ts';
import { ADMIN_LIST_VARIABLE, parseAdminList, platformAdminGate } from './gate.ts';
import { idRef } from './masking.ts';
import {
  applyRefusal,
  buildPlan,
  mappableItems,
  planFingerprint,
  ROLLBACK_CONFIRM_WORD,
  unmappedItems,
  type AccountKind,
  type DbAccount,
  type Plan,
  type PlanItem,
} from './plan.ts';
import {
  buildReadinessChecks,
  planData,
  summarizeChecks,
  type EndpointFacts,
  type ReadinessFacts,
} from './readiness.ts';

/** Réponse JSON sans en-têtes CORS : handleRequest ajoute ceux de l'origine de la requête (withCors). */
export const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function withCors(response: Response, cors: Record<string, string>): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export type EnvReader = (name: string) => string | undefined;

/** Lecture du service de connexion, injectable. Les erreurs sont celles du client partagé. */
export interface ProviderPort {
  listAccounts(): Promise<{ items: readonly unknown[]; truncated: boolean }>;
  listEndpoints(): Promise<{ items: readonly { url: string; enabled: boolean; trigger_events: readonly string[] }[]; truncated: boolean }>;
}

export interface HandlerDeps {
  authenticate(req: Request, cors: Record<string, string>): Promise<{ userId: string | null; method: string }>;
  // deno-lint-ignore no-explicit-any
  createAdmin(): any;
  provider: ProviderPort;
  env: EnvReader;
  now(): number;
  newBatchId(): string;
}

const ACTIONS = new Set(['access', 'readiness', 'remap_preview', 'remap_apply', 'remap_rollback']);
const BATCH_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Temps laissé à la boucle des comptes, compté depuis le début de la demande (lectures du service et de la
 * base comprises). Une fonction vit 60 s et le navigateur coupe à 55 s : on s'arrête à 30 s pour laisser la
 * marge d'un dernier compte et de la réponse.
 */
export const APPLY_BUDGET_MS = 30_000;
const PAGE = 1000;
const MAX_PAGES = 100;
const ORPHANS_PER_COLUMN = 50;
const ORPHANS_SHOWN = 100;
const USAGE_PARALLEL = 4;

// ---------------------------------------------------------------------------
// Lectures
// ---------------------------------------------------------------------------

// deno-lint-ignore no-explicit-any
type Admin = any;

/**
 * Lit toute une table par pages, dans l'ordre de la clé primaire : sans ordre stable, une pagination peut
 * sauter ou répéter des lignes. Une table plus longue que le plafond est une lecture en échec (`null`) :
 * un compte absent du plan ne serait ni converti ni listé.
 */
async function readAll(admin: Admin, table: string, columns: string): Promise<Record<string, unknown>[] | null> {
  const rows: Record<string, unknown>[] = [];
  for (let from = 0; from < MAX_PAGES * PAGE; from += PAGE) {
    const { data, error } = await admin.from(table).select(columns).order('id', { ascending: true }).range(from, from + PAGE - 1);
    if (error) {
      console.error(`[unipile-migration] read ${table} failed:`, error.code ?? '', error.message ?? '');
      return null;
    }
    const page = (data ?? []) as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE) return rows;
  }
  console.error(`[unipile-migration] read ${table} stopped: more than ${MAX_PAGES * PAGE} rows`);
  return null;
}

const str = (value: unknown): string | null => (typeof value === 'string' && value.trim() !== '' ? value : null);

/** Comptes reliés en base (LinkedIn, messagerie, WhatsApp, agenda). `null` si une lecture échoue. */
export async function loadDbAccounts(admin: Admin): Promise<DbAccount[] | null> {
  const [linkedin, email, whatsapp, calendar] = await Promise.all([
    readAll(admin, 'member_linkedin_accounts', 'linkedin_account_id, linkedin_account_name'),
    readAll(admin, 'member_email_accounts', 'email_account_id, email_address'),
    readAll(admin, 'member_whatsapp_accounts', 'whatsapp_account_id, name, phone_number'),
    readAll(admin, 'member_calendar_accounts', 'account_id, email_address'),
  ]);
  if (!linkedin || !email || !whatsapp || !calendar) return null;
  const out: DbAccount[] = [];
  for (const row of linkedin) {
    const id = str(row.linkedin_account_id);
    if (id) out.push({ kind: 'linkedin', storedId: id, label: str(row.linkedin_account_name), email: null });
  }
  for (const row of email) {
    const id = str(row.email_account_id);
    if (id) out.push({ kind: 'email', storedId: id, label: str(row.email_address), email: str(row.email_address) });
  }
  for (const row of whatsapp) {
    const id = str(row.whatsapp_account_id);
    // Le numéro d'abord : le nom du compte est réécrit par la page Connexions (il prend la valeur du service, le
    // plus souvent le numéro), ce qui changerait le libellé montré entre la simulation et le résultat.
    if (id) out.push({ kind: 'whatsapp', storedId: id, label: str(row.phone_number) ?? str(row.name), email: null });
  }
  for (const row of calendar) {
    const id = str(row.account_id);
    if (id) out.push({ kind: 'email', storedId: id, label: str(row.email_address), email: str(row.email_address) });
  }
  return out;
}

async function probeRemapInstalled(admin: Admin): Promise<boolean | 'unknown'> {
  try {
    // Registre seul : aucune lecture de table (le relevé par identifiant parcourt les journaux).
    const { error } = await admin.rpc('provider_account_id_columns');
    if (!error) return true;
    return isMissingFunctionError(error as DbError) ? false : 'unknown';
  } catch {
    return 'unknown';
  }
}

type ServiceFacts = ReadinessFacts['service'];

async function loadService(deps: HandlerDeps, keyConfigured: boolean): Promise<ServiceFacts> {
  if (!keyConfigured) return { ok: false };
  try {
    const result = await deps.provider.listAccounts();
    return { ok: true, accounts: result.items, truncated: result.truncated };
  } catch (error) {
    console.error('[unipile-migration] accounts list failed:', describeForLog(error));
    return { ok: false };
  }
}

function receiverUrl(env: EnvReader): string {
  return `${(env('SUPABASE_URL') ?? '').replace(/\/+$/, '')}${RECEIVER_FUNCTION_PATH}`;
}

async function loadEndpoints(deps: HandlerDeps, keyConfigured: boolean, service: ServiceFacts): Promise<EndpointFacts> {
  if (!keyConfigured) return { state: 'skipped', reason: 'key_missing' };
  if (!service.ok) return { state: 'skipped', reason: 'service_unreachable' };
  try {
    const listed = await deps.provider.listEndpoints();
    const base = receiverUrl(deps.env);
    const ours = listed.items
      .filter((endpoint) => isReceiverEndpoint(endpoint.url, base))
      .map((endpoint) => ({ enabled: endpoint.enabled === true, trigger_events: [...(endpoint.trigger_events ?? [])] }));
    return { state: 'listed', ours, truncated: listed.truncated };
  } catch (error) {
    console.error('[unipile-migration] endpoints list failed:', describeForLog(error));
    return { state: 'error' };
  }
}

function hostedDomainFact(env: EnvReader): ReadinessFacts['hostedDomain'] {
  try {
    const host = hostedDomain(env);
    return host ? { state: 'set', host } : { state: 'unset' };
  } catch {
    return { state: 'invalid' };
  }
}

function webhookTokenFact(env: EnvReader): ReadinessFacts['webhookToken'] {
  if ((env('UNIPILE_V2_WEBHOOK_TOKEN') ?? '').trim() !== '') return 'dedicated';
  if ((env('UNIPILE_WEBHOOK_SECRET') ?? '').trim() !== '') return 'derived';
  return 'missing';
}

/** Rassemble les faits de préparation. Aucune lecture ne lève : un échec devient un fait. */
export async function collectFacts(deps: HandlerDeps, admin: Admin): Promise<ReadinessFacts> {
  const env = deps.env;
  const keyConfigured = isUnipileConfigured(env);
  const [service, dbAccounts, remapInstalled] = await Promise.all([
    loadService(deps, keyConfigured),
    loadDbAccounts(admin).catch((error) => {
      console.error('[unipile-migration] db accounts failed:', error instanceof Error ? error.message : String(error));
      return null;
    }),
    probeRemapInstalled(admin),
  ]);
  const endpoints = await loadEndpoints(deps, keyConfigured, service);
  return {
    keyConfigured,
    service,
    hostedDomain: hostedDomainFact(env),
    endpoints,
    webhookToken: webhookTokenFact(env),
    adminCount: parseAdminList(env(ADMIN_LIST_VARIABLE)).length,
    nativeEnabled: env('CONNECTION_NATIVE_ENABLED') === '1',
    legacySecretsSet: (env('UNIPILE_API_KEY') ?? '').trim() !== '' || (env('UNIPILE_DSN') ?? '').trim() !== '',
    remapInstalled,
    db: dbAccounts ? { ok: true, accounts: dbAccounts } : { ok: false },
    wantedEvents: V2_TRIGGER_EVENTS,
  };
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export async function handleReadiness(deps: HandlerDeps, admin: Admin): Promise<Response> {
  const facts = await collectFacts(deps, admin);
  const checks = buildReadinessChecks(facts);
  return respond({ success: true, checks, summary: summarizeChecks(checks), generated_at: new Date(deps.now()).toISOString() });
}

interface UsageRow {
  table: string;
  column: string;
  rows: number;
  status: string;
}

async function readUsage(admin: Admin, oldId: string): Promise<UsageRow[] | null> {
  const { data, error } = await admin.rpc('provider_account_id_usage', { p_old: oldId });
  if (error) {
    console.error('[unipile-migration] usage failed:', (error as DbError).code ?? '', (error as DbError).hint ?? '');
    return null;
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    table: String(row.table_name ?? ''),
    column: String(row.column_name ?? ''),
    rows: Number(row.rows_holding ?? 0),
    status: String(row.status ?? ''),
  }));
}

/** Notes de lecture déduites des effectifs : ce que la bascule ne réécrit pas. */
export function usageNotes(usage: readonly UsageRow[]): string[] {
  const rows = (table: string, column?: string) =>
    usage.filter((u) => u.table === table && (column === undefined || u.column === column)).reduce((sum, u) => sum + u.rows, 0);
  const notes: string[] = [];
  if (rows('sourcing_agents', 'account_id') > 0) {
    notes.push('Un agent de recherche continue utilise ce compte : son contexte change, il faudra le recalibrer après la bascule.');
  }
  // Une proposition porte le compte dans ses paramètres et dans son aperçu : une ligne compte une fois, pas une
  // fois par colonne. Le plus grand des deux effectifs est exact quand elle les porte tous les deux (le cas courant).
  const proposals = Math.max(rows('agent_tool_executions', 'params'), rows('agent_tool_executions', 'dry_run_result'));
  if (proposals > 0) {
    notes.push(`${proposals} proposition${proposals > 1 ? 's' : ''} de l'assistant en attente mentionne${proposals > 1 ? 'nt' : ''} ce compte : le compte d'envoi est relu à l'exécution, rien n'est réécrit.`);
  }
  const logs = rows('webhook_event_log') + rows('search_failure_log');
  if (logs > 0) notes.push(`${logs} ligne${logs > 1 ? 's' : ''} de journal garde${logs > 1 ? 'nt' : ''} l'ancien identifiant (diagnostic seulement, non réécrites).`);
  const skipped = usage.filter((u) => u.status === 'no_primary_key' && u.rows > 0);
  if (skipped.length > 0) notes.push('Une colonne sans clé primaire ne peut pas être sauvegardée : elle n\'est pas réécrite.');
  const unusualRows = usage.filter((u) => u.status === 'unsupported_type').reduce((sum, u) => sum + u.rows, 0);
  if (unusualRows > 0) {
    notes.push(`${unusualRows} ligne${unusualRows > 1 ? 's' : ''} d'une colonne au type inattendu ne ${unusualRows > 1 ? 'seront' : 'sera'} pas convertie${unusualRows > 1 ? 's' : ''}.`);
  }
  return notes;
}

/** Un compte tel que l'écran le voit : type, libellé masqué, quatre derniers caractères. Jamais l'identifiant entier. */
function pairView(item: PlanItem) {
  return {
    kind: item.kind,
    via: item.via,
    label: item.maskedLabel,
    ref: item.ref,
  };
}

async function mapLimited<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return out;
}

interface BatchView {
  batch_id: string;
  pairs: number;
  /** Lignes réécrites par le lot (sauvegardes) : 0 = rien à annuler. */
  rows: number;
  applied_at: string | null;
  rolled_back: boolean;
  /** Un lot plus récent, non annulé, a réécrit des lignes : celui-ci ne s'annule qu'après lui. */
  newer_open: boolean;
}

/** Dix derniers lots, le plus récent d'abord. La règle d'ordre est celle de la restauration (une seule, côté base). */
async function previousBatches(admin: Admin): Promise<BatchView[] | null> {
  const { data, error } = await admin.rpc('remap_batches', { p_limit: 10 });
  if (error) {
    console.error('[unipile-migration] batches failed:', (error as DbError).code ?? '', (error as DbError).hint ?? '');
    return null;
  }
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
    batch_id: String(row.batch_id),
    pairs: Number(row.pairs ?? 0),
    rows: Number(row.rows_written ?? 0),
    applied_at: row.applied_at ? String(row.applied_at) : null,
    rolled_back: row.rolled_back === true,
    newer_open: row.newer_open === true,
  }));
}

interface OrphanView {
  table: string;
  column: string;
  ref: string;
  rows: number;
}

/**
 * Identifiants des colonnes du registre qui ne correspondent à aucun compte relié (voir la migration) :
 * rendus par table, colonne et fin d'identifiant, avec leur effectif. `null` si la lecture échoue.
 */
async function readOrphans(admin: Admin): Promise<{ items: OrphanView[]; truncated: boolean } | null> {
  const { data, error } = await admin.rpc('provider_account_id_orphans', { p_limit: ORPHANS_PER_COLUMN });
  if (error) {
    console.error('[unipile-migration] orphans failed:', (error as DbError).code ?? '', (error as DbError).hint ?? '');
    return null;
  }
  const perColumn = new Map<string, number>();
  const all: OrphanView[] = [];
  for (const row of (data ?? []) as Array<Record<string, unknown>>) {
    const table = String(row.table_name ?? '');
    const column = String(row.column_name ?? '');
    const rows = Number(row.rows_holding ?? 0);
    perColumn.set(`${table}.${column}`, (perColumn.get(`${table}.${column}`) ?? 0) + 1);
    if (rows > 0) all.push({ table, column, ref: idRef(row.value), rows });
  }
  all.sort((a, b) => b.rows - a.rows);
  const columnFull = [...perColumn.values()].some((count) => count >= ORPHANS_PER_COLUMN);
  return { items: all.slice(0, ORPHANS_SHOWN), truncated: columnFull || all.length > ORPHANS_SHOWN };
}

interface PlanContext {
  plan: Plan;
  service: Extract<ServiceFacts, { ok: true }>;
}

/** Plan de bascule, ou la réponse d'erreur à rendre (clé absente, service muet, base illisible). */
async function loadPlan(deps: HandlerDeps, admin: Admin): Promise<PlanContext | Response> {
  const keyConfigured = isUnipileConfigured(deps.env);
  const [service, dbAccounts] = await Promise.all([loadService(deps, keyConfigured), loadDbAccounts(admin)]);
  if (!keyConfigured) {
    return respond({ success: false, error_code: 'key_missing', error: 'La clé API du service de connexion n\'est pas configurée.' }, 409);
  }
  if (!service.ok) {
    return respond({ success: false, error_code: 'service_unreachable', error: 'Le service de connexion ne répond pas.' }, 503);
  }
  if (!dbAccounts) {
    return respond({ success: false, error_code: 'database_unavailable', error: 'Les comptes de la base n\'ont pas pu être lus.' }, 500);
  }
  return { plan: buildPlan(dbAccounts, service.accounts), service };
}

/** Comptes sans correspondance détaillés dans la simulation : au plus ce nombre, comme la liste de la vérification. */
const UNMAPPED_SHOWN = 50;

/** Une ligne de liaison (member_*) est le compte lui-même : ce qui compte pour le propriétaire, ce sont les données liées. */
const isLinkTable = (table: string) => table.startsWith('member_');

/**
 * Lignes qui garderont l'ancien identifiant parce que le compte n'est pas converti : colonnes réécrites par la
 * bascule (ou qu'elle ne sait pas réécrire), liaison du membre exclue. Les journaux et les propositions de
 * l'assistant (état report_only) sont dits dans les notes, pas comptés ici.
 */
export function heldUsage(usage: readonly UsageRow[]): UsageRow[] {
  return usage.filter((row) => row.rows > 0 && row.status !== 'report_only' && !isLinkTable(row.table));
}

export async function handlePreview(deps: HandlerDeps, admin: Admin): Promise<Response> {
  const loaded = await loadPlan(deps, admin);
  if (loaded instanceof Response) return loaded;
  const { plan, service } = loaded;
  const mappable = mappableItems(plan);
  const unmappedAll = unmappedItems(plan);
  const unmappedShown = unmappedAll.slice(0, UNMAPPED_SHOWN);
  const [usages, unmappedUsages] = await Promise.all([
    mapLimited(mappable, USAGE_PARALLEL, (item) => readUsage(admin, item.oldId)),
    // Un compte sans correspondance qui a encore une liaison garde ses lignes sur l'ancien identifiant : le
    // propriétaire doit savoir combien avant de décider de le laisser tel quel.
    mapLimited(unmappedShown, USAGE_PARALLEL, (item) => readUsage(admin, item.oldId)),
  ]);
  const pairs = mappable.map((item, index) => {
    const usage = usages[index];
    const nonzero = (usage ?? []).filter((row) => row.rows > 0);
    return {
      ...pairView(item),
      usage: nonzero,
      usage_error: usage === null,
      total_rows: nonzero.filter((row) => row.status === 'remap').reduce((sum, row) => sum + row.rows, 0),
      notes: usage ? usageNotes(usage) : [],
    };
  });
  const unmapped = unmappedShown.map((item, index) => {
    const usage = unmappedUsages[index];
    const held = usage ? heldUsage(usage) : [];
    return {
      kind: item.kind,
      label: item.maskedLabel,
      ref: item.ref,
      reason: item.reason,
      usage: held,
      usage_error: usage === null,
      held_rows: held.reduce((sum, row) => sum + row.rows, 0),
    };
  });
  const unmappedExact = unmappedAll.length === unmappedShown.length && unmapped.every((item) => !item.usage_error);
  const [batches, orphans] = await Promise.all([previousBatches(admin), readOrphans(admin)]);
  const data = planData(plan);
  return respond({
    success: true,
    plan_fingerprint: await planFingerprint(plan),
    counts: data.counts,
    shared_targets: plan.sharedTargets,
    service_accounts: plan.serviceAccounts,
    truncated: service.truncated,
    pairs,
    unmapped,
    unmapped_truncated: data.unmapped_truncated,
    // Total des lignes que les comptes laissés tels quels gardent sur l'ancien identifiant ; faux quand la liste est
    // tronquée ou qu'un relevé a échoué : le total est alors un minimum.
    unmapped_held_rows: unmapped.reduce((sum, item) => sum + item.held_rows, 0),
    unmapped_held_exact: unmappedExact,
    already_v2: plan.counts.all.already_v2,
    previous_batches: batches ?? [],
    previous_batches_error: batches === null,
    orphans: orphans?.items ?? [],
    orphans_truncated: orphans?.truncated ?? false,
    orphans_error: orphans === null,
  });
}

/** Colonne d'un compte que la conversion n'a pas réécrite alors qu'elle portait l'ancien identifiant. */
interface SkippedColumn {
  table: string;
  column: string;
  status: string;
  rows: number;
}

interface PairResult {
  kind: AccountKind;
  /** Libellé masqué et fin de l'ancien identifiant : jamais l'identifiant entier. */
  label: string | null;
  ref: string;
  status: 'applied' | 'failed';
  rows?: number;
  skipped?: SkippedColumn[];
  error_code?: RemapErrorCode;
  error?: string;
}

/** Colonnes sautées avec des lignes (sans clé primaire, type inattendu) lues dans le rapport de la fonction SQL. */
export function skippedColumns(data: unknown): SkippedColumn[] {
  const columns = (data as Record<string, unknown> | null)?.columns;
  if (!Array.isArray(columns)) return [];
  const out: SkippedColumn[] = [];
  for (const raw of columns as Array<Record<string, unknown>>) {
    const rows = Number(raw?.skipped_rows ?? 0);
    if (rows > 0) out.push({ table: String(raw.table ?? ''), column: String(raw.column ?? ''), status: String(raw.status ?? ''), rows });
  }
  return out;
}

export async function handleApply(deps: HandlerDeps, admin: Admin, userId: string, body: Record<string, unknown>): Promise<Response> {
  // Le temps compte depuis la demande : les lectures du service et de la base sont comprises.
  const startedAt = deps.now();
  // La confirmation est contrôlée avant toute lecture.
  const early = applyRefusal({
    confirm: body.confirm, allowUnmapped: body.allow_unmapped,
    keyConfigured: true, serviceReachable: true, listTruncated: false, unmappedCount: 0,
  });
  if (early) return respond({ success: false, error_code: early.error_code, error: early.error }, early.status);

  const keyConfigured = isUnipileConfigured(deps.env);
  const [service, dbAccounts, installed] = await Promise.all([
    loadService(deps, keyConfigured),
    loadDbAccounts(admin),
    probeRemapInstalled(admin),
  ]);
  const plan = dbAccounts && service.ok ? buildPlan(dbAccounts, service.accounts) : null;
  const refusal = applyRefusal({
    confirm: body.confirm,
    allowUnmapped: body.allow_unmapped,
    keyConfigured,
    serviceReachable: service.ok,
    listTruncated: service.ok && service.truncated,
    unmappedCount: plan ? unmappedItems(plan).length : 0,
  });
  if (refusal) return respond({ success: false, error_code: refusal.error_code, error: refusal.error }, refusal.status);
  if (!dbAccounts || !plan) {
    return respond({ success: false, error_code: 'database_unavailable', error: 'Les comptes de la base n\'ont pas pu être lus. Aucune bascule n\'est lancée.' }, 500);
  }
  if (installed !== true) {
    return respond({
      success: false, error_code: 'not_installed',
      error: 'Les fonctions de bascule ne sont pas installées ou pas vérifiables. Aucune bascule n\'est lancée.',
    }, 409);
  }

  const todo = mappableItems(plan).sort((a, b) => a.kind.localeCompare(b.kind) || a.oldId.localeCompare(b.oldId));
  if (todo.length === 0) {
    return respond({
      success: true, batch_id: null, applied: 0, failed: 0, rows_total: 0, skipped_rows: 0, remaining: 0, incomplete: false,
      unmapped_left: unmappedItems(plan).length, results: [],
    });
  }

  // La conversion qui part est celle que la simulation a montrée : sinon des comptes ont été reliés,
  // reconnectés ou retirés entre les deux et les chiffres confirmés ne sont plus les bons.
  const fingerprint = await planFingerprint(plan);
  if (typeof body.plan_fingerprint !== 'string' || body.plan_fingerprint !== fingerprint) {
    return respond({
      success: false, error_code: 'plan_changed',
      error: 'La simulation n\'est plus à jour. Aucune bascule n\'est lancée. Relancez la simulation.',
    }, 409);
  }

  const batchId = deps.newBatchId();
  const results: PairResult[] = [];
  let remaining = 0;
  // Un lot n'existe que si la base a inscrit au moins une paire : le numéro n'est rendu que dans ce cas.
  let recorded = false;
  for (let index = 0; index < todo.length; index++) {
    if (deps.now() - startedAt > APPLY_BUDGET_MS) {
      remaining = todo.length - index;
      break;
    }
    const item = todo[index];
    const newId = item.newId as string;
    const who = { kind: item.kind, label: item.maskedLabel, ref: item.ref };
    const { data, error } = await admin.rpc('remap_provider_account_id', {
      p_batch: batchId, p_old: item.oldId, p_new: newId, p_kind: item.kind, p_applied_by: userId,
    });
    if (error) {
      const code = classifyDbError(error as DbError);
      console.error('[unipile-migration] pair failed:', item.kind, item.ref, code, (error as DbError).code ?? '');
      results.push({ ...who, status: 'failed', error_code: code, error: remapErrorMessage(code) });
      continue;
    }
    const report = (data ?? {}) as Record<string, unknown>;
    // Plus aucune ligne ne portait cet ancien identifiant (une autre conversion est passée avant, par exemple deux
    // demandes simultanées) : rien n'a été écrit ni inscrit pour ce compte, il n'entre ni dans le lot ni dans le bilan.
    if (report.noop === true) continue;
    const rows = Number(report.total_rows ?? 0);
    // Une base dont la fonction ne rend pas `recorded` (version d'avant les gardes) a inscrit la paire dès qu'elle a écrit.
    if (report.recorded === true || (report.recorded === undefined && rows > 0)) recorded = true;
    const skipped = skippedColumns(data);
    results.push({ ...who, status: 'applied', rows, ...(skipped.length > 0 ? { skipped } : {}) });
  }

  const applied = results.filter((r) => r.status === 'applied').length;
  const failed = results.length - applied;
  const rowsTotal = results.reduce((sum, r) => sum + (r.rows ?? 0), 0);
  const skippedRows = results.reduce((sum, r) => sum + (r.skipped ?? []).reduce((n, c) => n + c.rows, 0), 0);
  console.info(`[unipile-migration] remap_apply by ${userId}: batch ${batchId}, applied ${applied}, failed ${failed}, skipped rows ${skippedRows}, remaining ${remaining}`);
  const incomplete = remaining > 0;
  return respond({
    success: failed === 0 && !incomplete,
    ...(failed > 0 ? { error_code: 'partial_failure', error: `${failed} compte${failed > 1 ? 's' : ''} en échec : rien n'a été modifié pour ${failed > 1 ? 'ceux-ci' : 'celui-ci'}.` } : {}),
    ...(incomplete ? { error_code: failed > 0 ? 'partial_failure' : 'time_budget', error: 'Le temps imparti est écoulé. Relancez la bascule pour traiter les comptes restants.' } : {}),
    batch_id: recorded ? batchId : null,
    applied,
    failed,
    rows_total: rowsTotal,
    skipped_rows: skippedRows,
    remaining,
    incomplete,
    unmapped_left: unmappedItems(plan).length,
    results,
  });
}

export async function handleRollback(admin: Admin, userId: string, body: Record<string, unknown>): Promise<Response> {
  // Le mot est contrôlé avant tout : l'annulation remet tous les comptes du lot à l'ancien format.
  if (body.confirm !== ROLLBACK_CONFIRM_WORD) {
    return respond({
      success: false, error_code: 'rollback_confirmation_required',
      error: `Saisissez ${ROLLBACK_CONFIRM_WORD} pour confirmer l'annulation.`,
    }, 400);
  }
  const batchId = body.batch_id;
  if (typeof batchId !== 'string' || !BATCH_ID_RE.test(batchId)) {
    return respond({ success: false, error_code: 'validation', error: 'Identifiant de lot invalide.' }, 400);
  }
  const { data, error } = await admin.rpc('rollback_provider_account_id_remap', { p_batch: batchId });
  if (error) {
    const code = classifyDbError(error as DbError);
    console.error('[unipile-migration] rollback failed:', code, (error as DbError).code ?? '');
    const status = code === 'batch_unknown' ? 404
      : code === 'batch_already_rolled_back' || code === 'batch_newer_open' || code === 'batch_empty' ? 409
      : 500;
    return respond({ success: false, error_code: code, error: remapErrorMessage(code) }, status);
  }
  const result = (data ?? {}) as Record<string, unknown>;
  const columns = Array.isArray(result.columns) ? result.columns as Array<Record<string, unknown>> : [];
  const stillNew = Array.isArray(result.still_new) ? result.still_new as Array<Record<string, unknown>> : [];
  console.info(`[unipile-migration] remap_rollback by ${userId}: batch ${batchId}`);
  return respond({
    success: true,
    batch_id: batchId,
    pairs: Number(result.pairs ?? 0),
    restored_rows: Number(result.restored_rows ?? 0),
    moved_rows: Number(result.moved_rows ?? 0),
    // Lignes créées depuis la conversion : elles gardent le nouvel identifiant, elles n'ont pas de sauvegarde.
    still_new_rows: Number(result.still_new_rows ?? 0),
    still_new: stillNew.map((c) => ({ table: c.table, column: c.column, rows: Number(c.rows ?? 0) })),
    columns: columns.map((c) => ({ table: c.table, column: c.column, restored: Number(c.restored ?? 0), moved: Number(c.moved ?? 0), status: c.status })),
  });
}

// ---------------------------------------------------------------------------
// Entrée
// ---------------------------------------------------------------------------

async function route(req: Request, deps: HandlerDeps, cors: Record<string, string>): Promise<Response> {
  try {
    let auth;
    try {
      auth = await deps.authenticate(req, cors);
    } catch (authResponse) {
      return authResponse as Response;
    }
    // Porte fermée avant toute lecture du corps, de la base ou du service.
    const gate = platformAdminGate(auth.userId, deps.env(ADMIN_LIST_VARIABLE));
    if (!gate.ok) return respond({ success: false, error: gate.error, error_code: gate.error_code }, gate.status);
    const userId = auth.userId as string;

    const body = await req.json().catch(() => null) as Record<string, unknown> | null;
    const action = body && typeof body.action === 'string' ? body.action : '';
    if (!ACTIONS.has(action)) {
      return respond({ success: false, error: 'Action inconnue.', error_code: 'unknown_action' }, 400);
    }
    const admin = deps.createAdmin();
    switch (action) {
      case 'access':
        return respond({ success: true });
      case 'readiness':
        return await handleReadiness(deps, admin);
      case 'remap_preview':
        return await handlePreview(deps, admin);
      case 'remap_apply':
        return await handleApply(deps, admin, userId, body ?? {});
      default:
        return await handleRollback(admin, userId, body ?? {});
    }
  } catch (error) {
    // Texte du prestataire ou de la base : journal du serveur seulement.
    console.error('[unipile-migration] Error:', describeForLog(error));
    if (isUnipileError(error)) {
      return respond({ success: false, error: userSafeMessage(errorKindOf(error)), error_code: errorKindOf(error) }, 502);
    }
    return respond({ success: false, error: "L'opération a échoué. Réessayez.", error_code: 'server' }, 500);
  }
}

export async function handleRequest(req: Request, deps: HandlerDeps): Promise<Response> {
  const cors = buildCorsHeaders(req);
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
  return withCors(await route(req, deps, cors), cors);
}
