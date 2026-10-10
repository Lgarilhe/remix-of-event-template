import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { format, parseISO, startOfDay } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ArrowRight, CheckCircle2, ClipboardList, FileText, Mic, Play, Video } from 'lucide-react';
import { CalendarListView } from '@/components/calendar/CalendarListView';
import { CalendarServiceLogo } from '@/components/calendar/CalendarServiceLogo';
import { InterviewActionButtons } from '@/components/sidebar/InterviewActionButtons';
import { PageHeader, PageLayout, texturedCard } from '@/components/layout';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  CALENDAR_DEMO_SERVICE_LABELS, calendarDemoLinks, createCalendarDemo,
  type CalendarDemoInterview, type CalendarDemoService,
} from '@/lib/calendarDemo';
import { cn } from '@/lib/utils';

type PreviewTab = 'scorecard' | 'assistant' | 'meeting';
interface DemoDraft {
  ratings: Record<string, number>;
  comments: Record<string, string>;
  notes: string;
  simulation: 'idle' | 'transcript' | 'report';
}
const emptyDraft = (): DemoDraft => ({ ratings: {}, comments: {}, notes: '', simulation: 'idle' });

function ServiceLabel({ service }: { service: CalendarDemoService }) {
  return <span className="inline-flex items-center gap-1.5 text-xs text-foreground-secondary">
    <CalendarServiceLogo service={service} decorative />{CALENDAR_DEMO_SERVICE_LABELS[service]}
  </span>;
}

/** Aperçu autonome : aucun lecteur, enregistrement, envoi ou appel IA. */
export default function CalendarDemo() {
  const [interviews] = useState(() => createCalendarDemo());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<PreviewTab>('scorecard');
  const [drafts, setDrafts] = useState<Record<string, DemoDraft>>({});
  const openerRef = useRef<HTMLElement | null>(null);
  const selected = interviews.find(interview => interview.event.id === selectedId) ?? null;
  const draft = selected ? drafts[selected.event.id] ?? emptyDraft() : emptyDraft();
  const days = [...new Map(interviews.map(({ event }) => {
    const day = startOfDay(parseISO(event.startAt));
    return [day.toISOString(), day];
  })).values()];

  function open(interview: CalendarDemoInterview, nextTab: PreviewTab) {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(interview.event.id);
    setTab(nextTab);
  }
  function updateDraft(update: Partial<DemoDraft>) {
    if (!selected) return;
    const id = selected.event.id;
    setDrafts(previous => ({ ...previous, [id]: { ...(previous[id] ?? emptyDraft()), ...update } }));
  }

  return <PageLayout maxWidth="md">
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-muted p-3 text-sm" data-component="calendar-demo-banner">
      <p><strong className="font-semibold">Données fictives</strong><span className="text-muted-foreground"> · Aperçu des entretiens</span></p>
      <Button variant="outline" size="sm" asChild className="min-h-11"><Link to="/calendar">Quitter la démo</Link></Button>
    </div>
    <PageHeader title="Entretiens" subtitle="Explorez deux rendez-vous fictifs : la visio, la grille et l’assistant d’entretien." />
    <p className="mb-5 text-sm text-muted-foreground">Les exemples Outlook et Google Agenda illustrent les connexions à venir. Aucun agenda n’est connecté par cette démonstration.</p>
    <CalendarListView days={days} events={interviews.map(interview => interview.event)} renderEvent={event => {
      const interview = interviews.find(item => item.event.id === event.id)!;
      const links = calendarDemoLinks(event.id);
      return <article className="space-y-4 rounded-lg border border-border bg-background p-4" aria-label={event.title}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold tabular-nums">{format(parseISO(event.startAt), 'HH:mm')}–{format(parseISO(event.endAt!), 'HH:mm')}</p>
          <Badge variant="muted">Exemple</Badge>
        </div>
        <div className="flex items-start gap-3">
          <Avatar className="h-11 w-11 shrink-0"><AvatarFallback>{interview.initials}</AvatarFallback></Avatar>
          <div className="min-w-0">
            <h2 className="text-md font-semibold text-foreground">{event.meta?.candidateName}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{event.subtitle}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2"><ServiceLabel service={interview.calendar} /><ServiceLabel service={interview.meeting} /></div>
        <div className="border-t border-border pt-3">
          <InterviewActionButtons links={links} joinUrl={null} onJoin={() => open(interview, 'meeting')}
            showContextLinks={false} onOpen={to => open(interview, to === links.coaching ? 'assistant' : 'scorecard')} />
        </div>
      </article>;
    }} />
    <p className="mt-4 text-xs text-muted-foreground">Vos essais restent dans cet aperçu et s’effacent en quittant la page. Aucun message ni invitation n’est envoyé.</p>

    <Dialog open={!!selected} onOpenChange={value => { if (!value) setSelectedId(null); }}>
      <DialogContent className="flex max-h-[90dvh] w-[calc(100%-1.5rem)] max-w-4xl flex-col gap-0 overflow-hidden p-0"
        onCloseAutoFocus={event => {
          if (openerRef.current?.isConnected) {
            event.preventDefault();
            openerRef.current.focus();
          }
        }}>
        {selected && <>
          <DialogHeader className="shrink-0 border-b border-border p-4 pr-14 text-left sm:p-5 sm:pr-14">
            <p className="mb-1 text-xs font-medium text-muted-foreground">Données fictives · Aucune connexion ni capture audio</p>
            <DialogTitle>{selected.event.meta?.candidateName}</DialogTitle>
            <DialogDescription className="break-words">{selected.event.subtitle} · {format(parseISO(selected.event.startAt), 'd MMMM à HH:mm', { locale: fr })}</DialogDescription>
          </DialogHeader>
          <Tabs value={tab} onValueChange={value => setTab(value as PreviewTab)} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="mx-3 my-3 grid h-auto shrink-0 grid-cols-3 sm:mx-5">
              <TabsTrigger value="scorecard" className="min-h-11 gap-1.5 px-2"><ClipboardList className="hidden h-4 w-4 sm:block" aria-hidden="true" />Grille</TabsTrigger>
              <TabsTrigger value="assistant" className="min-h-11 gap-1.5 px-2"><Mic className="hidden h-4 w-4 sm:block" aria-hidden="true" />Assistant</TabsTrigger>
              <TabsTrigger value="meeting" className="min-h-11 gap-1.5 px-2"><Video className="hidden h-4 w-4 sm:block" aria-hidden="true" />Visio</TabsTrigger>
            </TabsList>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 sm:px-5 sm:pb-5">
              <TabsContent value="scorecard" className="mt-0">
                <ScorecardPreview interview={selected} draft={draft} onChange={updateDraft} />
              </TabsContent>
              <TabsContent value="assistant" className="mt-0 space-y-4">
                {draft.simulation === 'idle' ? <section className={texturedCard('teal', 'space-y-4 rounded-xl p-5')}>
                  <Mic className="h-6 w-6" aria-hidden="true" />
                  <div><h3 className="text-md font-semibold">Assistant d’entretien</h3>
                    <p className="mt-2 text-sm leading-relaxed">Découvrez la transcription, les points à approfondir et le compte rendu à partir d’un échange fictif.</p></div>
                  <Button variant="primary" onClick={() => updateDraft({ simulation: 'transcript' })} className="min-h-11"><Play aria-hidden="true" />Lancer la simulation</Button>
                  <p className="text-xs">Aucun micro, enregistrement ou crédit IA utilisé.</p>
                </section> : <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant="info"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Extrait simulé</Badge>
                    <Button variant="ghost" size="sm" className="min-h-11" onClick={() => updateDraft({ simulation: 'idle' })}>Recommencer</Button>
                  </div>
                  {draft.simulation === 'transcript' ? <>
                    <section className="space-y-3 rounded-xl border border-border bg-card p-4" aria-label="Transcription fictive">
                      <h3 className="text-sm font-semibold">Transcription</h3>
                      {selected.transcript.map((line, index) => <p key={index} className="text-sm leading-relaxed text-foreground-secondary"><strong className="font-semibold text-foreground">{line.speaker} : </strong>{line.text}</p>)}
                    </section>
                    <section className="space-y-2 rounded-xl border border-info/30 bg-info-muted p-4" aria-label="Conseil fictif de l’assistant">
                      <h3 className="text-sm font-semibold">À approfondir</h3>
                      <p className="text-sm text-foreground-secondary">{selected.insight}</p>
                      <p className="text-sm font-medium">« {selected.followUp} »</p>
                    </section>
                    <Button variant="primary" onClick={() => updateDraft({ simulation: 'report' })} className="min-h-11"><FileText aria-hidden="true" />Voir le compte rendu</Button>
                  </> : <section className="space-y-4 rounded-xl border border-border bg-card p-4" aria-label="Compte rendu fictif">
                    <div><h3 className="text-md font-semibold">Compte rendu fictif</h3><p className="mt-1 text-xs text-muted-foreground">Exemple pré-écrit pour explorer le parcours</p></div>
                    <p className="text-sm leading-relaxed text-foreground-secondary">{selected.report}</p>
                    <Button variant="outline" onClick={() => setTab('scorecard')} className="min-h-11">Compléter ma grille<ArrowRight aria-hidden="true" /></Button>
                  </section>}
                </>}
              </TabsContent>
              <TabsContent value="meeting" className="mt-0 space-y-4">
                <section className="flex min-h-56 flex-col items-center justify-center gap-4 rounded-xl border border-border bg-muted p-5 text-center">
                  <CalendarServiceLogo service={selected.meeting} className="h-10 w-10" />
                  <Avatar className="h-16 w-16"><AvatarFallback className="text-xl">{selected.initials}</AvatarFallback></Avatar>
                  <div><h3 className="text-md font-semibold">Aperçu {CALENDAR_DEMO_SERVICE_LABELS[selected.meeting]}</h3>
                    <p className="mt-2 text-sm text-muted-foreground">Dans un véritable rendez-vous, « Rejoindre » ouvre son lien de visio.</p></div>
                  <p className="text-xs text-muted-foreground">Aucune réunion ouverte. Caméra et micro désactivés.</p>
                </section>
                <Button variant="primary" className="min-h-11" onClick={() => setTab('assistant')}><Mic aria-hidden="true" />Essayer l’assistant</Button>
              </TabsContent>
            </div>
          </Tabs>
        </>}
      </DialogContent>
    </Dialog>
  </PageLayout>;
}

function ScorecardPreview({ interview, draft, onChange }: {
  interview: CalendarDemoInterview;
  draft: DemoDraft;
  onChange: (update: Partial<DemoDraft>) => void;
}) {
  const rated = Object.values(draft.ratings);
  const average = rated.length ? (rated.reduce((sum, value) => sum + value, 0) / rated.length).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : null;
  return <section className="space-y-4" aria-label="Grille fictive">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-md font-semibold">Grille d’entretien</h3>
      <p className="text-xs text-muted-foreground" role="status">{rated.length}/{interview.criteria.length} critères notés{average ? ` · Moyenne ${average}/5` : ''}</p>
    </div>
    <p className="text-sm text-muted-foreground">Essayez une note et un commentaire. Vos modifications restent dans cette démo.</p>
    {interview.criteria.map(criterion => <fieldset key={criterion.id} className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4">
      <legend className="px-1 text-sm font-semibold">{criterion.label}</legend>
      <p className="text-sm text-foreground-secondary">{criterion.question}</p>
      <div role="radiogroup" aria-label={`Note : ${criterion.label}`} className="flex flex-wrap gap-1.5"
        onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const current = draft.ratings[criterion.id] ?? 1;
          const value = event.key === 'Home' ? 1 : event.key === 'End' ? 5
            : ['ArrowLeft', 'ArrowUp'].includes(event.key) ? (current === 1 ? 5 : current - 1) : (current === 5 ? 1 : current + 1);
          onChange({ ratings: { ...draft.ratings, [criterion.id]: value } });
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]')[value - 1]?.focus();
        }}>
        {[1, 2, 3, 4, 5].map(value => <Button key={value} type="button" role="radio" aria-checked={draft.ratings[criterion.id] === value}
          tabIndex={(draft.ratings[criterion.id] ?? 1) === value ? 0 : -1}
          aria-label={`${value} sur 5`} variant={draft.ratings[criterion.id] === value ? 'primary' : 'outline'}
          className={cn('h-11 min-w-11 px-3', draft.ratings[criterion.id] === value && 'font-semibold')}
          onClick={() => onChange({ ratings: { ...draft.ratings, [criterion.id]: value } })}>{value}</Button>)}
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={`demo-comment-${criterion.id}`}>Commentaire : {criterion.label}</Label>
        <Textarea id={`demo-comment-${criterion.id}`} rows={2} value={draft.comments[criterion.id] ?? ''} maxLength={3000}
          onChange={event => onChange({ comments: { ...draft.comments, [criterion.id]: event.target.value } })} placeholder="Votre observation…" />
      </div>
    </fieldset>)}
    <div className="space-y-2 rounded-xl border border-border bg-card p-3 sm:p-4">
      <Label htmlFor="demo-interview-notes">Notes de l’entretien</Label>
      <Textarea id="demo-interview-notes" rows={3} value={draft.notes} maxLength={6000}
        onChange={event => onChange({ notes: event.target.value })} placeholder="Points forts, questions à creuser, prochaines étapes…" />
    </div>
  </section>;
}
