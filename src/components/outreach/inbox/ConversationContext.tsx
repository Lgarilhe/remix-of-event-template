import React from 'react';
import { Link } from 'react-router-dom';
import { Briefcase, CalendarCheck, ExternalLink, GitBranch, ListPlus } from 'lucide-react';
import type { ActivityEvent } from '@/hooks/useProfileActivity';
import { Button } from '@/components/ui/button';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { activityService, meetingService } from '@/lib/messagingServices';
import { activityChannel } from '@/lib/inboxTimeline';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CandidateProfilePanel } from './CandidateProfilePanel';
import { CandidateProfileContent } from './CandidateProfileContent';
import type { LinkedInProfile } from '@/components/outreach/types';

interface ConversationContextProps {
  name: string;
  profileUrl: string | null;
  mission: string | null;
  missionUrl?: string;
  probableMission?: boolean;
  events: ActivityEvent[];
  now: number;
  sequenceStatus?: React.ReactNode;
  onEnroll: () => void;
  onAddToPipeline: () => void;
  readOnly?: boolean;
  profileId?: string | null;
  profileAliases?: string[];
  profile?: LinkedInProfile;
}

export function ConversationContext({ name, profileUrl, mission, missionUrl, probableMission, events, now, sequenceStatus, onEnroll, onAddToPipeline, readOnly = false, profileId = null, profileAliases = [], profile }: ConversationContextProps) {
  const upcoming = events.find(event => event.type === 'booking' && Date.parse(event.timestamp) >= now && !['cancelled', 'canceled', 'completed', 'done'].includes(event.status));
  const sequence = [...events].reverse().find(event => event.sequenceName);
  const contacts = [...new Map(events.filter(event => event.recipient).map(event => [activityChannel(event), event])).values()];
  const canOpenProfile = !!profileUrl && /^https?:\/\/([\w-]+\.)?linkedin\.com\//i.test(profileUrl);
  return (
    <div className="space-y-6 p-5" data-component="conversation-context">
      <div>
        <p className="eyebrow text-muted-foreground">Contexte candidat</p>
        <h3 className="mt-1 break-words text-sm font-semibold text-foreground">{name}</h3>
        {canOpenProfile && <a href={profileUrl!} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-xs text-foreground underline-offset-4 hover:underline md:min-h-8"><ServiceLogo service="linkedin" decorative />Voir le profil LinkedIn<ExternalLink className="h-3.5 w-3.5 text-foreground" aria-hidden="true" /></a>}
      </div>
      <Tabs key={profileId || profile?.id || profileUrl || name} defaultValue="followup">
        <TabsList className="grid h-auto w-full grid-cols-2"><TabsTrigger value="followup" className="min-h-11">Suivi</TabsTrigger><TabsTrigger value="profile" className="min-h-11">Profil</TabsTrigger></TabsList>
        <TabsContent value="profile" className="mt-5">{profile ? <CandidateProfileContent profile={profile} /> : <CandidateProfilePanel profileId={profileId} profileUrl={profileUrl} profileName={name} aliases={profileAliases} />}</TabsContent>
        <TabsContent value="followup" className="mt-5 space-y-6">
      <section>
        <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground"><Briefcase className="h-4 w-4" aria-hidden="true" />{probableMission ? 'Mission probable' : 'Mission'}</h4>
        {mission ? missionUrl ? <Link to={missionUrl} className="block min-h-11 break-words text-sm text-foreground underline-offset-4 md:min-h-0 hover:underline">{mission}</Link> : <p className="break-words text-sm text-foreground-secondary">{mission}</p> : <p className="text-xs text-muted-foreground">Aucune mission rattachée</p>}
      </section>
      <section>
        <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground"><CalendarCheck className="h-4 w-4" aria-hidden="true" />Prochain entretien</h4>
        {upcoming ? <div className="rounded-lg border border-border bg-background p-3">
          <p className="break-words text-sm font-medium text-foreground">{upcoming.eventName || 'Entretien'}</p>
          <p className="mt-2 text-sm text-foreground-secondary">{new Date(upcoming.timestamp).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
          <p className="mt-1 font-medium tabular-nums text-foreground">{new Date(upcoming.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</p>
          {upcoming.eventLocation && <p className="mt-2 flex items-start gap-2 break-words text-xs text-muted-foreground [overflow-wrap:anywhere]">{meetingService(upcoming.eventLocation) && <ServiceLogo service="google_meet" decorative />}<span>{upcoming.eventLocation}</span></p>}
          {upcoming.qualificationSessionId && <Button variant="ghost" size="sm" className="mt-2 w-full max-md:min-h-11" asChild><Link to={`/qualification/${upcoming.qualificationSessionId}`}>Ouvrir l'entretien</Link></Button>}
        </div> : <p className="text-xs text-muted-foreground">Aucun entretien à venir</p>}
      </section>
      {(sequence || sequenceStatus) && <section>
        <h4 className="mb-2 flex items-center gap-2 text-xs font-semibold text-foreground"><GitBranch className="h-4 w-4" aria-hidden="true" />Séquence</h4>
        {sequenceStatus && <div className="text-xs text-muted-foreground">{sequenceStatus}</div>}
        {sequence && <><p className="mt-2 break-words text-sm text-foreground-secondary">{sequence.sequenceName}</p><p className="mt-1 text-xs text-muted-foreground">Dernière activité : étape {sequence.stepOrder + 1}</p></>}
      </section>}
      {contacts.length > 0 && <section>
        <h4 className="mb-2 text-xs font-semibold text-foreground">Canaux et contacts</h4>
        <div className="space-y-2">{contacts.map(event => <p key={activityChannel(event)} className="flex items-start gap-2 text-xs text-foreground-secondary"><ServiceLogo service={activityService(event)} decorative /><span className="break-all">{event.recipient}</span></p>)}</div>
        {!readOnly && contacts.some(event => activityChannel(event) === 'whatsapp') && <Button asChild variant="ghost" size="sm" className="mt-2 min-h-11"><Link to="/settings/account/connections#whatsapp"><ServiceLogo service="whatsapp" decorative />Paramétrer WhatsApp</Link></Button>}
      </section>}
      {!readOnly && <div className="space-y-2 border-t border-border pt-4">
        <Button variant="outline" size="sm" className="w-full justify-start max-md:min-h-11" onClick={onEnroll}><ListPlus aria-hidden="true" />Inscrire dans une séquence</Button>
        <Button variant="ghost" size="sm" className="w-full justify-start max-md:min-h-11" onClick={onAddToPipeline}><Briefcase aria-hidden="true" />Ajouter au pipeline</Button>
      </div>}
        </TabsContent>
      </Tabs>
    </div>
  );
}
