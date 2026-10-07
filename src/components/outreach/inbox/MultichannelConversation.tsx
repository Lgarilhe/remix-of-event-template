import { useState } from 'react';
import { ChevronLeft, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useCandidateActions } from '@/hooks/useCandidateActions';
import { useProfileActivity } from '@/hooks/useProfileActivity';
import { useMemberName } from '@/hooks/useTeamMembers';
import { mergeCandidateActionEvents } from '@/lib/candidateActions';
import type { MultichannelConversation as Conversation } from '@/lib/multichannelInbox';
import { SERVICE_LABELS } from '@/lib/messagingServices';
import { CandidateActions, CandidateActionHistory } from './CandidateActions';
import { CandidateInteractionTimeline } from './CandidateInteractionTimeline';
import { ConversationContext } from './ConversationContext';

/** Un échange enregistré n'est jamais converti en fausse conversation LinkedIn. */
export function MultichannelConversation({ conversation, onBack, onChanged }: { conversation: Conversation; onBack: () => void; onChanged: () => void }) {
  const { user } = useAuthReady();
  const memberName = useMemberName();
  const [contextOpen, setContextOpen] = useState(false);
  const [chosenProject, setChosenProject] = useState<string | null>(conversation.projectId);
  const needsMission = conversation.ambiguousMission && !chosenProject;
  const projectName = conversation.availableProjects.find(project => project.id === chosenProject)?.name || conversation.projectName;
  const activity = useProfileActivity(conversation.candidateId, conversation.linkedinUrl);
  const actions = useCandidateActions(needsMission ? null : { candidate_id: conversation.candidateId, linkedin_url: conversation.linkedinUrl, project_id: chosenProject, account_id: conversation.ownerUserId === user?.id ? conversation.accountId : null }, onChanged);
  const ledger = [...new Map([...conversation.messages, ...actions.messages].map(row => [`${row.account_id}:${row.provider_message_id}`, row])).values()];
  const events = mergeCandidateActionEvents(activity.events, actions.plans, [], ledger, null, memberName);
  const context = <ConversationContext name={conversation.candidateName} profileId={conversation.candidateId} profileUrl={conversation.linkedinUrl} profile={conversation.profile} mission={projectName} missionUrl={chosenProject ? `/missions/${chosenProject}` : undefined} events={events} now={Date.now()} readOnly onEnroll={() => {}} onAddToPipeline={() => {}} />;
  return <div className="flex h-full min-w-0 overflow-hidden bg-background" data-component="multichannel-conversation">
    <div className="flex h-full min-w-0 flex-1 flex-col">
      <header className="flex shrink-0 items-start gap-2 border-b border-border p-3 md:px-5 md:py-4">
        <Button variant="ghost" size="icon" className="h-11 w-11 shrink-0 md:hidden" aria-label="Retour aux conversations" onClick={onBack}><ChevronLeft aria-hidden="true" /></Button>
        <div className="min-w-0 flex-1"><h2 className="break-words text-md font-semibold text-foreground">{conversation.candidateName}</h2><p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-foreground-secondary"><ServiceLogo service={conversation.latest.service} decorative />{SERVICE_LABELS[conversation.latest.service]} · {conversation.ownerUserId === user?.id ? 'Votre compte' : memberName(conversation.ownerUserId) || 'Compte de l’équipe'}</p><p className="mt-1 break-words text-xs text-muted-foreground">{projectName || (conversation.ambiguousMission ? 'Plusieurs missions : rattachement à vérifier' : conversation.projectId ? 'Mission rattachée' : 'Mission non identifiée')}</p></div>
        <Button variant="outline" size="sm" className="min-h-11 shrink-0" onClick={() => setContextOpen(true)}><UserRound aria-hidden="true" /><span className="hidden sm:inline">Fiche candidat</span><span className="sr-only sm:hidden">Fiche candidat</span></Button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 md:p-6">
        <div className="mx-auto max-w-5xl">
          {activity.error && <p className="mb-3 text-xs text-muted-foreground" role="status">Certains événements sont temporairement indisponibles.</p>}
          {conversation.ambiguousMission && <div className="mb-4 space-y-2 rounded-xl border border-border-strong bg-card p-4"><Label htmlFor="external-mission">Mission de la prochaine action</Label><p className="text-xs text-foreground-secondary">Plusieurs missions concernent ce candidat. Choisissez le contexte avant de préparer une réponse.</p><Select value={chosenProject ?? '__none__'} onValueChange={setChosenProject}><SelectTrigger id="external-mission" className="min-h-11"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="__none__" disabled className="min-h-11">Choisir une mission</SelectItem>{conversation.availableProjects.map(project => <SelectItem key={project.id} value={project.id} className="min-h-11">{project.name}</SelectItem>)}</SelectContent></Select></div>}
          <CandidateInteractionTimeline events={events} name={conversation.candidateName} />
          <CandidateActionHistory plans={actions.plans} messages={ledger} />
          <CandidateActions controller={actions} />
        </div>
      </div>
      <p className="shrink-0 border-t border-border bg-card px-4 py-3 text-xs leading-relaxed text-foreground-secondary">Préparez une réponse dans « Prochaines actions », puis vérifiez le compte et le destinataire avant l’envoi.</p>
    </div>
    <aside className="hidden w-80 shrink-0 overflow-y-auto border-l border-border bg-card xl:block" aria-label="Contexte candidat">{context}</aside>
    <Sheet open={contextOpen} onOpenChange={setContextOpen}><SheetContent className="w-full overflow-y-auto p-0 sm:max-w-xl [&>button]:h-11 [&>button]:w-11"><SheetHeader className="border-b border-border px-5 py-4 pr-14 text-left"><SheetTitle>Fiche de {conversation.candidateName}</SheetTitle><SheetDescription>Profil et suivi du candidat.</SheetDescription></SheetHeader>{context}</SheetContent></Sheet>
  </div>;
}
