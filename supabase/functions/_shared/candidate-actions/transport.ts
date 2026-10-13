/** Personal, verified channels for candidate actions. No transport retries a POST. */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.75.1';
import { isCandidateErasedForOrg } from '../get-or-fetch-contact.ts';
import { enforceLinkedInAction } from '../linkedin-quotas.ts';
import { candidateRef, recordOutbound } from '../candidate-stage-events.ts';
import { sanitizeEmailBody } from '../email-tool-policy.mjs';
import { textToHtml } from '../interview-followup.ts';
import {
  assertAccountOwnedByOrg, describeForLog, getChat, getChatForUser, getEmail, isUnipileError, listEmails, listMessages,
  sendEmail, sendMessage, startChat, toKonektChat, toKonektEmail, toKonektMessage, type ChatLookupEntry, type OwnedAccountKind,
} from '../unipile/index.ts';
import { resolveCandidateActionMessageScope } from './message-scope.ts';
import type { CandidateActionMessageEffect, CandidateActionMessageOutcome, CandidateActionScope, CandidateActionSource, CandidateActionTarget } from './types.ts';

type ActionClient = SupabaseClient;
// The quota helper infers an unknown schema from ReturnType<createClient>.
// The runtime client is identical; keep this compatibility cast at that boundary.
const quotaAdmin = (admin: ActionClient): Parameters<typeof enforceLinkedInAction>[0] => admin as unknown as Parameters<typeof enforceLinkedInAction>[0];
type Row = Record<string, unknown>;
export interface CandidateActionContact { candidate_id?: string; email?: string | null; phone?: string | null }
export interface CandidateActionMember { id: string; name: string; email?: string | null }

export class CandidateActionTransportError extends Error {
  constructor(public code: string, message: string) { super(message); this.name = 'CandidateActionTransportError'; }
}
function fail(code: string, message: string): never { throw new CandidateActionTransportError(code, message); }
const record = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const token = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const email = (value: unknown): string => { const text = token(value).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : ''; };
export function candidateActionPhone(value: unknown): string {
  const text = token(value).replace(/@(?:s\.whatsapp\.net|c\.us)$/, '').replace(/[\s().-]/g, '');
  const normalized = /^\d{8,15}$/.test(text) ? `+${text}` : text;
  return /^\+[1-9]\d{7,14}$/.test(normalized) ? normalized : '';
}
export function candidateActionEmailService(value: unknown): 'gmail' | 'outlook' | 'email' {
  const type = token(value).toUpperCase();
  if (/GOOGLE|GMAIL/.test(type)) return 'gmail';
  if (/MICROSOFT|OUTLOOK|EXCHANGE|OFFICE/.test(type)) return 'outlook';
  return 'email';
}
const usable = (value: unknown): boolean => !token(value) || ['OK', 'CONNECTED'].includes(token(value).toUpperCase());
/** A chat id is an opaque provider string; the client encodes it, this only rejects what could leave the path. */
const checkedId = (value: string): string => {
  if (!value || value.length > 512 || /[/\\?#]|\.\./.test(value)) fail('INVALID_CHANNEL_ID', 'La conversation ou le compte est invalide.');
  return value;
};
const profileSlug = (value: unknown): string => {
  try { const url = new URL(token(value)); return (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')) ? decodeURIComponent(url.pathname.match(/^\/in\/([^/]+)/)?.[1] ?? '').toLowerCase() : ''; } catch { return ''; }
};

/** Provider failure turned into an audited application error. The provider text only reaches the server log. */
function providerFailure(error: unknown, code: string, message: string): never {
  console.error('[candidate-actions] provider call failed:', describeForLog(error));
  if (isUnipileError(error) && error.kind === 'account_disconnected') fail('SENDER_CHANGED', 'Votre compte d’envoi doit être reconnecté. Préparez à nouveau cette action.');
  fail(code, message);
}

const ACCOUNT_COLUMN = { email: 'email_account_id', linkedin: 'linkedin_account_id', whatsapp: 'whatsapp_account_id' } as const;
const MAX_CHAT_OWNER_PROBES = 3;

/** Wording for an own account that is linked but cannot act: the state decides what the member can do about it. */
function blockedAccountMessage(status: unknown): string {
  const value = token(status).toUpperCase();
  if (value === 'DEGRADED') return 'Votre compte d’envoi est temporairement limité. Réessayez plus tard, sans le reconnecter.';
  if (value === 'LOCKED') return 'Votre compte d’envoi est verrouillé. Levez le blocage chez le service concerné, puis réessayez.';
  return 'Votre compte d’envoi doit être reconnecté. Préparez à nouveau cette action.';
}

/** The member's own accounts of one channel, newest first, split between those that can act and those linked but blocked. */
async function ownAccountRows(admin: ActionClient, userId: string, scope: CandidateActionScope, channel: 'email' | 'linkedin' | 'whatsapp', accountId?: string): Promise<{ usable: Row[]; blocked: Row[] }> {
  const table = channel === 'email' ? 'member_email_accounts' : channel === 'linkedin' ? 'member_linkedin_accounts' : 'member_whatsapp_accounts';
  let query = admin.from(table).select('*').eq('organization_id', scope.organization_id).eq('user_id', userId);
  if (accountId) query = query.eq(ACCOUNT_COLUMN[channel], accountId);
  const { data, error } = await query.order('linked_at', { ascending: false }).limit(10);
  if (error) fail('CHANNEL_UNVERIFIED', 'Votre connexion de messagerie ne peut pas être vérifiée. Réessayez.');
  const rows = (data ?? []) as Row[];
  return { usable: rows.filter(row => usable(row.account_status)), blocked: rows.filter(row => !usable(row.account_status)) };
}
async function ownAccounts(admin: ActionClient, userId: string, scope: CandidateActionScope, channel: 'email' | 'linkedin' | 'whatsapp', accountId?: string): Promise<Row[]> {
  return (await ownAccountRows(admin, userId, scope, channel, accountId)).usable;
}
async function ownAccount(admin: ActionClient, userId: string, scope: CandidateActionScope, channel: 'email' | 'linkedin' | 'whatsapp', accountId?: string): Promise<Row | null> {
  return (await ownAccounts(admin, userId, scope, channel, accountId))[0] ?? null;
}

/**
 * Last gate before a provider call: the account is linked, in this organization, by this very member.
 * The provider key is global, so an account id that is not the caller's own must never reach it.
 */
async function assertOwn(admin: ActionClient, userId: string, scope: CandidateActionScope, channel: OwnedAccountKind, accountId: string): Promise<void> {
  try { await assertAccountOwnedByOrg(admin, scope.organization_id, accountId, { userId, kinds: [channel] }); }
  catch (error) {
    if (isUnipileError(error) && error.code === 'account_not_owned') fail('CHAT_NOT_OWNED', 'Ce compte ne vous appartient pas. Répondez depuis votre propre compte.');
    providerFailure(error, 'CHANNEL_UNVERIFIED', 'Votre connexion de messagerie ne peut pas être vérifiée. Réessayez.');
  }
}

/**
 * A one-to-one chat and its exact other participant, never a display-name match.
 * A v2 chat carries no account id: the owner is the member's own account under which the provider
 * answers for this chat (a chat of a colleague, or of another account, is simply not reachable).
 */
async function verifiedChat(admin: ActionClient, userId: string, scope: CandidateActionScope, channel: 'linkedin' | 'whatsapp', chatId: string, accountId?: string): Promise<{ chat: ReturnType<typeof toKonektChat>; attendee: Row; account: Row; ownerId: string }> {
  const id = checkedId(chatId);
  const rows = await ownAccountRows(admin, userId, scope, channel, accountId);
  const accounts = rows.usable.slice(0, MAX_CHAT_OWNER_PROBES);
  if (!accounts.length) {
    // The plan's own account is gone from the member's links: the account changed. A linked account that is only limited
    // is not "another account": say what is wrong with it.
    if (rows.blocked.length) fail('SENDER_CHANGED', blockedAccountMessage(rows.blocked[0].account_status));
    if (accountId) {
      // An account id that a colleague carries is another member's chat; one that nobody carries any more was replaced or unlinked.
      const table = channel === 'linkedin' ? 'member_linkedin_accounts' : 'member_whatsapp_accounts';
      const { data, error } = await admin.from(table).select('user_id').eq('organization_id', scope.organization_id).eq(ACCOUNT_COLUMN[channel], accountId).neq('user_id', userId).limit(1);
      if (error) fail('CHAT_UNVERIFIED', 'La conversation ne peut pas être vérifiée. Réessayez.');
      if (!(data ?? []).length) fail('SENDER_CHANGED', 'Le compte de cette conversation a changé. Préparez à nouveau la réponse.');
    }
    fail('CHAT_NOT_OWNED', "Cette conversation appartient à un autre compte. Répondez depuis votre propre compte.");
  }
  let unverified: unknown = null;
  for (const account of accounts) {
    const ownerId = token(account[ACCOUNT_COLUMN[channel]]);
    await assertOwn(admin, userId, scope, channel, ownerId);
    let raw: unknown;
    try { raw = await getChat(ownerId, id); }
    catch (error) {
      if (isUnipileError(error) && (error.kind === 'not_found' || error.kind === 'forbidden')) continue;
      unverified = error;
      continue;
    }
    const chat = toKonektChat(raw, { accountId: ownerId });
    if (chat.type !== 0) fail('GROUP_CHAT_NOT_ALLOWED', 'Seules les conversations individuelles peuvent recevoir une action candidat.');
    const other = chat.attendees[0];
    const providerId = token(other?.provider_id) || token(chat.attendee_provider_id);
    if (!providerId) fail('RECIPIENT_UNVERIFIED', 'Le destinataire de la conversation ne peut pas être vérifié.');
    const attendee: Row = { provider_id: providerId, public_identifier: token(other?.public_identifier), specifics: {}, profile_url: token(other?.profile_url), name: token(other?.name) };
    return { chat, attendee, account, ownerId };
  }
  if (unverified) providerFailure(unverified, 'CHAT_UNVERIFIED', 'La conversation ne peut pas être vérifiée. Réessayez.');
  if (accountId) fail('SENDER_CHANGED', 'Le compte de cette conversation a changé. Préparez à nouveau la réponse.');
  fail('CHAT_NOT_OWNED', "Cette conversation appartient à un autre compte. Répondez depuis votre propre compte.");
}

export async function validateCandidateActionChat(admin: ActionClient, userId: string, scope: CandidateActionScope): Promise<{ candidateIds: string[]; linkedinUrl: string | null; candidateName: string; accountId: string }> {
  if (!scope.chat_id) fail('CHAT_REQUIRED', 'La conversation est introuvable.');
  const { attendee, ownerId } = await verifiedChat(admin, userId, scope, 'linkedin', scope.chat_id, scope.account_id ?? undefined);
  const specifics = record(attendee.specifics);
  const ids = [...new Set([token(attendee.provider_id), token(attendee.public_identifier), token(specifics.public_identifier)].filter(Boolean))];
  const url = token(attendee.profile_url);
  const slug = profileSlug(url);
  let matches = ids.includes(scope.candidate_id) || (!!slug && (slug === scope.candidate_id.toLowerCase() || slug === profileSlug(scope.linkedin_url)));
  if (!matches) {
    const { data, error } = await admin.from('mission_conversations').select('candidate_id,candidate_ids')
      .eq('organization_id', scope.organization_id).eq('account_id', ownerId)
      .eq('chat_id', scope.chat_id).limit(20);
    if (error) fail('CANDIDATE_UNVERIFIED', 'L’identité du candidat ne peut pas être vérifiée.');
    matches = (data ?? []).some((row: Row) => {
      const aliases = Array.isArray(row.candidate_ids) ? row.candidate_ids : [];
      return (row.candidate_id === scope.candidate_id || aliases.includes(scope.candidate_id)) && ids.some(id => aliases.includes(id) || row.candidate_id === id);
    });
  }
  if (!matches) fail('CANDIDATE_MISMATCH', 'Cette conversation ne correspond pas au candidat affiché.');
  if (!ids.length) fail('RECIPIENT_UNVERIFIED', 'Le destinataire LinkedIn ne peut pas être vérifié.');
  return { candidateIds: [...new Set([...ids, ...(slug ? [slug] : [])])], linkedinUrl: url || null, candidateName: token(attendee.name), accountId: ownerId };
}

export async function loadCandidateActionTargets(admin: ActionClient, userClient: ActionClient, userId: string, scope: CandidateActionScope, contacts: CandidateActionContact[], members: CandidateActionMember[]): Promise<CandidateActionTarget[]> {
  const targets: CandidateActionTarget[] = [];
  const [mailbox, linkedin, whatsapp] = await Promise.all([
    ownAccount(admin, userId, scope, 'email'),
    ownAccount(admin, userId, scope, 'linkedin', scope.account_id ?? undefined),
    ownAccount(admin, userId, scope, 'whatsapp'),
  ]);
  const address = email(mailbox?.email_address);
  if (mailbox && address) {
    if (members.some(member => member.id !== userId && !member.email)) {
      const { data, error } = await userClient.rpc('get_org_member_emails', { p_organization_id: scope.organization_id });
      if (error) fail('TEAM_CONTACTS_UNAVAILABLE', 'Les coordonnées de votre équipe ne peuvent pas être vérifiées. Réessayez.');
      const memberAddresses = new Map<string, string>((data ?? []).map((row: Row) => [token(row.user_id), email(row.email)]));
      members = members.map(member => ({ ...member, email: member.email ?? memberAddresses.get(member.id) ?? null }));
    }
    const accountId = token(mailbox.email_account_id);
    const service = candidateActionEmailService(mailbox.provider);
    for (const recipient of new Set(contacts.map(contact => email(contact.email)).filter(Boolean))) {
      if (recipient === address) continue;
      targets.push({ id: `email:${accountId}:candidate:${recipient}`, audience: 'candidate', channel: 'email', service, label: 'Candidat', recipient, senderAccountId: accountId, senderAddress: address });
    }
    for (const member of members) {
      const recipient = email(member.email);
      if (!recipient || member.id === userId || recipient === address) continue;
      targets.push({ id: `email:${accountId}:team:${member.id}`, audience: 'team', channel: 'email', service, label: member.name, recipient, memberId: member.id, senderAccountId: accountId, senderAddress: address });
    }
  }
  if (linkedin) {
    const accountId = token(linkedin.linkedin_account_id);
    let chatId = scope.chat_id ?? '';
    if (!chatId && /^(ACo|ACw|urn:li:)/.test(scope.candidate_id)) {
      await assertOwn(admin, userId, scope, 'linkedin', accountId);
      let entries: ChatLookupEntry[];
      try { entries = await getChatForUser(accountId, scope.candidate_id); }
      catch (error) { providerFailure(error, 'CHAT_DISCOVERY_UNAVAILABLE', 'Les conversations LinkedIn ne peuvent pas être vérifiées. Réessayez.'); }
      // One 1:1 chat per inbox at most; the one with a history wins, the answer of the provider order otherwise.
      chatId = token((entries.find(entry => entry.has_history === true) ?? entries[0])?.chat_id);
    }
    if (chatId) {
      const resolved = await validateCandidateActionChat(admin, userId, { ...scope, account_id: accountId, chat_id: chatId });
      const recipient = resolved.candidateIds.find(id => /^(ACo|ACw|urn:li:)/.test(id)) ?? resolved.candidateIds[0];
      targets.push({ id: `linkedin:${accountId}:${chatId}`, audience: 'candidate', channel: 'linkedin', service: 'linkedin', label: 'Candidat', recipient, recipientProviderId: recipient, chatId, senderAccountId: accountId, senderAddress: token(linkedin.linkedin_account_name) || 'Mon compte LinkedIn' });
    }
  }
  const senderPhone = candidateActionPhone(whatsapp?.phone_number);
  if (whatsapp && senderPhone) {
    const accountId = token(whatsapp.whatsapp_account_id);
    for (const recipient of new Set(contacts.map(contact => candidateActionPhone(contact.phone)).filter(Boolean))) {
      if (recipient === senderPhone) continue;
      targets.push({ id: `whatsapp:${accountId}:candidate:${recipient}`, audience: 'candidate', channel: 'whatsapp', service: 'whatsapp', label: 'Candidat', recipient, recipientProviderId: recipient, senderAccountId: accountId, senderAddress: senderPhone });
    }
  }
  return targets;
}

async function storedContacts(admin: ActionClient, scope: CandidateActionScope): Promise<CandidateActionContact[]> {
  const ids = new Set([scope.candidate_id]);
  const links = await Promise.all([
    admin.from('mission_conversations').select('candidate_id,candidate_ids').eq('organization_id', scope.organization_id).contains('candidate_ids', [scope.candidate_id]),
    admin.from('mission_conversations').select('candidate_id,candidate_ids').eq('organization_id', scope.organization_id).eq('candidate_id', scope.candidate_id),
  ]);
  for (const result of links) {
    if (result.error) fail('RECIPIENT_UNVERIFIED', "L'identité du candidat ne peut pas être vérifiée.");
    for (const row of result.data ?? []) for (const id of [row.candidate_id, ...(row.candidate_ids ?? [])]) if (typeof id === 'string') ids.add(id);
  }
  const enrollments = await Promise.all(['profile_id', 'provider_id', 'resolved_profile_id'].map(column => admin.from('sequence_enrollments').select('profile_id,provider_id,resolved_profile_id,email_used,phone_used').eq('organization_id', scope.organization_id).eq(column, scope.candidate_id).limit(100)));
  if (scope.linkedin_url) enrollments.push(await admin.from('sequence_enrollments').select('profile_id,provider_id,resolved_profile_id,email_used,phone_used').eq('organization_id', scope.organization_id).eq('profile_url', scope.linkedin_url).limit(100));
  const contacts: CandidateActionContact[] = [];
  for (const result of enrollments) {
    if (result.error) fail('RECIPIENT_UNVERIFIED', "Les coordonnées du candidat ne peuvent pas être vérifiées.");
    for (const row of result.data ?? []) {
      for (const id of [row.profile_id, row.provider_id, row.resolved_profile_id]) if (typeof id === 'string') ids.add(id);
      contacts.push({ email: row.email_used, phone: row.phone_used });
    }
  }
  const result = await admin.from('candidate_contacts').select('candidate_id,email,phone').eq('organization_id', scope.organization_id).in('candidate_id', [...ids]);
  if (result.error) fail('RECIPIENT_UNVERIFIED', "Les coordonnées du candidat ne peuvent pas être vérifiées.");
  return [...contacts, ...(result.data ?? [])];
}

export async function validateCandidateActionMessage(admin: ActionClient, userId: string, scope: CandidateActionScope, effect: CandidateActionMessageEffect): Promise<void> {
  if (!effect.content.trim() || effect.content.length > (effect.channel === 'linkedin' ? 1500 : 5000)) fail('INVALID_MESSAGE', 'Le message est vide ou trop long. Corrigez-le avant de valider.');
  const membership = await admin.from('organization_members').select('id').eq('organization_id', scope.organization_id).eq('user_id', userId).maybeSingle();
  if (membership.error || !membership.data) fail('RIGHTS_UNVERIFIED', "Vous ne pouvez plus agir dans cette organisation.");
  const rows = await ownAccountRows(admin, userId, scope, effect.channel, effect.senderAccountId);
  const account = rows.usable[0];
  if (!account) fail('SENDER_CHANGED', rows.blocked.length ? blockedAccountMessage(rows.blocked[0].account_status) : 'Votre compte d’envoi a changé ou doit être reconnecté. Préparez à nouveau cette action.');
  try {
    if (await isCandidateErasedForOrg(admin, { organizationId: scope.organization_id, linkedinIds: [scope.candidate_id], linkedinUrl: scope.linkedin_url, emails: effect.audience === 'candidate' && effect.channel === 'email' ? [effect.recipient] : [] })) fail('CANDIDATE_ERASED', 'Ce candidat a demandé l’effacement de ses données. Aucun message ne peut partir.');
  } catch (error) {
    if (error instanceof CandidateActionTransportError) throw error;
    fail('GDPR_UNVERIFIED', 'Le registre d’effacement ne peut pas être vérifié. Réessayez.');
  }
  if (effect.channel === 'email') {
    const address = email(account.email_address);
    const recipient = email(effect.recipient);
    if (!address || address !== email(effect.senderAddress) || effect.service !== candidateActionEmailService(account.provider)) fail('SENDER_CHANGED', 'Votre boîte d’envoi a changé. Préparez à nouveau cette action.');
    if (!recipient || !effect.subject?.trim() || effect.subject.length > 200) fail('INVALID_EMAIL', 'Le destinataire ou l’objet de l’e-mail est invalide.');
    if (effect.audience === 'candidate') {
      const contacts = await storedContacts(admin, scope);
      if (!contacts.some(contact => email(contact.email) === recipient)) fail('RECIPIENT_CHANGED', 'L’adresse du candidat a changé. Préparez à nouveau le message.');
    } else {
      if (!effect.memberId) fail('TEAM_RECIPIENT_CHANGED', 'Ce destinataire ne fait plus partie de votre équipe.');
      const member = await admin.from('organization_members').select('user_id').eq('organization_id', scope.organization_id).eq('user_id', effect.memberId).maybeSingle();
      if (member.error || !member.data || effect.memberId === userId) fail('TEAM_RECIPIENT_CHANGED', 'Ce destinataire ne fait plus partie de votre équipe.');
      const { data, error } = await admin.auth.admin.getUserById(effect.memberId);
      if (error || email(data?.user?.email) !== recipient) fail('TEAM_RECIPIENT_CHANGED', 'L’adresse de ce membre a changé. Préparez à nouveau le message.');
    }
    const suppressed = await admin.from('suppressed_emails').select('email').eq('email', recipient).maybeSingle();
    if (suppressed.error) fail('SUPPRESSION_UNVERIFIED', 'La liste d’exclusion ne peut pas être vérifiée. Réessayez.');
    if (suppressed.data) fail('EMAIL_SUPPRESSED', 'Cette adresse ne peut plus recevoir d’e-mails depuis l’application.');
  } else if (effect.channel === 'linkedin') {
    if (effect.audience !== 'candidate' || !effect.chatId || effect.service !== 'linkedin') fail('INVALID_LINKEDIN_TARGET', 'Le destinataire LinkedIn est invalide.');
    const candidate = await validateCandidateActionChat(admin, userId, { ...scope, chat_id: effect.chatId, account_id: effect.senderAccountId });
    if (!candidate.candidateIds.includes(effect.recipientProviderId ?? effect.recipient)) fail('RECIPIENT_CHANGED', 'Le destinataire de la conversation a changé.');
    const gate = await enforceLinkedInAction(quotaAdmin(admin), { accountId: effect.senderAccountId, actionType: 'message', userId, organizationId: scope.organization_id, source: 'candidate_action', mode: 'auto', log: false });
    if (!gate.allowed) fail('LINKEDIN_QUOTA', gate.reason || 'La limite de votre compte LinkedIn est atteinte.');
  } else {
    if (effect.audience !== 'candidate' || effect.service !== 'whatsapp' || candidateActionPhone(account.phone_number) !== effect.senderAddress) fail('INVALID_WHATSAPP_TARGET', 'Le compte ou le destinataire WhatsApp est invalide.');
    const contacts = await storedContacts(admin, scope);
    if (!contacts.some(contact => candidateActionPhone(contact.phone) === effect.recipient)) fail('RECIPIENT_CHANGED', 'Le numéro du candidat a changé. Préparez à nouveau le message.');
    if (effect.chatId) {
      const chat = await verifiedChat(admin, userId, scope, 'whatsapp', effect.chatId, effect.senderAccountId);
      if (candidateActionPhone(chat.attendee.provider_id) !== effect.recipient) fail('RECIPIENT_CHANGED', 'Le destinataire WhatsApp de la conversation a changé.');
    }
  }
}

/** Thread and RFC Message-ID of a mail we just sent: the v2 send answer may carry neither. Read once, never required, bounded to a few seconds. */
async function sentEmailIdentity(accountId: string, emailId: string): Promise<{ threadId: string | null; messageId: string | null }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const sent = await Promise.race([
      getEmail(accountId, emailId, { metaOnly: true }),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 4_000); }),
    ]);
    return { threadId: sent && token(sent.thread_id) ? token(sent.thread_id) : null, messageId: sent && token(sent.message_id) ? token(sent.message_id) : null };
  } catch { return { threadId: null, messageId: null }; } finally { if (timer) clearTimeout(timer); }
}

/** Calls this only after the engine has durably claimed this individual effect. */
export async function sendCandidateActionMessage(admin: ActionClient, userId: string, scope: CandidateActionScope, effect: CandidateActionMessageEffect, context?: { planId: string }): Promise<CandidateActionMessageOutcome> {
  try { await validateCandidateActionMessage(admin, userId, scope, effect); }
  catch (error) { return { status: 'failed', result: { errorCode: error instanceof CandidateActionTransportError ? error.code : 'PREFLIGHT_FAILED', message: error instanceof CandidateActionTransportError ? error.message : 'Les conditions de l’envoi ne peuvent pas être vérifiées.' } }; }
  // The provider key is global: the sending account must be this member's own, whatever the plan said.
  try { await assertOwn(admin, userId, scope, effect.channel, effect.senderAccountId); }
  catch (error) { return { status: 'failed', result: { errorCode: error instanceof CandidateActionTransportError ? error.code : 'PREFLIGHT_FAILED', message: error instanceof CandidateActionTransportError ? error.message : 'Les conditions de l’envoi ne peuvent pas être vérifiées.' } }; }
  if (effect.channel === 'linkedin') {
    const gate = await enforceLinkedInAction(quotaAdmin(admin), { accountId: effect.senderAccountId, actionType: 'message', userId, organizationId: scope.organization_id, source: 'candidate_action', mode: 'auto' });
    if (!gate.allowed) return { status: 'failed', result: { errorCode: 'LINKEDIN_QUOTA', message: gate.reason || 'La limite de votre compte LinkedIn est atteinte. Réessayez plus tard.' } };
    // Mark the pending Konekt send so its webhook echo cannot advance the wrong mission.
    await recordOutbound(admin, { organizationId: scope.organization_id, accountId: effect.senderAccountId, candidate: candidateRef({ ids: [scope.candidate_id, effect.recipientProviderId], profileUrl: scope.linkedin_url }), source: 'assistant', projectId: scope.project_id, chatId: effect.chatId, createdBy: userId, pending: true });
  }
  let existingChatId = effect.chatId;
  if (effect.channel === 'whatsapp' && !existingChatId) {
    const lookupFailed: CandidateActionMessageOutcome = { status: 'failed', result: { errorCode: 'CHAT_LOOKUP_FAILED', message: 'Votre conversation WhatsApp ne peut pas être vérifiée. Aucun message n’a été envoyé.' } };
    try {
      // The lookup is by person: every entry is that person's 1:1 chat in one inbox, each re-verified below.
      const entries = (await getChatForUser(effect.senderAccountId, effect.recipient)).slice(0, MAX_CHAT_OWNER_PROBES);
      for (const entry of entries) {
        const verified = await verifiedChat(admin, userId, scope, 'whatsapp', entry.chat_id, effect.senderAccountId);
        if (candidateActionPhone(verified.attendee.provider_id) === effect.recipient) { existingChatId = entry.chat_id; break; }
      }
      // A chat exists with this person but none could be proven to be theirs: never start a second one blindly.
      if (entries.length && !existingChatId) return { status: 'failed', result: { errorCode: 'RECIPIENT_CHANGED', message: 'Le destinataire WhatsApp ne peut pas être vérifié. Aucun message n’a été envoyé.' } };
    } catch (error) {
      console.error('[candidate-actions] whatsapp chat lookup failed:', describeForLog(error));
      return lookupFailed;
    }
  }
  const sendStartedAt = Date.now();
  const uncertain: CandidateActionMessageOutcome = { status: 'unknown', result: { errorCode: 'SEND_UNCERTAIN', message: 'Le service n’a pas confirmé l’envoi. Vérifiez votre conversation ou vos e-mails envoyés avant toute nouvelle action.' } };
  const rejected: CandidateActionMessageOutcome = { status: 'failed', result: { errorCode: 'SEND_REJECTED', message: 'Le service a refusé le message. Vérifiez votre connexion puis réessayez.' } };
  let providerId = '';
  let threadId: string | null = existingChatId || null;
  let providerReceipt: Row = {};
  try {
    if (effect.channel === 'email') {
      const sent = await sendEmail({ accountId: effect.senderAccountId, to: [{ email: effect.recipient, display_name: effect.recipient }], subject: effect.subject!.trim(), html: textToHtml(effect.content.trim()) });
      if (sent.outcome === 'uncertain') { console.error('[candidate-actions] email send outcome unknown:', describeForLog(sent.error)); return uncertain; }
      if (sent.outcome === 'refused') { console.error('[candidate-actions] email send refused:', describeForLog(sent.error)); return rejected; }
      // The Email id is the one id the webhook and the mailbox reads share: the journal key must be the same everywhere.
      providerId = sent.emailId;
      const identity = await sentEmailIdentity(effect.senderAccountId, sent.emailId);
      threadId = identity.threadId;
      // The RFC Message-ID is what a reply names in In-Reply-To: it is kept in the receipt of the effect, where the incoming path finds it.
      const rfcMessageId = sent.messageId ?? identity.messageId;
      providerReceipt = { object: 'EmailSent', id: sent.emailId, ...(rfcMessageId ? { message_id: rfcMessageId } : {}) };
    } else {
      const text = effect.content.trim();
      const sent = existingChatId
        ? await sendMessage({ accountId: effect.senderAccountId, chatId: existingChatId, text })
        : await startChat({ accountId: effect.senderAccountId, user: effect.recipientProviderId ?? effect.recipient, text });
      if (sent.outcome === 'uncertain') { console.error('[candidate-actions] chat send outcome unknown:', describeForLog(sent.error)); return uncertain; }
      if (sent.outcome === 'refused') { console.error('[candidate-actions] chat send refused:', describeForLog(sent.error)); return rejected; }
      providerId = sent.messageId ?? '';
      threadId = sent.chatId ?? existingChatId ?? null;
      providerReceipt = { object: existingChatId ? 'MessageSent' : 'ChatStarted', ...(sent.messageIds.length ? { message_id: sent.messageIds.length === 1 ? sent.messageIds[0] : sent.messageIds } : {}), ...(threadId ? { chat_id: threadId } : {}) };
    }
  } catch (error) {
    // The client throws before any request only for a missing key, an invalid input or an outdated account id: nothing was sent.
    if (isUnipileError(error) && (error.kind === 'config' || error.kind === 'validation' || error.kind === 'account_disconnected')) {
      console.error('[candidate-actions] send not attempted:', describeForLog(error));
      return { status: 'failed', result: { errorCode: error.kind === 'config' ? 'CHANNEL_UNAVAILABLE' : 'SEND_REJECTED', message: error.kind === 'config' ? 'Le service de messagerie est indisponible. Aucun message n’a été envoyé.' : error.kind === 'account_disconnected' ? 'Votre compte d’envoi doit être reconnecté. Aucun message n’a été envoyé.' : 'Le message n’a pas pu être préparé pour l’envoi. Aucun message n’a été envoyé.' } };
    }
    console.error('[candidate-actions] send failed unexpectedly:', describeForLog(error));
    return uncertain;
  }
  // A confirmed send remains successful even if its receipt or local journal fails.
  const completedAt = new Date().toISOString();
  let referenceId: string | undefined;
  let journalFailed = false;
  try {
    // A privacy request received while the provider was sending must not be
    // followed by recreating the erased content in our local history.
    if (await isCandidateErasedForOrg(admin, { organizationId: scope.organization_id, linkedinIds: [scope.candidate_id], linkedinUrl: scope.linkedin_url, emails: effect.audience === 'candidate' && effect.channel === 'email' ? [effect.recipient] : [] })) throw new Error('Candidate data was erased while the message was sending');
    const journal = await admin.from('candidate_action_messages').insert({
    organization_id: scope.organization_id, candidate_id: scope.candidate_id, project_id: scope.project_id ?? null,
    owner_user_id: userId, account_id: effect.senderAccountId, channel: effect.channel, service: effect.service,
    audience: effect.audience, direction: 'outbound', provider_message_id: providerId || `konekt-effect:${effect.id}`,
    provider_thread_id: threadId, counterpart: effect.recipient, sender: effect.senderAddress, recipient: effect.recipient,
    subject: effect.subject?.trim() || null, content: effect.content.trim(), occurred_at: completedAt,
    action_plan_id: context?.planId ?? null, effect_id: context?.planId ? effect.id : null,
    }).select('id').maybeSingle();
    if (journal.error && journal.error.code !== '23505') {
      journalFailed = true;
      console.error('[candidate-actions] sent message journal failed:', journal.error.message);
    }
    if (journal.error?.code === '23505') {
      journalFailed = true;
      // Its webhook or the bounded inbox read may have won the unique insert.
      // Attach only this exact confirmed send; a historical collision stays private.
      const duplicate = await admin.from('candidate_action_messages').select('*')
        .eq('organization_id', scope.organization_id).eq('owner_user_id', userId)
        .eq('account_id', effect.senderAccountId).eq('provider_message_id', providerId || `konekt-effect:${effect.id}`).maybeSingle();
      const existing = duplicate.data as Row | null;
      const sameSend = !duplicate.error && existing && existing.channel === effect.channel && existing.service === effect.service
        && existing.direction === 'outbound' && existing.candidate_id === scope.candidate_id
        && (token(existing.project_id) || null) === (scope.project_id ?? null) && existing.audience === effect.audience
        && existing.recipient === effect.recipient && existing.counterpart === effect.recipient && existing.sender === effect.senderAddress
        && existing.content === effect.content.trim() && (!threadId || existing.provider_thread_id === threadId)
        && (token(existing.subject) || null) === (effect.subject?.trim() || null)
        && Number.isFinite(Date.parse(token(existing.occurred_at)))
        && Date.parse(token(existing.occurred_at)) >= sendStartedAt - 60_000 && Date.parse(token(existing.occurred_at)) <= Date.parse(completedAt) + 60_000
        && (!existing.action_plan_id || existing.action_plan_id === context?.planId)
        && (!existing.effect_id || existing.effect_id === effect.id);
      if (sameSend && context?.planId && existing) {
        let attachment = admin.from('candidate_action_messages').update({ action_plan_id: context.planId, effect_id: effect.id })
          .eq('id', existing.id).eq('organization_id', scope.organization_id).eq('owner_user_id', userId)
          .eq('account_id', effect.senderAccountId).eq('provider_message_id', providerId || `konekt-effect:${effect.id}`)
          .eq('candidate_id', scope.candidate_id).eq('channel', effect.channel).eq('direction', 'outbound');
        attachment = scope.project_id ? attachment.eq('project_id', scope.project_id) : attachment.is('project_id', null);
        attachment = existing.action_plan_id ? attachment.eq('action_plan_id', existing.action_plan_id) : attachment.is('action_plan_id', null);
        attachment = existing.effect_id ? attachment.eq('effect_id', existing.effect_id) : attachment.is('effect_id', null);
        const attached = await attachment.select('id').maybeSingle();
        if (!attached.error && attached.data?.id) { referenceId = attached.data.id; journalFailed = false; }
      }
    }
    if (journal.data?.id) referenceId = journal.data.id;
    if (effect.channel === 'linkedin') {
      const tracked = await recordOutbound(admin, { organizationId: scope.organization_id, accountId: effect.senderAccountId, candidate: candidateRef({ ids: [scope.candidate_id, effect.recipientProviderId], profileUrl: scope.linkedin_url }), source: 'assistant', projectId: scope.project_id, chatId: threadId, messageId: providerId || null, createdBy: userId });
      if (!tracked.ok) journalFailed = true;
    }
  } catch (error) {
    journalFailed = true;
    console.error('[candidate-actions] message sent, tracking unavailable:', error instanceof Error ? error.message : 'unknown');
  }
  return { status: 'succeeded', result: { providerId: providerId || undefined, providerThreadId: threadId ?? undefined, providerReceipt, completedAt, performedBy: userId, referenceId, referenceTable: referenceId ? 'candidate_action_messages' : undefined, message: journalFailed ? 'Le message est envoyé. Son historique n’a pas pu être enregistré.' : 'Message envoyé.' } };
}

/** The same provider-backed source is used before and after its private journal is hydrated. */
export function candidateActionStoredEmailSource(row: Row): CandidateActionSource | null {
  const id = token(row.provider_message_id);
  const accountId = token(row.account_id);
  const timestamp = token(row.occurred_at);
  const detail = token(row.content).slice(0, 5000);
  if (row.channel !== 'email' || row.audience !== 'candidate' || !id || !accountId || !detail || !Number.isFinite(Date.parse(timestamp))) return null;
  const version = new Date(timestamp).toISOString();
  return {
    id: `email-${accountId}-${id}`, type: row.direction === 'outbound' ? 'outbound_message' : 'inbound_message',
    title: token(row.subject) || 'Échange par e-mail', author: token(row.sender) || 'Correspondant',
    timestamp: version, summary: detail.slice(0, 240), detail,
    service: row.service === 'gmail' || row.service === 'outlook' ? row.service : 'email',
    projectId: token(row.project_id) || null,
    reference: { table: 'provider_emails', id, version },
  };
}

const EMAIL_HISTORY_LIMIT = 50;
const CHAT_HISTORY_LIMIT = 50;
/** A page proves the end of the history only when the provider says nothing follows and the page is not simply full. */
function pageIsComplete(page: { items: unknown[]; nextCursor?: string | null; hasMore?: boolean | null; totalCount?: number | null }, limit: number): boolean {
  return !page.nextCursor && page.hasMore !== true && page.items.length < limit && (page.totalCount ?? 0) <= page.items.length;
}

export async function readCandidateActionEmailContext(admin: ActionClient, userId: string, scope: CandidateActionScope, targets: CandidateActionTarget[]): Promise<{ messages: CandidateActionSource[]; complete: boolean }> {
  const candidates = targets.filter(target => target.channel === 'email' && target.audience === 'candidate');
  if (!candidates.length) return { messages: [], complete: true };
  const account = await ownAccount(admin, userId, scope, 'email', candidates[0].senderAccountId);
  if (!account) fail('CHANNEL_UNVERIFIED', 'Votre boîte e-mail doit être reconnectée.');
  const senderAddress = email(account.email_address);
  if (!senderAddress || senderAddress !== email(candidates[0].senderAddress)) fail('CHANNEL_UNVERIFIED', 'Votre boîte e-mail a changé. Rechargez la conversation.');
  const binding = await resolveCandidateActionMessageScope(admin, scope.organization_id, scope.candidate_id);
  const erased = () => isCandidateErasedForOrg(admin, { organizationId: scope.organization_id, linkedinIds: [scope.candidate_id, binding.candidate_id], linkedinUrl: scope.linkedin_url, emails: candidates.map(target => target.recipient) });
  if (await erased()) return { messages: [], complete: true };
  const accountId = candidates[0].senderAccountId;
  await assertOwn(admin, userId, scope, 'email', accountId);
  const recipients = new Set(candidates.map(target => target.recipient));
  const actualContacts = await storedContacts(admin, scope);
  const allowedCandidateIds = new Set([scope.candidate_id, binding.candidate_id, ...actualContacts.map(contact => token(contact.candidate_id)).filter(Boolean)]);
  const unambiguousRecipients = new Set<string>();
  const recipientIdentities = await Promise.all([...recipients].map(async recipient => {
    const result = await admin.from('candidate_contacts').select('candidate_id').eq('organization_id', scope.organization_id)
      .ilike('email', recipient.replace(/([%_\\])/g, '\\$1')).limit(11);
    return { recipient, result };
  }));
  for (const { recipient, result: identities } of recipientIdentities) {
    if (!actualContacts.some(contact => email(contact.email) === recipient)) continue;
    if (identities.error) fail('RECIPIENT_UNVERIFIED', 'Les coordonnées du candidat ne peuvent pas être vérifiées.');
    if ((identities.data ?? []).length <= 10 && (identities.data ?? []).every((row: Row) => allowedCandidateIds.has(token(row.candidate_id)))) unambiguousRecipients.add(recipient);
  }
  let page: Awaited<ReturnType<typeof listEmails>>;
  try { page = await listEmails(accountId, { anyEmail: [...recipients], limit: EMAIL_HISTORY_LIMIT, metaOnly: false }); }
  catch (error) { providerFailure(error, 'EMAIL_CONTEXT_UNAVAILABLE', 'Les échanges par e-mail ne peuvent pas être lus pour le moment.'); }
  // The list is scoped by the account in the path: a message of another mailbox cannot appear in it.
  // Offset based providers give no cursor, so a full page, a has_more flag or a total larger than the page also mean more history exists.
  // A search by address is approximate on Outlook (it may miss messages), so an Outlook history is never claimed complete.
  let complete = pageIsComplete(page, EMAIL_HISTORY_LIMIT) && candidateActionEmailService(account.provider) !== 'outlook' && unambiguousRecipients.size === recipients.size;
  const imported: Row[] = page.items.slice(0, EMAIL_HISTORY_LIMIT).flatMap(raw => {
    const row = toKonektEmail(raw, { accountId, accountEmail: senderAddress });
    const from = email(row.from_attendee?.identifier);
    const to = row.to_attendees.map(attendee => email(attendee.identifier)).filter(Boolean);
    const cc = row.cc_attendees.map(attendee => email(attendee.identifier)).filter(Boolean);
    const direction = from === senderAddress ? 'outbound' : 'inbound';
    const counterpart = direction === 'inbound' ? from : to.length === 1 ? to[0] : '';
    if (!unambiguousRecipients.has(counterpart)) return [];
    if (!from || (direction === 'inbound' && ![...to, ...cc].includes(senderAddress))) { complete = false; return []; }
    const id = token(row.id);
    const timestamp = token(row.date);
    const content = sanitizeEmailBody(row.body_plain, row.body, 12_000);
    if (!id || !Number.isFinite(Date.parse(timestamp)) || !content) { complete = false; return []; }
    return [{ organization_id: scope.organization_id, candidate_id: binding.candidate_id, project_id: binding.project_id,
      owner_user_id: userId, account_id: accountId, channel: 'email', service: candidateActionEmailService(account.provider),
      audience: 'candidate', direction, provider_message_id: id, provider_thread_id: token(row.thread_id) || null,
      counterpart, sender: from, recipient: direction === 'inbound' ? senderAddress : counterpart,
      subject: token(row.subject) || null, content, occurred_at: new Date(timestamp).toISOString(),
    }];
  });
  if (!imported.length) return { messages: [], complete };
  const stillOwned = await ownAccount(admin, userId, scope, 'email', candidates[0].senderAccountId);
  if (!stillOwned || email(stillOwned.email_address) !== senderAddress) fail('CHANNEL_UNVERIFIED', 'Votre boîte e-mail a changé. Rechargez la conversation.');
  if (await erased()) return { messages: [], complete: true };
  // First opening imports at most one bounded provider page. It never sends,
  // changes a contact, reassigns an existing message, or reads a colleague's box.
  const journal = await admin.from('candidate_action_messages').upsert(imported, { onConflict: 'account_id,provider_message_id', ignoreDuplicates: true });
  if (journal.error) { console.error('[candidate-actions] private email history could not be saved:', journal.error.message); complete = false; }
  const saved = await admin.from('candidate_action_messages').select('*').eq('organization_id', scope.organization_id)
    .eq('owner_user_id', userId).eq('account_id', candidates[0].senderAccountId)
    .in('provider_message_id', imported.map(row => row.provider_message_id));
  if (saved.error) complete = false;
  const byProviderId = new Map<string, Row>((saved.data ?? []).map((row: Row) => [token(row.provider_message_id), row]));
  const messages = imported.flatMap(row => {
    const existing = byProviderId.get(token(row.provider_message_id));
    if (existing && (existing.candidate_id !== binding.candidate_id || existing.audience !== 'candidate')) { complete = false; return []; }
    const source = candidateActionStoredEmailSource(existing ?? row);
    return source ? [source] : [];
  });
  return { messages, complete };
}

export async function readCandidateActionChatContext(admin: ActionClient, userId: string, scope: CandidateActionScope): Promise<{ messages: CandidateActionSource[]; complete: boolean }> {
  if (!scope.chat_id) return { messages: [], complete: true };
  const participant = await validateCandidateActionChat(admin, userId, scope);
  let page: Awaited<ReturnType<typeof listMessages>>;
  try { page = await listMessages(participant.accountId, scope.chat_id, { limit: CHAT_HISTORY_LIMIT }); }
  catch (error) { providerFailure(error, 'CHAT_CONTEXT_UNAVAILABLE', 'Les messages de cette conversation ne peuvent pas être lus pour le moment.'); }
  const messages: CandidateActionSource[] = page.items.flatMap(raw => {
    const row = toKonektMessage(raw, { accountId: participant.accountId, chatId: scope.chat_id });
    const id = token(row.id);
    const timestamp = token(row.timestamp);
    const detail = token(row.text).slice(0, 5000);
    if (!id || !Number.isFinite(Date.parse(timestamp)) || !detail || (row.is_sender !== true && row.is_sender !== false)) return [];
    return [{ id: `linkedin-${participant.accountId}-${id}`, type: row.is_sender ? 'outbound_message' : 'inbound_message', title: row.is_sender ? 'Votre message LinkedIn' : 'Message du candidat', author: row.is_sender ? 'Vous' : participant.candidateName || 'Candidat', timestamp, summary: detail.slice(0, 240), detail, service: 'linkedin' as const, reference: { table: 'provider_messages', id, version: timestamp } }];
  });
  return { messages, complete: pageIsComplete(page, CHAT_HISTORY_LIMIT) };
}
