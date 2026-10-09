/** Personal, verified channels for candidate actions. No transport retries a POST. */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.75.1';
import { resolveUnipileCredentials } from '../resolve-org-credentials.ts';
import { isCandidateErasedForOrg } from '../get-or-fetch-contact.ts';
import { enforceLinkedInAction, recordUsageSignal, parseUsagePct } from '../linkedin-quotas.ts';
import { candidateRef, recordOutbound } from '../candidate-stage-events.ts';
import { classifySendStatus } from '../sequence-send-rules.ts';
import { sanitizeEmailBody } from '../email-tool-policy.mjs';
import { textToHtml } from '../interview-followup.ts';
import { resolveCandidateActionMessageScope } from './message-scope.ts';
import type { CandidateActionMessageEffect, CandidateActionMessageOutcome, CandidateActionScope, CandidateActionSource, CandidateActionTarget } from './types.ts';

type ActionClient = SupabaseClient;
// Older shared helpers infer an unknown schema from ReturnType<createClient>.
// The runtime client is identical; keep this compatibility cast at that boundary.
const legacyAdmin = (admin: ActionClient): NonNullable<Parameters<typeof resolveUnipileCredentials>[1]> => admin as unknown as NonNullable<Parameters<typeof resolveUnipileCredentials>[1]>;
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
const safeId = (value: string): string => {
  if (!value || value.length > 512 || /[/\\?#]|\.\./.test(value)) fail('INVALID_CHANNEL_ID', 'La conversation ou le compte est invalide.');
  return encodeURIComponent(value);
};
const profileSlug = (value: unknown): string => {
  try { const url = new URL(token(value)); return (url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com')) ? decodeURIComponent(url.pathname.match(/^\/in\/([^/]+)/)?.[1] ?? '').toLowerCase() : ''; } catch { return ''; }
};
const items = (value: unknown): Row[] => { const payload = record(value); const rows = Array.isArray(value) ? value : payload.items; return Array.isArray(rows) ? rows.map(record) : []; };

export async function candidateActionProviderCredentials(admin: ActionClient, organizationId: string): Promise<{ apiKey: string; baseUrl: string }> {
  const creds = await resolveUnipileCredentials(organizationId, legacyAdmin(admin));
  if (!creds) fail('CHANNEL_UNAVAILABLE', 'Le service de messagerie est indisponible. Réessayez dans un instant.');
  const base = creds.dsn.startsWith('https://') ? creds.dsn : `https://${creds.dsn}`;
  return { apiKey: creds.apiKey, baseUrl: base.replace(/\/$/, '').replace(/\/api\/v1$/, '') + '/api/v1' };
}

export function candidateActionProviderFetch(creds: { apiKey: string; baseUrl: string }, path: string, options: RequestInit = {}, timeoutMs = 12_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(`${creds.baseUrl}${path}`, { ...options, headers: { 'X-API-KEY': creds.apiKey, Accept: 'application/json', ...options.headers }, signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function ownAccount(admin: ActionClient, userId: string, scope: CandidateActionScope, channel: 'email' | 'linkedin' | 'whatsapp', accountId?: string): Promise<Row | null> {
  const table = channel === 'email' ? 'member_email_accounts' : channel === 'linkedin' ? 'member_linkedin_accounts' : 'member_whatsapp_accounts';
  const column = channel === 'email' ? 'email_account_id' : channel === 'linkedin' ? 'linkedin_account_id' : 'whatsapp_account_id';
  let query = admin.from(table).select('*').eq('organization_id', scope.organization_id).eq('user_id', userId);
  if (accountId) query = query.eq(column, accountId);
  const { data, error } = await query.order('linked_at', { ascending: false }).limit(10);
  if (error) fail('CHANNEL_UNVERIFIED', 'Votre connexion de messagerie ne peut pas être vérifiée. Réessayez.');
  const rows = (data ?? []) as Row[];
  return rows.find(row => usable(row.account_status)) ?? null;
}

/** A one-to-one chat and its exact non-self attendee, never a display-name match. */
async function verifiedChat(admin: ActionClient, userId: string, scope: CandidateActionScope, channel: 'linkedin' | 'whatsapp', chatId: string, accountId?: string): Promise<{ chat: Row; attendee: Row; account: Row }> {
  const creds = await candidateActionProviderCredentials(admin, scope.organization_id);
  const chatResponse = await candidateActionProviderFetch(creds, `/chats/${safeId(chatId)}`);
  if (!chatResponse.ok) fail('CHAT_UNVERIFIED', 'La conversation ne peut pas être vérifiée. Réessayez.');
  const chat = record(await chatResponse.json());
  const ownerId = token(chat.account_id);
  if (!ownerId || (accountId && accountId !== ownerId)) fail('SENDER_CHANGED', 'Le compte de cette conversation a changé. Préparez à nouveau la réponse.');
  const account = await ownAccount(admin, userId, scope, channel, ownerId);
  if (!account) fail('CHAT_NOT_OWNED', "Cette conversation appartient à un autre compte. Répondez depuis votre propre compte.");
  const attendeeResponse = await candidateActionProviderFetch(creds, `/chats/${safeId(chatId)}/attendees`);
  if (!attendeeResponse.ok) fail('RECIPIENT_UNVERIFIED', 'Le destinataire de la conversation ne peut pas être vérifié.');
  const attendees = items(await attendeeResponse.json());
  const others = attendees.filter(row => row.is_self !== true && row.is_self !== 1 && row.role !== 'self');
  if (others.length !== 1 || token(chat.type) === '1' || Number(chat.type) === 1) fail('GROUP_CHAT_NOT_ALLOWED', 'Seules les conversations individuelles peuvent recevoir une action candidat.');
  const attendee = others[0];
  if (token(attendee.account_id) && token(attendee.account_id) !== ownerId) fail('RECIPIENT_UNVERIFIED', 'Le destinataire de cette conversation ne peut pas être vérifié.');
  return { chat, attendee, account };
}

export async function validateCandidateActionChat(admin: ActionClient, userId: string, scope: CandidateActionScope): Promise<{ candidateIds: string[]; linkedinUrl: string | null; candidateName: string }> {
  if (!scope.chat_id) fail('CHAT_REQUIRED', 'La conversation est introuvable.');
  const { attendee, chat } = await verifiedChat(admin, userId, scope, 'linkedin', scope.chat_id, scope.account_id ?? undefined);
  const specifics = record(attendee.specifics);
  const ids = [...new Set([token(attendee.provider_id), token(attendee.public_identifier), token(specifics.public_identifier)].filter(Boolean))];
  const url = token(attendee.profile_url);
  const slug = profileSlug(url);
  let matches = ids.includes(scope.candidate_id) || (!!slug && (slug === scope.candidate_id.toLowerCase() || slug === profileSlug(scope.linkedin_url)));
  if (!matches) {
    const { data, error } = await admin.from('mission_conversations').select('candidate_id,candidate_ids')
      .eq('organization_id', scope.organization_id).eq('account_id', token(chat.account_id))
      .eq('chat_id', scope.chat_id).limit(20);
    if (error) fail('CANDIDATE_UNVERIFIED', 'L’identité du candidat ne peut pas être vérifiée.');
    matches = (data ?? []).some((row: Row) => {
      const aliases = Array.isArray(row.candidate_ids) ? row.candidate_ids : [];
      return (row.candidate_id === scope.candidate_id || aliases.includes(scope.candidate_id)) && ids.some(id => aliases.includes(id) || row.candidate_id === id);
    });
  }
  if (!matches) fail('CANDIDATE_MISMATCH', 'Cette conversation ne correspond pas au candidat affiché.');
  if (!ids.length) fail('RECIPIENT_UNVERIFIED', 'Le destinataire LinkedIn ne peut pas être vérifié.');
  return { candidateIds: [...new Set([...ids, ...(slug ? [slug] : [])])], linkedinUrl: url || null, candidateName: token(attendee.name) };
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
      const creds = await candidateActionProviderCredentials(admin, scope.organization_id);
      const response = await candidateActionProviderFetch(creds, `/chat_attendees/${safeId(scope.candidate_id)}/chats?account_id=${safeId(accountId)}&limit=10`);
      if (!response.ok) fail('CHAT_DISCOVERY_UNAVAILABLE', 'Les conversations LinkedIn ne peuvent pas être vérifiées. Réessayez.');
      chatId = token(items(await response.json()).find(chat => token(chat.account_id) === accountId && Number(chat.type) === 0)?.id);
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
  const account = await ownAccount(admin, userId, scope, effect.channel, effect.senderAccountId);
  if (!account) fail('SENDER_CHANGED', 'Votre compte d’envoi a changé ou doit être reconnecté. Préparez à nouveau cette action.');
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
    const gate = await enforceLinkedInAction(legacyAdmin(admin), { accountId: effect.senderAccountId, actionType: 'message', userId, organizationId: scope.organization_id, source: 'candidate_action', mode: 'auto', log: false });
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

/** Calls this only after the engine has durably claimed this individual effect. */
export async function sendCandidateActionMessage(admin: ActionClient, userId: string, scope: CandidateActionScope, effect: CandidateActionMessageEffect, context?: { planId: string }): Promise<CandidateActionMessageOutcome> {
  try { await validateCandidateActionMessage(admin, userId, scope, effect); }
  catch (error) { return { status: 'failed', result: { errorCode: error instanceof CandidateActionTransportError ? error.code : 'PREFLIGHT_FAILED', message: error instanceof CandidateActionTransportError ? error.message : 'Les conditions de l’envoi ne peuvent pas être vérifiées.' } }; }
  let creds: { apiKey: string; baseUrl: string };
  try { creds = await candidateActionProviderCredentials(admin, scope.organization_id); }
  catch { return { status: 'failed', result: { errorCode: 'CHANNEL_UNAVAILABLE', message: 'Le service de messagerie est indisponible. Aucun message n’a été envoyé.' } }; }
  if (effect.channel === 'linkedin') {
    const gate = await enforceLinkedInAction(legacyAdmin(admin), { accountId: effect.senderAccountId, actionType: 'message', userId, organizationId: scope.organization_id, source: 'candidate_action', mode: 'auto' });
    if (!gate.allowed) return { status: 'failed', result: { errorCode: 'LINKEDIN_QUOTA', message: gate.reason || 'La limite de votre compte LinkedIn est atteinte. Réessayez plus tard.' } };
    // Mark the pending Konekt send so its webhook echo cannot advance the wrong mission.
    await recordOutbound(admin, { organizationId: scope.organization_id, accountId: effect.senderAccountId, candidate: candidateRef({ ids: [scope.candidate_id, effect.recipientProviderId], profileUrl: scope.linkedin_url }), source: 'assistant', projectId: scope.project_id, chatId: effect.chatId, createdBy: userId, pending: true });
  }
  let existingChatId = effect.chatId;
  if (effect.channel === 'whatsapp' && !existingChatId) {
    try {
      const response = await candidateActionProviderFetch(creds, `/chat_attendees/${safeId(effect.recipient)}/chats?account_id=${safeId(effect.senderAccountId)}&limit=10`, {}, 6_000);
      if (!response.ok) return { status: 'failed', result: { errorCode: 'CHAT_LOOKUP_FAILED', message: 'Votre conversation WhatsApp ne peut pas être vérifiée. Aucun message n’a été envoyé.' } };
      const payload = record(await response.json());
      const chats = items(payload).filter(chat => token(chat.account_id) === effect.senderAccountId && Number(chat.type) === 0);
      const chat = chats.find(row => candidateActionPhone(row.attendee_provider_id) === effect.recipient)
        ?? (chats.length === 1 ? chats[0] : undefined);
      if (chat) {
        const verified = await verifiedChat(admin, userId, scope, 'whatsapp', token(chat.id), effect.senderAccountId);
        if (candidateActionPhone(verified.attendee.provider_id) !== effect.recipient) return { status: 'failed', result: { errorCode: 'RECIPIENT_CHANGED', message: 'Le destinataire WhatsApp ne peut pas être vérifié. Aucun message n’a été envoyé.' } };
        existingChatId = token(chat.id);
      } else if (chats.length || payload.cursor) {
        return { status: 'failed', result: { errorCode: 'CHAT_LOOKUP_FAILED', message: 'Votre conversation WhatsApp ne peut pas être vérifiée. Aucun message n’a été envoyé.' } };
      }
    } catch {
      return { status: 'failed', result: { errorCode: 'CHAT_LOOKUP_FAILED', message: 'Votre conversation WhatsApp ne peut pas être vérifiée. Aucun message n’a été envoyé.' } };
    }
  }
  let response: Response;
  const sendStartedAt = Date.now();
  try {
    if (effect.channel === 'email') {
      const form = new FormData();
      form.set('account_id', effect.senderAccountId);
      form.set('subject', effect.subject!.trim());
      form.set('body', textToHtml(effect.content.trim()));
      form.set('to', JSON.stringify([{ display_name: effect.recipient, identifier: effect.recipient }]));
      response = await candidateActionProviderFetch(creds, '/emails', { method: 'POST', headers: { 'Idempotency-Key': effect.id }, body: form }, 15_000);
    } else {
      const form = new FormData();
      form.set('account_id', effect.senderAccountId);
      form.set('text', effect.content.trim());
      if (!existingChatId) form.set('attendees_ids', effect.recipientProviderId ?? effect.recipient);
      response = await candidateActionProviderFetch(creds, existingChatId ? `/chats/${safeId(existingChatId)}/messages` : '/chats', { method: 'POST', body: form }, 15_000);
    }
  } catch {
    return { status: 'unknown', result: { errorCode: 'SEND_UNCERTAIN', message: 'Le service n’a pas confirmé l’envoi. Vérifiez votre conversation ou vos e-mails envoyés avant toute nouvelle action.' } };
  }
  const outcome = classifySendStatus(response.status);
  if (outcome !== 'ok') {
    await response.text().catch(() => '');
    return { status: outcome === 'uncertain' ? 'unknown' : 'failed', result: { errorCode: outcome === 'uncertain' ? 'SEND_UNCERTAIN' : 'SEND_REJECTED', message: outcome === 'uncertain' ? 'L’envoi n’est pas confirmé. Vérifiez vos messages envoyés avant de continuer.' : 'Le service a refusé le message. Vérifiez votre connexion puis réessayez.' } };
  }
  // A successful HTTP send remains successful even if its receipt or local journal fails.
  const receipt = record(await response.json().catch(() => null));
  const providerId = token(receipt.provider_id) || token(receipt.message_id) || token(receipt.id);
  const threadId = token(receipt.thread_id) || token(receipt.chat_id) || existingChatId || null;
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
      await recordUsageSignal(legacyAdmin(admin), effect.senderAccountId, parseUsagePct(receipt));
    }
  } catch (error) {
    journalFailed = true;
    console.error('[candidate-actions] message sent, tracking unavailable:', error instanceof Error ? error.message : 'unknown');
  }
  const providerReceipt = Object.fromEntries(['object', 'provider_id', 'message_id', 'id', 'thread_id', 'chat_id', 'tracking_id'].filter(key => receipt[key] !== undefined).map(key => [key, receipt[key]]));
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
  const creds = await candidateActionProviderCredentials(admin, scope.organization_id);
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
  const query = new URLSearchParams({ account_id: candidates[0].senderAccountId, any_email: [...recipients].join(','), limit: '50', meta_only: 'false' });
  const response = await candidateActionProviderFetch(creds, `/emails?${query}`);
  if (!response.ok) fail('EMAIL_CONTEXT_UNAVAILABLE', 'Les échanges par e-mail ne peuvent pas être lus pour le moment.');
  const payload = record(await response.json());
  let complete = !payload.cursor && items(payload).length <= 50 && unambiguousRecipients.size === recipients.size;
  const imported: Row[] = items(payload).slice(0, 50).flatMap(row => {
    const from = email(record(row.from_attendee).identifier);
    const to = items(row.to_attendees).map(attendee => email(attendee.identifier)).filter(Boolean);
    const cc = items(row.cc_attendees).map(attendee => email(attendee.identifier)).filter(Boolean);
    if (token(row.account_id) && row.account_id !== candidates[0].senderAccountId) { complete = false; return []; }
    const direction = from === senderAddress ? 'outbound' : 'inbound';
    const counterpart = direction === 'inbound' ? from : to.length === 1 ? to[0] : '';
    if (!unambiguousRecipients.has(counterpart)) return [];
    if (!from || (direction === 'inbound' && ![...to, ...cc].includes(senderAddress))) { complete = false; return []; }
    const id = token(row.provider_id) || token(row.id);
    const timestamp = token(row.date);
    const content = sanitizeEmailBody(row.body_plain, row.body, 12_000);
    if (!id || !Number.isFinite(Date.parse(timestamp)) || !content) { complete = false; return []; }
    return [{ organization_id: scope.organization_id, candidate_id: binding.candidate_id, project_id: binding.project_id,
      owner_user_id: userId, account_id: candidates[0].senderAccountId, channel: 'email', service: candidateActionEmailService(account.provider),
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
  const creds = await candidateActionProviderCredentials(admin, scope.organization_id);
  const response = await candidateActionProviderFetch(creds, `/chats/${safeId(scope.chat_id)}/messages?limit=50`);
  if (!response.ok) fail('CHAT_CONTEXT_UNAVAILABLE', 'Les messages de cette conversation ne peuvent pas être lus pour le moment.');
  const payload = record(await response.json());
  const messages: CandidateActionSource[] = items(payload).flatMap(row => {
    const id = token(row.provider_id) || token(row.message_id) || token(row.id);
    const timestamp = token(row.timestamp);
    const detail = token(row.text).slice(0, 5000);
    if (!id || !Number.isFinite(Date.parse(timestamp)) || !detail || (row.is_sender !== true && row.is_sender !== false && row.is_sender !== 1 && row.is_sender !== 0)) return [];
    return [{ id: `linkedin-${scope.account_id}-${id}`, type: row.is_sender === true || row.is_sender === 1 ? 'outbound_message' : 'inbound_message', title: row.is_sender === true || row.is_sender === 1 ? 'Votre message LinkedIn' : 'Message du candidat', author: row.is_sender === true || row.is_sender === 1 ? 'Vous' : participant.candidateName || 'Candidat', timestamp, summary: detail.slice(0, 240), detail, service: 'linkedin' as const, reference: { table: 'provider_messages', id, version: timestamp } }];
  });
  return { messages, complete: !payload.cursor };
}
