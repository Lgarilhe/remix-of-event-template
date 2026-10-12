// Faux prestataires (LinkedIn via l'API v2 du fournisseur de connexion, IA, e-mail,
// Notion) pour la stack locale : chaque appel sortant des edge functions arrive
// ici, est journalisé et reçoit une réponse de succès. Personne n'est contacté.
//
// Le faux fournisseur LinkedIn parle l'API v2 uniquement : hôte api.unipile.com
// (en-tête x-original-host posé par functions-server.ts), chemins /v2/{acc_...}/...
// pour les appels d'un compte, /v2/accounts, /v2/auth/*, /v2/webhooks/* pour
// l'application. Toute requête vers l'ancienne API (/api/v1) répond 599 et est
// consignée comme violation (VENDOR_MOCK_STRICT_V1=0 la consigne sans la refuser).
//
// Surface de contrôle (inchangée pour les specs, étendue pour la v2) :
//   GET    /__log                 journal complet
//   GET    /__log?account_id=X    appels d'un compte (isolation entre tests)
//   DELETE /__log                 vide journal, modes, violations, envois, état des comptes
//   POST   /__mode                { "<account_id>" | "*": { fail_send: 500, distance: "SECOND_DEGREE" } }
//   GET    /__violations[?account_id=X&kind=K]   violations : v1_call, wrong_host, bad_api_key,
//                                 bad_account_id, unhandled, contract_violation
//   DELETE /__violations          vide les violations seules
//   POST   /__fire                { account_id, type, payload?, id?, target_url?, token?,
//                                   use_registered_endpoints?, account_name?, account_provider?,
//                                   retries?, retry_delay_ms? }
//                                 construit une enveloppe de webhook v2 et la poste sur
//                                 target_url (défaut VENDOR_MOCK_WEBHOOK_URL) avec ?v2_token=
//   GET    /__deliveries[?account_id=X]   envois de webhooks faits par /__fire et par le rejeu
//   POST   /__auth_script         { match, steps } : points de contrôle de /v2/auth/intent (ci-dessous)
//
// Réponses scriptées, par compte (clé "*" : tous les comptes, à éviter entre
// tests parallèles) : la première route qui correspond gagne, `times` limite le
// nombre d'utilisations (absent = illimité), `delay_ms` simule un délai ou un
// timeout (le moteur coupe à 15 s). Tous les sélecteurs donnés doivent correspondre.
//   POST /__mode { "<account_id>": { "routes": [
//     { "method": "POST", "op": "startChat", "status": 500, "body": {...}, "delay_ms": 0, "times": 1 },
//     { "method": "POST", "path": "/chats/send$", "preset": "rate_limited" }
//   ] } }
// `op` : operationId de la spécification (startChat, sendMessage, createRelationRequest,
// getUserChat, getMessagesList, getInmailCredits, sendEmail, createAuthLink...).
// `path` : expression sur le chemin complet (/v2/acc_x/chats/send). `url` : expression
// sur le chemin suivi de la chaîne de requête. `preset` : corps d'erreur nommé de
// tests/fixtures/unipile-v2/error-presets.json (status, body et headers surchargeables).
// `headers` : en-têtes de réponse. `network_error: true` coupe la connexion sans réponse.
// `app_level: true` (ou l'ancien `unscoped: true`) : la route vaut aussi pour les appels
// d'application sans compte dans le chemin (/v2/accounts, /v2/auth, /v2/webhooks).
//
// Injection d'erreur sur toute la surface d'un compte :
//   { "<account_id>": { "error": { "status": 500, "body": {...}, "preset": "forbidden",
//       "ops": ["startChat"], "methods": ["POST"], "times": 1, "delay_ms": 0 } } }
//
// Un compte retiré (DELETE /v2/accounts/{id}) répond 404 à tout appel, un compte verrouillé
// ou déconnecté (modes `locked`, `status`) répond 403 comme le ferait le fournisseur
// (`allow_when_locked: true` lève ce refus pour les tests qui veulent lire malgré tout).
// `strict_accounts: true` (clé "*" ou compte) : GET /v2/accounts/{id} répond 404 pour un
// identifiant jamais créé ni configuré, au lieu de le créer à la volée.
//
// Modes de comportement d'un compte : fail_send (statut ; envois de message, d'invitation
// et d'e-mail), distance (profil : FIRST_DEGREE, SECOND_DEGREE, THIRD_DEGREE,
// OUT_OF_NETWORK, SELF, ou 1 à 3 ; distance_style: "legacy" rend DISTANCE_1 à 3),
// invitation_pending, licenses (défaut classic, recruiter, sales_navigator : inbox,
// crédits InMail et contrats), inmail_credits ({classic:10,...} ou null), contracts,
// message_id_shape (string, array, null), status / locked / missing / product_status /
// v1_account_id (objet Account), candidate_provider_id, search_results, ai_markers,
// action_recipes, ai_text, profile_sections ({ experience: [...], education: [...], ...} :
// contenu des sections demandées par with_sections), group_chats (identifiants de conversations
// de groupe : participants lisibles).
//
// Points de contrôle de /v2/auth/intent : sans script, un compte LinkedIn, IMAP, mock ou
// Instagram est créé tout de suite (réponse Account) ; WhatsApp répond un QR code ;
// Google et Outlook répondent une adresse OAuth. Un script se pose avec
//   POST /__auth_script { "match": "<username | user | phone_number | state | account_id>",
//     "steps": [ { "checkpoint": "OTP", "channel": "SMS", "expect_code": "123456" }, ... ] }
// Chaque étape est un point de contrôle ({checkpoint: type, ...champs du point de contrôle,
// expect_code}), un QR code ({qrcode}), une adresse OAuth ({oauth_url}) ou une erreur
// ({error: {status, body}}). Le code attendu est vérifié par POST /v2/auth/checkpoint ;
// après la dernière étape, la réponse est l'objet Account. Une erreur en tête de script
// vaut pour les `times` premiers appels de /v2/auth/intent (1 par défaut), puis le script suit ;
// une erreur plus loin répond au POST /v2/auth/checkpoint de son rang.
//
// Réponse de l'IA sans la clé "*" : { "<account_id>": { "ai_markers": { "<marqueur>": "<texte>" } } },
// rendue à tout appel à l'IA dont la requête contient le marqueur.
//
// Supposé : l'emplacement du titre (headline) d'un profil. L'ancien profil le portait dans
// specifics.headline, la spécification actuelle l'omet : le faux le met dans `description`
// à la racine, comme l'ensemble des objets User (question ouverte 11 du digest).
//
// Les formes de réponse suivent la spécification OpenAPI (snapshot « Unipile API »,
// 2026-10-11). Ce qu'elle ne dit pas (corps d'erreur, formats d'identifiants de
// conversation, d'inbox et de message, clé des produits d'un compte) est inventé ici et
// marqué « supposé » : à remplacer par de vraies captures.
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

const PORT = Number(process.env.VENDOR_MOCK_PORT ?? 54340);
const V2_HOST = 'api.unipile.com';
const V2_API_KEY = process.env.VENDOR_MOCK_V2_API_KEY ?? 'e2e-test-key';
const WEBHOOK_URL = process.env.VENDOR_MOCK_WEBHOOK_URL ?? 'http://127.0.0.1:54321/functions/v1/unipile-webhook';
const WEBHOOK_TOKEN = process.env.VENDOR_MOCK_WEBHOOK_TOKEN ?? 'local-v2-webhook-token';
const STRICT_V1 = process.env.VENDOR_MOCK_STRICT_V1 !== '0';
const APP_ID = 'app_e2emock';

const FIXTURES = new URL('../../tests/fixtures/unipile-v2/', import.meta.url);
const loadFixture = (name) => JSON.parse(readFileSync(new URL(name, FIXTURES), 'utf8'));
const ERROR_PRESETS = loadFixture('error-presets.json').presets;
const TRIGGER_EVENTS = new Set(loadFixture('webhook-events.json').trigger_events);

let log = [];
let modes = {};
let violations = [];
let deliveries = [];
let accounts = new Map();
let intents = new Map();
let authScripts = [];
let links = new Map();
let endpoints = new Map();
let conversations = [];
let events = new Map();
let n = 0;

const send = (res, code, body, headers = {}) => {
  res.writeHead(code, { 'content-type': 'application/json', ...headers });
  res.end(code === 204 || body === undefined ? undefined : JSON.stringify(body));
};

// Identifiants : préfixe documenté + 26 caractères base32 minuscules, comme les captures
// (acc_01kyex2j0pexzt3v8prstne0ey). Les identifiants de conversation et de message sont
// opaques et sans préfixe documenté : on imite la capture (CLASSIC_2-CHAT, CLASSIC_2-MSG).
const B32 = '0123456789abcdefghjkmnpqrstvwxyz';
const rid = (len = 26) => Array.from(randomBytes(len), (b) => B32[b % 32]).join('');
const newId = (prefix) => `${prefix}_${rid()}`;
const serial = () => (n += 1);

// Champs texte d'un corps multipart (l'envoi de message LinkedIn est en form-data).
function multipartFields(raw, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType ?? '');
  if (!m) return null;
  const boundary = `--${m[1] ?? m[2]}`;
  const fields = {};
  for (const part of raw.split(boundary)) {
    const name = /name="([^"]+)"/.exec(part)?.[1];
    if (!name || /filename=/.test(part)) continue;
    const value = part.split(/\r?\n\r?\n/).slice(1).join('\n\n').replace(/\r?\n--$/, '').replace(/\r?\n$/, '');
    fields[name] = fields[name] === undefined ? value : [].concat(fields[name], value);
  }
  return fields;
}

// Recettes de test : les références viennent de la vraie consigne du serveur.
// Ce faux modèle n'invente aucun identifiant et permet de tester le validateur
// fermé sans recopier la formule des IDs de cibles dans chaque scénario.
function actionRecipe(body, recipe) {
  const message = [...(body?.messages ?? [])].reverse().find((item) => item.role === 'user');
  const prompt = JSON.parse(typeof message?.content === 'string' ? message.content : message?.content?.find((item) => item.type === 'text')?.text);
  const source = prompt.sources.find((item) => item.type === (recipe.sourceType ?? 'note')) ?? prompt.sources[0];
  const effects = recipe.effects.map((effect) => {
    if (effect.kind !== 'message') return effect;
    const { audience = 'candidate', channel = 'email', ...rest } = effect;
    const target = prompt.targets.find((item) => item.audience === audience && item.channel === channel);
    return { ...rest, targetId: target?.id ?? 'missing-target' };
  });
  return JSON.stringify({ plans: [{ intent: recipe.intent ?? 'reply', title: 'Répondre et conserver le suivi',
    reason: 'Une information réelle attend une réponse.', sourceIds: [source.id], effects }] });
}

// Match the Anthropic protocol: a structured preparation can contain a tool
// block and thinking without any text block for the wrapper to concatenate.
function candidateActionReply(body, recipe, serial) {
  const preparation = actionRecipe(body, recipe);
  if (recipe.responseMode === 'tool_use') return {
    content: [
      { type: 'thinking', thinking: 'Préparation structurée du faux prestataire.' },
      { type: 'tool_use', id: `toolu_actions_${serial}`, name: 'prepare_candidate_actions', input: JSON.parse(preparation) },
    ],
    stop_reason: 'tool_use',
  };
  return { content: [{ type: 'text', text: preparation }], stop_reason: 'end_turn' };
}

// ─── Objets v2 ──────────────────────────────────────────────────────────────

const ALL_LICENSES = ['classic', 'recruiter', 'sales_navigator'];
const licensesOf = (mode) => mode.licenses ?? ALL_LICENSES;

const DISTANCE_BY_NUMBER = { 1: 'FIRST_DEGREE', 2: 'SECOND_DEGREE', 3: 'THIRD_DEGREE' };
const LEGACY_DISTANCE = { FIRST_DEGREE: 'DISTANCE_1', SECOND_DEGREE: 'DISTANCE_2', THIRD_DEGREE: 'DISTANCE_3' };
function networkDistance(mode) {
  let d = mode.distance ?? 'FIRST_DEGREE';
  if (DISTANCE_BY_NUMBER[d]) d = DISTANCE_BY_NUMBER[d];
  const legacy = /^DISTANCE_(\d)$/.exec(String(d));
  if (legacy) d = DISTANCE_BY_NUMBER[legacy[1]] ?? d;
  return mode.distance_style === 'legacy' ? LEGACY_DISTANCE[d] ?? d : d;
}

const nowIso = () => new Date().toISOString();
const isProviderId = (id) => /^ACo/.test(id);
const mockProviderId = (id) => (isProviderId(id) ? id : `ACoAAMOCK${id.replace(/[^a-zA-Z0-9]/g, '')}`);

// Identifiant public d'un membre : 'test-candidat' pour le candidat par défaut, sinon propre à chaque identifiant
// (comme l'ancien faux prestataire, qui rendait l'identifiant lui-même) : deux candidats d'un même test ne
// partagent pas un identifiant public, ce qui les ferait rapprocher à tort par leur adresse de profil.
const slugOfProviderId = (id) => (id === 'ACoAAMOCKCANDIDATE' ? 'test-candidat' : id.toLowerCase());

function userLight(id, mode = {}, extra = {}) {
  const slug = isProviderId(id) ? slugOfProviderId(id) : id;
  return {
    object: 'User', id: mockProviderId(id), type: 'individual', public_identifier: slug,
    display_name: 'Test Candidat', first_name: 'Test', last_name: 'Candidat',
    profile_url: `https://www.linkedin.com/in/${slug}`, description: 'Ingénieur',
    specifics: { network_distance: networkDistance(mode) }, ...extra,
  };
}

function userProfile(userParam, mode, acc = null) {
  const me = userParam === 'me';
  const id = me ? mode.user_id ?? 'ACoAAMOCKME' : userParam;
  const slug = isProviderId(id) ? (me ? 'compte-test' : slugOfProviderId(id)) : id;
  const visitToken = `vt_${rid(16)}`;
  if (acc) (accountRecord(acc).visit_tokens ??= new Set()).add(visitToken);
  const specifics = {
    member_id: String(1000000 + (serial() % 1000)),
    network_distance: me ? 'SELF' : networkDistance(mode),
    can_send_inmail: true, notify_visit_token: visitToken, is_premium: false,
  };
  if (mode.invitation_pending) {
    specifics.relation_request = { object: 'RelationRequest', type: 'sent', id: String(serial()), created_at: nowIso() };
    specifics.relation_request_status = 'PENDING';
  }
  return {
    object: 'UserProfile', id: mockProviderId(id), type: 'individual', public_identifier: slug,
    display_name: 'Test Candidat', first_name: 'Test', last_name: 'Candidat',
    profile_url: `https://www.linkedin.com/in/${slug}`, description: 'Ingénieur', location: 'Paris, France',
    is_blocked: false, provider: 'linkedin', specifics,
  };
}

// Sections d'un profil (with_sections=linkedin_*). Forme vide par défaut, selon la spécification :
// recommendations est { received, given }, interests un objet, les autres des listes ; un test
// pose `profile_sections` pour y mettre du contenu (job_title/company, school, name/endorsement_count...).
const SECTION_EMPTY = { recommendations: () => ({ received: [], given: [] }), interests: () => ({}) };
const ALL_SECTIONS = ['experience', 'education', 'languages', 'skills', 'certifications', 'volunteer_experience', 'projects', 'recommendations', 'interests'];
const userSections = (query, mode = {}) => {
  const asked = query.getAll('with_sections').flatMap((v) => v.split(','));
  const out = {};
  for (const s of asked) {
    const k = s.replace(/^linkedin_/, '').replace(/_preview$/, '');
    for (const name of k === '*' ? ALL_SECTIONS : [k]) out[name] = mode.profile_sections?.[name] ?? (SECTION_EMPTY[name] ? SECTION_EMPTY[name]() : []);
  }
  return out;
};

function messageObject({ id, chat_id, sender_id, is_sender = false, text = '', timestamp, type = 'MESSAGE' }, mode = {}) {
  return {
    object: 'Message', id, text, sender_id, chat_id, timestamp: timestamp ?? nowIso(), is_sender,
    is_hidden: false, is_seen: false, is_delivered: true, is_deleted: false, is_edited: false, is_pinned: false,
    is_event: false, is_mentionned: false, reactions_counter: [], provider: 'linkedin', attachments: [], hyperlinks: [],
    sender: { object: 'User', id: sender_id, type: 'individual', display_name: is_sender ? 'Compte test' : 'Test Candidat' },
    specifics: { type },
  };
}

function chatObject(id, mode) {
  const candidate = mode.candidate_provider_id ?? 'ACoAAMOCKCANDIDATE';
  return {
    object: 'Chat', id, name: 'Test Candidat', muted_until: false, created_at: nowIso(), updated_at: nowIso(),
    last_message_timestamp: nowIso(), user_id: candidate, is_group: false, is_1to1: true, is_channel: false,
    type: '1to1', is_pinned: false, is_readonly: false, is_archived: false, folders: [], unread_count: 0,
    provider: 'linkedin', user: userLight(candidate, mode),
  };
}

function emailObject(id, mode = {}) {
  return {
    object: 'Email', id, message_id: `<${id}@mock.invalid>`, thread_id: `thread_${id}`, subject: 'Re: Bonjour',
    body: '<p>Merci</p>', body_plain: 'Merci', snippet: 'Merci', headers: [],
    from: [{ email: 'candidat@example.test', display_name: 'Test Candidat' }],
    to: [{ email: 'recruteur@example.test', display_name: 'Compte test' }],
    cc: [], bcc: [], reply_to: [], date: nowIso(), attachments: [], folders: ['INBOX'], is_unread: true,
  };
}

function productsOf(rec, mode) {
  if (rec.provider !== 'linkedin') return {};
  const products = { classic: 'running' };
  for (const l of licensesOf(mode)) products[l] = 'running';
  return { ...products, ...(mode.product_status ?? {}) };
}

function accountObject(rec, mode = {}) {
  const status = mode.status ?? rec.status;
  const metadata = { products_connection_status: productsOf(rec, mode), custom_data: rec.custom_data ?? {} };
  if (mode.v1_account_id) metadata.v1_account_id = mode.v1_account_id;
  return {
    object: 'Account', id: rec.id, application_id: APP_ID, user_id: mode.user_id ?? 'ACoAAMOCKME',
    name: mode.name ?? rec.name, created_at: rec.created_at, status, is_locked: mode.locked ?? rec.is_locked,
    provider: mode.provider ?? rec.provider, metadata,
    ...(rec.proxy ? { proxy: rec.proxy } : {}),
  };
}

function accountRecord(id, init = {}) {
  let rec = accounts.get(id);
  if (!rec) {
    rec = { id, status: 'running', is_locked: false, provider: 'linkedin', name: 'Compte test', created_at: nowIso(), custom_data: {}, removed: false, ...init };
    accounts.set(id, rec);
  }
  return rec;
}

const modeOf = (acc) => ({ ...(modes['*'] ?? {}), ...(acc ? modes[acc] ?? {} : {}) });

// Identifiants de message selon message_id_shape (spec : string, tableau ou null).
function messageIds(mode, count = 1) {
  const ids = Array.from({ length: count }, () => `CLASSIC_${serial()}-MSG`);
  if (mode.message_id_shape === 'null') return null;
  if (mode.message_id_shape === 'array') return ids;
  return ids[0];
}

// Un résultat de recherche par licence, avec les champs obligatoires de la spécification :
// Recruiter est `full` (nom, contact, listes vides) ou `partial` (ni nom, ni URL, ni photo),
// Sales Navigator ajoute ses drapeaux et compteurs.
function peopleResult(partial, product) {
  const id = partial.id ?? `ACoAAMOCKSEARCH${serial()}`;
  const common = { object: 'PeopleSearchResult', id, network_distance: 'SECOND_DEGREE', product, headline: 'Ingénieur', location: 'Paris, France', can_send_inmail: true };
  const named = { display_name: 'Test Candidat', public_identifier: `test-${id}`, profile_url: `https://www.linkedin.com/in/test-${id}` };
  if (product === 'recruiter') {
    const visibility = partial.visibility === 'partial' ? 'partial' : 'full';
    const base = { ...common, visibility, candidate_id: `cand_${id}`, is_hidden_candidate: false, work_experience: [] };
    if (visibility === 'partial') return { ...base, ...partial };
    return {
      ...base, ...named, is_open_to_work: false, is_recently_open_to_work: false, is_active_talent: false, is_closer_in_network: false,
      skills: [], education: [], languages: [], certifications: [], projects: [], volunteering: [], recommendations: [], ...partial,
    };
  }
  if (product === 'sales_navigator') {
    return {
      ...common, ...named, has_been_viewed: false, has_been_saved: false, has_posted_recently: false, has_viewed_your_profile: false,
      was_hired_recently: false, was_promoted_recently: false, follows_your_company: false, is_premium: false, is_past_colleague: false,
      is_open_profile: false, contact_info: {}, lists_count: 0, notes_count: 0, education: [], skills: [], work_experience: [],
      languages: [], volunteering: [], ...partial,
    };
  }
  return { ...common, ...named, ...partial };
}

const page = (items, query) => {
  const limit = Math.max(1, Number(query.get('limit') ?? 20) || 20);
  const offset = Math.max(0, Number(query.get('offset') ?? 0) || 0);
  return { items: items.slice(offset, offset + limit), has_more: items.length > offset + limit };
};

// ─── Validation des requêtes (contrat) ──────────────────────────────────────
// Table écrite à la main d'après les digests de la spécification. Un écart est
// consigné (violation contract_violation) et la requête reçoit 422 : un faux
// prestataire trop tolérant laisserait passer des corps que l'API réelle refuse.

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.length > 0;
const isUri = (v) => typeof v === 'string' && /^https?:\/\/\S+$/.test(v);
const extra = (obj, allowed, where) => Object.keys(obj).filter((k) => !allowed.includes(k)).map((k) => `${where}: champ inconnu « ${k} »`);

function specificsProblems(specifics, where) {
  const out = [];
  if (specifics === undefined) return out;
  if (!isObj(specifics)) return [`${where}: objet attendu`];
  out.push(...extra(specifics, ['linkedin', 'instagram'], where));
  const li = specifics.linkedin;
  if (li === undefined) return out;
  if (!isObj(li)) return [...out, `${where}.linkedin: objet attendu`];
  out.push(...extra(li, ['classic', 'sales_navigator', 'recruiter'], `${where}.linkedin`));
  const present = ['classic', 'sales_navigator', 'recruiter'].filter((k) => li[k] !== undefined);
  if (present.length > 1) out.push(`${where}.linkedin: une seule des clés classic, sales_navigator, recruiter`);
  if (li.classic !== undefined) {
    if (!isObj(li.classic)) out.push(`${where}.linkedin.classic: objet attendu`);
    else {
      out.push(...extra(li.classic, ['inmail', 'company_topic', 'relation_request_id', 'applicant', 'shared_content'], `${where}.linkedin.classic`));
      if (li.classic.inmail !== undefined && typeof li.classic.inmail !== 'boolean') out.push(`${where}.linkedin.classic.inmail: booléen attendu`);
    }
  }
  if (li.sales_navigator !== undefined) {
    if (!isObj(li.sales_navigator)) out.push(`${where}.linkedin.sales_navigator: objet attendu`);
    else {
      out.push(...extra(li.sales_navigator, ['subject'], `${where}.linkedin.sales_navigator`));
      if (!isStr(li.sales_navigator.subject)) out.push(`${where}.linkedin.sales_navigator.subject obligatoire`);
    }
  }
  if (li.recruiter !== undefined) {
    if (!isObj(li.recruiter)) out.push(`${where}.linkedin.recruiter: objet attendu`);
    else {
      out.push(...extra(li.recruiter, ['subject', 'signature', 'visibility', 'intent', 'send_as', 'channel_type', 'follow_up'], `${where}.linkedin.recruiter`));
      if (!isStr(li.recruiter.subject)) out.push(`${where}.linkedin.recruiter.subject obligatoire`);
      if (!isStr(li.recruiter.signature)) out.push(`${where}.linkedin.recruiter.signature obligatoire`);
    }
  }
  return out;
}

function startChatProblems(b) {
  if (!isObj(b)) return ['corps JSON attendu'];
  const out = extra(b, ['text', 'users_ids', 'name', 'attachments', 'specifics'], 'corps');
  if (typeof b.text !== 'string') out.push('text obligatoire (chaîne, éventuellement vide)');
  const u = b.users_ids;
  if (!(isStr(u) || (Array.isArray(u) && u.length > 0 && u.every(isStr)))) out.push('users_ids obligatoire (chaîne ou tableau non vide de chaînes)');
  out.push(...specificsProblems(b.specifics, 'specifics'));
  return out;
}

const PEOPLE_SEARCH_KEYS = {
  performClassicPeopleSearch: ['keywords', 'network_distance', 'location', 'current_company', 'past_company', 'school', 'connections_of', 'followers_of', 'industry', 'service', 'profile_language', 'open_to_volunteering', 'advanced_keywords'],
  performRecruiterPeopleSearch: ['keywords', 'spotlights', 'load_saved_search', 'load_custom_filter', 'save_search', 'save_custom_filter', 'network_distance', 'location', 'postal_code', 'postal_code_radius', 'job_title', 'occupation', 'skills', 'company', 'current_company', 'past_company', 'company_size', 'years_of_experience', 'years_in_current_position', 'years_in_current_company', 'degree', 'workplace_type', 'school', 'field_of_study', 'employment_type', 'graduation_year', 'industry', 'seniority', 'spoken_language', 'profile_language', 'project', 'job_function', 'first_name', 'last_name', 'recently_joined', 'is_military_veteran', 'recruiting_activity', 'hide_previously_viewed', 'group', 'is_past_applicant', 'notes', 'tags'],
  performSalesPeopleSearch: ['keywords', 'save_search', 'load_saved_search', 'load_recent_search', 'current_company', 'past_company', 'company_headcount', 'company_type', 'company_location', 'function', 'current_job_title', 'past_job_title', 'seniority', 'years_in_company', 'years_in_position', 'location', 'postal_code', 'industry', 'first_name', 'last_name', 'profile_language', 'years_of_experience', 'group', 'school', 'following_your_company', 'viewed_your_profile_recently', 'network_distance', 'connections_of', 'past_colleague', 'shared_experiences', 'changed_jobs', 'posted_on_linkedin', 'persona', 'account_list', 'lead_list', 'recent_interaction', 'saved_resources'],
};

const AUTH_PROVIDERS = ['imap', 'whatsapp', 'linkedin', 'mock', 'google', 'outlook', 'telegram', 'instagram'];
const LINK_PROVIDERS = ['*', '*:MESSAGING', '*:EMAILS', '*:CALENDAR', '*:SOCIAL', ...AUTH_PROVIDERS];

function authLinkProblems(b) {
  if (!isObj(b)) return ['corps JSON attendu'];
  const out = extra(b, ['account_scope_id', 'expires_on', 'domain', 'redirect_uri', 'state', 'config', 'providers', 'account_id'], 'corps');
  if (!isStr(b.expires_on) || Number.isNaN(Date.parse(b.expires_on))) out.push('expires_on obligatoire (date-heure ISO 8601)');
  if (!isUri(b.redirect_uri)) out.push('redirect_uri obligatoire (une seule adresse)');
  const hasProviders = b.providers !== undefined;
  const hasAccount = b.account_id !== undefined;
  if (hasProviders === hasAccount) out.push('exactement un de providers (nouveau compte) ou account_id (reconnexion)');
  if (hasAccount && !/^acc_/.test(String(b.account_id))) out.push('account_id doit valoir acc_...');
  if (hasProviders) {
    const list = Array.isArray(b.providers) ? b.providers : [b.providers];
    if (list.length === 0 || !list.every((p) => LINK_PROVIDERS.includes(p))) out.push('providers: valeurs minuscules de l\'énumération (linkedin, whatsapp...), ou *');
  }
  if (b.config !== undefined) {
    if (!isObj(b.config)) out.push('config: objet attendu');
    else out.push(...extra(b.config, ['google', 'outlook', 'linkedin', 'whatsapp', 'instagram', 'imap', 'telegram', 'global'], 'config'));
  }
  return out;
}

function authIntentProblems(b) {
  if (!isObj(b)) return ['corps JSON attendu'];
  if (!AUTH_PROVIDERS.includes(b.provider)) return ['provider obligatoire (énumération minuscule)'];
  const out = [];
  const c = b.credentials;
  if (b.account_id !== undefined && !/^acc_/.test(String(b.account_id))) out.push('account_id doit valoir acc_...');
  switch (b.provider) {
    case 'linkedin':
      if (!isObj(c)) out.push('credentials obligatoire');
      else if (c.access_token !== undefined) {
        if (!isStr(c.access_token) || !isStr(c.user_agent)) out.push('credentials (cookie): access_token et user_agent obligatoires');
        if (c.premium_token !== undefined) out.push('credentials: premium_access_token, pas premium_token');
      } else if (!isStr(c.username) || !isStr(c.password)) out.push('credentials: username et password, ou access_token et user_agent');
      break;
    case 'imap':
      if (!isObj(c) || !((isStr(c.user) && isStr(c.password)) || (isObj(c.imap) && isObj(c.smtp)))) out.push('credentials: user et password, ou imap et smtp');
      break;
    case 'whatsapp':
      if (!isObj(c) || !(c.qrcode === true || isStr(c.phone_number))) out.push('credentials: qrcode true, ou phone_number');
      else if (isStr(c.phone_number) && !/^\d+$/.test(c.phone_number)) out.push('phone_number: chiffres seulement, sans +');
      break;
    case 'google': case 'outlook':
      if (!isUri(b.oauth_callback_redirect_uri)) out.push('oauth_callback_redirect_uri obligatoire');
      break;
    case 'mock':
      if (!isObj(c)) out.push('credentials obligatoire (objet vide)');
      break;
    default:
      if (!isObj(c)) out.push('credentials obligatoire');
  }
  return out;
}

function sendEmailProblems(b, multipart) {
  if (multipart) return [];
  if (!isObj(b)) return ['corps JSON attendu'];
  const out = extra(b, ['to', 'cc', 'bcc', 'from', 'subject', 'html', 'plain_text', 'reply_to', 'reply_to_message_id', 'attachments', 'custom_headers', 'tracking_options'], 'corps');
  if (!Array.isArray(b.to) || b.to.length === 0 || !b.to.every((a) => isObj(a) && isStr(a.email))) out.push('to obligatoire (tableau de {email})');
  if (b.from !== undefined && !(isObj(b.from) && isStr(b.from.email))) out.push('from: un objet {email}, pas un tableau');
  for (const key of ['cc', 'bcc', 'reply_to']) {
    if (b[key] !== undefined && !(Array.isArray(b[key]) && b[key].every((a) => isObj(a) && isStr(a.email)))) out.push(`${key}: tableau de {email}`);
  }
  if (b.tracking_options !== undefined && (!isObj(b.tracking_options) || extra(b.tracking_options, ['opens', 'clicks', 'label', 'custom_domain'], 'tracking_options').length)) out.push('tracking_options: opens, clicks, label, custom_domain');
  if (isObj(b.tracking_options) && (b.tracking_options.opens === true || b.tracking_options.clicks === true) && !isStr(b.html)) out.push('tracking_options: html obligatoire pour le suivi');
  if (b.custom_headers !== undefined && !(Array.isArray(b.custom_headers) && b.custom_headers.every((h) => isObj(h) && isStr(h.name) && typeof h.value === 'string'))) out.push('custom_headers: tableau de {name, value} (chaînes)');
  return out;
}

// Paramètres de requête déclarés par opération (digests de la spécification) : un paramètre
// inconnu ou une taille de page hors bornes est un écart, comme une clé de corps inconnue.
function queryProblems(query, allowed, limitRange) {
  const out = [];
  for (const key of query.keys()) if (!allowed.includes(key)) out.push(`requête: paramètre inconnu « ${key} »`);
  if (query.has('limit')) {
    const limit = Number(query.get('limit'));
    const [min, max] = limitRange ?? [1, 100];
    if (!limitRange && !allowed.includes('limit')) return out;
    if (!Number.isInteger(limit) || limit < min || limit > max) out.push(`requête: limit entre ${min} et ${max}`);
  }
  return out;
}

const isArrOfStr = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');
const BARE_STRING_FORBIDDEN = ['location', 'seniority', 'skills', 'industry', 'company', 'current_company', 'past_company', 'school', 'job_title', 'degree', 'function', 'current_job_title', 'past_job_title'];

function searchBodyProblems(op, b) {
  if (b === '' || b === undefined) return [];
  if (!isObj(b)) return ['corps JSON attendu'];
  const out = extra(b, PEOPLE_SEARCH_KEYS[op], 'corps');
  if (op === 'performClassicPeopleSearch') {
    if (b.network_distance !== undefined && !(Array.isArray(b.network_distance) && b.network_distance.every((d) => [1, 2, 3].includes(d)))) out.push('network_distance: tableau de nombres 1, 2 ou 3');
    for (const key of ['location', 'current_company', 'past_company', 'school', 'industry', 'profile_language']) {
      if (b[key] !== undefined && !isArrOfStr(b[key])) out.push(`${key}: tableau d'identifiants (chaînes)`);
    }
    for (const key of ['connections_of', 'followers_of']) if (b[key] !== undefined && typeof b[key] !== 'string') out.push(`${key}: une seule chaîne`);
  } else {
    for (const key of BARE_STRING_FORBIDDEN) {
      if (typeof b[key] === 'string') out.push(`${key}: tableau ou objet {include, exclude} attendu, pas une chaîne`);
    }
  }
  return out;
}

function webhookCreateProblems(b, patch) {
  if (!isObj(b)) return ['corps JSON attendu'];
  const out = patch ? extra(b, ['trigger_events', 'account_ids', 'url', 'description', 'enabled'], 'corps') : [];
  if (!patch || b.trigger_events !== undefined) {
    if (!Array.isArray(b.trigger_events)) out.push('trigger_events obligatoire (tableau)');
    else for (const t of b.trigger_events) if (!TRIGGER_EVENTS.has(t)) out.push(`trigger_events: « ${t} » hors de l'énumération`);
  }
  if (!patch || b.url !== undefined) {
    if (!isStr(b.url) || !/^https?:\/\//.test(b.url) || b.url.length > 255) out.push('url obligatoire (http ou https, 255 caractères au plus)');
  }
  if (b.account_ids !== undefined && !(Array.isArray(b.account_ids) && b.account_ids.every((a) => /^acc_/.test(String(a))))) out.push('account_ids: identifiants acc_...');
  if (b.description !== undefined && (typeof b.description !== 'string' || b.description.length > 255)) out.push('description: 255 caractères au plus');
  if (!patch && b.enabled !== undefined) out.push('enabled: seulement à la modification');
  return out;
}

const CONTRACT = {
  startChat: (c) => startChatProblems(c.body),
  startChatFromInbox: (c) => startChatProblems(c.body),
  sendMessage: (c) => {
    const b = c.body;
    if (!isObj(b)) return ['corps JSON attendu'];
    const out = extra(b, ['text', 'quote_id', 'attachments', 'specifics'], 'corps');
    if (typeof b.text !== 'string') out.push('text obligatoire');
    // Un InMail ne se crée qu'avec la conversation ; ici seul specifics.linkedin.classic.shared_content existe.
    const li = b.specifics?.linkedin;
    if (b.specifics !== undefined) {
      if (!isObj(b.specifics) || !isObj(li) || Object.keys(b.specifics).some((k) => k !== 'linkedin') || Object.keys(li).some((k) => k !== 'classic')
        || (isObj(li.classic) && Object.keys(li.classic).some((k) => k !== 'shared_content'))) {
        out.push('specifics: seulement linkedin.classic.shared_content (inmail et subject n\'existent qu\'à la création de la conversation)');
      }
    }
    return out;
  },
  createRelationRequest: (c) => {
    const b = c.body;
    if (!isObj(b)) return ['corps JSON attendu'];
    const out = extra(b, ['user_id', 'message'], 'corps');
    if (!isStr(b.user_id)) out.push('user_id obligatoire');
    if (b.message !== undefined && typeof b.message !== 'string') out.push('message: chaîne attendue');
    return out;
  },
  visitUserProfile: (c) => {
    const token = c.query.get('token');
    if (!token) return ['token obligatoire (paramètre de requête notify_visit_token)'];
    // Le jeton vient d'une lecture de profil du même compte (specifics.notify_visit_token).
    if (!c.mode.any_visit_token && !accounts.get(c.acc)?.visit_tokens?.has(token)) return ['token inconnu : il vient du profil lu par ce compte (specifics.notify_visit_token)'];
    return [];
  },
  getRelationRequestsList: (c) => (['sent', 'received'].includes(c.query.get('type')) ? [] : ['type obligatoire (sent ou received)']),
  getInmailCredits: (c) => (!c.query.has('service') || ALL_LICENSES.includes(c.query.get('service')) ? [] : ['service: classic, recruiter ou sales_navigator']),
  // Classic : curseur seul, pas de limit (page fixe de 10). Recruiter : curseur et limit 1 à 100.
  // Sales Navigator : offset et limit 1 à 100, pas de curseur.
  performClassicPeopleSearch: (c) => [...searchBodyProblems('performClassicPeopleSearch', c.body), ...queryProblems(c.query, ['cursor'])],
  performRecruiterPeopleSearch: (c) => [...searchBodyProblems('performRecruiterPeopleSearch', c.body), ...queryProblems(c.query, ['cursor', 'limit'], [1, 100])],
  performSalesPeopleSearch: (c) => [...searchBodyProblems('performSalesPeopleSearch', c.body), ...queryProblems(c.query, ['offset', 'limit'], [1, 100])],
  performClassicCompaniesSearch: (c) => queryProblems(c.query, ['cursor']),
  performClassicPostsSearch: (c) => queryProblems(c.query, ['cursor', 'limit'], [1, 49]),
  performClassicJobsSearch: (c) => queryProblems(c.query, ['offset', 'limit'], [1, 50]),
  performSalesCompaniesSearch: (c) => queryProblems(c.query, ['offset', 'limit'], [1, 100]),
  performClassicSearchFromUrl: (c) => [...(isObj(c.body) && isStr(c.body.url) ? extra(c.body, ['url'], 'corps') : ['url obligatoire']), ...queryProblems(c.query, ['offset', 'limit', 'cursor'], [1, 100])],
  performRecruiterSearchFromUrl: (c) => [...(isObj(c.body) && isStr(c.body.url) ? extra(c.body, ['url'], 'corps') : ['url obligatoire']), ...queryProblems(c.query, ['offset', 'limit', 'cursor'], [1, 5000])],
  performSalesSearchFromUrl: (c) => [...(isObj(c.body) && isStr(c.body.url) ? extra(c.body, ['url'], 'corps') : ['url obligatoire']), ...queryProblems(c.query, ['offset', 'limit', 'cursor'], [1, 100])],
  getClassicSearchParameters: (c) => (c.query.get('type') && c.query.has('keywords') ? [] : ['type et keywords obligatoires']),
  sendEmail: (c) => sendEmailProblems(c.body, c.multipart),
  createAuthLink: (c) => authLinkProblems(c.body),
  startAuthIntent: (c) => authIntentProblems(c.body),
  solveCheckpoint: (c) => {
    const b = c.body;
    if (!isObj(b)) return ['corps JSON attendu'];
    const out = extra(b, ['code', 'intent_id'], 'corps');
    if (typeof b.code !== 'string') out.push('code obligatoire');
    if (!/^acc_/.test(String(b.intent_id))) out.push('intent_id obligatoire (acc_...)');
    return out;
  },
  requestCheckpoint: (c) => (isObj(c.body) && /^acc_/.test(String(c.body.intent_id)) ? extra(c.body, ['intent_id', 'challenge'], 'corps') : ['intent_id obligatoire (acc_...)']),
  resendCheckpoint: (c) => (isObj(c.body) && /^acc_/.test(String(c.body.intent_id)) ? extra(c.body, ['intent_id'], 'corps') : ['intent_id obligatoire (acc_...)']),
  createWebhookEndpoint: (c) => webhookCreateProblems(c.body, false),
  updateWebhookEndpoint: (c) => webhookCreateProblems(c.body, true),
  updateAccount: (c) => (isObj(c.body) ? extra(c.body, ['account_scope_id', 'metadata', 'auto_proxy_country', 'allow_country_fallback', 'proxy'], 'corps') : ['corps JSON attendu']),
  listWebhookConversations: (c) => (/^we_/.test(c.query.get('endpoint_id') ?? '') ? [] : ['endpoint_id obligatoire (we_...)']),
};

// ─── Webhooks : enveloppe, envoi, rejeu ─────────────────────────────────────

function defaultPayload(type, acc, mode) {
  const rec = accountRecord(acc);
  if (type === 'message.new') {
    const k = serial();
    const sender = mode.candidate_provider_id ?? 'ACoAAMOCKCANDIDATE';
    // Exactement les clés de la seule capture réelle (tests/fixtures/unipile-v2/webhook-events.json) :
    // ni specifics, ni drapeaux is_event / is_hidden. Un test qui veut d'autres champs les pose dans `payload`.
    return {
      id: `CLASSIC_${k}-MSG`, text: 'Bonjour', object: 'Message',
      sender: { id: sender, object: 'User', display_name: 'Test Candidat' },
      chat_id: `CLASSIC_${k}-CHAT`, is_seen: false, is_sender: false, sender_id: sender, timestamp: nowIso(), attachments: [],
    };
  }
  // Formes supposées (la spécification ne les détaille pas), minimales : de quoi retrouver le message et la conversation.
  if (type === 'message.receipt.read' || type === 'message.receipt.delivery') {
    const k = serial();
    return { message_id: `CLASSIC_${k}-MSG`, chat_id: `CLASSIC_${k}-CHAT`, is_seen: type === 'message.receipt.read' };
  }
  if (type === 'message.reaction.new' || type === 'message.reaction.delete') {
    const k = serial();
    return {
      message_id: `CLASSIC_${k}-MSG`, chat_id: `CLASSIC_${k}-CHAT`, reaction: 'like', is_sender: false,
      sender: { id: mode.candidate_provider_id ?? 'ACoAAMOCKCANDIDATE', object: 'User', display_name: 'Test Candidat' },
    };
  }
  if (type === 'relation.new') {
    return { object: 'UserRelation', id: `REL-${serial()}`, created_at: nowIso(), user: userLight('ACoAAMOCKCANDIDATE', mode) };
  }
  if (type.startsWith('account.')) {
    const account = accountObject(rec, mode);
    const status = /^account\.status\.(running|errored|disconnected|degraded|partial)$/.exec(type)?.[1];
    if (status) account.status = status;
    // degraded et partial : un produit au moins n'est pas en marche, sinon l'événement n'aurait rien à dire.
    if ((status === 'degraded' || status === 'partial') && Object.keys(account.metadata.products_connection_status).length > 0) {
      const products = { ...account.metadata.products_connection_status };
      const broken = Object.keys(products).find((k) => k !== 'classic') ?? 'classic';
      products[broken] = status === 'degraded' ? 'errored' : 'disconnected';
      account.metadata = { ...account.metadata, products_connection_status: products };
    }
    // Un compte retiré n'est plus « en marche » : l'événement ne le prétend pas.
    if (type === 'account.remove') delete account.status;
    if (type === 'account.locked') account.is_locked = true;
    if (type === 'account.unlocked') account.is_locked = false;
    const sync = /^account\.initial_sync\.(running|failed|completed)$/.exec(type)?.[1];
    if (sync) account.initial_sync = { status: sync, started_at: nowIso() };
    return account;
  }
  if (type === 'email.new') return emailObject(`mail_${serial()}`, mode);
  return {};
}

function buildEnvelope({ type, acc, payload, id, name, provider, created_at }) {
  const mode = modeOf(acc);
  const rec = accountRecord(acc);
  return {
    id: id ?? newId('evt'), type, created_at: created_at ?? nowIso(), hash: rid(8), account_scope_id: null,
    account_id: acc, application_id: APP_ID, application_production: false,
    account_name: name ?? rec.name, account_provider: provider ?? rec.provider,
    payload: { ...defaultPayload(type, acc, mode), ...(payload ?? {}) },
  };
}

const redactToken = (u) => String(u).replace(/(v2_token=)[^&]+/, '$1***');

function withToken(rawUrl, token) {
  const u = new URL(rawUrl);
  if (token) u.searchParams.set('v2_token', token);
  return u.toString();
}

async function deliver(url, envelope, meta = {}) {
  const started = Date.now();
  let status = null;
  let text = null;
  let error = null;
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(envelope), signal: AbortSignal.timeout(20000) });
    status = r.status;
    text = (await r.text()).slice(0, 2000);
  } catch (e) {
    error = String(e?.message ?? e);
  }
  const record = {
    at: nowIso(), account_id: envelope.account_id, event_id: envelope.id, type: envelope.type,
    endpoint_id: meta.endpoint_id ?? null, url: redactToken(url), http_status: status, response_body: text, error,
    first_attempt: meta.first_attempt ?? true, latency_ms: Date.now() - started,
  };
  deliveries.push(record);
  if (meta.endpoint_id) {
    conversations.push({
      object: 'WebhookConversation', id: newId('wc'), endpoint_id: meta.endpoint_id, event_id: envelope.id,
      event_type: envelope.type, first_attempt: record.first_attempt, created_at: record.at, http_status: status,
      endpoint_url: url, response_body: text, latency_ms: 0, response_time_ms: record.latency_ms,
    });
  }
  return record;
}

const endpointsFor = (envelope, onlyId) => [...endpoints.values()].filter((e) => e.enabled
  && (!onlyId || e.id === onlyId)
  && e.trigger_events.includes(envelope.type)
  && (e.account_ids.length === 0 || e.account_ids.includes(envelope.account_id)));

// ─── Points de contrôle d'authentification ──────────────────────────────────

const CHECKPOINT_RESERVED = ['checkpoint', 'expect_code', 'then_expect_code'];

function checkpointReply(intent) {
  const step = intent.steps[intent.idx];
  if (step.error) {
    intent.idx += 1;
    return [step.error.status ?? 400, step.error.body ?? { title: 'Mock auth error' }];
  }
  if (step.qrcode !== undefined) return [200, { object: 'AuthenticationQrCode', qrcode: step.qrcode, intent_id: intent.id }];
  if (step.oauth_url !== undefined) return [200, { object: 'OauthUrl', url: step.oauth_url }];
  const checkpoint = { type: step.checkpoint };
  for (const [k, v] of Object.entries(step)) if (!CHECKPOINT_RESERVED.includes(k)) checkpoint[k] = v;
  if (step.checkpoint === 'CAPTCHA') { checkpoint.public_key ??= null; checkpoint.data ??= null; }
  return [200, { object: 'AuthenticationCheckpoint', checkpoint, intent_id: intent.id }];
}

function intentResult(intent) {
  if (intent.idx >= intent.steps.length) {
    const rec = accountRecord(intent.id, { provider: intent.provider });
    rec.provider = intent.provider;
    rec.status = 'running';
    rec.name = intent.label ?? rec.name;
    intent.done = true;
    return [200, accountObject(rec, modeOf(intent.id))];
  }
  return checkpointReply(intent);
}

function defaultSteps(body) {
  if (body.provider === 'whatsapp') return [{ qrcode: `mock-qr-${rid(12)}` }];
  if (body.provider === 'google' || body.provider === 'outlook') return [{ oauth_url: `https://oauth.mock.invalid/${body.provider}/${rid(10)}` }];
  return [];
}

// ─── Table des routes v2 ────────────────────────────────────────────────────
// Routes d'un compte : expression sur la suite du chemin après /v2/{acc_...}.
// Routes d'application : expression sur le chemin complet. Un handler rend
// [statut, corps, options?] (options : headers, delay_ms).

const T_NOT_FOUND = { status: 404, type: 'errors/resource_not_found', title: 'Not found', detail: 'mock' };
const inbox = (license) => ({ object: 'Inbox', id: `INBOX_${license.toUpperCase()}`, description: license, disabled: false });

const ACCOUNT_ROUTES = [
  ['getInboxesList', 'GET', /^\/inboxes$/, (c) => [200, { data: licensesOf(c.mode).map(inbox), total_count: licensesOf(c.mode).length }]],
  ['getInboxChatsList', 'GET', /^\/inboxes\/([^/]+)\/chats$/, () => [200, { data: [] }]],
  ['startChatFromInbox', 'POST', /^\/inboxes\/([^/]+)\/chats\/send$/, (c) => {
    if (!licensesOf(c.mode).some((l) => inbox(l).id === c.m[1])) return [404, T_NOT_FOUND];
    return [200, { object: 'ChatStarted', chat_id: `CLASSIC_${serial()}-CHAT`, message_id: messageIds(c.mode) }];
  }],
  ['getChatsList', 'GET', /^\/chats$/, () => [200, { data: [] }]],
  ['startChat', 'POST', /^\/chats\/send$/, (c) => [200, { object: 'ChatStarted', chat_id: `CLASSIC_${serial()}-CHAT`, message_id: messageIds(c.mode) }]],
  ['getChat', 'GET', /^\/chats\/([^/]+)$/, (c) => [200, chatObject(decodeURIComponent(c.m[1]), c.mode)]],
  ['updateChat', 'PATCH', /^\/chats\/([^/]+)$/, (c) => [200, chatObject(decodeURIComponent(c.m[1]), c.mode)]],
  ['deleteChat', 'DELETE', /^\/chats\/([^/]+)$/, () => [204]],
  ['getMessagesList', 'GET', /^\/chats\/([^/]+)\/messages$/, () => [200, { data: [] }]],
  ['sendMessage', 'POST', /^\/chats\/([^/]+)\/messages\/send$/, (c) => [200, { object: 'MessageSent', message_id: messageIds(c.mode) }]],
  ['getMessage', 'GET', /^\/chats\/([^/]+)\/messages\/([^/]+)$/, (c) => [200, messageObject({
    id: decodeURIComponent(c.m[2]), chat_id: decodeURIComponent(c.m[1]), sender_id: c.mode.candidate_provider_id ?? 'ACoAAMOCKCANDIDATE',
    is_sender: c.mode.message_is_sender === true, text: c.mode.message_text ?? '' }, c.mode)]],
  ['deleteMessage', 'DELETE', /^\/chats\/([^/]+)\/messages\/([^/]+)$/, () => [204]],
  ['readMessage', 'POST', /^\/chats\/([^/]+)\/messages\/([^/]+)\/read$/, () => [200, { object: 'MessageRead' }]],
  // Spec : « Trying to retrieve the list of participants of a 1to1 chat will fail ».
  ['getParticipantsList', 'GET', /^\/chats\/([^/]+)\/participants$/, () => [400, { status: 400, type: 'errors/invalid_parameters', title: 'Bad request', detail: 'participants of a 1to1 chat' }]],
  ['getUserChat', 'GET', /^\/users\/([^/]+)\/chat$/, () => [200, { object: 'ChatLookup', data: [] }]],
  ['visitUserProfile', 'POST', /^\/users\/visit-profile$/, () => [200, { object: 'ProfileVisited' }]],
  ['getRelationRequestsList', 'GET', /^\/users\/me\/relation-requests$/, (c) => [200, { data: c.mode.relation_requests ?? [] }]],
  ['createRelationRequest', 'POST', /^\/users\/me\/relation-requests$/, (c) => [201, {
    object: 'RelationRequest', type: 'sent', id: String(serial()), created_at: nowIso(),
    ...(isObj(c.body) && typeof c.body.message === 'string' ? { message: c.body.message } : {}),
  }]],
  ['cancelRelationRequest', 'POST', /^\/users\/me\/relation-requests\/([^/]+)\/cancel$/, () => [200, { object: 'RelationRequestCanceled' }]],
  ['acceptRelationRequest', 'POST', /^\/users\/me\/relation-requests\/([^/]+)\/accept$/, () => [200, { object: 'RelationRequestConfirmed' }]],
  ['deleteRelation', 'DELETE', /^\/users\/me\/relations\/([^/]+)$/, () => [204]],
  ['getUserRelations', 'GET', /^\/users\/([^/]+)\/relations$/, () => [200, { data: [] }]],
  ['getUserProfile', 'GET', /^\/users\/([^/]+)$/, (c) => {
    const id = decodeURIComponent(c.m[1]);
    c.entry.id_kind = id === 'me' ? 'me' : isProviderId(id) ? 'provider_id' : 'slug';
    const profile = userProfile(id, c.mode, c.acc);
    Object.assign(profile.specifics, userSections(c.query, c.mode));
    return [200, profile];
  }],
  ['getInmailCredits', 'GET', /^\/linkedin\/inmail-credits$/, (c) => {
    const all = c.mode.inmail_credits === undefined
      ? Object.fromEntries(licensesOf(c.mode).map((l) => [l, 10]))
      : c.mode.inmail_credits ?? {};
    const service = c.query.get('service');
    const credits = service ? Object.fromEntries(Object.entries(all).filter(([k]) => k === service)) : all;
    return [200, { object: 'InmailCredits', credits }];
  }],
  ['getAvailableContracts', 'GET', /^\/linkedin\/contracts$/, (c) => [200, { object: 'AvailableContracts', contracts: contractsOf(c) }]],
  ['selectContract', 'POST', /^\/linkedin\/contracts\/([^/]+)\/select$/, (c) => {
    const contracts = contractsOf(c);
    const chosen = contracts.find((x) => x.id === decodeURIComponent(c.m[1]));
    if (!chosen) return [404, T_NOT_FOUND];
    accountRecord(c.acc).selected_contract = chosen.id;
    return [200, { object: 'ContractSelected', contract: { ...chosen, selected: true } }];
  }],
  ['getClassicSearchParameters', 'GET', /^\/linkedin\/search\/parameters$/, () => [200, { data: [] }]],
  ['performClassicSearchFromUrl', 'POST', /^\/linkedin\/search$/, (c) => searchReply(c, 'classic')],
  ['performClassicPeopleSearch', 'POST', /^\/linkedin\/search\/people$/, (c) => searchReply(c, 'classic')],
  ['performClassicCompaniesSearch', 'POST', /^\/linkedin\/search\/companies$/, () => [200, { data: [] }]],
  ['getClassicCompanyProfile', 'GET', /^\/linkedin\/company\/([^/]+)$/, (c) => [200, {
    object: 'CompanyProfile', id: decodeURIComponent(c.m[1]), name: 'Société test', is_school: false, is_active: true,
    is_archived: false, is_employee: false, is_verified: false, is_claimable: false, is_claimable_by_viewer: false,
    mailbox: { id: 'mailbox_mock', enabled: true }, viewer_roles: [], locations: [], industry: [], insights: {}, hashtags: [],
  }]],
  ['getRecruiterHiringProjectList', 'GET', /^\/linkedin\/recruiter\/projects$/, () => [200, { data: [] }]],
  ['performRecruiterSearchFromUrl', 'POST', /^\/linkedin\/recruiter\/search$/, (c) => searchReply(c, 'recruiter')],
  ['getRecruiterSearchParameters', 'POST', /^\/linkedin\/recruiter\/search\/parameters$/, () => [200, { data: [] }]],
  ['performRecruiterPeopleSearch', 'POST', /^\/linkedin\/recruiter\/search\/people$/, (c) => searchReply(c, 'recruiter')],
  ['performSalesSearchFromUrl', 'POST', /^\/linkedin\/sales-navigator\/search$/, (c) => searchReply(c, 'sales_navigator')],
  ['getSalesSearchParameters', 'GET', /^\/linkedin\/sales-navigator\/search\/parameters$/, () => [200, { data: [] }]],
  ['performSalesPeopleSearch', 'POST', /^\/linkedin\/sales-navigator\/search\/people$/, (c) => searchReply(c, 'sales_navigator')],
  ['sendEmail', 'POST', /^\/emails\/send$/, (c) => {
    const k = serial();
    return [200, { object: 'EmailSent', id: `mail_${k}`, ...(c.mode.email_message_id === false ? {} : { message_id: `<mock-${k}@mock.invalid>` }) }];
  }],
  ['getEmailsList', 'GET', /^\/emails$/, (c) => [200, { data: c.mode.emails ?? [] }]],
  ['getEmail', 'GET', /^\/emails\/([^/]+)$/, (c) => [200, emailObject(decodeURIComponent(c.m[1]), c.mode)]],
  ['readEmail', 'POST', /^\/emails\/([^/]+)\/read$/, () => [200, { object: 'EmailRead' }]],
  ['getThread', 'GET', /^\/threads\/([^/]+)$/, (c) => [200, { object: 'Thread', id: decodeURIComponent(c.m[1]), emails: [] }]],
  ['getEmailSenders', 'GET', /^\/email-senders$/, () => [200, { data: [] }]],
  // Lecture d'un dossier (la façon exhaustive de relire les réponses d'une boîte) : mêmes courriers que /emails.
  ['getFolderEmailsList', 'GET', /^\/folders\/([^/]+)\/emails$/, (c) => [200, { data: c.mode.emails ?? [] }]],
  ['getPostsList', 'GET', /^\/users\/([^/]+)\/posts$/, (c) => [200, { data: c.mode.posts ?? [] }]],
  ['performClassicPostsSearch', 'POST', /^\/linkedin\/search\/posts$/, () => [200, { data: [] }]],
  ['performClassicJobsSearch', 'POST', /^\/linkedin\/search\/jobs$/, () => [200, { data: [] }]],
  ['performSalesCompaniesSearch', 'POST', /^\/linkedin\/sales-navigator\/search\/companies$/, () => [200, { data: [] }]],
  ['getCalendarsList', 'GET', /^\/calendars$/, () => [200, { data: [] }]],
  ['getCalendarEventList', 'GET', /^\/calendars\/([^/]+)\/events$/, () => [200, { data: [] }]],
];

function contractsOf(c) {
  const rec = accountRecord(c.acc);
  const list = c.mode.contracts ?? licensesOf(c.mode).filter((l) => l !== 'classic')
    .map((product) => ({ product, id: `mock-contract-${product}`, name: `Contrat ${product} (test)` }));
  const selected = rec.selected_contract ?? list[0]?.id;
  return list.map((x) => ({ object: 'Contract', selected: x.id === selected, ...x }));
}

function searchReply(c, product) {
  const data = (c.mode.search_results ?? []).map((r) => peopleResult(r, product));
  return [200, { data, ...(c.mode.search_next_cursor ? { next_cursor: c.mode.search_next_cursor } : {}) }];
}

const endpointObject = (e) => ({
  object: 'WebhookEndpoint', id: e.id, application_id: APP_ID, enabled: e.enabled, description: e.description ?? null,
  url: e.url, trigger_events: e.trigger_events, secret: e.secret, account_ids: e.account_ids,
  account_targets: e.account_ids.map((id) => ({ object: 'WebhookEndpointAccountTarget', id, account_name: null, account_provider: 'linkedin', status: 'active' })),
});

const APP_ROUTES = [
  ['listAccounts', 'GET', /^\/v2\/accounts$/, (c) => {
    const q = c.query;
    const all = [...accounts.values()].filter((r) => !r.removed).map((r) => accountObject(r, modeOf(r.id)))
      .filter((a) => (!q.get('provider') || a.provider === q.get('provider'))
        && (!q.get('status') || a.status === q.get('status'))
        && (!q.get('search') || a.id.includes(q.get('search')) || (a.name ?? '').includes(q.get('search'))))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const { items, has_more } = page(all, q);
    return [200, { object: 'Accounts', data: items, has_more }];
  }],
  ['getAccount', 'GET', /^\/v2\/accounts\/([^/]+)$/, (c) => {
    const rec = accounts.get(c.m[1]);
    if (c.mode.missing || rec?.removed) return [404, T_NOT_FOUND];
    // Une connexion native non terminée n'est pas un compte : l'identifiant de l'intent ne s'y lit pas.
    if (!rec && intents.has(c.m[1])) return [404, T_NOT_FOUND];
    // Mode strict : un identifiant jamais créé ni configuré n'existe pas.
    if (!rec && c.mode.strict_accounts && !modes[c.m[1]]) return [404, T_NOT_FOUND];
    return [200, accountObject(accountRecord(c.m[1]), c.mode)];
  }],
  ['updateAccount', 'PATCH', /^\/v2\/accounts\/([^/]+)$/, (c) => {
    if (c.mode.missing || accounts.get(c.m[1])?.removed) return [404, T_NOT_FOUND];
    const rec = accountRecord(c.m[1]);
    const b = isObj(c.body) ? c.body : {};
    if (b.metadata !== undefined) rec.custom_data = b.metadata;
    if (b.proxy !== undefined) rec.proxy = b.proxy === null ? undefined : { country: null, auto_proxy: false, host: b.proxy.host, port: b.proxy.port, protocol: b.proxy.protocol ?? 'https' };
    return [200, accountObject(rec, c.mode)];
  }],
  ['removeAccount', 'DELETE', /^\/v2\/accounts\/([^/]+)$/, (c) => {
    if (c.mode.missing || accounts.get(c.m[1])?.removed) return [404, T_NOT_FOUND];
    accountRecord(c.m[1]).removed = true;
    return [200, { success: true }];
  }],
  ['createAuthLink', 'POST', /^\/v2\/auth\/link$/, (c) => {
    const b = c.body;
    const token = rid(24);
    links.set(token, { token, state: b.state ?? null, redirect_uri: b.redirect_uri, account_id: b.account_id ?? null, providers: b.providers ?? null });
    if (b.account_id) c.entry.account_id = b.account_id;
    return [200, { object: 'HostedAuthLink', link: `https://${b.domain ?? 'auth.unipile.com'}/${token}` }];
  }],
  ['startAuthIntent', 'POST', /^\/v2\/auth\/intent$/, (c) => {
    const b = c.body;
    const candidates = [b.credentials?.username, b.credentials?.user, b.credentials?.imap?.user, b.credentials?.phone_number, b.state, b.account_id].filter(Boolean);
    const script = authScripts.find((s) => candidates.includes(s.match));
    // Une erreur en tête de script vaut pour les `times` premières tentatives (1 par défaut) :
    // chaque tentative est un nouvel intent, l'erreur ne peut donc pas être une étape d'un intent.
    const lead = script?.steps[0];
    if (lead?.error) {
      lead.left ??= lead.times ?? 1;
      lead.left -= 1;
      if (lead.left <= 0) script.steps.shift();
      return [lead.error.status ?? 400, lead.error.body ?? { title: 'Mock auth error' }];
    }
    const intent = {
      id: b.account_id ?? newId('acc'), provider: b.provider, state: b.state ?? null, idx: 0,
      steps: script ? structuredClone(script.steps) : defaultSteps(b),
      label: b.credentials?.username ?? b.credentials?.user ?? b.credentials?.phone_number ?? null,
    };
    intents.set(intent.id, intent);
    c.entry.account_id = intent.id;
    return intentResult(intent);
  }],
  ['solveCheckpoint', 'POST', /^\/v2\/auth\/checkpoint$/, (c) => {
    const intent = intents.get(c.body.intent_id);
    c.entry.account_id = c.body.intent_id;
    if (!intent || intent.done) return [404, { status: 404, type: 'errors/resource_not_found', title: 'Intent not found' }];
    const step = intent.steps[intent.idx];
    if (step?.expect_code !== undefined && String(c.body.code) !== String(step.expect_code)) {
      return [400, { status: 400, type: 'errors/invalid_checkpoint', title: 'Invalid code' }];
    }
    intent.idx += 1;
    return intentResult(intent);
  }],
  ['requestCheckpoint', 'POST', /^\/v2\/auth\/checkpoint\/request$/, (c) => {
    const intent = intents.get(c.body.intent_id);
    c.entry.account_id = c.body.intent_id;
    if (!intent || intent.done) return [404, { status: 404, type: 'errors/resource_not_found', title: 'Intent not found' }];
    const step = intent.steps[intent.idx];
    if (step?.checkpoint === 'CHALLENGE_SELECTION' && c.body.challenge) {
      intent.steps[intent.idx] = { checkpoint: 'OTP', channel: c.body.challenge, expect_code: step.then_expect_code };
    } else if (c.body.challenge && step?.checkpoint === 'OTP') step.channel = c.body.challenge;
    return checkpointReply(intent);
  }],
  ['resendCheckpoint', 'POST', /^\/v2\/auth\/checkpoint\/resend$/, (c) => {
    c.entry.account_id = c.body.intent_id;
    return intents.has(c.body.intent_id) ? [204] : [404, { status: 404, type: 'errors/resource_not_found', title: 'Intent not found' }];
  }],
  ['createWebhookEndpoint', 'POST', /^\/v2\/webhooks\/endpoints$/, (c) => {
    const b = c.body;
    const e = { id: newId('we'), enabled: true, description: b.description ?? null, url: b.url, trigger_events: b.trigger_events, secret: rid(32), account_ids: b.account_ids ?? [] };
    endpoints.set(e.id, e);
    return [200, endpointObject(e)];
  }],
  ['listWebhookEndpoints', 'GET', /^\/v2\/webhooks\/endpoints$/, (c) => {
    const { items, has_more } = page([...endpoints.values()], c.query);
    return [200, { object: 'WebhookEndpoints', data: items.map(endpointObject), has_more }];
  }],
  ['getWebhookEndpoint', 'GET', /^\/v2\/webhooks\/endpoints\/([^/]+)$/, (c) => (endpoints.has(c.m[1]) ? [200, endpointObject(endpoints.get(c.m[1]))] : [404, T_NOT_FOUND])],
  ['updateWebhookEndpoint', 'PATCH', /^\/v2\/webhooks\/endpoints\/([^/]+)$/, (c) => {
    const e = endpoints.get(c.m[1]);
    if (!e) return [404, T_NOT_FOUND];
    Object.assign(e, Object.fromEntries(Object.entries(c.body).filter(([k]) => ['trigger_events', 'account_ids', 'url', 'description', 'enabled'].includes(k))));
    return [200, endpointObject(e)];
  }],
  ['deleteWebhookEndpoint', 'DELETE', /^\/v2\/webhooks\/endpoints\/([^/]+)$/, (c) => {
    if (!endpoints.delete(c.m[1])) return [404, T_NOT_FOUND];
    return [200, { success: true }];
  }],
  ['listWebhookConversations', 'GET', /^\/v2\/webhooks\/conversations$/, (c) => {
    const rows = conversations.filter((w) => w.endpoint_id === c.query.get('endpoint_id')
      && (!c.query.get('event_id') || w.event_id === c.query.get('event_id'))).reverse();
    const { items, has_more } = page(rows, c.query);
    return [200, { object: 'WebhookConversations', data: items, has_more }];
  }],
  ['replayWebhookEvent', 'POST', /^\/v2\/webhooks\/events\/([^/]+)\/replay$/, (c) => {
    const envelope = events.get(c.m[1]);
    if (!envelope) return [404, T_NOT_FOUND];
    const targets = endpointsFor(envelope, c.query.get('endpoint_id'));
    // 202 : la remise est asynchrone, avec l'identifiant et la charge d'origine.
    setImmediate(() => { for (const e of targets) void deliver(e.url, envelope, { endpoint_id: e.id, first_attempt: false }); });
    return [202, { object: 'EventReplay', event_id: envelope.id, endpoint_ids: targets.map((e) => e.id) }];
  }],
];

const APP_SEGMENTS = new Set(['accounts', 'auth', 'webhooks', 'api-keys', 'scopes']);
const stripSlash = (s) => (s.length > 1 ? s.replace(/\/+$/, '') : s);

// ─── Violations et détection de l'ancienne API ──────────────────────────────

const V1_FAMILIES = /^\/api\/v1\/(chats|chat_attendees|users|accounts|linkedin|emails|messages|hosted|webhooks|posts|companies|calendars|folders|attendees|drafts)(\/|$)/;

// Ancienne API : chemin /api/v1/... d'un hôte du fournisseur (ou sans hôte), ou dont la
// première famille de chemin est connue. Les chemins /api/v1 d'autres fournisseurs
// (Apollo : /api/v1/mixed_people/api_search) ne comptent pas.
function looksLikeV1(host, p) {
  const unipileHost = Boolean(host && /unipile/i.test(host));
  if (/\/api\/v1(\/|$)/.test(p)) return unipileHost || host === null || V1_FAMILIES.test(p);
  return host === V2_HOST && !(p === '/v2' || p.startsWith('/v2/')) && !p.startsWith('/__');
}

function violation(kind, entry, detail) {
  violations.push({ at: nowIso(), kind, method: entry.method, path: entry.path, account_id: entry.account_id ?? null, host: entry.host ?? null, detail });
}

// ─── Réponse ────────────────────────────────────────────────────────────────

function reply(res, entry, status, body, opts = {}) {
  const go = () => {
    if (opts.network_error) { entry.status = 0; res.socket?.destroy(); return; }
    entry.status = status;
    send(res, status, body, opts.headers);
  };
  return opts.delay_ms ? setTimeout(go, opts.delay_ms) : go();
}

function scriptedRoutes(acc) {
  const own = acc ? modes[acc]?.routes ?? [] : [];
  const shared = modes['*']?.routes ?? [];
  const appLevel = acc ? [] : Object.values(modes).flatMap((value) => value?.routes ?? []).filter((r) => r.unscoped === true || r.app_level === true);
  return [...own, ...shared, ...appLevel];
}

function routeMatches(r, ctx) {
  return (!r.method || r.method === ctx.method)
    && (r.op === undefined || r.op === ctx.op)
    && (r.url !== undefined ? new RegExp(r.url).test(ctx.p + ctx.search) : r.path !== undefined ? new RegExp(r.path).test(ctx.p) : true)
    && (r.times === undefined || r.times > 0);
}

function fromSpec(spec) {
  const preset = spec.preset ? ERROR_PRESETS[spec.preset] : null;
  if (spec.preset && !preset) return [500, { object: 'MockError', detail: `preset inconnu : ${spec.preset}` }, {}];
  return [
    spec.status ?? preset?.status ?? 200,
    spec.body ?? preset?.body ?? {},
    { headers: { ...(preset?.headers ?? {}), ...(spec.headers ?? {}) }, delay_ms: spec.delay_ms, network_error: spec.network_error === true },
  ];
}

// Refus d'un appel fait au nom d'un compte retiré, verrouillé ou dont la session est coupée.
function accountRefusal(acc, mode) {
  const rec = accountRecord(acc);
  if (rec.removed) return [404, T_NOT_FOUND];
  if (mode.allow_when_locked) return null;
  if (mode.locked ?? rec.is_locked) return [403, { status: 403, type: 'errors/account_locked', title: 'Forbidden', detail: 'Account is locked' }];
  const status = mode.status ?? rec.status;
  if (status === 'disconnected') return [403, ERROR_PRESETS.forbidden?.body ?? { status: 403, type: 'errors/forbidden', title: 'Forbidden', detail: 'Please reconnect this account' }];
  if (status === 'errored') return [503, { status: 503, type: 'errors/service_unavailable', title: 'Service unavailable', detail: 'Account errored' }];
  return null;
}

const SEND_OPS = ['startChat', 'startChatFromInbox', 'sendMessage', 'createRelationRequest', 'sendEmail'];

function handleV2(req, res, url, entry, body, multipart) {
  const p = url.pathname;
  entry.api = 'v2';
  const host = entry.host;
  // Rattachement au compte avant tout contrôle : une violation d'hôte, de clé ou de route
  // est consignée sous le compte du chemin (ou de l'intent / du compte du corps pour /v2/auth).
  const first = /^\/v2\/([^/]+)(?:\/([^/]+))?/.exec(p);
  if (first) {
    const fromPath = APP_SEGMENTS.has(first[1]) ? (first[1] === 'accounts' ? first[2] : null) : first[1];
    const fromBody = first[1] === 'auth' && isObj(body) ? body.intent_id ?? body.account_id : null;
    const id = fromPath ?? fromBody;
    entry.account_id = typeof id === 'string' && /^acc_/.test(id) ? id : null;
  }
  if (host && host !== V2_HOST) {
    violation('wrong_host', entry, `hôte ${host}`);
    return reply(res, entry, 599, { object: 'MockViolation', kind: 'wrong_host', detail: 'unexpected host for the v2 API' });
  }
  if (req.headers['x-api-key'] !== V2_API_KEY) {
    violation('bad_api_key', entry, 'X-API-KEY absente ou inattendue');
    return reply(res, entry, 401, { status: 401, type: 'errors/invalid_credentials', title: 'Invalid credentials' });
  }
  const seg = /^\/v2\/([^/]+)/.exec(p)?.[1] ?? null;
  const appLevel = seg === null || APP_SEGMENTS.has(seg);
  let acc = null;
  let rest = null;
  let route;
  let m;
  if (appLevel) {
    const clean = stripSlash(p);
    // La barre finale fait partie du chemin de ces trois collections (digest accounts-auth) : on les
    // sert sans, mais l'écart est consigné pour qu'un client qui la perd soit vu.
    if (clean === p && /^\/v2\/(accounts|webhooks\/endpoints|webhooks\/conversations)$/.test(p)) {
      violation('contract_violation', entry, `barre finale obligatoire : ${p}/`);
    }
    for (const r of APP_ROUTES) {
      if (r[1] !== req.method) continue;
      const found = r[2].exec(clean);
      if (found) { route = r; m = found; break; }
    }
    if (route && seg === 'accounts' && m[1]) {
      if (!/^acc_/.test(m[1])) {
        violation('bad_account_id', entry, `identifiant ${m[1]}`);
        return reply(res, entry, 400, { status: 400, type: 'errors/invalid_parameters', title: 'Bad request', detail: 'account_id must match acc_' });
      }
      acc = m[1];
    }
  } else {
    if (!/^acc_/.test(seg)) {
      violation('bad_account_id', entry, `identifiant ${seg}`);
      return reply(res, entry, 400, { status: 400, type: 'errors/invalid_parameters', title: 'Bad request', detail: 'account_id must match acc_' });
    }
    acc = seg;
    rest = stripSlash(p.slice(`/v2/${seg}`.length) || '/');
    for (const r of ACCOUNT_ROUTES) {
      if (r[1] !== req.method) continue;
      const found = r[2].exec(rest);
      if (found) { route = r; m = found; break; }
    }
    accountRecord(acc);
  }
  if (acc) entry.account_id = acc;
  const mode = modeOf(acc);
  const ctx = { req, method: req.method, p, search: url.search, query: url.searchParams, body, multipart, acc, mode, m, entry, op: route?.[0] ?? null };
  entry.op = ctx.op;
  entry.contract_skipped = multipart || undefined;

  const problems = route && CONTRACT[ctx.op] ? CONTRACT[ctx.op](ctx) : [];
  if (problems.length) {
    entry.contract = { violations: problems };
    violation('contract_violation', entry, problems.join(' ; '));
  }

  const scripted = scriptedRoutes(acc).find((r) => routeMatches(r, ctx));
  if (scripted) {
    if (scripted.times !== undefined) scripted.times -= 1;
    entry.scripted = true;
    const [status, replyBody, opts] = fromSpec(scripted);
    return reply(res, entry, status, replyBody, opts);
  }
  const injected = mode.error;
  if (injected && (!injected.ops || injected.ops.includes(ctx.op)) && (!injected.methods || injected.methods.includes(req.method))
    && (injected.times === undefined || injected.times > 0)) {
    if (injected.times !== undefined) injected.times -= 1;
    entry.scripted = true;
    const [status, replyBody, opts] = fromSpec(injected);
    return reply(res, entry, status, replyBody, opts);
  }
  // État du compte : un compte retiré n'existe plus, un compte verrouillé ou déconnecté refuse tout appel.
  if (acc && !appLevel && route) {
    const refusal = accountRefusal(acc, mode);
    if (refusal) return reply(res, entry, refusal[0], refusal[1]);
  }
  if (!route) {
    violation('unhandled', entry, 'route v2 inconnue du faux fournisseur');
    return reply(res, entry, 501, { object: 'MockViolation', kind: 'unhandled', detail: 'route not implemented by the mock' });
  }
  if (mode.fail_send && SEND_OPS.includes(ctx.op)) {
    return reply(res, entry, mode.fail_send, { status: mode.fail_send, type: 'errors/mock_failure', title: 'Mock failure' });
  }
  if (problems.length) {
    return reply(res, entry, 422, { object: 'MockViolation', kind: 'contract_violation', violations: problems });
  }
  const [status, replyBody] = route[3](ctx);
  return reply(res, entry, status, replyBody);
}

// ─── Autres prestataires (IA, e-mail, Notion...) ────────────────────────────

function handleOther(req, res, url, entry, body, raw) {
  const p = url.pathname;
  const account_id = url.searchParams.get('account_id') ?? (body && typeof body === 'object' ? body.account_id : undefined) ?? null;
  entry.account_id = account_id;
  const mode = modeOf(account_id);
  const ctx = { method: req.method, p, search: url.search, op: null };
  const route = scriptedRoutes(account_id).find((r) => routeMatches(r, ctx));
  if (route) {
    if (route.times !== undefined) route.times -= 1;
    entry.scripted = true;
    const [status, replyBody, opts] = fromSpec(route);
    return reply(res, entry, status, replyBody, opts);
  }
  serial();
  // IA. Réponse par marqueur : un test pose { "<compte>": { "ai_markers": { "<marqueur>": "<texte>" } } }
  // et place le marqueur dans ce qu'il fait lire à l'IA (message, profil). Aucun
  // appel à l'IA ne porte de compte : sans marqueur, seule la clé '*' s'appliquerait.
  if (req.method === 'POST' && p === '/v1/messages') {
    const marked = Object.values(modes).flatMap((value) => Object.entries(value?.ai_markers ?? {}))
      .find(([marker]) => marker && raw.includes(marker));
    const recipe = Object.values(modes).flatMap((value) => Object.entries(value?.action_recipes ?? {}))
      .find(([marker]) => marker && raw.includes(marker));
    const aiReply = !marked && recipe ? candidateActionReply(body, recipe[1], n)
      : { content: [{ type: 'text', text: marked ? marked[1] : mode.ai_text ?? 'Bonjour, votre parcours m’intéresse. Seriez-vous ouvert à un échange ?' }], stop_reason: 'end_turn' };
    return reply(res, entry, 200, {
      id: `msg_ai_${n}`, type: 'message', role: 'assistant', model: body?.model ?? 'mock',
      ...aiReply, usage: { input_tokens: 10, output_tokens: 10 },
    });
  }
  return reply(res, entry, 200, { object: 'Mock', items: [] });
}

// ─── Surface de contrôle ────────────────────────────────────────────────────

async function control(req, res, url, raw) {
  const p = url.pathname;
  const acc = url.searchParams.get('account_id');
  const json = () => (raw ? JSON.parse(raw) : {});
  if (p === '/__log') {
    if (req.method === 'DELETE') {
      log = []; modes = {}; violations = []; deliveries = []; accounts = new Map(); intents = new Map(); authScripts = [];
      links = new Map(); endpoints = new Map(); conversations = []; events = new Map();
      return send(res, 200, { ok: true });
    }
    return send(res, 200, acc ? log.filter((e) => e.account_id === acc) : log);
  }
  if (p === '/__mode') {
    if (req.method === 'POST') Object.assign(modes, json());
    return send(res, 200, modes);
  }
  if (p === '/__violations') {
    if (req.method === 'DELETE') { violations = []; return send(res, 200, { ok: true }); }
    const kind = url.searchParams.get('kind');
    return send(res, 200, violations.filter((v) => (!acc || v.account_id === acc) && (!kind || v.kind === kind)));
  }
  if (p === '/__deliveries') return send(res, 200, acc ? deliveries.filter((d) => d.account_id === acc) : deliveries);
  if (p === '/__auth_script' && req.method === 'POST') {
    const b = json();
    if (!isStr(b.match) || !Array.isArray(b.steps)) return send(res, 400, { error: 'match (chaîne) et steps (tableau) obligatoires' });
    authScripts = authScripts.filter((s) => s.match !== b.match);
    authScripts.push({ match: b.match, steps: b.steps });
    return send(res, 200, { ok: true, steps: b.steps.length });
  }
  if (p === '/__fire' && req.method === 'POST') {
    const b = json();
    if (!/^acc_/.test(String(b.account_id))) return send(res, 400, { error: 'account_id obligatoire (acc_...)' });
    if (!TRIGGER_EVENTS.has(b.type)) return send(res, 400, { error: `type hors de l'énumération des événements : ${b.type}` });
    if (b.id !== undefined && !/^evt_/.test(String(b.id))) return send(res, 400, { error: 'id doit valoir evt_...' });
    const envelope = buildEnvelope({ type: b.type, acc: b.account_id, payload: b.payload, id: b.id, name: b.account_name, provider: b.account_provider, created_at: b.created_at });
    events.set(envelope.id, envelope);
    const targets = b.use_registered_endpoints
      ? endpointsFor(envelope).map((e) => ({ url: e.url, endpoint_id: e.id }))
      : [{ url: withToken(b.target_url ?? WEBHOOK_URL, b.token === undefined ? WEBHOOK_TOKEN : b.token), endpoint_id: null }];
    const results = [];
    // `retries` : comme le fournisseur, rejoue la même enveloppe (même evt_, first_attempt faux) tant que
    // le récepteur répond 5xx ou ne répond pas, jusqu'à `retries` fois. 0 par défaut.
    const retries = Math.max(0, Math.min(Number(b.retries ?? 0) || 0, 10));
    for (const t of targets) {
      let record = await deliver(t.url, envelope, { endpoint_id: t.endpoint_id });
      results.push(record);
      for (let i = 0; i < retries && (record.http_status === null || record.http_status >= 500); i++) {
        if (b.retry_delay_ms) await new Promise((r) => setTimeout(r, Number(b.retry_delay_ms)));
        record = await deliver(t.url, envelope, { endpoint_id: t.endpoint_id, first_attempt: false });
        results.push(record);
      }
    }
    return send(res, 200, { event: envelope, deliveries: results });
  }
  return send(res, 404, { error: 'contrôle inconnu' });
}

async function handle(req, res, raw) {
  const url = new URL(req.url, 'http://mock');
  const p = url.pathname;
  if (p.startsWith('/__')) return control(req, res, url, raw);

  const contentType = req.headers['content-type'];
  let body = raw;
  let multipart = false;
  try { body = JSON.parse(raw); } catch {
    const fields = multipartFields(raw, contentType);
    multipart = fields !== null;
    body = fields ?? raw;
  }
  const host = req.headers['x-original-host'] ?? null;
  const entry = { at: nowIso(), host, method: req.method, path: p, query: Object.fromEntries(url.searchParams), account_id: null, body, api: null };
  log.push(entry);

  if (looksLikeV1(host, p)) {
    entry.api = 'v1';
    entry.account_id = url.searchParams.get('account_id') ?? (body && typeof body === 'object' ? body.account_id : undefined) ?? null;
    violation('v1_call', entry, `ancienne API appelée : ${req.method} ${p}`);
    return STRICT_V1
      ? reply(res, entry, 599, { object: 'MockViolation', kind: 'v1_call', detail: 'the previous API generation is no longer served' })
      : reply(res, entry, 200, { object: 'Mock', items: [] });
  }
  if (host && /unipile/i.test(host) && host !== V2_HOST) {
    violation('wrong_host', entry, `hôte ${host}`);
    return reply(res, entry, 599, { object: 'MockViolation', kind: 'wrong_host', detail: 'unexpected host for the v2 API' });
  }
  if (p === '/v2' || p.startsWith('/v2/')) return handleV2(req, res, url, entry, body, multipart);
  return handleOther(req, res, url, entry, body, raw);
}

http.createServer((req, res) => {
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', () => {
    handle(req, res, raw).catch((e) => {
      console.error('[vendor-mock]', e);
      if (!res.headersSent) send(res, 500, { object: 'MockError', detail: String(e?.message ?? e) });
    });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`vendor mock on ${PORT}`));
