import React from 'react';
import { ArrowUpRight, MessageSquare, RotateCcw } from 'lucide-react';
import type { Chat } from '@/hooks/useMessagesInbox';
import type { ResponseFilter } from '@/lib/inboxThreadState';
import { getChatDisplayName, getChatHeadline, getChatAvatar, getInitials } from '@/hooks/useMessagesInboxHelpers';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

export function InboxOverview({ chats, replyCount, followUpCount, onSelect, onFilter }: {
  chats: Chat[];
  replyCount: number;
  followUpCount: number;
  onSelect: (chat: Chat) => void;
  onFilter: (filter: ResponseFilter) => void;
}) {
  return (
    <div className="h-full overflow-y-auto bg-background p-6 md:p-10 xl:p-14">
      <div className="mx-auto max-w-4xl">
        <p className="eyebrow text-muted-foreground">Vos échanges candidats</p>
        <h2 className="mt-2 text-title font-semibold text-foreground">Chaque conversation, avec son contexte</h2>
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-foreground-secondary">Ouvrez un échange pour retrouver les messages, les envois de séquences et les entretiens du candidat.</p>
        <div className="mt-8 grid gap-4 lg:grid-cols-2">
          {[{ label: 'À répondre', count: replyCount, filter: 'waiting_me' as const, icon: MessageSquare }, { label: 'À relancer', count: followUpCount, filter: 'to_follow_up' as const, icon: RotateCcw }].map(({ label, count, filter, icon: Icon }) => (
            <Button variant="ghost" key={filter} onClick={() => onFilter(filter)} className="flex h-auto min-h-24 items-center gap-4 rounded-lg border border-border bg-muted p-5 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Icon className="h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />
              <span className="flex-1"><span className="block text-title font-semibold tabular-nums text-foreground">{count}</span><span className="text-sm text-foreground-secondary">{label}</span></span>
              <ArrowUpRight className="h-4 w-4 text-foreground" aria-hidden="true" />
            </Button>
          ))}
        </div>
        {chats.length > 0 && <section className="mt-10">
          <h3 className="mb-3 text-sm font-semibold text-foreground">Conversations récentes</h3>
          <div className="divide-y divide-border">{chats.slice(0, 5).map(chat => <Button key={chat.id} variant="ghost" className="h-auto min-h-20 w-full justify-start gap-3 rounded-lg px-3 py-4 text-left" onClick={() => onSelect(chat)}>
            <Avatar className="h-10 w-10 shrink-0"><AvatarImage src={getChatAvatar(chat) || undefined} alt="" /><AvatarFallback>{getInitials(getChatDisplayName(chat))}</AvatarFallback></Avatar>
            <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{getChatDisplayName(chat)}</span><span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{chat.last_message?.text || getChatHeadline(chat) || 'Ouvrir la conversation'}</span></span>
            <ArrowUpRight className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
          </Button>)}</div>
        </section>}
      </div>
    </div>
  );
}
