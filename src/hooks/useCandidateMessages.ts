import { useQuery } from '@tanstack/react-query';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyLinkedInAccountId } from '@/hooks/useMyLinkedInAccountId';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { candidateLinkedInSlug } from '@/lib/candidateProfile';
import type { Message } from '@/hooks/useMessagesInbox';
import type { CandidateProfileIdentity } from './useInboxCandidateProfile';

export interface CandidateMessages { messages: Message[]; chats: { id: string; label: string }[] }
const objects = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.filter(row => row && typeof row === 'object') : [];

/** Parcourt toutes les pages disponibles, y compris plusieurs conversations avec la même personne. */
export async function fetchCandidateMessages(organizationId: string, accountId: string, ids: string[], profileUrl?: string | null): Promise<CandidateMessages> {
  const chats = new Map<string, Record<string, unknown>>();
  let lookupSucceeded = false;
  const readChats = async (id: string) => {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    do {
      const { data } = await invokeUnipile({ body: { action: 'get_chats', organization_id: organizationId, account_id: accountId, attendee_provider_id: id, limit: 100, ...(cursor ? { cursor } : {}) } });
      if (!data.success) { if (cursor) throw new Error('Une partie des conversations est indisponible.'); return; }
      lookupSucceeded = true;
      objects(data.chats).forEach(chat => { if (typeof chat.id === 'string') chats.set(chat.id, chat); });
      cursor = typeof data.cursor === 'string' && data.cursor ? data.cursor : undefined;
      if (cursor && cursors.has(cursor)) throw new Error('Le chargement des conversations est incomplet.');
      if (cursor) cursors.add(cursor);
    } while (cursor);
  };
  for (const id of ids) await readChats(id);
  // Les fiches importées peuvent ne connaître que l'URL publique, pas l'identifiant de conversation.
  if (!chats.size && candidateLinkedInSlug(profileUrl)) {
    const { data } = await invokeUnipile({ body: { action: 'get_profile', organization_id: organizationId, account_id: accountId, profile_id: candidateLinkedInSlug(profileUrl), profile_url: profileUrl } });
    if (data.success && data.profile && typeof data.profile === 'object') {
      emitQuotaAction('profileVisits', 1, accountId);
      const profile = data.profile as Record<string, unknown>;
      const providerId = typeof profile.provider_id === 'string' ? profile.provider_id : typeof profile.id === 'string' ? profile.id : null;
      if (providerId && !ids.includes(providerId)) await readChats(providerId);
    } else if (!lookupSucceeded) throw new Error('Les conversations LinkedIn sont temporairement indisponibles.');
  }
  if (!lookupSucceeded) throw new Error('Les conversations LinkedIn sont temporairement indisponibles.');
  const messages: Message[] = [];
  const orderedChats = [...chats.values()].sort((a, b) => Date.parse(String(b.timestamp || '')) - Date.parse(String(a.timestamp || '')));
  for (const chat of orderedChats) {
    let cursor: string | undefined;
    const cursors = new Set<string>();
    const seen = new Set<string>();
    do {
      const { data } = await invokeUnipile({ body: { action: 'get_messages', organization_id: organizationId, account_id: accountId, chat_id: chat.id, limit: 100, ...(cursor ? { cursor } : {}) } });
      if (!data.success) throw new Error('Les messages LinkedIn sont temporairement indisponibles.');
      for (const row of objects(data.messages)) {
        if (typeof row.id !== 'string' || seen.has(row.id)) continue;
        seen.add(row.id);
        messages.push(row as unknown as Message);
      }
      cursor = typeof data.cursor === 'string' && data.cursor ? data.cursor : undefined;
      if (cursor && cursors.has(cursor)) throw new Error('Le chargement des messages est incomplet.');
      if (cursor) cursors.add(cursor);
    } while (cursor);
  }
  return { messages, chats: orderedChats.map(chat => ({ id: String(chat.id), label: String(chat.name || (chat.is_inmail ? 'InMail' : 'Conversation LinkedIn')) })) };
}

export function useCandidateMessages({ profileId, profileUrl, aliases = [] }: CandidateProfileIdentity) {
  const { user, isReady } = useAuthReady();
  const { organizationId } = useOrganization();
  const accountId = useMyLinkedInAccountId();
  const ids = [...new Set([profileId, ...aliases].filter((id): id is string => !!id))].sort();
  const queryKey = ['candidate-messages', user?.id, organizationId, accountId, ids.join('|'), profileUrl ?? ''];
  const query = useQuery({ queryKey, queryFn: () => fetchCandidateMessages(organizationId!, accountId!, ids, profileUrl), enabled: isReady && !!user && !!organizationId && !!accountId && (!!ids.length || !!profileUrl), staleTime: 30_000, retry: false });
  return { ...query, queryKey, accountId, organizationId, userId: user?.id };
}
