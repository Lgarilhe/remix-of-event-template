/**
 * Action `send_message` de unipile-search : un message dans une conversation
 * existante (`chat_id`) ou une nouvelle conversation (`recipient_id`), par message
 * direct ou par InMail.
 *
 * Règles d'envoi (refonte mission, lot 0b, inchangées) :
 *  - le candidat, le contrôle d'effacement RGPD et le marqueur
 *    (record_candidate_outbound, `pending`) passent AVANT l'appel au prestataire,
 *    pour que l'écho de ce message au webhook ne soit pas pris pour un message
 *    écrit hors Konekt ;
 *  - « Contacté » et le lien conversation-mission ne sont posés qu'APRÈS un envoi
 *    confirmé ; un envoi incertain (délai, 5xx, réponse illisible) n'est jamais
 *    enregistré comme envoyé et n'est jamais repris ;
 *  - l'enregistrement est au mieux : son échec est journalisé, jamais rendu.
 *
 * InMail : il n'existe qu'à la création de la conversation et dépend de la licence
 * du compte (contrat sélectionné) : Classic `inmail`, Recruiter objet + signature,
 * Sales Navigator objet. La signature vient de l'appelant, sinon du nom du profil
 * de la personne qui a relié le compte.
 */

import {
  chatRef,
  getChat,
  sendMessage,
  startChat,
  userRef,
  UnipileError,
  type InmailSpec,
  type SendOutcome,
  type UserRefInput,
} from '../_shared/unipile/index.ts';
import { candidateRef, missionIdFrom, recordOutbound, type CandidateRef } from '../_shared/candidate-stage-events.ts';
import { isCandidateErasedForOrg } from '../_shared/get-or-fetch-contact.ts';
import { accountInboxes, pickInbox, resolveLicences, type Licence } from './licence.ts';
import { failureResponse, json } from './responses.ts';

/** Appelant d'un envoi : organisation vérifiée, utilisateur (vide en appel interne). */
export interface SendContext {
  organizationId: string;
  userId: string;
  isInternal: boolean;
  /** Membre qui a relié le compte d'envoi (signature d'un InMail Recruiter). */
  accountOwnerId: string | null;
  // deno-lint-ignore no-explicit-any
  admin: () => any;
}

const SEND_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function sendText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** Candidat d'une conversation déjà liée à une mission sur ce compte (lien conversation–mission). */
async function linkedChatCandidate(
  // deno-lint-ignore no-explicit-any
  admin: any,
  organizationId: string,
  accountId: string,
  chatId: string,
): Promise<CandidateRef | null> {
  const { data, error } = await admin
    .from('mission_conversations')
    .select('candidate_id, candidate_ids, candidate_slug')
    .eq('organization_id', organizationId)
    .eq('account_id', accountId)
    .eq('chat_id', chatId)
    .order('last_mission_send_at', { ascending: false, nullsFirst: false })
    .limit(1);
  if (error) {
    console.warn('[unipile-search] send_message: lien de conversation illisible:', error.message);
    return null;
  }
  const row = (data ?? [])[0] as { candidate_id: string | null; candidate_ids: string[] | null; candidate_slug: string | null } | undefined;
  if (!row) return null;
  const ref = candidateRef({ ids: [row.candidate_id, ...(row.candidate_ids ?? [])], slug: row.candidate_slug });
  return ref.ids.length > 0 ? ref : null;
}

/**
 * Candidat d'une conversation lu auprès du prestataire : l'interlocuteur d'une
 * conversation à deux. Un groupe, une conversation illisible ou sans identifiant :
 * null. Le chat est lu sous le compte de la requête (il n'a pas de compte propre).
 */
export async function fetchChatCandidate(accountId: string, chatId: string): Promise<CandidateRef | null> {
  try {
    const chat = await getChat(accountId, chatId);
    if (chat.is_group === true || chat.type === 'group' || chat.type === 'channel') return null;
    const user = chat.user;
    const ref = candidateRef({
      ids: [sendText(chat.user_id) ?? sendText(user?.id)],
      slug: sendText(user?.public_identifier),
      profileUrl: sendText(user?.profile_url),
      name: sendText(user?.display_name),
    });
    return ref.ids.length > 0 ? ref : null;
  } catch (e) {
    console.warn('[unipile-search] send_message: lecture de la conversation impossible:', e instanceof UnipileError ? e.kind : e instanceof Error ? e.message : e);
    return null;
  }
}

/** Envoi manuel à enregistrer : candidat, mission et auteur, résolus avant le POST. */
export interface ManualSendTarget {
  // deno-lint-ignore no-explicit-any
  admin: any;
  candidate: CandidateRef;
  projectId: string | null;
  createdBy: string | null;
  source: 'manual' | 'assistant';
  sendKind: 'message' | 'inmail';
}

/**
 * Avant le POST : candidat, mission et auteur de l'envoi, puis marqueur
 * (record_candidate_outbound, p_pending). Mission : project_id s'il a la forme d'un
 * uuid (préfixe project: accepté), sinon résolue par le serveur. Candidat :
 * recipient_id et recipient_profile_url ; pour une conversation existante, celui du
 * lien, sinon l'interlocuteur de la conversation. source et created_by ne sont lus
 * que sur un appel interne (assistant). Candidat effacé (RGPD) dans l'organisation,
 * ou registre illisible : rien n'est enregistré, le message part quand même. Au
 * mieux : jamais d'erreur rendue.
 */
export async function prepareManualSend(
  accountId: string,
  params: Record<string, unknown>,
  ctx: SendContext,
): Promise<ManualSendTarget | null> {
  try {
    const rawProjectId = params.project_id;
    const projectId = missionIdFrom(rawProjectId);
    if (!projectId && rawProjectId != null && rawProjectId !== '') {
      console.warn('[unipile-search] send_message: project_id ignoré (forme invalide)');
    }
    const chatId = sendText(params.chat_id);
    const admin = ctx.admin();

    let candidate = candidateRef({
      ids: [sendText(params.recipient_id)],
      profileUrl: sendText(params.recipient_profile_url),
    });
    if (candidate.ids.length === 0 && chatId) {
      candidate = (await linkedChatCandidate(admin, ctx.organizationId, accountId, chatId))
        ?? (await fetchChatCandidate(accountId, chatId))
        ?? candidate;
    }
    if (candidate.ids.length === 0) {
      console.warn('[unipile-search] send_message: candidat inconnu, aucun lien ni étape');
      return null;
    }
    try {
      // Client esm.sh, type attendu npm : même API.
      // deno-lint-ignore no-explicit-any
      if (await isCandidateErasedForOrg(admin as any, {
        organizationId: ctx.organizationId,
        linkedinIds: candidate.ids,
        linkedinUrl: candidate.profile_url ?? (candidate.slug ? `https://www.linkedin.com/in/${candidate.slug}` : null),
      })) {
        console.log('[unipile-search] send_message: candidat effacé, rien n\'est enregistré');
        return null;
      }
    } catch (e) {
      console.warn('[unipile-search] send_message: registre d\'effacement illisible, rien n\'est enregistré:', e instanceof Error ? e.message : e);
      return null;
    }

    const internalCreatedBy = sendText(params.created_by);
    const target: ManualSendTarget = {
      admin,
      candidate,
      projectId,
      createdBy: ctx.isInternal
        ? (internalCreatedBy && SEND_UUID_RE.test(internalCreatedBy) ? internalCreatedBy : null)
        : (ctx.userId || null),
      source: ctx.isInternal && params.source === 'assistant' ? 'assistant' : 'manual',
      // is_inmail ne vaut que pour une nouvelle conversation (voir l'envoi).
      sendKind: !params.chat_id && params.is_inmail ? 'inmail' : 'message',
    };
    const marker = await recordOutbound(admin, {
      organizationId: ctx.organizationId,
      accountId,
      candidate,
      source: target.source,
      projectId,
      chatId,
      createdBy: target.createdBy,
      pending: true,
      sendKind: target.sendKind,
    });
    if (!marker.ok) console.error('[unipile-search] send_message: marqueur non posé:', marker.fn, marker.kind, marker.error);
    return target;
  } catch (e) {
    console.error('[unipile-search] send_message: préparation de l\'enregistrement impossible:', e instanceof Error ? e.message : e);
    return null;
  }
}

/**
 * Après un envoi réussi : lien conversation–mission et « Contacté »
 * (record_candidate_outbound), au mieux. Un échec est journalisé et n'est
 * jamais renvoyé : le message est parti.
 */
export async function recordManualSend(
  target: ManualSendTarget,
  accountId: string,
  params: Record<string, unknown>,
  sent: { messageId: string | null; chatId: string | null },
  ctx: SendContext,
): Promise<void> {
  try {
    const res = await recordOutbound(target.admin, {
      organizationId: ctx.organizationId,
      accountId,
      candidate: target.candidate,
      source: target.source,
      projectId: target.projectId,
      chatId: sendText(params.chat_id) ?? sent.chatId,
      messageId: sent.messageId,
      createdBy: target.createdBy,
      sendKind: target.sendKind,
    });
    if (!res.ok) {
      console.error('[unipile-search] send_message:', res.fn, res.kind, res.error);
    } else if ('reason' in res.data) {
      console.log(`[unipile-search] send_message: aucun lien (${res.data.reason})`);
    } else {
      console.log(`[unipile-search] send_message: mission ${res.data.project_id} (${res.data.via}), ${res.data.rows.length} ligne(s)`);
    }
  } catch (e) {
    console.error('[unipile-search] send_message: enregistrement de l\'envoi impossible:', e instanceof Error ? e.message : e);
  }
}

// ---------------------------------------------------------------------------
// InMail et route de création d'une conversation
// ---------------------------------------------------------------------------

/** Nom affiché du profil Konekt d'un membre (signature d'un InMail Recruiter). */
async function signatureOf(
  // deno-lint-ignore no-explicit-any
  admin: any,
  userId: string | null,
): Promise<string | null> {
  if (!userId) return null;
  try {
    const { data } = await admin.from('profiles').select('display_name').eq('user_id', userId).maybeSingle();
    return sendText((data as { display_name?: string | null } | null)?.display_name);
  } catch (e) {
    console.warn('[unipile-search] send_message: nom de signature illisible:', e instanceof Error ? e.message : e);
    return null;
  }
}

export type InmailPlan = { ok: true; spec: InmailSpec } | { ok: false; error: string };

/**
 * Forme de l'InMail d'après le contrat sélectionné du compte. Un objet est exigé
 * en Recruiter et en Sales Navigator (le prestataire le demande) ; Classic n'en a pas.
 */
export async function planInmail(
  accountId: string,
  params: Record<string, unknown>,
  ctx: Pick<SendContext, 'userId' | 'accountOwnerId' | 'admin'>,
): Promise<InmailPlan> {
  const licences = await resolveLicences(accountId);
  const subject = sendText(params.subject);
  if (licences.active === 'classic') return { ok: true, spec: { licence: 'classic' } };
  if (!subject) return { ok: false, error: 'Renseignez l’objet de l’InMail.' };
  if (licences.active === 'sales_navigator') return { ok: true, spec: { licence: 'sales_navigator', subject } };
  const signature = sendText(params.signature)
    ?? await signatureOf(ctx.admin(), ctx.accountOwnerId ?? (ctx.userId || null));
  if (!signature) {
    return { ok: false, error: 'Votre nom n’est pas renseigné dans votre profil : il signe l’InMail Recruiter. Complétez votre profil, puis réessayez.' };
  }
  return { ok: true, spec: { licence: 'recruiter', subject, signature } };
}

/**
 * Démarre une conversation. La boîte par laquelle elle part est choisie d'après la
 * licence quand elle est identifiable ; si le prestataire refuse cette route (rien
 * n'a été fait), la route sans boîte est essayée une fois. Un envoi incertain n'est
 * jamais repris.
 */
export async function startConversation(
  accountId: string,
  user: UserRefInput,
  text: string,
  kind: Licence,
  inmail: InmailSpec | undefined,
): Promise<SendOutcome> {
  let inboxId: string | undefined;
  try {
    inboxId = pickInbox(await accountInboxes(accountId), kind)?.id;
  } catch (e) {
    console.warn('[unipile-search] send_message: boîtes illisibles, envoi sans boîte:', e instanceof UnipileError ? e.kind : e);
  }
  const first = await startChat({ accountId, user, text, inboxId, inmail });
  if (inboxId !== undefined && first.outcome === 'refused' && (first.kind === 'validation' || first.kind === 'not_found')) {
    console.warn('[unipile-search] send_message: route par boîte refusée, essai sans boîte');
    return await startChat({ accountId, user, text, inmail });
  }
  return first;
}

// ---------------------------------------------------------------------------
// Action
// ---------------------------------------------------------------------------

/** Envoi contrôlé, prêt à partir : texte, destinataire d'une nouvelle conversation et forme de l'InMail. */
export interface SendPlan {
  body: string;
  /** Destinataire d'une nouvelle conversation ; null dans une conversation existante. */
  user: UserRefInput | null;
  inmail: InmailSpec | undefined;
  kind: Licence;
}

export type SendPlanResult = { ok: true; plan: SendPlan } | { ok: false; response: Response };

const SEND_FAILURE_OPTIONS = {
  validationMessage: 'Le message n’a pas pu être envoyé. Vérifiez le destinataire et le texte, puis réessayez.',
};

/**
 * Contrôles d'un envoi, sans rien écrire ni envoyer : entrées, conversation, destinataire et forme de l'InMail
 * (objet, signature). Appelé AVANT le plafond LinkedIn pour qu'un envoi refusé ne compte pas dans le journal
 * d'usage, et avant le marqueur pour qu'une demande qui n'atteint jamais le prestataire n'en laisse pas.
 */
export async function planSend(
  accountId: string,
  params: Record<string, unknown>,
  ctx: Pick<SendContext, 'userId' | 'accountOwnerId' | 'admin'>,
): Promise<SendPlanResult> {
  const { chat_id, recipient_id, text, message, is_inmail } = params;
  const messageText = (text || message) as string;
  const refuse = (error: string, status = 400): SendPlanResult => ({ ok: false, response: json({ success: false, error }, status) });

  // Il faut une conversation existante (chat_id) ou un destinataire (recipient_id).
  if (!chat_id && !recipient_id) return refuse('Chat ID ou Recipient ID requis');
  if (!messageText || typeof messageText !== 'string' || messageText.trim().length === 0) return refuse('Message vide');
  const body = messageText.trim();

  // Une conversation se désigne avec le compte : un identifiant mal formé est refusé ici, avant tout marqueur.
  if (chat_id) {
    try {
      chatRef(accountId, String(chat_id));
    } catch {
      return refuse('Identifiant de conversation invalide');
    }
  }

  // Destinataire d'une nouvelle conversation : identifiant du candidat, puis son adresse de profil.
  let user: UserRefInput | null = null;
  if (!chat_id) {
    const given = userRef(String(recipient_id));
    user = {
      providerId: given?.providerId ?? null,
      slug: given?.slug ?? null,
      profileUrl: sendText(params.recipient_profile_url),
    };
    if (!userRef(user)) return refuse('Recipient ID invalide');
  }

  // La forme de l'InMail se lit chez le prestataire sans rien écrire.
  let inmail: InmailSpec | undefined;
  let kind: Licence = 'classic';
  if (!chat_id && is_inmail) {
    try {
      const plan = await planInmail(accountId, params, ctx);
      if (!plan.ok) return { ok: false, response: json({ success: false, error: plan.error, errorType: 'INVALID_REQUEST' }, 400) };
      inmail = plan.spec;
      kind = plan.spec.licence;
    } catch (error) {
      return { ok: false, response: failureResponse(error, 'send_message', SEND_FAILURE_OPTIONS) };
    }
  }
  return { ok: true, plan: { body, user, inmail, kind } };
}

export async function handleSendMessage(
  accountId: string,
  params: Record<string, unknown>,
  ctx: SendContext,
  planned?: SendPlan,
): Promise<Response> {
  const { chat_id } = params;
  let plan = planned;
  if (!plan) {
    const checked = await planSend(accountId, params, ctx);
    if (!checked.ok) return checked.response;
    plan = checked.plan;
  }

  try {
    const manualSend = await prepareManualSend(accountId, params, ctx);

    const outcome = chat_id
      ? await sendMessage({ accountId, chatId: String(chat_id), text: plan.body })
      : await startConversation(accountId, plan.user as UserRefInput, plan.body, plan.kind, plan.inmail);

    if (outcome.outcome !== 'sent') {
      // `uncertain` : le message est peut-être parti, rien n'est enregistré comme envoyé (le marqueur seul reste).
      return failureResponse(outcome.error, 'send_message', SEND_FAILURE_OPTIONS);
    }

    if (manualSend) await recordManualSend(manualSend, accountId, params, outcome, ctx);

    return json({
      success: true,
      message: {
        object: chat_id ? 'MessageSent' : 'ChatStarted',
        message_id: outcome.messageId,
        message_ids: outcome.messageIds,
        chat_id: sendText(chat_id) ?? outcome.chatId,
      },
    });
  } catch (error) {
    return failureResponse(error, 'send_message', SEND_FAILURE_OPTIONS);
  }
}
