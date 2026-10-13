import { useMemo, useState } from 'react';
import { format, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ArrowRight, CheckCircle2, ClipboardList, FileText, Mic, Play, User, X } from 'lucide-react';
import { ProfileDetailedTab } from '@/components/ats/candidate-detail/ProfileDetailedTab';
import { ScorecardEditor, type ScorecardCriterion } from '@/components/ats/ScorecardEditor';
import { ProfileDetailSheet } from '@/components/outreach/result-card/ProfileDetailSheet';
import type { LinkedInProfile } from '@/components/outreach/types';
import { CalendarServiceLogo } from '@/components/calendar/CalendarServiceLogo';
import type { DemoDraft, PreviewTab } from '@/components/calendar/CalendarDemoProvider';
import { texturedCard } from '@/components/layout';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CALENDAR_DEMO_SERVICE_LABELS, type CalendarDemoInterview } from '@/lib/calendarDemo';

interface InterviewDemoDialogProps {
  selected: CalendarDemoInterview;
  tab: PreviewTab;
  draft: DemoDraft;
  onClose: () => void;
  onTabChange: (tab: PreviewTab) => void;
  onDraftChange: (update: Partial<DemoDraft>) => void;
  onRestoreFocus: (event: Event) => void;
}

/** La fiche et l'éditeur habituels ; seules les données et leur sauvegarde sont locales. */
export default function InterviewDemoDialog({ selected, tab, draft, onClose, onTabChange, onDraftChange, onRestoreFocus }: InterviewDemoDialogProps) {
  const [criterionIndex, setCriterionIndex] = useState(0);
  const profile = useMemo<LinkedInProfile>(() => ({
    ...selected.profile,
    id: selected.event.id,
    name: selected.event.meta?.candidateName,
    headline: selected.event.meta?.candidateHeadline,
  }), [selected]);
  const criteria = useMemo<ScorecardCriterion[]>(() => selected.criteria.map(criterion => ({
    id: criterion.id,
    label: criterion.label,
    description: criterion.description,
    category: criterion.category,
    weight: criterion.weight,
    suggestedQuestions: [criterion.question],
    ratingRubric: criterion.ratingRubric,
  })), [selected]);
  const rated = criteria.filter(criterion => draft.ratings[criterion.id] != null);
  const weightedScore = rated.length
    ? rated.reduce((sum, criterion) => sum + draft.ratings[criterion.id] * criterion.weight, 0)
      / rated.reduce((sum, criterion) => sum + criterion.weight, 0)
    : null;
  const assistantOpen = tab === 'assistant' || tab === 'meeting';
  const assistant = assistantOpen ? <div className="space-y-4">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{tab === 'meeting' ? 'Visioconférence' : 'Assistant d’entretien'}</h3>
      <Button variant="ghost" size="icon" className="h-11 w-11" aria-label="Fermer le panneau d’entretien" onClick={() => onTabChange('scorecard')}><X aria-hidden="true" /></Button>
    </div>
    {tab === 'meeting'
      ? <MeetingPreview interview={selected} onOpenAssistant={() => onTabChange('assistant')} />
      : <AssistantPreview interview={selected} draft={draft} onChange={onDraftChange} onOpenScorecard={() => onTabChange('scorecard')} />}
  </div> : undefined;
  const evaluation = <div className="space-y-4">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="inline-flex items-center gap-1.5"><CalendarServiceLogo service={selected.calendar} className="h-4 w-4" />{CALENDAR_DEMO_SERVICE_LABELS[selected.calendar]}</span>
      <span>Grille préparée · {format(parseISO(selected.event.startAt), 'd MMMM à HH:mm', { locale: fr })}</span>
    </div>
    <ScorecardEditor
      value={{
        criteria, ratings: draft.ratings, comments: draft.comments, overallScore: weightedScore,
        jobTitle: selected.event.subtitle, interviewStage: 'phone_screen',
        recommendation: draft.recommendation, summary: draft.notes, followUpNotes: draft.followUpNotes,
      }}
      currentCriterionIndex={criterionIndex}
      onCriterionChange={setCriterionIndex}
      onRate={(id, rating) => onDraftChange({ ratings: { ...draft.ratings, [id]: rating } })}
      onComment={(id, comment) => onDraftChange({ comments: { ...draft.comments, [id]: comment } })}
      onRecommendationChange={recommendation => onDraftChange({ recommendation })}
      onSummaryChange={notes => onDraftChange({ notes })}
      onFollowUpNotesChange={followUpNotes => onDraftChange({ followUpNotes })}
      status={<p role="status" className="text-xs text-muted-foreground">Exemple fictif · Modifications conservées dans cet aperçu</p>}
      actions={<>
        <Button variant={tab === 'assistant' ? 'secondary' : 'outline'} size="sm" className="max-md:min-h-11" aria-label={tab === 'assistant' ? "Fermer l'assistant d'entretien" : "Ouvrir l'assistant d'entretien"} onClick={() => onTabChange(tab === 'assistant' ? 'scorecard' : 'assistant')}><Mic aria-hidden="true" />Assistant</Button>
        <Button variant="outline" size="sm" className="max-md:min-h-11" onClick={() => onTabChange('meeting')}><CalendarServiceLogo service={selected.meeting} className="h-4 w-4" />Rejoindre</Button>
      </>}
      assistant={assistant}
    />
  </div>;

  return <ProfileDetailSheet
    profile={profile}
    open
    onOpenChange={open => { if (!open) onClose(); }}
    selectedJob={null}
    localPreview
    hideStandardTabs
    pipelineMeta={{ stage: 'Exemple fictif', stageOptions: [] }}
    initialTab="evaluation"
    activeTab={tab === 'profile' ? 'profile' : 'evaluation'}
    onActiveTabChange={next => onTabChange(next === 'profile' ? 'profile' : 'scorecard')}
    onCloseAutoFocus={onRestoreFocus}
    extraTabs={[
      { key: 'profile', label: 'Profil', icon: User, content: <ProfileDetailedTab linkedinProfileData={selected.profile} enrichedProfile={null} /> },
      { key: 'evaluation', label: 'Évaluation', icon: ClipboardList, content: evaluation },
    ]}
  />;
}

function AssistantPreview({ interview, draft, onChange, onOpenScorecard }: {
  interview: CalendarDemoInterview;
  draft: DemoDraft;
  onChange: (update: Partial<DemoDraft>) => void;
  onOpenScorecard: () => void;
}) {
  if (draft.simulation === 'idle') return <section className={texturedCard('teal', 'space-y-4 rounded-xl p-5')}>
    <Mic className="h-6 w-6" aria-hidden="true" />
    <p className="text-sm leading-relaxed">Découvrez la transcription, les points à approfondir et le compte rendu à partir d’un échange fictif.</p>
    <Button variant="primary" onClick={() => onChange({ simulation: 'transcript' })} className="min-h-11"><Play aria-hidden="true" />Lancer la simulation</Button>
    <p className="text-xs">Aucun micro, enregistrement ou crédit IA utilisé.</p>
  </section>;

  return <>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <Badge variant="info"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Extrait simulé</Badge>
      <Button variant="ghost" size="sm" className="min-h-11" onClick={() => onChange({ simulation: 'idle' })}>Recommencer</Button>
    </div>
    {draft.simulation === 'transcript' ? <>
      <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Transcription fictive">
        <h3 className="text-sm font-semibold">Transcription</h3>
        {interview.transcript.map((line, index) => <p key={index} className="text-sm leading-relaxed text-foreground-secondary"><strong className="font-semibold text-foreground">{line.speaker} : </strong>{line.text}</p>)}
      </section>
      <section className="space-y-2 rounded-xl border border-info/30 bg-info-muted p-4" aria-label="Conseil fictif de l’assistant">
        <h3 className="text-sm font-semibold">À approfondir</h3>
        <p className="text-sm text-foreground-secondary">{interview.insight}</p>
        <p className="text-sm font-medium">« {interview.followUp} »</p>
      </section>
      <Button variant="primary" onClick={() => onChange({ simulation: 'report' })} className="min-h-11"><FileText aria-hidden="true" />Voir le compte rendu</Button>
    </> : <section className="space-y-4 rounded-xl border border-border bg-card p-4" aria-label="Compte rendu fictif">
      <div><h3 className="text-md font-semibold">Compte rendu fictif</h3><p className="mt-1 text-xs text-muted-foreground">Exemple pré-écrit pour explorer le parcours</p></div>
      <p className="text-sm leading-relaxed text-foreground-secondary">{interview.report}</p>
      <Button variant="outline" onClick={onOpenScorecard} className="min-h-11">Compléter ma grille<ArrowRight aria-hidden="true" /></Button>
    </section>}
  </>;
}

function MeetingPreview({ interview, onOpenAssistant }: { interview: CalendarDemoInterview; onOpenAssistant: () => void }) {
  return <div className="space-y-4">
    <section className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted p-5 text-center">
      <CalendarServiceLogo service={interview.meeting} className="h-10 w-10" />
      <Avatar className="h-16 w-16"><AvatarFallback className="text-xl">{interview.initials}</AvatarFallback></Avatar>
      <div><h3 className="text-md font-semibold">Aperçu {CALENDAR_DEMO_SERVICE_LABELS[interview.meeting]}</h3>
        <p className="mt-2 text-sm text-muted-foreground">Dans un véritable rendez-vous, « Rejoindre » ouvre son lien de visio.</p></div>
      <p className="text-xs text-muted-foreground">Aucune réunion ouverte. Caméra et micro désactivés.</p>
    </section>
    <Button variant="primary" className="min-h-11" onClick={onOpenAssistant}><Mic aria-hidden="true" />Essayer l’assistant</Button>
  </div>;
}
