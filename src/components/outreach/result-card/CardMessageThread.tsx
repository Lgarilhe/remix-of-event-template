import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Loader2, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { CandidateInteractionTimeline } from '@/components/outreach/inbox/CandidateInteractionTimeline';
import { useProfileActivity } from '@/hooks/useProfileActivity';
import { useCandidateMessages, type CandidateMessages } from '@/hooks/useCandidateMessages';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyLinkedInAccountId } from '@/hooks/useMyLinkedInAccountId';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { toast } from 'sonner';

interface CardMessageThreadProps {
  profileId: string;
  profileName: string;
  profileUrl?: string | null;
  profileAliases?: string[];
  /** Mission de l'envoi : le serveur y pose « Contacté ». */
  projectId?: string;
  onMessageSent?: () => void;
  onProfileTreated?: () => void;
}

/** L'état de saisie repart de zéro à chaque candidat, utilisateur, organisation ou compte. */
export function CardMessageThread(props: CardMessageThreadProps) {
  const { user } = useAuthReady();
  const { organizationId } = useOrganization();
  const accountId = useMyLinkedInAccountId();
  return <InteractionThread key={JSON.stringify([user?.id, organizationId, accountId, props.profileId, props.profileUrl])} {...props} />;
}

function InteractionThread({ profileId, profileName, profileUrl, profileAliases = [], projectId, onMessageSent, onProfileTreated }: CardMessageThreadProps) {
  const activity = useProfileActivity(profileId, profileUrl, profileName, profileAliases);
  const query = useCandidateMessages({ profileId, profileUrl, aliases: profileAliases });
  const queryClient = useQueryClient();
  const [replyText, setReplyText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [replyChatId, setReplyChatId] = useState('');
  const sending = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const messages = query.data?.messages ?? [];
  const chats = query.data?.chats ?? [];
  const chatId = chats.some(chat => chat.id === replyChatId) ? replyChatId : chats[0]?.id;

  async function handleSendReply() {
    if (!query.accountId || !query.organizationId || !chatId || !replyText.trim() || sending.current) return;
    sending.current = true;
    setIsSending(true);
    const text = replyText.trim();
    try {
      const { data } = await invokeUnipile({ body: { action: 'send_message', organization_id: query.organizationId, account_id: query.accountId, chat_id: chatId, text, project_id: projectId } });
      if (!data.success) throw new Error('Envoi impossible');
      emitQuotaAction('messagesSent', 1, query.accountId);
      const sent = data.message && typeof data.message === 'object' ? data.message as Record<string, unknown> : {};
      queryClient.setQueryData<CandidateMessages>(query.queryKey, previous => previous && ({ ...previous, messages: [...previous.messages, { id: typeof sent.id === 'string' ? sent.id : `sent-${Date.now()}`, text, is_sender: true, timestamp: new Date().toISOString() }] }));
      if (mounted.current) { setReplyText(''); toast.success('Message envoyé !'); onMessageSent?.(); onProfileTreated?.(); }
    } catch {
      if (mounted.current) toast.error("Erreur lors de l'envoi du message");
    } finally {
      sending.current = false;
      if (mounted.current) setIsSending(false);
    }
  }

  return <div className="space-y-4">
    <div className="flex items-center justify-between gap-2 border-b border-border pb-2"><p className="text-xs text-muted-foreground">Tous les échanges et événements disponibles</p><Button variant="ghost" size="sm" className="min-h-11" disabled={query.isFetching || activity.loading} onClick={() => { activity.retry(); if (query.accountId) void query.refetch(); }}>Actualiser</Button></div>
    {(activity.loading || query.isLoading) && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Chargement des interactions…</p>}
    {activity.error && <div role="status" className="space-y-2"><p className="text-sm text-muted-foreground">Certaines interactions sont temporairement indisponibles.</p><Button variant="outline" size="sm" className="min-h-11" onClick={activity.retry}>Réessayer les événements</Button></div>}
    {query.isError && <div role="status" className="space-y-2"><p className="text-sm text-muted-foreground">Les messages LinkedIn sont temporairement indisponibles.</p><Button variant="outline" size="sm" className="min-h-11" onClick={() => void query.refetch()}>Réessayer les messages</Button></div>}
    {!query.accountId && <div className="space-y-2"><p className="text-sm text-muted-foreground">Connectez votre compte LinkedIn pour retrouver aussi vos conversations.</p><Button asChild variant="outline" size="sm" className="min-h-11"><Link to="/settings/account/connections">Ouvrir mes connexions</Link></Button></div>}
    {!activity.loading && !query.isLoading && !activity.error && !query.isError && !messages.length && !activity.events.length && <p className="py-6 text-sm text-muted-foreground">Aucune interaction enregistrée avec ce candidat.</p>}
    <CandidateInteractionTimeline messages={messages} events={activity.events} name={profileName} />
    {!!chatId && !query.isError && <div className="space-y-2 border-t border-border pt-3">
      <p className="flex items-center gap-2 text-xs text-muted-foreground"><ServiceLogo service="linkedin" decorative />Réponse via votre compte LinkedIn</p>
      {chats.length > 1 && <div className="space-y-1"><p className="text-xs text-muted-foreground">Conversation de la réponse</p><Select value={chatId} onValueChange={setReplyChatId} disabled={isSending}><SelectTrigger className="min-h-11" aria-label="Conversation de la réponse"><SelectValue /></SelectTrigger><SelectContent>{chats.map((chat, index) => <SelectItem key={chat.id} value={chat.id} className="min-h-11">{chat.label} {index + 1}</SelectItem>)}</SelectContent></Select></div>}
      <div className="flex gap-2"><Textarea value={replyText} onChange={event => setReplyText(event.target.value)} disabled={isSending} aria-label={`Répondre à ${profileName} sur LinkedIn`} placeholder="Écrire un message…" className="min-h-[60px] max-h-[120px] resize-none text-sm" onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void handleSendReply(); } }} /><Button onClick={() => void handleSendReply()} disabled={!replyText.trim() || isSending} aria-label="Envoyer le message LinkedIn" size="icon" variant="primary" className="h-auto min-h-[60px] w-12">{isSending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}</Button></div>
      <p className="text-xs text-muted-foreground">Entrée pour envoyer, Maj + Entrée pour un retour à la ligne.</p>
    </div>}
  </div>;
}
