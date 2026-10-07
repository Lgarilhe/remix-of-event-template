import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, PanelRight, Send } from 'lucide-react';
import { CandidateInteractionTimeline } from './CandidateInteractionTimeline';
import { CandidateProfileContent } from './CandidateProfileContent';
import { DemoCandidateActions } from './DemoCandidateActions';
import { DemoTeamCoordination } from './DemoTeamCoordination';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ConversationContext } from './ConversationContext';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { createInboxDemo } from '@/lib/inboxDemo';
import { createDemoCandidateActions, type DemoActionResult } from '@/lib/inboxDemoActions';
import { SERVICE_LABELS, type MessagingService } from '@/lib/messagingServices';
import type { ActivityEvent } from '@/hooks/useProfileActivity';
import { cn } from '@/lib/utils';

const initials = (name: string) => name.split(' ').map(word => word[0]).slice(0, 2).join('');
const noop = () => {};

/** Démo locale utilisant les cartes et le contexte de la messagerie, sans lecteur ni action serveur. */
export function InboxDemo({ onExit }: { onExit: () => void }) {
  const [conversations] = useState(() => createInboxDemo());
  const [selectedId, setSelectedId] = useState<string | null>(conversations[0].id);
  const [search, setSearch] = useState('');
  const [contextOpen, setContextOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [service, setService] = useState<MessagingService>('whatsapp');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [replies, setReplies] = useState<Record<string, ActivityEvent[]>>({});
  const [actionResults, setActionResults] = useState<Record<string, DemoActionResult>>({});
  const [dismissedActions, setDismissedActions] = useState<Record<string, boolean>>({});
  const [actionDrafts, setActionDrafts] = useState<Record<string, Record<string, string>>>({});
  const suggestedActions = useMemo(() => createDemoCandidateActions(conversations), [conversations]);
  const endRef = useRef<HTMLDivElement>(null);
  const selected = conversations.find(conversation => conversation.id === selectedId) ?? null;
  const events = useMemo(() => {
    if (!selected) return [];
    const appliedMessages: ActivityEvent[] = suggestedActions[selected.id].flatMap(action => {
      const result = actionResults[action.id];
      if (!result) return [];
      return action.effects.filter(effect => effect.kind === 'message').filter(effect => effect.audience === 'candidate').map(effect => ({
        id: `demo-action-${action.id}-${effect.id}`, type: 'message', timestamp: result.appliedAt,
        actionType: effect.service === 'whatsapp' ? 'whatsapp_message' : effect.service === 'linkedin' ? 'message' : 'email',
        channel: effect.service === 'gmail' || effect.service === 'outlook' ? 'email' : effect.service,
        service: effect.service, direction: 'outbound', recipient: effect.recipient,
        finalMessage: result.contents[effect.id], finalSubject: effect.subject, stepOrder: 0, status: 'sent',
      }));
    });
    return [...selected.events, ...(replies[selected.id] ?? []), ...appliedMessages].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));
  }, [selected, replies, suggestedActions, actionResults]);
  const draft = selected ? drafts[selected.id] ?? '' : '';
  useEffect(() => {
    const frame = requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
    return () => cancelAnimationFrame(frame);
  }, [selectedId]);
  function applyAction(id: string) {
    const action = selected && suggestedActions[selected.id].find(item => item.id === id);
    if (!action || actionResults[id] || dismissedActions[id]) return;
    const contents = Object.fromEntries(action.effects.map(effect => [effect.id, (actionDrafts[id]?.[effect.id] ?? effect.content).trim()]));
    if (Object.values(contents).some(value => !value)) return;
    const result = { appliedAt: new Date().toISOString(), contents };
    setActionResults(previous => previous[id] ? previous : { ...previous, [id]: result });
  }
  const actions = selected && <DemoCandidateActions key={selected.id} actions={suggestedActions[selected.id]} results={actionResults} dismissed={dismissedActions} drafts={actionDrafts}
    onDraftChange={(id, effectId, value) => setActionDrafts(previous => ({ ...previous, [id]: { ...previous[id], [effectId]: value } }))}
    onApply={applyAction} onDismiss={(id, dismissed) => setDismissedActions(previous => ({ ...previous, [id]: dismissed }))} />;
  const teamCoordination = selected && <DemoTeamCoordination actions={suggestedActions[selected.id]} results={actionResults} />;
  const context = selected && <ConversationContext name={selected.name} profile={selected.profile} profileUrl={null} mission={selected.mission} events={events} now={Date.now()} readOnly onEnroll={noop} onAddToPipeline={noop} />;

  function send() {
    if (!selected || !draft.trim()) return;
    const event: ActivityEvent = {
      id: `demo-reply-${selected.id}-${Date.now()}`, type: 'message', timestamp: new Date().toISOString(),
      actionType: service === 'whatsapp' ? 'whatsapp_message' : service === 'linkedin' ? 'message' : 'email',
      channel: service === 'gmail' || service === 'outlook' ? 'email' : service,
      service, direction: 'outbound', finalMessage: draft.trim(),
      finalSubject: service === selected.emailService ? `Re : ${selected.mission}` : undefined,
      stepOrder: 0, status: 'sent',
    };
    setReplies(previous => ({ ...previous, [selected.id]: [...(previous[selected.id] ?? []), event] }));
    setDrafts(previous => ({ ...previous, [selected.id]: '' }));
    requestAnimationFrame(() => endRef.current?.scrollIntoView({ block: 'end' }));
  }

  return <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background" data-component="inbox-demo">
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border bg-muted px-3 py-2 text-xs md:px-5">
      <p className="text-foreground-secondary"><span className="md:hidden"><strong className="font-semibold text-foreground">Démo</strong> · Données fictives</span><span className="hidden md:inline"><strong className="font-semibold text-foreground">Démonstration</strong> · Candidats fictifs. Vos messages et modifications restent dans cet aperçu.</span></p>
      <Button variant="outline" size="sm" aria-label="Quitter la démo" className="min-h-11 shrink-0 md:min-h-8" onClick={onExit}><span className="md:hidden">Quitter</span><span className="hidden md:inline">Quitter la démo</span></Button>
    </div>
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className={cn('h-full w-full shrink-0 flex-col border-r border-border md:flex md:w-[320px] xl:w-[360px] 2xl:w-[380px]', selected ? 'hidden' : 'flex')}>
        <div className="space-y-3 border-b border-border p-3">
          <h1 className="text-title font-semibold text-foreground">Messagerie</h1>
          <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Rechercher un candidat fictif" aria-label="Rechercher un candidat fictif" className="max-md:min-h-11" />
          <p className="text-xs text-muted-foreground">3 conversations pour explorer les différents canaux</p>
        </div>
        <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
          {conversations.filter(conversation => conversation.name.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))).map(conversation => <Button key={conversation.id} variant="ghost" aria-pressed={selectedId === conversation.id} onClick={() => { setSelectedId(conversation.id); setService('whatsapp'); setContextOpen(false); }} className={cn('h-auto min-h-24 w-full justify-start gap-3 whitespace-normal rounded-lg p-3 text-left', selectedId === conversation.id && 'bg-accent')}>
            <Avatar className="h-10 w-10 shrink-0"><AvatarFallback>{initials(conversation.name)}</AvatarFallback></Avatar>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-foreground">{conversation.name}</span>
              <span className="mt-1 block truncate text-xs font-normal text-muted-foreground">{conversation.preview}</span>
              <span className="mt-2 flex items-center gap-2"><ServiceLogo service="linkedin" /><ServiceLogo service={conversation.emailService} /><ServiceLogo service="whatsapp" />{conversation.id === 'demo-maya' ? <ServiceLogo service="aircall" /> : conversation.id === 'demo-camille' ? <ServiceLogo service="calendly" /> : null}<span className="text-2xs font-normal text-muted-foreground">Exemple</span></span>
            </span>
          </Button>)}
          {!conversations.some(conversation => conversation.name.toLocaleLowerCase('fr').includes(search.toLocaleLowerCase('fr'))) && <p className="p-4 text-sm text-muted-foreground">Aucun exemple pour cette recherche.</p>}
        </div>
      </aside>
      {selected && <div className="flex h-full min-w-0 flex-1 overflow-hidden" data-component="conversation-workspace">
        <div className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
          <header className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2 md:gap-3 md:px-5 md:py-3">
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 md:hidden" aria-label="Retour aux conversations" onClick={() => setSelectedId(null)}><ChevronLeft aria-hidden="true" /></Button>
            <Avatar className="hidden h-10 w-10 shrink-0 sm:flex"><AvatarFallback>{initials(selected.name)}</AvatarFallback></Avatar>
            <div className="min-w-0 flex-1"><h2 className="truncate text-md font-semibold text-foreground">{selected.name}</h2><p className="truncate text-xs text-muted-foreground">{selected.headline}</p><p className="mt-1 hidden truncate text-xs text-foreground-secondary md:block">{selected.mission}</p></div>
            <Button variant="outline" size="sm" aria-label="Fiche candidat" className="min-h-11 shrink-0" onClick={() => setProfileOpen(true)}><span className="md:hidden">Fiche</span><span className="hidden md:inline">Fiche candidat</span></Button>
            <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 2xl:hidden" aria-label="Voir le contexte candidat" onClick={() => setContextOpen(true)}><PanelRight aria-hidden="true" /></Button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 md:px-6" data-component="demo-timeline">
            <div className="mx-auto max-w-5xl">
              <CandidateInteractionTimeline events={events} name={selected.name} />
              <div className="mt-5" data-component="demo-next-action">{actions}</div>
              {teamCoordination}
              <div ref={endRef} />
            </div>
          </div>
          <form className="shrink-0 space-y-2 border-t border-border bg-background p-3 md:px-5" onSubmit={event => { event.preventDefault(); send(); }}>
            <div className="flex flex-wrap items-center gap-1" aria-label="Canal de la réponse fictive">{(['linkedin', selected.emailService, 'whatsapp'] as const).map(option => <Button type="button" key={option} variant={service === option ? 'outline' : 'ghost'} size="sm" className="min-h-11 gap-2 px-2 md:min-h-8 md:px-3" aria-pressed={service === option} onClick={() => setService(option)}><ServiceLogo service={option} decorative />{SERVICE_LABELS[option]}</Button>)}</div>
            <Textarea value={draft} onChange={event => setDrafts(previous => ({ ...previous, [selected.id]: event.target.value }))} maxLength={2000} rows={2} className="min-h-16 resize-none" aria-label="Réponse fictive" placeholder="Essayez une réponse fictive…" />
            <div className="flex items-center justify-between gap-2"><p className="text-2xs text-muted-foreground">Simulation uniquement</p><Button type="submit" variant="primary" size="sm" disabled={!draft.trim()} className="min-h-11 gap-2 md:min-h-8"><Send aria-hidden="true" />Envoyer dans la démo</Button></div>
          </form>
        </div>
        <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border bg-muted 2xl:block">{context}</aside>
        <Dialog open={profileOpen} onOpenChange={setProfileOpen}>
          <DialogContent className="flex max-h-[90dvh] max-w-3xl flex-col overflow-hidden p-0 [&>button]:h-11 [&>button]:w-11">
            <DialogHeader className="shrink-0 p-5 pb-2 pr-14"><DialogTitle>{selected.name}</DialogTitle><DialogDescription>Fiche fictive · Les mêmes interactions et propositions que dans la messagerie</DialogDescription></DialogHeader>
            <Tabs defaultValue="profile" className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-5 grid h-auto shrink-0 grid-cols-3"><TabsTrigger value="profile" className="min-h-11">Profil</TabsTrigger><TabsTrigger value="interactions" className="min-h-11">Interactions</TabsTrigger><TabsTrigger value="actions" className="min-h-11">Actions</TabsTrigger></TabsList>
              <TabsContent value="profile" className="min-h-0 flex-1 overflow-y-auto p-5"><CandidateProfileContent profile={selected.profile} /></TabsContent>
              <TabsContent value="interactions" className="min-h-0 flex-1 overflow-y-auto p-5"><CandidateInteractionTimeline events={events} name={selected.name} />{teamCoordination}</TabsContent>
              <TabsContent value="actions" className="min-h-0 flex-1 overflow-y-auto p-5">
                {actions}
                {suggestedActions[selected.id].some(action => actionResults[action.id]) && <section className="mt-6 space-y-4 border-t border-border pt-4" aria-label="Contenus enregistrés dans la fiche" data-component="demo-saved-documents">
                  <h4 className="text-sm font-semibold text-foreground">Enregistré dans la fiche</h4>
                  {suggestedActions[selected.id].flatMap(action => {
                    const result = actionResults[action.id];
                    return result ? action.effects.filter(effect => effect.kind === 'document').map(effect => <div key={effect.id}>
                      <h5 className="text-sm font-medium text-foreground">{effect.label}</h5>
                      <p className="mt-1 text-xs text-muted-foreground">{effect.destination}</p>
                      <p className="mt-2 whitespace-pre-line break-words text-sm leading-relaxed text-foreground-secondary">{result.contents[effect.id]}</p>
                    </div>) : [];
                  })}
                </section>}
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>
        <Sheet open={contextOpen} onOpenChange={setContextOpen}><SheetContent className="w-full max-w-sm overflow-y-auto p-0 [&>button]:h-11 [&>button]:w-11"><SheetHeader className="p-5 pb-0"><SheetTitle>Suivi et profil du candidat</SheetTitle></SheetHeader>{context}</SheetContent></Sheet>
      </div>}
    </div>
  </div>;
}
