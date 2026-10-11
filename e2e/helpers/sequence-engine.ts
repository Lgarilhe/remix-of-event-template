/**
 * Aides des tests qui font tourner le moteur de séquences contre la stack
 * locale (e2e/local-stack) : cycle du moteur, webhooks, journal et réponses
 * scriptées du faux prestataire, organisation autorisée à envoyer, seeds.
 *
 * Le faux prestataire LinkedIn parle l'API v2 uniquement (chemins /v2/{acc_...}/...,
 * voir e2e/local-stack/vendor-mock.mjs). Les specs ne doivent plus écrire de chemin ni
 * de clé de corps du fournisseur : elles passent par les accesseurs de ce fichier
 * (opOf, recipientOf, inmailOf, inviteNoteOf, sentTexts...), les constructeurs de
 * routes (`routes`) et d'enveloppes de webhook (`v2`).
 *
 * Tout test qui s'en sert doit s'ignorer sans `engineAvailable` (CI actuelle).
 */
import { expect, request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E } from './env';
import { admin, createOrg, seedLinkedInAccount, seedSequence, type SeededStep, type TestOrg } from './supabase-admin';

export const MOCK_URL = process.env.E2E_VENDOR_MOCK_URL ?? '';
export const CRON_SECRET = process.env.E2E_PROCESS_SEQUENCES_SECRET ?? '';
/** Secret de l'ancien en-tête `unipile-auth` : ne sert plus qu'aux tests qui prouvent son refus. */
export const WEBHOOK_SECRET = process.env.E2E_UNIPILE_WEBHOOK_SECRET ?? '';
/** Jeton `?v2_token=` des webhooks v2 (UNIPILE_V2_WEBHOOK_TOKEN de la stack). */
export const WEBHOOK_V2_TOKEN = process.env.E2E_UNIPILE_V2_WEBHOOK_TOKEN ?? '';
/** Clé d'application que le faux fournisseur exige (en-tête X-API-KEY). */
export const PROVIDER_API_KEY = process.env.E2E_UNIPILE_V2_API_KEY ?? 'e2e-test-key';
/**
 * Variables d'environnement du fournisseur pour un sous-processus qui appelle le faux prestataire
 * sans passer par le serveur de fonctions (sonde Deno de l'assistant) : sa configuration vient de
 * l'environnement, il n'y a plus d'identifiants par organisation en base.
 */
export const PROVIDER_ENV: Record<string, string> = {
  UNIPILE_V2_API_KEY: PROVIDER_API_KEY,
  UNIPILE_V2_WEBHOOK_TOKEN: WEBHOOK_V2_TOKEN,
  ...(process.env.E2E_UNIPILE_HOSTED_DOMAIN ? { UNIPILE_HOSTED_DOMAIN: process.env.E2E_UNIPILE_HOSTED_DOMAIN } : {}),
};
export const engineAvailable = process.env.E2E_EDGE_FUNCTIONS === '1' && !!MOCK_URL && !!CRON_SECRET && !!WEBHOOK_V2_TOKEN;
/** Variables de la stack absentes de l'environnement (vide quand tout est là). */
const missingStackVariables = [
  ['E2E_EDGE_FUNCTIONS=1', process.env.E2E_EDGE_FUNCTIONS === '1'],
  ['E2E_VENDOR_MOCK_URL', !!MOCK_URL],
  ['E2E_PROCESS_SEQUENCES_SECRET', !!CRON_SECRET],
  ['E2E_UNIPILE_V2_WEBHOOK_TOKEN', !!WEBHOOK_V2_TOKEN],
].filter(([, present]) => !present).map(([name]) => name);
export const ENGINE_SKIP_REASON = `moteur et faux prestataires absents (lancer e2e/local-stack/up.sh${
  missingStackVariables.length > 0 ? `, puis relire son fichier d'environnement ; manque : ${missingStackVariables.join(', ')}` : ''
})`;

export const rand = () => Math.random().toString(36).slice(2, 10);
export const minutesFromNow = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

// ─── Faux prestataire ───────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'tests', 'fixtures', 'unipile-v2');
const loadFixture = (name: string) => JSON.parse(fs.readFileSync(path.join(FIXTURES_DIR, name), 'utf8'));

export interface ProviderErrorPreset {
  status: number;
  headers?: Record<string, string>;
  body: Record<string, unknown>;
}

/**
 * Erreurs du fournisseur, source unique (tests/fixtures/unipile-v2/error-presets.json) :
 * rate_limited, credits_exhausted, already_invited, validation, unauthorized, forbidden,
 * not_found, server_error, bad_gateway, unavailable. Formes SUPPOSÉES (la spécification ne
 * décrit aucun corps d'erreur), avec le nom du fournisseur dans title et detail à dessein :
 * un test vérifie qu'il n'arrive jamais à un utilisateur.
 */
export const PROVIDER_ERRORS = loadFixture('error-presets.json').presets as Record<string, ProviderErrorPreset>;

export interface MockCall {
  at: string;
  host: string | null;
  method: string;
  path: string;
  query: Record<string, string>;
  account_id: string | null;
  body: Record<string, unknown> | string;
  scripted?: boolean;
  /** operationId de la spécification (startChat, sendMessage...), absent si la route est inconnue. */
  op?: string | null;
  /** 'v2', ou 'v1' pour un appel a l'ancienne API (le faux prestataire le refuse en 599). */
  api?: 'v1' | 'v2' | null;
  /** Statut rendu (0 : connexion coupée). Absent tant que la réponse n'est pas partie. */
  status?: number;
  contract?: { violations: string[] };
  /** Profil lu : 'provider_id', 'slug' ou 'me'. */
  id_kind?: string;
}

export interface MockViolation {
  at: string;
  kind: 'v1_call' | 'wrong_host' | 'bad_api_key' | 'bad_account_id' | 'unhandled' | 'contract_violation';
  method: string;
  path: string;
  account_id: string | null;
  host: string | null;
  detail: string;
}

/** Appels reçus par le faux prestataire pour un compte LinkedIn (tous les comptes sans argument). */
export async function mockCalls(accountId?: string): Promise<MockCall[]> {
  const q = accountId ? `?account_id=${encodeURIComponent(accountId)}` : '';
  const res = await fetch(`${MOCK_URL}/__log${q}`);
  return (await res.json()) as MockCall[];
}

/** Violations consignées : appel de l'ancienne API, mauvais hôte ou clé, route inconnue, corps hors contrat. */
export async function mockViolations(accountId?: string, kind?: MockViolation['kind']): Promise<MockViolation[]> {
  const q = new URLSearchParams();
  if (accountId) q.set('account_id', accountId);
  if (kind) q.set('kind', kind);
  const res = await fetch(`${MOCK_URL}/__violations?${q}`);
  return (await res.json()) as MockViolation[];
}

/** Aucun appel de l'ancienne API dans toute la pile (une violation v1_call est aussi un 599 pour la fonction). */
export async function expectNoV1Calls() {
  expect(await mockViolations(undefined, 'v1_call')).toEqual([]);
}

/** Aucune violation pour les comptes donnés : l'appel respecte le contrat et la route existe. */
export async function expectNoViolations(...accountIds: string[]) {
  for (const id of accountIds) expect(await mockViolations(id), `violations de ${id}`).toEqual([]);
}

export const callBody = (c: MockCall): Record<string, unknown> => (c.body && typeof c.body === 'object' ? c.body : {});
export const opOf = (c: MockCall): string | null => c.op ?? null;

/** Appels d'un compte pour une ou plusieurs opérations (startChat, sendMessage, getInmailCrédits...). */
export async function callsOf(accountId: string, op: string | string[]): Promise<MockCall[]> {
  const ops = Array.isArray(op) ? op : [op];
  return (await mockCalls(accountId)).filter((c) => c.op && ops.includes(c.op));
}

export const isNewChat = (c: MockCall) => c.method === 'POST' && (c.op === 'startChat' || c.op === 'startChatFromInbox');
export const isChatMessage = (c: MockCall) => c.method === 'POST' && c.op === 'sendMessage';

/** Envois de texte : nouvelle conversation ou suite d'une conversation. */
export async function chatPosts(accountId: string): Promise<MockCall[]> {
  return (await mockCalls(accountId)).filter((c) => isNewChat(c) || isChatMessage(c));
}

/** Destinataire d'une nouvelle conversation (users_ids : chaîne, ou premier élément d'un tableau). */
export function recipientOf(c: MockCall): string | null {
  const ids = callBody(c).users_ids;
  if (typeof ids === 'string') return ids;
  return Array.isArray(ids) && typeof ids[0] === 'string' ? ids[0] : null;
}

/** Identifiant de la conversation visée par un envoi de suite (/v2/{acc}/chats/{id}/messages/send). */
export function chatIdOf(c: MockCall): string | null {
  const m = /\/chats\/([^/]+)\/messages\/send$/.exec(c.path);
  return m ? decodeURIComponent(m[1]) : null;
}

export interface InMailKind {
  kind: 'classic' | 'recruiter' | 'sales_navigator';
  subject?: string;
  signature?: string;
}

/** InMail d'une nouvelle conversation, selon la licence : specifics.linkedin.{classic.inmail, recruiter, sales_navigator}. */
export function inmailOf(c: MockCall): InMailKind | null {
  const li = (callBody(c).specifics as { linkedin?: Record<string, Record<string, unknown>> } | undefined)?.linkedin;
  if (!li) return null;
  if (li.recruiter) return { kind: 'recruiter', subject: li.recruiter.subject as string | undefined, signature: li.recruiter.signature as string | undefined };
  if (li.sales_navigator) return { kind: 'sales_navigator', subject: li.sales_navigator.subject as string | undefined };
  if (li.classic?.inmail === true) return { kind: 'classic' };
  return null;
}

export const inviteNoteOf = (c: MockCall): string | undefined => callBody(c).message as string | undefined;
export const inviteTargetOf = (c: MockCall): string | undefined => callBody(c).user_id as string | undefined;

/** Messages LinkedIn réellement envoyés depuis ce compte (nouvelle conversation ou suite). */
export async function sentTexts(accountId: string): Promise<string[]> {
  return (await chatPosts(accountId)).map((c) => String(callBody(c).text ?? ''));
}

/** Invitations LinkedIn (demandes de relation) envoyées depuis ce compte. */
export async function sentInvites(accountId: string): Promise<MockCall[]> {
  return callsOf(accountId, 'createRelationRequest');
}

export interface MockRoute {
  /** Aussi pour un appel d'application sans compte dans le chemin (/v2/accounts, /v2/auth, /v2/webhooks) ; utiliser un chemin propre au test. */
  app_level?: boolean;
  /** Ancien nom de app_level. */
  unscoped?: boolean;
  method?: string;
  /** operationId de la spécification, ex. 'startChat'. Tous les sélecteurs donnés doivent correspondre. */
  op?: string;
  /** Expression régulière appliquée au chemin complet, ex. '/chats/send$'. */
  path?: string;
  /** À la place de `path` : expression sur le chemin suivi de la chaîne de requete. */
  url?: string;
  /** Corps d'erreur nommé de PROVIDER_ERRORS ; status, body et headers le surchargent. */
  preset?: keyof typeof PROVIDER_ERRORS | string;
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
  delay_ms?: number;
  times?: number;
  /** Coupe la connexion sans réponse (résultat d'envoi incertain). */
  network_error?: boolean;
}

/** Erreur injectée sur toute la surface d'un compte (ou sur `ops`). */
export interface MockError extends Omit<MockRoute, 'op' | 'path' | 'url' | 'method' | 'app_level' | 'unscoped'> {
  ops?: string[];
  methods?: string[];
}

/**
 * Comportement du faux prestataire pour un compte : `routes` scriptees, `error`, ou
 * raccourcis `fail_send` (statut), `distance` ('SECOND_DEGREE'...), `invitation_pending`,
 * `licenses`, `inmail_credits`, `contracts`, `message_id_shape`, `status`, `locked`,
 * `ai_text`, `candidate_provider_id`. La clé '*' vaut pour tous les comptes : à éviter,
 * d'autres tests tournent sur la même stack.
 */
export async function setMockMode(accountId: string, mode: { routes?: MockRoute[]; error?: MockError; [k: string]: unknown }) {
  await fetch(`${MOCK_URL}/__mode`, { method: 'POST', body: JSON.stringify({ [accountId]: mode }) });
}

/** Script de points de contrôle de POST /v2/auth/intent, retrouvé par identifiant, numéro ou état. */
export async function scriptAuth(match: string, steps: Record<string, unknown>[]) {
  const res = await fetch(`${MOCK_URL}/__auth_script`, { method: 'POST', body: JSON.stringify({ match, steps }) });
  expect(res.status).toBe(200);
}

// ─── Constructeurs de routes scriptées ──────────────────────────────────────

const CANDIDATE_ID = 'ACoAAMOCKCANDIDATE';
const SELF_ID = 'ACoAAMOCKME';
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const routes = {
  /** Résultats de GET /v2/{acc}/users/{id}/chat : aucun (pas de conversation), un ou plusieurs (une par inbox). */
  chatLookup(chats: (string | { chat_id: string; inbox_id?: string; has_history?: boolean })[], extra: Partial<MockRoute> = {}): MockRoute {
    const data = chats.map((c) => (typeof c === 'string' ? { chat_id: c } : c));
    return { method: 'GET', op: 'getUserChat', body: { object: 'ChatLookup', data }, ...extra };
  },
  /** Messages d'une conversation, du plus récent au plus ancien, avec tous les champs obligatoires. */
  messages(
    chatId: string,
    items: { from: 'candidate' | 'self'; text: string; at?: string; id?: string; senderId?: string }[],
    extra: Partial<MockRoute> = {},
  ): MockRoute {
    const data = items
      .map((m, i) => {
        const isSender = m.from === 'self';
        const senderId = m.senderId ?? (isSender ? SELF_ID : CANDIDATE_ID);
        return {
          object: 'Message', id: m.id ?? `${chatId}-M${i + 1}`, text: m.text, sender_id: senderId, chat_id: chatId,
          timestamp: m.at ?? new Date(Date.now() - (items.length - i) * 60_000).toISOString(), is_sender: isSender,
          is_hidden: false, is_seen: false, is_delivered: true, is_deleted: false, is_edited: false, is_pinned: false,
          is_event: false, is_mentionned: false, reactions_counter: [], provider: 'linkedin', attachments: [], hyperlinks: [],
          sender: { object: 'User', id: senderId, type: 'individual', display_name: isSender ? 'Compte test' : 'Test Candidat' },
          specifics: { type: 'MESSAGE' },
        };
      })
      .sort((x, y) => Date.parse(y.timestamp) - Date.parse(x.timestamp));
    return { method: 'GET', op: 'getMessagesList', path: `/chats/${escapeRe(encodeURIComponent(chatId))}/messages$`, body: { data }, ...extra };
  },
  /** Profil lu (GET /v2/{acc}/users/{id}) : distance specifics.network_distance, jeton de visite. */
  profile(p: { distance?: string; id?: string; slug?: string; invitationPending?: boolean } = {}, extra: Partial<MockRoute> = {}): MockRoute {
    const id = p.id ?? CANDIDATE_ID;
    const specifics: Record<string, unknown> = { network_distance: p.distance ?? 'FIRST_DEGREE', can_send_inmail: true, notify_visit_token: `vt_${rand()}` };
    if (p.invitationPending) specifics.relation_request_status = 'PENDING';
    const body = {
      object: 'UserProfile', id, type: 'individual', public_identifier: p.slug ?? 'test-candidat', display_name: 'Test Candidat',
      first_name: 'Test', last_name: 'Candidat', description: 'Ingénieur', is_blocked: false, provider: 'linkedin', specifics,
    };
    return { method: 'GET', op: 'getUserProfile', body, ...extra };
  },
  /** Crédits InMail (GET /v2/{acc}/linkedin/inmail-credits) ; une licence absente n'a pas d'abonnement. */
  inmailCredits(credits: { classic?: number; recruiter?: number; sales_navigator?: number }, extra: Partial<MockRoute> = {}): MockRoute {
    return { method: 'GET', op: 'getInmailCredits', body: { object: 'InmailCredits', credits }, ...extra };
  },
  /** Échec d'une opération avec un corps d'erreur nommé (PROVIDER_ERRORS). */
  fail(op: string, preset: keyof typeof PROVIDER_ERRORS | string, extra: Partial<MockRoute> = {}): MockRoute {
    return { op, preset, ...extra };
  },
};

// ─── Appels aux fonctions ───────────────────────────────────────────────────

export async function postJson(path: string, body: unknown, headers: Record<string, string> = {}) {
  const ctx = await request.newContext();
  const res = await ctx.post(`${E2E.supabaseUrl}${path}`, {
    headers: { apikey: E2E.anonKey, 'Content-Type': 'application/json', ...headers },
    data: body,
  });
  const status = res.status();
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  await ctx.dispose();
  return { status, body: json };
}

/** Appel d'une edge function avec un JWT utilisateur (ou une autre clé). */
export function callFunction(name: string, token: string, body: Record<string, unknown>) {
  return postJson(`/functions/v1/${name}`, body, { Authorization: `Bearer ${token}` });
}

/** Action du moteur avec le secret du cron. Réessaie tant qu'un autre cycle tient le verrou. */
export async function runEngine(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < 30; attempt++) {
    const res = await postJson('/functions/v1/process-sequences', body, { Authorization: `Bearer ${CRON_SECRET}` });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    if (res.body.skipped_reason !== 'lock_held') return res.body;
    await new Promise((r) => setTimeout(r, 2_000));
  }
  throw new Error('verrou du moteur jamais libéré');
}

/**
 * Un cycle `process`, comme le cron. `force: true` lève la fenêtre d'envoi
 * (jours ouvrés 8 h-19 h) pour que le test passe aussi le soir et le week-end.
 */
export function runCycle(opts: { force?: boolean } = {}) {
  return runEngine({ action: 'process', force: opts.force ?? true });
}

// ─── Webhooks v2 ────────────────────────────────────────────────────────────

export interface V2Envelope {
  id: string;
  type: string;
  created_at: string;
  hash: string;
  account_scope_id: null;
  account_id: string;
  account_name: string;
  account_provider: string;
  application_id: string;
  application_production: boolean;
  payload: Record<string, unknown>;
}

const evtId = () => `evt_${Array.from({ length: 26 }, () => '0123456789abcdefghjkmnpqrstvwxyz'[Math.floor(Math.random() * 32)]).join('')}`;

function envelope(type: string, accountId: string, payload: Record<string, unknown>, opts: { id?: string; name?: string; provider?: string } = {}): V2Envelope {
  return {
    id: opts.id ?? evtId(), type, created_at: new Date().toISOString(), hash: rand(), account_scope_id: null, account_id: accountId,
    account_name: opts.name ?? 'Compte test', account_provider: opts.provider ?? 'linkedin', application_id: 'app_e2emock',
    application_production: false, payload,
  };
}

const userLight = (id: string, name = 'Test Candidat', slug?: string) => ({
  object: 'User', id, type: 'individual', display_name: name, ...(slug ? { public_identifier: slug, profile_url: `https://www.linkedin.com/in/${slug}` } : {}),
});

/**
 * Enveloppes de webhook v2 (type, payload, id evt_...). Les charges de relation.new, account.* et
 * email.new suivent les objets de la spécification : cles À CONFIRMER sur un premier événement réel
 * (clé de l'utilisateur de relation.new, clé `state` de account.add, forme de l'e-mail).
 */
export const v2 = {
  envelope,
  /** message.new : `isSender` vrai pour un message écrit par le compte lui-même. */
  messageNew(o: { accountId: string; chatId: string; messageId?: string; senderId?: string; text?: string; isSender?: boolean; at?: string; id?: string; senderName?: string }): V2Envelope {
    const senderId = o.senderId ?? (o.isSender ? SELF_ID : CANDIDATE_ID);
    const messageId = o.messageId ?? `MSG-${rand()}`;
    return envelope('message.new', o.accountId, {
      object: 'Message', id: messageId, text: o.text ?? 'Bonjour', sender: userLight(senderId, o.senderName), chat_id: o.chatId,
      is_seen: false, is_sender: o.isSender === true, sender_id: senderId, timestamp: o.at ?? new Date().toISOString(), attachments: [],
    }, { id: o.id });
  },
  relationNew(o: { accountId: string; userId?: string; name?: string; slug?: string; id?: string }): V2Envelope {
    return envelope('relation.new', o.accountId, {
      object: 'UserRelation', id: `REL-${rand()}`, created_at: new Date().toISOString(),
      user: userLight(o.userId ?? CANDIDATE_ID, o.name, o.slug),
    }, { id: o.id });
  },
  emailNew(o: { accountId: string; emailId?: string; from?: string; to?: string; subject?: string; bodyPlain?: string; headers?: { name: string; value: string }[]; threadId?: string; id?: string; provider?: string }): V2Envelope {
    const emailId = o.emailId ?? `mail_${rand()}`;
    return envelope('email.new', o.accountId, {
      object: 'Email', id: emailId, message_id: `<${emailId}@mock.invalid>`, thread_id: o.threadId ?? `thread_${emailId}`,
      subject: o.subject ?? 'Re: Bonjour', body: `<p>${o.bodyPlain ?? 'Merci'}</p>`, body_plain: o.bodyPlain ?? 'Merci', snippet: o.bodyPlain ?? 'Merci',
      headers: o.headers ?? [], from: [{ email: o.from ?? 'candidat@example.test' }], to: [{ email: o.to ?? 'recruteur@example.test' }],
      cc: [], bcc: [], reply_to: [], date: new Date().toISOString(), attachments: [], folders: ['INBOX'], is_unread: true,
    }, { id: o.id, provider: o.provider });
  },
  accountAdd(o: { accountId: string; state?: string; name?: string; id?: string }): V2Envelope {
    return envelope('account.add', o.accountId, { object: 'Account', id: o.accountId, status: 'running', provider: 'linkedin', ...(o.state ? { state: o.state } : {}) }, { id: o.id, name: o.name });
  },
  accountReconnect(o: { accountId: string; state?: string; name?: string; id?: string }): V2Envelope {
    return envelope('account.reconnect', o.accountId, { object: 'Account', id: o.accountId, status: 'running', provider: 'linkedin', ...(o.state ? { state: o.state } : {}) }, { id: o.id, name: o.name });
  },
  /** account.status.<statut> : le statut est porté par le nom de l'événement. */
  accountStatus(accountId: string, status: 'running' | 'degraded' | 'partial' | 'disconnected' | 'errored', id?: string): V2Envelope {
    return envelope(`account.status.${status}`, accountId, { object: 'Account', id: accountId, status, provider: 'linkedin' }, { id });
  },
  accountLocked: (accountId: string): V2Envelope => envelope('account.locked', accountId, { object: 'Account', id: accountId, is_locked: true, provider: 'linkedin' }),
  accountUnlocked: (accountId: string): V2Envelope => envelope('account.unlocked', accountId, { object: 'Account', id: accountId, is_locked: false, provider: 'linkedin' }),
  accountRemove: (accountId: string): V2Envelope => envelope('account.remove', accountId, { object: 'Account', id: accountId, provider: 'linkedin' }),
};

/**
 * Webhook sans contrôle du statut : `token` (défaut : le bon jeton), `null` pour l'omettre, ou
 * `query` pour imposer la chaîne de requete ; `headers` pour les tests d'authentification (ancien
 * en-tête `unipile-auth`, signature inconnue, `?hosted_sig=`).
 */
export async function rawWebhook(
  payload: unknown,
  opts: { token?: string | null; query?: string; headers?: Record<string, string> } = {},
) {
  const token = opts.token === undefined ? WEBHOOK_V2_TOKEN : opts.token;
  const query = opts.query ?? (token ? `?v2_token=${encodeURIComponent(token)}` : '');
  return postJson(`/functions/v1/unipile-webhook${query}`, payload, opts.headers ?? {});
}

/** Enveloppe v2 remise à unipile-webhook avec le bon jeton ; le test attend un 200. */
export async function webhook(payload: V2Envelope | Record<string, unknown>) {
  const res = await rawWebhook(payload);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return res.body;
}

/**
 * Livraison par le faux prestataire lui-même (POST /__fire) : même enveloppe que le vrai service, posté
 * sur unipile-webhook avec ?v2_token=. `payload` complete la charge par défaut du type. Un `id` evt_
 * déjà utilisé rejoue le même événement (dédoublonnage). Rend l'enveloppe et le résultat de chaque envoi.
 */
export async function fireWebhook(spec: {
  account_id: string;
  type: string;
  payload?: Record<string, unknown>;
  id?: string;
  target_url?: string;
  token?: string | null;
  use_registered_endpoints?: boolean;
}): Promise<{ event: V2Envelope; deliveries: { http_status: number | null; response_body: string | null; error: string | null }[] }> {
  const res = await fetch(`${MOCK_URL}/__fire`, { method: 'POST', body: JSON.stringify(spec) });
  expect(res.status, await res.clone().text()).toBe(200);
  return (await res.json()) as never;
}

// ─── Seeds ──────────────────────────────────────────────────────────────────

/** Abonnement actif sur un plan payant, qui autorise l'envoi. */
export async function setPaidPlan(orgId: string, planId = 'cabinet') {
  const { error } = await admin()
    .from('organization_subscriptions')
    .upsert({ organization_id: orgId, plan_id: planId, status: 'active' }, { onConflict: 'organization_id' });
  if (error) throw new Error(`organization_subscriptions: ${error.message}`);
}

/** Organisation qui a le droit d'envoyer : offre payante active et compte LinkedIn relié au propriétaire. */
export async function sendingOrg(prefix: string): Promise<{ org: TestOrg; accountId: string }> {
  const org = await createOrg('agency', prefix);
  await setPaidPlan(org.orgId);
  const accountId = await seedLinkedInAccount(org.orgId, org.owner.userId, `acc_${rand()}`, 'OK');
  return { org, accountId };
}

/** Séquence de messages : un modèle par étape, délai `delayDays` entre étapes. */
export async function messageSequence(org: TestOrg, createdBy: string, templates: string[], delayDays = 3) {
  const seeded = await seedSequence(org.orgId, createdBy, templates.map((_, i) => ({
    action_type: 'message', delay_days: i === 0 ? 0 : delayDays,
  })));
  for (const [i, step] of seeded.steps.entries()) {
    await admin().from('sequence_steps').update({ message_template: templates[i] }).eq('id', step.id);
  }
  return seeded;
}

/** Inscription active, profil LinkedIn unique au format ACo…, fuseau de Paris. */
export async function enroll(
  org: TestOrg,
  sequenceId: string,
  createdBy: string,
  accountId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ enrollmentId: string; profileId: string }> {
  const profileId = (overrides.profile_id as string | undefined) ?? `ACoAAE2E${rand()}${rand()}`;
  const { data, error } = await admin()
    .from('sequence_enrollments')
    .insert({
      sequence_id: sequenceId,
      organization_id: org.orgId,
      created_by: createdBy,
      profile_id: profileId,
      profile_name: 'Camille Martin',
      account_id: accountId,
      status: 'active',
      current_step_order: 0,
      user_timezone: 'Europe/Paris',
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`enroll: ${error?.message}`);
  return { enrollmentId: data.id as string, profileId };
}

/** Exécution d'étape, due par défaut (il y a une minute). À insérer en dernier : un cycle concurrent la prendrait. */
export async function schedule(
  org: TestOrg,
  enrollmentId: string,
  step: SeededStep,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const { data, error } = await admin()
    .from('sequence_step_executions')
    .insert({
      enrollment_id: enrollmentId,
      organization_id: org.orgId,
      step_id: step.id,
      step_order: step.step_order,
      status: 'scheduled',
      scheduled_at: minutesFromNow(-1),
      ...overrides,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(`schedule: ${error?.message}`);
  return data.id as string;
}

export interface ExecutionRow {
  id: string;
  step_order: number;
  status: string;
  scheduled_at: string;
  final_message: string | null;
  skip_reason: string | null;
  error_message: string | null;
  retry_count: number | null;
}

export async function executionsOf(enrollmentId: string): Promise<ExecutionRow[]> {
  const { data } = await admin()
    .from('sequence_step_executions')
    .select('id, step_order, status, scheduled_at, final_message, skip_reason, error_message, retry_count')
    .eq('enrollment_id', enrollmentId)
    .order('step_order');
  return (data ?? []) as ExecutionRow[];
}

export async function enrollmentRow(id: string) {
  const { data } = await admin()
    .from('sequence_enrollments')
    .select('status, pause_reason, current_step_order, tracking_data, connection_status')
    .eq('id', id)
    .single();
  return data as {
    status: string;
    pause_reason: string | null;
    current_step_order: number;
    tracking_data: Record<string, unknown> | null;
    connection_status: string | null;
  };
}
