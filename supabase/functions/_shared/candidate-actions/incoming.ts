/** Durable private inbox events, independently of sequence enrollment state. */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2.75.1';
import { sanitizeEmailBody } from '../email-tool-policy.mjs';
import { resolveCandidateActionMessageScope } from './message-scope.ts';
import { inReplyToCandidates } from '../sequence-email-policy.mjs';
import { isCandidateErasedForOrg } from '../get-or-fetch-contact.ts';
import { candidateActionEmailService, candidateActionPhone, candidateActionProviderCredentials, candidateActionProviderFetch } from './transport.ts';

type ActionClient = SupabaseClient;
type Row = Record<string, unknown>;
const rec = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const email = (value: unknown): string => { const text = str(value).toLowerCase(); return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text) ? text : ''; };
const rows = (value: unknown): Row[] => { const list = Array.isArray(value) ? value : rec(value).items; return Array.isArray(list) ? list.map(rec) : []; };
const escapeLike = (value: string): string => value.replace(/([%_\\])/g, '\\$1');
const safePath = (id: string): string => {
  if (!id || id.length > 512 || /[/\\?#]|\.\./.test(id)) throw new Error('Invalid incoming message identity');
  return encodeURIComponent(id);
};

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

async function knownMessageBinding(admin: ActionClient, account: BoundAccount, counterpart: string, threadId: string | null, replyIds: string[]): Promise<MessageBinding | null | undefined> {
  const { data, error } = await admin.from('candidate_action_messages')
    .select('candidate_id,project_id,audience,provider_message_id,provider_thread_id,action_plan_id,occurred_at')
    .eq('organization_id', account.organization_id).eq('owner_user_id', account.user_id)
    .eq('account_id', account.account_id).eq('channel', account.channel).eq('direction', 'outbound')
    .eq('counterpart', counterpart).order('occurred_at', { ascending: false }).limit(100);
  if (error) throw error;
  const exactReplies = (data ?? []).filter((row: Row) => replyIds.includes(str(row.provider_message_id)));
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
  const creds = await candidateActionProviderCredentials(admin, account.organization_id);
  const path = account.channel === 'email' ? `/emails/${safePath(id)}?account_id=${encodeURIComponent(accountId)}` : `/messages/${safePath(id)}`;
  const response = await candidateActionProviderFetch(creds, path, {}, 4_000);
  if (!response.ok) throw new Error('Incoming provider message could not be read');
  const message = rec(await response.json());
  if (str(message.account_id) && message.account_id !== accountId) throw new Error('Incoming message belongs to another account');
  const timestamp = str(message.date) || str(message.timestamp) || str(v2.timestamp);
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error('Incoming message without valid timestamp');
  const threadId = str(message.thread_id) || str(message.chat_id) || str(payload.chat_id) || str(nested.chat_id) || str(v2.chat_id) || null;
  let counterpart: string;
  let sender: string;
  let recipient: string;
  let content: string;
  let direction: 'inbound' | 'outbound';
  if (account.channel === 'email') {
    const from = email(rec(message.from_attendee).identifier);
    const to = rows(message.to_attendees).map(row => email(row.identifier)).filter(Boolean);
    const cc = rows(message.cc_attendees).map(row => email(row.identifier)).filter(Boolean);
    if (!account.address || !from || (from !== account.address && ![...to, ...cc].includes(account.address))) throw new Error('Incoming email mailbox identity cannot be verified');
    direction = from === account.address ? 'outbound' : 'inbound';
    // Multi-recipient sent email has no single candidate attribution.
    if (direction === 'outbound' && to.length !== 1) return { channel: account.channel, audience: null, captured: false };
    counterpart = direction === 'inbound' ? from : to[0];
    sender = from;
    recipient = direction === 'inbound' ? account.address : counterpart;
    content = sanitizeEmailBody(message.body_plain, message.body, 12_000);
  } else {
    if (!threadId || (message.is_sender !== true && message.is_sender !== false && message.is_sender !== 1 && message.is_sender !== 0)) throw new Error('Incoming chat direction cannot be verified');
    const chatResponse = await candidateActionProviderFetch(creds, `/chats/${safePath(threadId)}`, {}, 4_000);
    if (!chatResponse.ok) throw new Error('Incoming chat ownership cannot be verified');
    const chat = rec(await chatResponse.json());
    if (chat.account_id !== accountId || Number(chat.type) !== 0) return { channel: account.channel, audience: null, captured: false };
    const attendeeResponse = await candidateActionProviderFetch(creds, `/chats/${safePath(threadId)}/attendees`, {}, 4_000);
    if (!attendeeResponse.ok) throw new Error('Incoming chat attendee cannot be verified');
    const other = rows(await attendeeResponse.json()).filter(row => row.is_self !== true && row.is_self !== 1 && row.role !== 'self');
    if (other.length !== 1) return { channel: account.channel, audience: null, captured: false };
    const identity = str(other[0].provider_id);
    counterpart = account.channel === 'whatsapp' ? candidateActionPhone(identity) : identity;
    if (!counterpart) throw new Error('Incoming chat attendee identity missing');
    direction = message.is_sender === true || message.is_sender === 1 ? 'outbound' : 'inbound';
    sender = direction === 'inbound' ? counterpart : account.address;
    recipient = direction === 'inbound' ? account.address : counterpart;
    content = str(message.text).slice(0, 12_000);
  }
  // Attachment-only events are not invented text; a later real text event will be captured.
  if (!content) return { channel: account.channel, audience: null, captured: false };
  const replyIds = inReplyToCandidates(message.in_reply_to ?? payload.in_reply_to);
  const known = await knownMessageBinding(admin, account, counterpart, threadId, replyIds);
  const binding = known === undefined ? await contactBinding(admin, account, counterpart, threadId) : known;
  if (!binding) return { channel: account.channel, audience: null, captured: false };
  if (await isCandidateErasedForOrg(admin, { organizationId: account.organization_id, linkedinIds: [binding.candidate_id], emails: account.channel === 'email' && binding.audience === 'candidate' ? [counterpart] : [] })) return { channel: account.channel, audience: null, captured: false };
  const providerMessageId = str(message.provider_id) || str(message.message_id) || id;
  const { error } = await admin.from('candidate_action_messages').upsert({
    organization_id: account.organization_id, candidate_id: binding.candidate_id, project_id: binding.project_id,
    owner_user_id: account.user_id, account_id: accountId, channel: account.channel,
    service: account.channel === 'email' ? candidateActionEmailService(account.provider) : account.channel,
    audience: binding.audience, direction, provider_message_id: providerMessageId, provider_thread_id: threadId,
    counterpart, sender, recipient, subject: str(message.subject) || null, content,
    occurred_at: new Date(timestamp).toISOString(), action_plan_id: binding.action_plan_id ?? null,
    in_reply_to: replyIds[0] ?? null,
  }, { onConflict: 'account_id,provider_message_id', ignoreDuplicates: true });
  if (error) throw error;
  return { channel: account.channel, audience: binding.audience, captured: true };
}
