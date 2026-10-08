import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronDown, ExternalLink, Loader2, Pause, Settings2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useSourcingAgent } from '@/hooks/useSourcingAgent';
import { useLinkedInQuotaStatus } from '@/hooks/useLinkedInQuotaStatus';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { ScorePill } from '@/components/missions/v3/pipeline/CandidateListRow';
import { SourcingAgentIdentity } from './SourcingAgentIdentity';
import { SourcingAgentContext } from './SourcingAgentContext';
import { AgentMemoryDialog } from './AgentMemoryDialog';
import {
  DEFAULT_SOURCING_AGENT_SETTINGS, sourcingAgentDate, sourcingAgentReason,
  sourcingCalibration, sourcingCanResume, sourcingLinkedInUrl, sourcingProfileDetails, sourcingUncertainCandidates, sourcingVisibleUncertainCandidates, validSourcingAgentSettings,
  type SourcingAgentApi, type SourcingAgentCandidate, type SourcingAgentCommand,
  type SourcingAgentConfiguration, type SourcingAgentSettings,
} from '@/types/sourcingAgent';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  projectName?: string;
  missionStatus?: string;
  returnFocusRef?: { readonly current: HTMLElement | null };
}

export interface SourcingAgentWorkspaceProps {
  projectId: string;
  projectName?: string;
  missionStatus?: string;
  className?: string;
  enabled?: boolean;
}

const API_LABELS: Record<SourcingAgentApi, string> = { classic: 'LinkedIn', recruiter: 'LinkedIn Recruiter', sales_navigator: 'LinkedIn Sales Navigator' };
const control = 'max-sm:min-h-11';
const text = (value: unknown) => typeof value === 'string' ? value : '';
const profileName = (profile: Record<string, unknown>) => text(profile.name) || [text(profile.first_name), text(profile.last_name)].filter(Boolean).join(' ') || 'Profil sans nom';
type Confirmation = { action: 'approve_calibration' | 'resume' | 'stop' | 'skip_uncertain'; revision: number; contextKey: string; fits: SourcingAgentCandidate[]; candidate?: SourcingAgentCandidate };
const UNCERTAIN_SKIP_REASON = 'Évaluation interrompue : ne pas relancer ce profil.';
interface FeedbackDraft { decision: 'fit' | 'reject' | null; reason: string; editing: boolean }

function CandidateReview({ candidate, busy, draft, onDraftChange, onReview }: {
  candidate: SourcingAgentCandidate; busy: boolean;
  draft?: FeedbackDraft;
  onDraftChange: (draft: FeedbackDraft) => void;
  onReview: (candidate: SourcingAgentCandidate, decision: 'fit' | 'reject', reason: string) => Promise<void>;
}) {
  const decision = draft ? draft.decision : candidate.decision;
  const reason = draft?.reason ?? candidate.reason ?? '';
  const editing = draft?.editing ?? false;
  const updateDraft = (change: Partial<FeedbackDraft>) => onDraftChange({ decision, reason, editing, ...change });
  const name = profileName(candidate.profile);
  const url = sourcingLinkedInUrl(candidate.profile);
  const summary = text(candidate.result.summary);
  const details = sourcingProfileDetails(candidate);
  return <li className="space-y-3 py-4">
    <div className="flex items-start gap-3">
      <PersonAvatar name={name} src={text(candidate.profile.profile_picture_url) || null} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2"><span className="text-sm font-medium break-words">{name}</span><ScorePill score={typeof candidate.score === 'number' ? candidate.score : null} /></div>
        <p className="text-xs text-muted-foreground break-words">{text(candidate.profile.headline) || 'Titre non renseigné'}</p>
        <p className="mt-1 text-xs text-muted-foreground">{candidate.provenance.source === 'pool' ? 'Vos candidats existants' : 'LinkedIn'}{candidate.decision ? ` · Avis enregistré : ${candidate.decision === 'fit' ? 'correspond au besoin' : 'à écarter'}` : ' · À relire'}</p>
      </div>
    </div>
    {summary && <p className="text-sm whitespace-pre-wrap break-words">{summary}</p>}
    {candidate.reason && !editing && <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">Votre avis : {candidate.reason}</p>}
    <div className="flex flex-wrap gap-2">
      {url && <Button type="button" size="sm" variant="ghost" className={control} asChild><a href={url} target="_blank" rel="noopener noreferrer">Voir sur LinkedIn<ExternalLink aria-hidden="true" className="h-3.5 w-3.5" /></a></Button>}
      {!editing && <Button type="button" size="sm" variant="outline" className={control} disabled={busy} onClick={() => updateDraft({ editing: true })}>{candidate.decision ? 'Modifier votre avis' : 'Donner votre avis'}</Button>}
    </div>
    <Collapsible className="space-y-2"><CollapsibleTrigger asChild><Button type="button" size="sm" variant="ghost" className={`${control} group`}><ChevronDown className="h-3.5 w-3.5 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />Voir les éléments du profil</Button></CollapsibleTrigger><CollapsibleContent className="space-y-3 border-l border-border pl-3">
      {details.location && <p className="text-xs text-muted-foreground">Localisation : {details.location}</p>}
      {details.summary && <div className="space-y-1"><h4 className="text-xs font-semibold">Présentation du profil</h4><p className="text-sm whitespace-pre-wrap break-words">{details.summary}</p></div>}
      {details.skills.length > 0 && <div className="space-y-1"><h4 className="text-xs font-semibold">Compétences renseignées</h4><p className="text-sm break-words">{details.skills.join(' · ')}</p></div>}
      {details.experience.length > 0 && <div className="space-y-1"><h4 className="text-xs font-semibold">Expériences</h4><ul className="space-y-2">{details.experience.map((item, index) => <li key={index} className="space-y-1"><p className="text-sm font-medium break-words">{[item.title, item.company].filter(Boolean).join(' · ')}</p>{item.period && <p className="text-xs text-muted-foreground">{item.period}</p>}{item.description && <p className="text-sm whitespace-pre-wrap break-words">{item.description}</p>}</li>)}</ul></div>}
      {details.education.length > 0 && <div className="space-y-1"><h4 className="text-xs font-semibold">Formation</h4><ul className="space-y-1 text-sm">{details.education.map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul></div>}
      {details.strengths.length > 0 && <div className="space-y-1"><h4 className="text-xs font-semibold">Points forts de l’évaluation</h4><ul className="list-disc space-y-1 pl-4 text-sm">{details.strengths.map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul></div>}
      {details.concerns.length > 0 && <div className="space-y-1"><h4 className="text-xs font-semibold">Réserves de l’évaluation</h4><ul className="list-disc space-y-1 pl-4 text-sm">{details.concerns.map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul></div>}
      {details.confidence !== null && <p className="text-xs text-muted-foreground">Complétude des données utilisées : {details.confidence}/100.</p>}
      {!details.summary && !details.skills.length && !details.experience.length && !details.education.length && <p className="text-sm text-muted-foreground">Le parcours détaillé n’est pas renseigné dans les données enregistrées.</p>}
      <p className="text-xs text-muted-foreground">Proposition mise à jour {sourcingAgentDate(candidate.updated_at) ? `le ${sourcingAgentDate(candidate.updated_at)}` : 'à une date non renseignée'}. Aucune nouvelle consultation du profil n’est déclenchée ici.</p>
    </CollapsibleContent></Collapsible>
    {editing && <div className="space-y-2">
      <div className="flex flex-wrap gap-2" role="group" aria-label={`Avis sur ${name}`}>
        <Button type="button" size="sm" variant="outline" className={`${control} ${decision === 'fit' ? 'bg-accent' : ''}`} disabled={busy} aria-pressed={decision === 'fit'} onClick={() => updateDraft({ decision: 'fit' })}>Correspond au besoin</Button>
        <Button type="button" size="sm" variant="outline" className={`${control} ${decision === 'reject' ? 'bg-accent' : ''}`} disabled={busy} aria-pressed={decision === 'reject'} onClick={() => updateDraft({ decision: 'reject' })}>À écarter</Button>
      </div>
      <Label htmlFor={`sourcing-reason-${candidate.id}`}>Pourquoi ce profil correspond-il au besoin ou s’en écarte-t-il ?</Label>
      <Textarea id={`sourcing-reason-${candidate.id}`} value={reason} onChange={(event) => updateDraft({ reason: event.target.value })} maxLength={1000} disabled={busy} placeholder="Ex. : expérience du secteur pertinente, mais périmètre de management trop limité." />
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" variant="primary" className={control} disabled={busy || !decision || reason.trim().length < 5} aria-busy={busy} onClick={() => {
          if (!decision) return;
          void onReview(candidate, decision, reason.trim()).then(() => updateDraft({ editing: false })).catch(() => {});
        }}>Enregistrer l’avis</Button>
        <Button type="button" size="sm" variant="ghost" className={control} disabled={busy} onClick={() => updateDraft({ editing: false })}>Annuler</Button>
      </div>
    </div>}
  </li>;
}

export function SourcingAgentWorkspace({ projectId, projectName, missionStatus, className, enabled = true }: SourcingAgentWorkspaceProps) {
  const { orgType } = useOrganization();
  const query = useSourcingAgent(projectId, { enabled, pollWhileOpen: enabled });
  const identity = useRef(query.contextIdentity);
  identity.current = query.contextIdentity;
  const [draft, setDraft] = useState<SourcingAgentConfiguration>({ source: 'pool', account_id: null, api: null, settings: { ...DEFAULT_SOURCING_AGENT_SETTINGS } });
  const [dirty, setDirty] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [visible, setVisible] = useState(10);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [tab, setTab] = useState('pilotage');
  const [memoriesOpen, setMemoriesOpen] = useState(false);
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, FeedbackDraft>>({});
  const confirmationOpener = useRef<HTMLElement | null>(null);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const tabFocusFrame = useRef<number | null>(null);
  const switchTab = (value: string) => {
    const captured = query.contextIdentity;
    if (tabFocusFrame.current !== null) cancelAnimationFrame(tabFocusFrame.current);
    setTab(value);
    tabFocusFrame.current = requestAnimationFrame(() => {
      tabFocusFrame.current = null;
      if (identity.current === captured && enabled) tabRefs.current[value]?.focus();
    });
  };
  const data = query.data;
  const agent = data?.agent;
  const account = data?.accounts.find((item) => item.id === draft.account_id);
  const quota = useLinkedInQuotaStatus(enabled && draft.source === 'linkedin' && account ? account.id : null);
  const calibration = sourcingCalibration(data);
  const uncertainCandidates = sourcingUncertainCandidates(data);
  const visibleUncertain = sourcingVisibleUncertainCandidates(data);
  const verified = Boolean(data && !query.isError && !data.requires_refresh);
  const canRun = verified && data?.eligibility.allowed === true && uncertainCandidates.length === 0 && missionStatus !== 'archived';
  const needsCalibration = Boolean(!data?.requires_refresh && agent?.context_snapshot.context_key && agent.context_snapshot.context_key !== data?.context_key);
  const sourceValid = draft.source === 'pool' || Boolean(!data?.accounts_error && account && draft.api && account.apis.includes(draft.api));
  const settingsValid = validSourcingAgentSettings(draft.settings);

  useEffect(() => {
    setDraft({ source: 'pool', account_id: null, api: null, settings: { ...DEFAULT_SOURCING_AGENT_SETTINGS } });
    setDirty(false); setDraftRevision(0); setVisible(10); setConfirmation(null); setTab('pilotage'); setMemoriesOpen(false); setFeedbackDrafts({});
  }, [query.contextIdentity]);
  useEffect(() => () => { if (tabFocusFrame.current !== null) cancelAnimationFrame(tabFocusFrame.current); }, [query.contextIdentity]);
  useEffect(() => {
    if (dirty || !data) return;
    setDraft(agent ? { source: agent.source, account_id: agent.account_id, api: agent.api, settings: { ...agent.settings } }
      : { source: 'pool', account_id: null, api: null, settings: { ...DEFAULT_SOURCING_AGENT_SETTINGS } });
    setDraftRevision(agent?.revision ?? 0);
  }, [data, agent, dirty]);

  const update = (change: Partial<SourcingAgentConfiguration>) => { setDraft((previous) => ({ ...previous, ...change })); setDirty(true); };
  const setting = (key: keyof SourcingAgentSettings, value: number) => update({ settings: { ...draft.settings, [key]: value } });
  const run = async (command: SourcingAgentCommand, message?: string) => {
    const captured = query.contextIdentity;
    const result = await query.mutate(command);
    if (identity.current !== captured) return;
    if (command.action === 'configure') { setDirty(false); setDraftRevision(result.agent?.revision ?? 0); switchTab('pilotage'); }
    if (command.action === 'start_calibration') switchTab('profils');
    if (command.action === 'approve_calibration') switchTab('pilotage');
    if (confirmation && command.action === confirmation.action) setConfirmation(null);
    if (message) toast.success(message);
  };
  const confirm = (action: Confirmation['action'], candidate?: SourcingAgentCandidate) => {
    if (!agent || !data) return;
    query.clearActionError();
    confirmationOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setConfirmation({ action, revision: agent.revision, contextKey: action === 'skip_uncertain' && candidate ? candidate.context_key : data.context_key, fits: calibration.fits, candidate });
  };
  const next = sourcingAgentDate(agent?.next_run_at);
  const last = sourcingAgentDate(agent?.last_run_at);
  const candidates = verified ? data?.candidates.filter((candidate) => candidate.context_key === data.context_key && candidate.state !== 'skipped' && candidate.state !== 'discovered') ?? [] : [];
  const reason = sourcingAgentReason(agent?.last_reason);
  const canPause = agent && agent.last_reason !== 'SCORING_UNCERTAIN' && ['active', 'calibrating', 'awaiting_review', 'blocked'].includes(agent.status);
  const canResume = verified && sourcingCanResume(data);
  const readyToStart = Boolean(agent && (['draft', 'stopped'].includes(agent.status) || (['paused', 'blocked'].includes(agent.status) && !agent.approved_context_key)));
  const step: 0 | 1 | 2 = !agent || needsCalibration ? 0 : agent.status === 'stopped' ? 1 : agent.approved_context_key || calibration.canApprove ? 2 : 1;

  return <div className={`min-w-0 space-y-6 max-sm:[&_button]:min-h-11 ${className ?? ''}`}>
    <SourcingAgentIdentity agent={agent} projectName={projectName} step={step} verified={verified} />
    {query.isPending && !data ? <div role="status" aria-label="Chargement de l’agent" className="space-y-3"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-24 w-full" /></div>
      : query.isError && !data ? <ErrorBox title="L’agent de sourcing n’a pas pu être chargé." detail={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />
      : !data ? <ErrorBox title="Le contexte de l’agent n’est pas disponible." onRetry={() => void query.refetch()} />
      : <>
        {canPause && <div className="flex justify-end"><Button type="button" size="sm" variant="ghost" className={`${control} ml-auto text-muted-foreground`} disabled={query.isSaving} aria-busy={query.pendingAction === 'pause'} onClick={() => { void run({ action: 'pause' }, 'Agent mis en pause').catch(() => {}); }}><Pause aria-hidden="true" className="h-3.5 w-3.5" />Mettre en pause</Button></div>}
        {query.isError && <ErrorBox title="L’agent n’a pas pu être actualisé." detail="Le dernier état connu reste affiché. Vous pouvez mettre en pause, arrêter ou résoudre une évaluation interrompue. Actualisez avant de relancer une recherche." onRetry={() => void query.refetch()} />}
        {data.requires_refresh && <p role="status" className="text-sm text-muted-foreground">Actualisation des prérequis…</p>}
          {visibleUncertain.length > 0 && <section aria-label="Évaluations interrompues" className="space-y-2 border-b border-border pb-4">
            <h3 className="text-sm font-semibold">Évaluations interrompues ({visibleUncertain.length})</h3>
            <p className="text-sm text-muted-foreground">Le résultat de ces évaluations n’a pas pu être confirmé. Ignorez les profils concernés sans refaire leur évaluation avant de reprendre la recherche.</p>
            <ul className="divide-y divide-border">{visibleUncertain.map((candidate) => <li key={candidate.id} className="space-y-3 py-3">
              <div className="flex items-start gap-3"><PersonAvatar name={profileName(candidate.profile)} src={text(candidate.profile.profile_picture_url) || null} /><div className="min-w-0"><p className="text-sm font-medium break-words">{profileName(candidate.profile)}</p><p className="text-xs text-muted-foreground break-words">{text(candidate.profile.headline)}</p><p className="mt-1 text-xs text-muted-foreground">Évaluation interrompue, aucune note confirmée.</p>{candidate.context_key !== data.context_key && <p className="mt-1 text-xs text-muted-foreground">Cette évaluation avait été lancée avec des critères antérieurs.</p>}</div></div>
              <Button type="button" size="sm" variant="ghost" className={`${control} h-auto whitespace-normal rounded-lg border border-border hover:border-foreground py-2 text-left`} disabled={query.isSaving || missionStatus === 'archived'} onClick={() => confirm('skip_uncertain', candidate)}>Ignorer ce profil sans refaire l’évaluation</Button>
            </li>)}</ul>
          </section>}
          {!data.requires_refresh && data.eligibility.reasons.length > 0 && <section aria-label="Prérequis de la recherche" className="space-y-1 border-t border-border pt-4"><h3 className="text-sm font-semibold">Avant de démarrer</h3><ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">{data.eligibility.reasons.map((item) => <li key={item}>{item}</li>)}</ul></section>}
          {query.actionError && <p role="alert" className="text-sm text-danger">{query.actionError}</p>}
          {['REVISION_CONFLICT', 'CONTEXT_CHANGED', 'MEMORY_CONFLICT'].includes(query.actionErrorCode ?? '') && <Button type="button" size="sm" variant="outline" className={control} disabled={query.isSaving} onClick={() => setConfirmation(null)}>Relire la version actualisée</Button>}

        <Tabs value={tab} onValueChange={setTab} className="space-y-5">
          <TabsList aria-label="Espace de travail de l’agent" className="h-11 w-full justify-start sm:w-auto"><TabsTrigger ref={(element) => { tabRefs.current.pilotage = element; }} value="pilotage" className="flex-1 max-sm:min-h-11 sm:flex-none">Pilotage</TabsTrigger><TabsTrigger ref={(element) => { tabRefs.current.profils = element; }} value="profils" className="flex-1 max-sm:min-h-11 sm:flex-none">Profils{candidates.filter(candidate => !candidate.decision).length > 0 && ` (${candidates.filter(candidate => !candidate.decision).length})`}</TabsTrigger><TabsTrigger ref={(element) => { tabRefs.current.reglages = element; }} value="reglages" className="flex-1 max-sm:min-h-11 sm:flex-none">Réglages</TabsTrigger></TabsList>
          <TabsContent value="pilotage" forceMount className="space-y-5 data-[state=inactive]:hidden">
            <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
              <div className="space-y-5">
                <Card className="space-y-4 p-4 sm:p-5">
                  <p className="text-xs font-medium text-muted-foreground">Prochaine étape</p>
                  {!verified ? <><h3 className="text-lg font-semibold">Vérifier le contexte actuel</h3><p className="text-sm text-muted-foreground">Nous relisons le cadrage, les mémoires et les connexions avant toute nouvelle recherche.</p><Button type="button" variant="outline" className={control} disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser l’agent</Button></>
                    : uncertainCandidates.length > 0 ? <><h3 className="text-lg font-semibold">Résoudre les évaluations interrompues</h3><p className="text-sm text-muted-foreground">Traitez les profils signalés ci-dessus. Aucune nouvelle évaluation ne sera lancée avant votre décision.</p></>
                    : !agent || dirty || needsCalibration ? <><h3 className="text-lg font-semibold">{needsCalibration ? 'Le besoin a changé' : dirty ? 'Finaliser votre préparation' : 'Donner le cap à votre agent'}</h3><p className="text-sm text-muted-foreground">{needsCalibration ? 'Revoyez les filtres, le cadrage et les mémoires, puis préparez un nouveau calibrage.' : dirty ? 'Enregistrez les réglages que vous venez de modifier avant de lancer l’agent.' : 'Choisissez une source de candidats, un rythme et un budget adaptés à cette mission.'}</p><Button type="button" variant="primary" className={control} onClick={() => switchTab('reglages')}>{agent ? 'Revoir les réglages' : 'Configurer mon agent'}<ArrowRight aria-hidden="true" className="h-4 w-4" /></Button></>
                    : readyToStart ? <><h3 className="text-lg font-semibold">Tester le cap sur 5 profils</h3><p className="text-sm text-muted-foreground">Le calibrage vous permet de corriger le cap avant la recherche continue. Chaque évaluation consomme des crédits IA.</p><Button type="button" variant="primary" className={control} disabled={query.isSaving || dirty || !canRun} aria-busy={query.pendingAction === 'start_calibration'} onClick={() => { void run({ action: 'start_calibration' }, 'Calibrage lancé').catch(() => {}); }}>Lancer le calibrage</Button></>
                    : !agent.approved_context_key && calibration.canApprove ? <><h3 className="text-lg font-semibold">Votre calibrage est prêt à être validé</h3><p className="text-sm text-muted-foreground">Vous avez donné au moins 3 avis motivés, dont un positif. Relisez les références avant d’activer la recherche continue.</p><Button type="button" variant="primary" className={control} disabled={query.isSaving || !canRun} onClick={() => confirm('approve_calibration')}>Valider le calibrage et activer</Button></>
                    : !agent.approved_context_key ? <><h3 className="text-lg font-semibold">{agent.status === 'calibrating' ? 'Le calibrage est en cours' : 'Lui montrer ce qui fait un bon profil'}</h3><p className="text-sm text-muted-foreground">Donnez au moins 3 avis motivés, dont un profil qui correspond au besoin. Vos raisons aideront à définir les références de calibrage.</p><Button type="button" variant="primary" className={control} onClick={() => switchTab('profils')}>Relire les premiers profils<ArrowRight aria-hidden="true" className="h-4 w-4" /></Button></>
                    : agent.status === 'active' ? <><h3 className="text-lg font-semibold">Votre agent suit le cap validé</h3><p className="text-sm text-muted-foreground">Il propose des profils selon votre cadence et vos limites. Vous gardez la main sur la sélection et le contact.</p><Button type="button" variant="primary" className={control} onClick={() => switchTab('profils')}>Relire les propositions<ArrowRight aria-hidden="true" className="h-4 w-4" /></Button></>
                    : <><h3 className="text-lg font-semibold">Reprendre lorsque vous êtes prêt</h3><p className="text-sm text-muted-foreground">Vérifiez les critères applicables et les limites avant de confirmer la reprise.</p>          {agent && ['paused', 'blocked', 'awaiting_review'].includes(agent.status) && agent.approved_context_key && <Button type="button" variant="primary" className={control} disabled={query.isSaving || dirty || missionStatus === 'archived' || !canResume} onClick={() => confirm('resume')}>Vérifier les critères et reprendre</Button>}
</>}
                </Card>
                {agent && <Card className="space-y-4 p-4 sm:p-5">          {agent && <section aria-label="Activité de l’agent" className="space-y-3">
            <div className="flex flex-wrap items-center gap-2"><h3 className="text-base font-semibold">Activité de l’agent</h3>

            </div>
            {reason && <p className="text-sm">{reason}</p>}
            <div className="space-y-1 text-xs text-muted-foreground">
              {last && <p>Dernier passage : {last}</p>}
              {next && ['active', 'calibrating'].includes(agent.status) && <p>Prochain passage : {next}</p>}
              <p>Profils comptabilisés le {agent.daily_date} : {agent.profiles_used} / {agent.settings.daily_profile_limit}</p>
              <p>Crédits IA du jour : {data.credits_estimate.used} utilisés, {agent.credits_reserved} réservés. Budget cible : {agent.settings.daily_credit_limit}.</p>
              {agent.status === 'paused' && agent.lease_until && new Date(agent.lease_until).getTime() > Date.now() && <p>La pause est enregistrée. Les opérations déjà lancées peuvent se terminer.</p>}
            </div>
          </section>}
          {agent && !['draft', 'stopped'].includes(agent.status) && <Button type="button" size="sm" variant="ghost" className={`${control} justify-self-start text-muted-foreground`} disabled={query.isSaving} onClick={() => confirm('stop')}>Arrêter l’agent</Button>}
</Card>}
              </div>
              <SourcingAgentContext projectId={projectId} projectName={projectName} agent={agent} orgType={orgType} verified={verified && !needsCalibration} onMemories={() => setMemoriesOpen(true)} />
            </div>
          </TabsContent>
          <TabsContent value="profils" forceMount className="space-y-5 data-[state=inactive]:hidden">
            {verified && agent && !agent.approved_context_key && <Card className="space-y-4 p-4 sm:p-5"><div className="space-y-1"><h3 className="text-lg font-semibold">Calibrer ensemble</h3><p className="text-sm text-muted-foreground">L’agent apprend le cap à partir de vos références validées, sans modifier les critères éliminatoires ou les mémoires.</p></div><Progress value={Math.min(calibration.reviewed / 3, 1) * 100} aria-label="Avis motivés nécessaires au calibrage" className="h-1.5" /><div className="flex flex-wrap gap-x-5 gap-y-2 text-sm"><p className="flex items-center gap-2">{calibration.reviewed >= 3 && <Check aria-hidden="true" className="h-4 w-4" />}{calibration.reviewed} avis motivé{calibration.reviewed > 1 ? 's' : ''} / 3 minimum</p><p className="flex items-center gap-2">{calibration.fits.length > 0 && <Check aria-hidden="true" className="h-4 w-4" />}{calibration.fits.length > 0 ? 'Une référence positive identifiée' : 'Au moins une référence positive à identifier'}</p></div></Card>}
            {agent && <Card className="space-y-3 p-4 sm:p-5"><section aria-label="Profils proposés" className="space-y-3">
            <h3 className="text-base font-semibold">Profils à relire{verified && candidates.length > 0 && ` (${candidates.length})`}</h3>
            {candidates.length ? <ul className="divide-y divide-border">{candidates.slice(0, visible).map((candidate) => <CandidateReview key={`${query.contextIdentity}:${candidate.id}:${candidate.context_key}`} candidate={candidate} busy={query.isSaving || !verified} draft={feedbackDrafts[`${candidate.context_key}:${candidate.id}`]} onDraftChange={(feedback) => { if (identity.current === query.contextIdentity) setFeedbackDrafts(previous => ({ ...previous, [`${candidate.context_key}:${candidate.id}`]: feedback })); }} onReview={async (row, decision, feedback) => { await run({ action: 'review', candidate_id: row.id, decision, reason: feedback }); }} />)}</ul> : <p className="text-sm text-muted-foreground">{!verified ? 'Vérification des critères actuels avant d’afficher les profils.' : agent.status === 'calibrating' ? 'Les profils apparaîtront après leur recherche et leur évaluation.' : 'Aucun profil à relire pour les critères actuels.'}</p>}
            {visible < candidates.length && <Button type="button" size="sm" variant="ghost" className={control} onClick={() => setVisible((count) => Math.min(50, count + 10))}>Afficher 10 profils de plus</Button>}
            {verified && ['calibrating', 'awaiting_review', 'paused'].includes(agent.status) && !agent.approved_context_key && <div className="space-y-2"><p className="text-xs text-muted-foreground">{calibration.reviewed} avis motivé{calibration.reviewed > 1 ? 's' : ''} enregistré{calibration.reviewed > 1 ? 's' : ''}. Au moins 3 avis et un profil pertinent sont nécessaires.</p><Button type="button" variant="primary" className={control} disabled={query.isSaving || dirty || !canRun || !calibration.canApprove} onClick={() => confirm('approve_calibration')}>Valider le calibrage et activer</Button></div>}
          </section></Card>}
            {!agent && <p className="text-sm text-muted-foreground">Préparez votre agent, puis lancez le calibrage pour découvrir les premiers profils.</p>}
          </TabsContent>
          <TabsContent value="reglages" forceMount className="space-y-5 data-[state=inactive]:hidden"><Card className="p-4 sm:p-5">          <section aria-label="Configuration de l’agent" className="space-y-4">
            <div className="space-y-1"><h3 className="text-lg font-semibold">Préparer son terrain de recherche</h3><p className="text-sm text-muted-foreground">Choisissez où chercher, à quel rythme et avec quel budget. L’enregistrement ne lance aucune recherche.</p></div>
            <div className="space-y-2"><Label htmlFor="sourcing-agent-source">Source à explorer</Label>
              <Select value={draft.source} disabled={query.isSaving} onValueChange={(source: 'pool' | 'linkedin') => update({ source, account_id: null, api: null })}><SelectTrigger id="sourcing-agent-source" className={control}><SelectValue /></SelectTrigger><SelectContent><SelectItem className={control} value="pool">Vos candidats existants</SelectItem><SelectItem className={control} value="linkedin">LinkedIn</SelectItem></SelectContent></Select>
              <p className="text-xs text-muted-foreground">{draft.source === 'pool' ? 'Les profils déjà enregistrés dans votre espace et auxquels vous avez accès.' : 'L’agent utilise votre compte et les licences réellement disponibles.'}</p>
            </div>
            {draft.source === 'linkedin' && !data.requires_refresh && <div className="space-y-3">
              {data.accounts_error ? <ErrorBox title="Vos comptes et licences LinkedIn n’ont pas pu être chargés." detail={data.accounts_error} onRetry={() => void query.refetch()} /> : data.accounts.length ? <div className="grid gap-3 sm:grid-cols-2"><div className="min-w-0 space-y-2"><Label htmlFor="sourcing-agent-account">Votre compte LinkedIn</Label><Select value={draft.account_id ?? ''} disabled={query.isSaving} onValueChange={(account_id) => update({ account_id, api: null })}><SelectTrigger id="sourcing-agent-account" className={control}><SelectValue placeholder="Choisir votre compte" /></SelectTrigger><SelectContent className="w-[var(--radix-select-trigger-width)] max-w-[calc(100vw-2rem)]">{data.accounts.map((item) => <SelectItem className={`${control} min-w-0 whitespace-normal break-words [&>span:last-child]:min-w-0 [&>span:last-child]:flex-1`} key={item.id} value={item.id}>{item.name}{item.status !== 'OK' ? ' · Connexion à vérifier' : ''}</SelectItem>)}</SelectContent></Select></div>
                <div className="space-y-2"><Label htmlFor="sourcing-agent-license">Licence de recherche</Label><Select value={draft.api ?? ''} disabled={query.isSaving || !account} onValueChange={(api: SourcingAgentApi) => update({ api })}><SelectTrigger id="sourcing-agent-license" className={control}><SelectValue placeholder="Choisir la licence" /></SelectTrigger><SelectContent>{account?.apis.map((api) => <SelectItem className={control} key={api} value={api}>{API_LABELS[api]}</SelectItem>)}</SelectContent></Select></div></div>
                : <p className="text-sm text-muted-foreground">Aucun compte LinkedIn utilisable n’est disponible pour vous.</p>}
              {account && account.status !== 'OK' && <p role="status" className="text-sm text-muted-foreground">La connexion de ce compte doit être vérifiée avant de démarrer la recherche. Reconnectez LinkedIn, puis actualisez les comptes.</p>}
              <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" className={control} asChild><Link to="/settings/account/connections">{account && account.status !== 'OK' ? 'Reconnecter LinkedIn' : data.accounts.length ? 'Gérer la connexion LinkedIn' : 'Connecter LinkedIn'}</Link></Button><Button type="button" size="sm" variant="ghost" className={control} disabled={query.isFetching} onClick={() => void query.refetch()}>Actualiser les comptes</Button></div>
              {account && (quota.isError ? <ErrorBox title="Les limites LinkedIn n’ont pas pu être chargées." onRetry={() => void quota.refetch()} /> : quota.data ? <div className="space-y-1 text-xs text-muted-foreground"><p>Compte LinkedIn aujourd’hui : {quota.data.today.searches} / {quota.data.caps.searches} recherches, {quota.data.today.profile_views} / {quota.data.caps.profile_views} consultations de profil.</p><p>Horaires du compte : {quota.data.business_hours.start} h à {quota.data.business_hours.end} h ({quota.data.timezone}).</p>{quota.data.paused_until && <p>Compte en pause jusqu’au {sourcingAgentDate(quota.data.paused_until)}.</p>}</div> : <p className="text-xs text-muted-foreground">{quota.isPending ? 'Chargement des limites LinkedIn…' : 'Les limites de ce compte ne sont pas disponibles.'}</p>)}
            </div>}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="sourcing-agent-cadence">Fréquence des passages</Label><Select value={String(draft.settings.cadence_hours)} disabled={query.isSaving} onValueChange={(value) => setting('cadence_hours', Number(value))}><SelectTrigger id="sourcing-agent-cadence" className={control}><SelectValue /></SelectTrigger><SelectContent>{[2, 6, 12, 24].map((hours) => <SelectItem className={control} key={hours} value={String(hours)}>Toutes les {hours} heures</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label htmlFor="sourcing-agent-profiles">Profils à évaluer par jour</Label><Input id="sourcing-agent-profiles" className={control} type="number" inputMode="numeric" min={5} max={100} step={1} value={draft.settings.daily_profile_limit} disabled={query.isSaving} onChange={(event) => setting('daily_profile_limit', Number(event.target.value))} /></div>
              <div className="space-y-2"><Label htmlFor="sourcing-agent-credits">Budget cible de crédits IA</Label><Input id="sourcing-agent-credits" className={control} aria-describedby="sourcing-agent-budget-help" type="number" inputMode="numeric" min={12} max={500} step={1} value={draft.settings.daily_credit_limit} disabled={query.isSaving} onChange={(event) => setting('daily_credit_limit', Number(event.target.value))} /><p id="sourcing-agent-budget-help" className="text-xs text-muted-foreground">Prévoyez au moins 12 crédits pour permettre une évaluation. Le coût d’une évaluation peut dépasser le montant restant. Le plafond de profils, lui, est strict.</p></div>
            </div>
            <Collapsible className="space-y-3 border-t border-border pt-4"><CollapsibleTrigger asChild><Button type="button" variant="ghost" className={`${control} group`}><Settings2 aria-hidden="true" className="h-4 w-4" />Réglages avancés<ChevronDown aria-hidden="true" className="h-4 w-4 transition-transform group-data-[state=open]:rotate-180" /></Button></CollapsibleTrigger><CollapsibleContent className="space-y-3"><p className="text-sm text-muted-foreground">Ajustez la quantité de propositions et leur note minimum. Vos critères et mémoires restent ceux de la mission.</p><div className="grid gap-4 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="sourcing-agent-pending">Profils en attente de votre avis</Label><Input id="sourcing-agent-pending" className={control} type="number" inputMode="numeric" min={5} max={50} step={1} value={draft.settings.max_pending} disabled={query.isSaving} onChange={(event) => setting('max_pending', Number(event.target.value))} /></div><div className="space-y-2"><Label htmlFor="sourcing-agent-score">Note minimum pour une proposition</Label><Input id="sourcing-agent-score" className={control} type="number" inputMode="numeric" min={0} max={100} step={1} value={draft.settings.min_score} disabled={query.isSaving} onChange={(event) => setting('min_score', Number(event.target.value))} /></div></div></CollapsibleContent></Collapsible>
            <p className="text-xs text-muted-foreground">Estimation de départ : environ {data.credits_estimate.per_profile} crédits IA par évaluation. Le coût réel dépend du profil et des vérifications nécessaires.</p>
            <p className="text-xs text-muted-foreground">L’agent utilise le cadrage, les filtres et les mémoires applicables à {orgType === 'enterprise' ? 'ce poste' : 'cette mission'}. Vos avis n’ajoutent pas automatiquement de filtre éliminatoire ni de mémoire.</p>
            {!settingsValid && <p role="alert" className="text-sm text-danger">Vérifiez les limites : 5 à 100 profils par jour, 12 à 500 crédits, 5 à 50 profils en attente et une note de 0 à 100.</p>}
            <Button type="button" variant={agent ? 'outline' : 'primary'} className={control} disabled={query.isSaving || !verified || uncertainCandidates.length > 0 || !sourceValid || !settingsValid || (!dirty && Boolean(agent) && !needsCalibration) || missionStatus === 'archived'} aria-busy={query.pendingAction === 'configure'} onClick={() => { void run({ action: 'configure', ...draft, expected_revision: draftRevision }, 'Configuration enregistrée').catch(() => {}); }}>{query.pendingAction === 'configure' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{needsCalibration && !dirty ? 'Préparer un nouveau calibrage' : 'Enregistrer la configuration'}</Button>
            {visibleUncertain.length > 0 && <p className="text-xs text-muted-foreground">Traitez les évaluations interrompues avant d’enregistrer un nouveau calibrage.</p>}
            {dirty && agent && <p className="text-xs text-muted-foreground">Enregistrez vos modifications avant de lancer ou reprendre la recherche. Les critères devront être validés à nouveau.</p>}
            {dirty && agent && agent.revision !== draftRevision && query.actionErrorCode === 'REVISION_CONFLICT' && <div className="space-y-2"><p className="text-sm">Une nouvelle version de l’agent est disponible. Relisez vos réglages avant de réenregistrer.</p><Button type="button" size="sm" variant="outline" className={control} disabled={query.isSaving || query.isFetching} onClick={() => { setDraftRevision(agent.revision); query.clearActionError(); }}>Confirmer ces réglages pour la version actualisée</Button></div>}
          </section>
</Card></TabsContent>
        </Tabs>
      </>}
      <AlertDialog open={Boolean(confirmation)} onOpenChange={(nextOpen) => { if (!nextOpen && !query.isSaving) setConfirmation(null); }}>
        <AlertDialogContent className="w-[calc(100%-2rem)] max-h-[85dvh] overflow-y-auto max-sm:[&_button]:min-h-11" onCloseAutoFocus={(event) => { event.preventDefault(); const target = confirmationOpener.current; if (target?.isConnected && target.getClientRects().length > 0) target.focus(); else tabRefs.current[tab]?.focus(); }}><AlertDialogHeader><AlertDialogTitle>{confirmation?.action === 'skip_uncertain' ? 'Ignorer ce profil sans nouvelle évaluation ?' : confirmation?.action === 'stop' ? 'Arrêter cet agent ?' : confirmation?.action === 'resume' ? 'Reprendre avec les critères actuels ?' : 'Activer la recherche continue ?'}</AlertDialogTitle><AlertDialogDescription>{confirmation?.action === 'skip_uncertain' ? 'Le résultat et le coût final de cette évaluation n’ont pas pu être confirmés. Le budget réservé est comptabilisé par prudence ; le montant réellement payé peut différer. Cette action ne déclenche aucun nouveau débit du portefeuille et ne relance pas l’évaluation. Une opération déjà lancée peut encore se terminer.' : confirmation?.action === 'stop' ? 'Les prochaines recherches seront arrêtées. Les profils et vos avis seront conservés.' : confirmation?.action === 'resume' ? 'La reprise utilise le cadrage, les filtres, les références de calibrage et les mémoires actuellement applicables. Revoyez-les avant de confirmer.' : 'Les profils positifs ci-dessous et les raisons de vos avis remplaceront les références de calibrage du cadrage, dans la limite de 5 profils. Les critères éliminatoires et les mémoires ne seront pas modifiés automatiquement.'}</AlertDialogDescription></AlertDialogHeader>
          {confirmation?.action === 'approve_calibration' && <ul className="divide-y divide-border">{confirmation.fits.map((fit) => <li key={fit.id} className="py-2"><p className="text-sm font-medium">{profileName(fit.profile)}</p><p className="text-xs text-muted-foreground break-words">{text(fit.profile.headline)}</p><p className="text-xs text-muted-foreground whitespace-pre-wrap break-words">{fit.reason}</p></li>)}</ul>}
          {confirmation?.action === 'skip_uncertain' && confirmation.candidate && <div className="space-y-1"><p className="text-sm font-medium break-words">{profileName(confirmation.candidate.profile)}</p><p className="text-xs text-muted-foreground break-words">{text(confirmation.candidate.profile.headline)}</p><p className="text-sm">L’agent sera en pause. Vous pourrez ensuite choisir séparément de reprendre la recherche.</p></div>}
          {confirmation?.action !== 'stop' && confirmation?.action !== 'skip_uncertain' && <p className="text-sm">L’agent proposera des profils. Aucun contact ni aucune sélection définitive ne sera effectué automatiquement.</p>}
          {query.actionError && <p role="alert" className="text-sm text-danger">{query.actionError}</p>}
          {['REVISION_CONFLICT', 'CONTEXT_CHANGED', 'MEMORY_CONFLICT'].includes(query.actionErrorCode ?? '') && <Button type="button" size="sm" variant="outline" className={control} disabled={query.isSaving} onClick={() => setConfirmation(null)}>Relire la version actualisée</Button>}
          <AlertDialogFooter><AlertDialogCancel className={control} disabled={query.isSaving}>Annuler</AlertDialogCancel><AlertDialogAction className={control} disabled={query.isSaving || (confirmation?.action === 'skip_uncertain' && !confirmation.candidate) || (confirmation?.action === 'resume' && !canResume) || (confirmation?.action === 'approve_calibration' && !canRun)} aria-busy={query.isSaving} onClick={(event) => { event.preventDefault(); if (!confirmation) return; void run({ action: confirmation.action, expected_revision: confirmation.revision, expected_context_key: confirmation.contextKey, ...(confirmation.action === 'approve_calibration' ? { save_calibration_profiles: true as const } : {}), ...(confirmation.action === 'skip_uncertain' ? { candidate_id: confirmation.candidate?.id, confirm_uncertain: true as const, reason: UNCERTAIN_SKIP_REASON } : {}) }, confirmation.action === 'skip_uncertain' ? 'Profil ignoré. Agent maintenu en pause.' : confirmation.action === 'stop' ? 'Agent arrêté' : 'Recherche continue activée').catch(() => {}); }}>{query.isSaving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}{confirmation?.action === 'skip_uncertain' ? 'Ignorer ce profil' : confirmation?.action === 'stop' ? 'Arrêter l’agent' : confirmation?.action === 'resume' ? 'Confirmer la reprise' : 'Enregistrer les références et activer'}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    <AgentMemoryDialog open={memoriesOpen} onOpenChange={setMemoriesOpen} projectId={projectId} projectTitle={projectName} />
  </div>;
}

/** The same guided workspace remains available from the mission’s legacy menu. */
export function SourcingAgentDialog({ open, onOpenChange, projectId, projectName, missionStatus, returnFocusRef }: Props) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="w-[calc(100%-2rem)] max-w-4xl max-h-[85dvh] overflow-y-auto max-sm:p-4 max-sm:[&_button]:min-h-11 max-sm:[&>button:last-child]:min-w-11" onOpenAutoFocus={(event) => { openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; event.preventDefault(); titleRef.current?.focus(); }} onCloseAutoFocus={(event) => { const target = returnFocusRef?.current ?? openerRef.current; if (target?.isConnected) { event.preventDefault(); target.focus(); } }}>
      <DialogHeader className="sr-only"><DialogTitle ref={titleRef} tabIndex={-1} className="outline-none">Agent de sourcing</DialogTitle><DialogDescription>Préparez la recherche, calibrez les profils puis pilotez votre agent de sourcing.</DialogDescription></DialogHeader>
      <SourcingAgentWorkspace projectId={projectId} projectName={projectName} missionStatus={missionStatus} enabled={open} />
    </DialogContent>
  </Dialog>;
}
