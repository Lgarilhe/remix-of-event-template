// Premier message LinkedIn d'une file ou d'une séquence, vu de l'API v2.
//
// Un InMail n'existe qu'à la création de la conversation, et sa forme dépend de
// la licence du compte : Classic `inmail`, Recruiter objet + signature, Sales
// Navigator objet. La licence se lit sur les contrats du compte (Recruiter et
// Sales Navigator sont exclusifs, un seul est sélectionné ; Classic est toujours
// là). Les boîtes de messagerie du compte ne disent pas quelle licence elles
// servent : on ne conclut que sur un mot explicite, sinon le client n'en devine
// pas et la conversation part par la route sans boîte.
//
// Un message direct (relation de premier degré) passe par la boîte Classic.
// Rien n'est mis en cache ici : un cycle de la file traite trois éléments au
// plus.
//
//   deno test --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/_shared/sequence-linkedin-send.test.ts

import {
  listContracts,
  listInboxes,
  startChat,
  UnipileError,
  type Inbox,
  type InmailSpec,
  type LinkedInLicence,
  type SendOutcome,
  type TransportOptions,
  type UserRefInput,
} from './unipile/index.ts';

/** Licence du contrat sélectionné ; Classic sans contrat. */
export interface SendLicences {
  recruiter: boolean;
  sales_navigator: boolean;
  active: LinkedInLicence;
}

/** Licences à partir de la liste des contrats (`product`, `selected`). */
export function licencesFromContracts(contracts: ReadonlyArray<{ product?: unknown; selected?: unknown }>): SendLicences {
  const products = contracts.map((c) => c.product);
  const recruiter = products.includes('recruiter');
  const salesNavigator = products.includes('sales_navigator');
  const selected = contracts.find((c) => c.selected === true)?.product;
  const active: LinkedInLicence = selected === 'recruiter' || selected === 'sales_navigator'
    ? selected
    : recruiter ? 'recruiter' : salesNavigator ? 'sales_navigator' : 'classic';
  return { recruiter, sales_navigator: salesNavigator, active };
}

/**
 * Licence active d'un compte. Un compte sans contrat (liste refusée comme
 * introuvable, interdite ou invalide) est Classic ; toute autre erreur remonte,
 * l'appelant ne devine jamais la licence.
 */
export async function resolveSendLicence(accountId: string, options: TransportOptions = {}): Promise<LinkedInLicence> {
  try {
    return licencesFromContracts(await listContracts(accountId, options)).active;
  } catch (error) {
    if (error instanceof UnipileError && ['not_found', 'validation', 'forbidden'].includes(error.kind)) return 'classic';
    throw error;
  }
}

export type InmailPlan =
  | { ok: true; spec: InmailSpec }
  | { ok: false; reason: 'subject_missing' | 'signature_missing' };

function present(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/**
 * Forme de l'InMail pour une licence. Un objet est exigé en Recruiter et en
 * Sales Navigator ; Recruiter exige aussi une signature (le nom du membre qui
 * a relié le compte).
 */
export function planInmail(
  licence: LinkedInLicence,
  input: { subject: unknown; signature: unknown },
): InmailPlan {
  if (licence === 'classic') return { ok: true, spec: { licence: 'classic' } };
  const subject = present(input.subject);
  if (!subject) return { ok: false, reason: 'subject_missing' };
  if (licence === 'sales_navigator') return { ok: true, spec: { licence: 'sales_navigator', subject } };
  const signature = present(input.signature);
  if (!signature) return { ok: false, reason: 'signature_missing' };
  return { ok: true, spec: { licence: 'recruiter', subject, signature } };
}

/** Licence de la boîte, d'après un mot explicite ; `undefined` si rien ne permet de conclure. */
export function inboxKindOf(inbox: { id?: unknown; description?: unknown }): LinkedInLicence | undefined {
  const label = `${typeof inbox.id === 'string' ? inbox.id : ''} ${typeof inbox.description === 'string' ? inbox.description : ''}`.toLowerCase();
  if (/recruiter|talent/.test(label)) return 'recruiter';
  if (/sales|navigator/.test(label)) return 'sales_navigator';
  if (/classic/.test(label)) return 'classic';
  return undefined;
}

/**
 * Boîte par laquelle démarrer une conversation de licence `kind` : l'unique
 * boîte active, sinon celle dont le type est connu et égal à `kind`, sinon
 * aucune.
 */
export function pickInbox(inboxes: readonly Inbox[], kind: LinkedInLicence): Inbox | undefined {
  if (inboxes.length === 1) return inboxes[0];
  return inboxes.find((inbox) => inboxKindOf(inbox) === kind);
}

/** Boîtes actives du compte ; un compte sans notion de boîte (liste introuvable ou invalide) n'en a aucune. */
async function activeInboxes(accountId: string, options: TransportOptions): Promise<Inbox[]> {
  try {
    return (await listInboxes(accountId, options)).filter((inbox) => inbox && typeof inbox.id === 'string' && inbox.disabled !== true);
  } catch (error) {
    if (error instanceof UnipileError && ['not_found', 'validation'].includes(error.kind)) return [];
    throw error;
  }
}

export interface StartLinkedInChatInput {
  accountId: string;
  user: string | UserRefInput;
  text: string;
  /** Licence dont la boîte porte la conversation (Classic pour un message direct). */
  kind: LinkedInLicence;
  inmail?: InmailSpec;
}

/**
 * Démarre la conversation. La boîte est choisie d'après la licence quand elle
 * est identifiable ; si le fournisseur refuse cette route (rien n'a été fait),
 * la route sans boîte est essayée une fois. Un envoi incertain n'est jamais
 * repris.
 */
export async function startLinkedInChat(input: StartLinkedInChatInput, options: TransportOptions = {}): Promise<SendOutcome> {
  let inboxId: string | undefined;
  try {
    inboxId = pickInbox(await activeInboxes(input.accountId, options), input.kind)?.id;
  } catch (error) {
    // Lecture des boîtes impossible : l'envoi part sans boîte plutôt que de ne pas partir.
    console.warn('[sequence-linkedin-send] boîtes illisibles, envoi sans boîte:', error instanceof UnipileError ? error.kind : 'inconnu');
  }
  const base = { accountId: input.accountId, user: input.user, text: input.text, inmail: input.inmail };
  const first = await startChat({ ...base, inboxId }, options);
  if (inboxId !== undefined && first.outcome === 'refused' && (first.kind === 'validation' || first.kind === 'not_found')) {
    console.warn('[sequence-linkedin-send] route par boîte refusée, essai sans boîte');
    return await startChat(base, options);
  }
  return first;
}
