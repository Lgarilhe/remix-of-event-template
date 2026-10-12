/** Durable private inbox events, independently of sequence enrollment state. */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.75.1';
import { sanitizeEmailBody } from '../email-tool-policy.mjs';
import { resolveCandidateActionMessageScope } from './message-scope.ts';
import { inReplyToCandidates } from '../sequence-email-policy.mjs';
import { isCandidateErasedForOrg } from '../get-or-fetch-contact.ts';
import { getChat, getEmail, getMessage, isUnipileError, toKonektChat, toKonektEmail, toKonektMessage } from '../unipile/index.ts';
import { candidateActionEmailService, candidateActionPhone } from './transport.ts';

type ActionClient = SupabaseClient;
type Row = Record<string, unknown>;
const rec = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const email = (value: unknown): string => { const text = str(value).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : ''; };
const escapeLike = (value: string): string => value.replace(/([%_\\])/g, '\\$1');
const safeId = (id: string): string => {
  if (!id || id.length > 512 || /[/\\?#]|\.\./.test(id)) throw new Error('Invalid incoming message identity');
  return id;
};
/** An incoming event is read inside the webhook delivery: a slow provider must fail the delivery (and replay it), not stall it. */
const READ_BUDGET_MS = 4_000;
function bounded<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Incoming provider read timed out')), READ_BUDGET_MS); });
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

interface BoundAccount { organization_id: string; user_id: string; account_id: string; address: string; channel: 'email' | 'linkedin' | 'whatsapp'; provider: string }
interface MessageBinding { candidate_id: string; project_id: string | null; audience: 'candidate' | 'team'; action_plan_id?: string | null }

async function boundAccount(admin: ActionClient, accountId: string): Promise<BoundAccount | null> {
  const specs = [
    ['member_email_accounts', 'email_account_id', 'email'] as const,
    ['member_linkedin_accounts', 'linkedin_account_id', 'linkedin'] as const,
    ['member_whatsapp_accounts', 'whatsapp_account_id', 'whatsapp'] as const,
  ];
  const results = await Promise.all(specs.map(([table, column]) => admin.from(table).select('*').eq(column, accountId).limit(3)));
  const matches: BoundAccount[] = [];
  for (let index = 0; index < results.length; index++) {
    const result = results[index];
    if (result.error) throw result.error;
    const channel = specs[index][2];
    for (const row of result.data ?? []) {
      if (['DELETED', 'DISCONNECTED'].includes(str(row.account_status).toUpperCase())) continue;
      const address = channel === 'email' ? email(row.email_address) : channel === 'whatsapp' ? candidateActionPhone(row.phone_number) : str(row.linkedin_account_name);
      if (row.organization_id && row.user_id) matches.push({ organization_id: row.organization_id, user_id: row.user_id, account_id: accountId, address, channel, provider: str(row.provider) });
    }
  }
  // An orphan or an ambiguous cross-organization binding is never guessed.
  if (matches.length !== 1) return null;
  const account = matches[0];
  const membership = await admin.from('organization_members').select('id').eq('organization_id', account.organization_id).eq('user_id', account.user_id).maybeSingle();
  if (membership.error) throw membership.error;
  return membership.data ? account : null;
}

/**
 * Journal rows of our own sends that a reply names. A reply carries the RFC Message-ID of the mail it answers,
 * while the journal key is the provider's Email id: the RFC id of each send is kept in the receipt of its effect,
 * so the effect ids matching the reply are the exact identity of the answered send.
 */
async function answeredEffectIds(admin: ActionClient, replyIds: string[]): Promise<Set<string>> {
  if (!replyIds.length) return new Set();
  const { data, error } = await admin.from('candidate_action_effects').select('id')
    .in('result->providerReceipt->>message_id', replyIds).limit(20);
  if (error) throw error;
  return new Set((data ?? []).map((row: Row) => str(row.id)).filter(Boolean));
}

async function knownMessageBinding(admin: ActionClient, account: BoundAccount, counterpart: string, threadId: string | null, replyIds: string[]): Promise<MessageBinding | null | undefined> {
  const { data, error } = await admin.from('candidate_action_messages')
    .select('candidate_id,project_id,audience,provider_message_id,provider_thread_id,action_plan_id,effect_id,occurred_at')
    .eq('organization_id', account.organization_id).eq('owner_user_id', account.user_id)
    .eq('account_id', account.account_id).eq('channel', account.channel).eq('direction', 'outbound')
    .eq('counterpart', counterpart).order('occurred_at', { ascending: false }).limit(100);
  if (error) throw error;
  let exactReplies = (data ?? []).filter((row: Row) => replyIds.includes(str(row.provider_message_id)));
  if (!exactReplies.length && account.channel === 'email' && (data ?? []).length) {
    const answered = await answeredEffectIds(admin, replyIds);
    if (answered.size) exactReplies = (data ?? []).filter((row: Row) => answered.has(str(row.effect_id)));
  }
  const matching = exactReplies.length ? exactReplies : (data ?? []).filter((row: Row) => !!threadId && row.provider_thread_id === threadId);
  if (!matching.length) return undefined;
  const scopes = new Set(matching.map((row: Row) => JSON.stringify([row.candidate_id, row.project_id ?? null, row.audience])));
  // A reused thread may discuss the same candidate for different missions.
  // An ambiguous historical binding must not fall back to contact inference.
  if (scopes.size !== 1) return null;
  const row = matching[0] as Row | undefined;
  return row ? { candidate_id: str(row.candidate_id), project_id: str(row.project_id) || null, audience: row.audience === 'team' ? 'team' : 'candidate', action_plan_id: str(row.action_plan_id) || null } : null;
}

async function contactBinding(admin: ActionClient, account: BoundAccount, counterpart: string, chatId: string | null): Promise<MessageBinding | null> {
  if (account.channel === 'linkedin') {
    if (!chatId) return null;
    const { data, error } = await admin.from('mission_conversations').select('candidate_id,candidate_ids,project_id')
      .eq('organization_id', account.organization_id).eq('account_id', account.account_id).eq('chat_id', chatId).limit(10);
    if (error) throw error;
    const matching = (data ?? []).filter((row: Row) => row.candidate_id === counterpart || (Array.isArray(row.candidate_ids) && row.candidate_ids.includes(counterpart)));
    const candidates = new Set(matching.map((row: Row) => str(row.candidate_id)));
    if (candidates.size !== 1) return null;
    return { candidate_id: str(matching[0].candidate_id), project_id: matching.length === 1 ? str(matching[0].project_id) || null : null, audience: 'candidate' };
  }
  // Exact persisted coordinates only, never a name or a broad profile search.
  let query = admin.from('candidate_contacts').select('candidate_id').eq('organization_id', account.organization_id);
  query = account.channel === 'email'
    ? query.ilike('email', escapeLike(counterpart))
    : query.in('phone', [counterpart, counterpart.slice(1)]);
  const contacts = await query.limit(10);
  if (contacts.error) throw contacts.error;
  const ids = new Set<string>((contacts.data ?? []).map((row: Row) => str(row.candidate_id)).filter(Boolean));
  // Addresses/numbers used in a prior sequence remain exact identity evidence,
  // including completed enrollments (the reply must still appear in history).
  let enrollmentQuery = admin.from('sequence_enrollments').select('profile_id,provider_id,resolved_profile_id,job_id').eq('organization_id', account.organization_id);
  enrollmentQuery = account.channel === 'email' ? enrollmentQuery.ilike('email_used', escapeLike(counterpart)) : enrollmentQuery.in('phone_used', [counterpart, counterpart.slice(1)]);
  const enrollment = await enrollmentQuery.limit(100);
  if (enrollment.error) throw enrollment.error;
  if (!ids.size) for (const row of enrollment.data ?? []) {
    const id = str(row.resolved_profile_id) || str(row.provider_id) || str(row.profile_id);
    if (id) ids.add(id);
  }
  if (ids.size !== 1) return null;
  const mission = await resolveCandidateActionMessageScope(admin, account.organization_id, [...ids][0], enrollment.data ?? []);
  return { ...mission, audience: 'candidate' };
}

export async function captureCandidateActionIncoming(admin: ActionClient, payload: Row, rawEnvelope?: unknown): Promise<{ channel: BoundAccount['channel'] | null; audience: 'candidate' | 'team' | null; captured: boolean }> {
  const accountId = str(payload.account_id);
  if (!accountId) return { channel: null, audience: null, captured: false };
  const account = await boundAccount(admin, accountId);
  if (!account) return { channel: null, audience: null, captured: false };
  const nested = rec(rec(payload.data).message);
  const raw = rec(rawEnvelope);
  const v2 = typeof raw.type === 'string' ? rec(raw.payload) : {};
  const id = account.channel === 'email' ? str(payload.email_id) || str(v2.id) : str(payload.message_id) || str(nested.id) || str(v2.id);
  if (!id) throw new Error('Incoming event without durable message identity');
  const existing = await admin.from('candidate_action_messages').select('id,audience').eq('account_id', accountId).eq('provider_message_id', id).maybeSingle();
  if (existing.error) throw existing.error;
  if (existing.data) return { channel: account.channel, audience: existing.data.audience, captured: true };
  // The account is the one the delivery names, proven bound to a member above; a v2 message or chat has no account of its own.
  let threadId: string | null = null;
  let timestamp: string;
  let replyIdsSource: unknown;
  let providerMessageId: string;
  let subject: string | null = null;
  let counterpart: string;
  let sender: string;
  let recipient: string;
  let content: string;
  let direction: 'inbound' | 'outbound';
  if (account.channel === 'email') {
    const message = toKonektEmail(await bounded(getEmail(accountId, safeId(id))), { accountId, accountEmail: account.address });
    timestamp = str(message.date) || str(v2.date);
    if (!Number.isFinite(Date.parse(timestamp))) throw new Error('Incoming message without valid timestamp');
    threadId = str(message.thread_id) || str(payload.thread_id) || null;
    const from = email(message.from_attendee?.identifier);
    const to = message.to_attendees.map(row => email(row.identifier)).filter(Boolean);
    const cc = message.cc_attendees.map(row => email(row.identifier)).filter(Boolean);
    if (!account.address || !from || (from !== account.address && ![...to, ...cc].includes(account.address))) throw new Error('Incoming email mailbox identity cannot be verified');
    direction = from === account.address ? 'outbound' : 'inbound';
    // Multi-recipient sent email has no single candidate attribution.
    if (direction === 'outbound' && to.length !== 1) return { channel: account.channel, audience: null, captured: false };
    counterpart = direction === 'inbound' ? from : to[0];
    sender = from;
    recipient = direction === 'inbound' ? account.address : counterpart;
    content = sanitizeEmailBody(message.body_plain, message.body, 12_000);
    subject = str(message.subject) || null;
    replyIdsSource = message.in_reply_to ?? payload.in_reply_to;
    // One canonical id per mail, the provider's own Email id: the delivery and the journal of a send agree on it.
    providerMessageId = str(message.provider_id) || id;
  } else {
    // A message is readable only inside its chat: the chat id comes from the delivery (envelope or flattened event).
    const chatId = str(payload.chat_id) || str(nested.chat_id) || str(rec(rec(payload.data).chat).id) || str(v2.chat_id);
    if (!chatId) throw new Error('Incoming chat direction cannot be verified');
    const message = toKonektMessage(await bounded(getMessage(accountId, safeId(chatId), safeId(id))), { accountId, chatId });
    timestamp = str(message.timestamp) || str(v2.timestamp);
    if (!Number.isFinite(Date.parse(timestamp))) throw new Error('Incoming message without valid timestamp');
    if (message.is_sender !== true && message.is_sender !== false) throw new Error('Incoming chat direction cannot be verified');
    threadId = chatId;
    // Read under this very account: a chat that is not the account's own does not answer, and the delivery is replayed.
    let rawChat: unknown;
    try { rawChat = await bounded(getChat(accountId, chatId)); }
    catch (error) {
      // A chat that definitively does not answer under this account (deleted, or an inbox the account cannot read) will never answer:
      // replaying the delivery would loop for ever and block the reply handlers that run after this capture.
      if (isUnipileError(error) && (error.kind === 'not_found' || error.kind === 'forbidden')) return { channel: account.channel, audience: null, captured: false };
      throw error;
    }
    const chat = toKonektChat(rawChat, { accountId });
    if (chat.type !== 0) return { channel: account.channel, audience: null, captured: false };
    const identity = str(chat.attendees[0]?.provider_id) || str(chat.attendee_provider_id);
    counterpart = account.channel === 'whatsapp' ? candidateActionPhone(identity) : identity;
    if (!counterpart) throw new Error('Incoming chat attendee identity missing');
    direction = message.is_sender ? 'outbound' : 'inbound';
    sender = direction === 'inbound' ? counterpart : account.address;
    recipient = direction === 'inbound' ? account.address : counterpart;
    content = str(message.text).slice(0, 12_000);
    replyIdsSource = payload.in_reply_to;
    providerMessageId = str(message.provider_id) || id;
  }
  // Attachment-only events are not invented text; a later real text event will be captured.
  if (!content) return { channel: account.channel, audience: null, captured: false };
  const replyIds = inReplyToCandidates(replyIdsSource);
  const known = await knownMessageBinding(admin, account, counterpart, threadId, replyIds);
  const binding = known === undefined ? await contactBinding(admin, account, counterpart, threadId) : known;
  if (!binding) return { channel: account.channel, audience: null, captured: false };
  if (await isCandidateErasedForOrg(admin, { organizationId: account.organization_id, linkedinIds: [binding.candidate_id], emails: account.channel === 'email' && binding.audience === 'candidate' ? [counterpart] : [] })) return { channel: account.channel, audience: null, captured: false };
  const { error } = await admin.from('candidate_action_messages').upsert({
    organization_id: account.organization_id, candidate_id: binding.candidate_id, project_id: binding.project_id,
    owner_user_id: account.user_id, account_id: accountId, channel: account.channel,
    service: account.channel === 'email' ? candidateActionEmailService(account.provider) : account.channel,
    audience: binding.audience, direction, provider_message_id: providerMessageId, provider_thread_id: threadId,
    counterpart, sender, recipient, subject, content,
    occurred_at: new Date(timestamp).toISOString(), action_plan_id: binding.action_plan_id ?? null,
    in_reply_to: replyIds[0] ?? null,
  }, { onConflict: 'account_id,provider_message_id', ignoreDuplicates: true });
  if (error) throw error;
  return { channel: account.channel, audience: binding.audience, captured: true };
}
