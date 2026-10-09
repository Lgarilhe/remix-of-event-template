import { useRef, useState } from 'react';
import { Check, ChevronDown, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { texturedCard } from '@/components/layout/texturedCard';
import { GuidedActionReview, type GuidedReviewEffect } from './GuidedActionReview';
import { CandidateActionSummary } from './CandidateActionSummary';
import { cn } from '@/lib/utils';
import type { DemoActionResult, DemoActionSource, DemoCandidateAction } from '@/lib/inboxDemoActions';
import { SERVICE_LABELS } from '@/lib/messagingServices';

const dateLabel = (value: string) => new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const ACTION_CARD = 'flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between';

function ActionSources({ sources }: { sources: DemoActionSource[] }) {
  return <div className="space-y-3">{sources.map(source => <Collapsible key={source.id}>
    <div className="rounded-xl border border-border-strong bg-card p-4">
      <div className="flex items-start gap-2">
        {source.service ? <ServiceLogo service={source.service} decorative /> : <FileText className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{source.title}</p>
          <p className="mt-1 text-xs text-foreground-secondary">{source.author} · {dateLabel(source.timestamp)}</p>
        </div>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">{source.summary}</p>
      <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="mt-1 min-h-11 gap-1">Lire l’extrait<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></Button></CollapsibleTrigger>
      <CollapsibleContent><p className="mt-2 whitespace-pre-line break-words border-l-2 border-border-strong pl-3 text-sm leading-relaxed text-foreground">{source.detail}</p></CollapsibleContent>
    </div>
  </Collapsible>)}</div>;
}

/** Préparation, validation et résultats restent dans l’aperçu, sans appel externe. */
export function DemoCandidateActions({ actions, results, dismissed, drafts, subjectDrafts, onDraftChange, onSubjectDraftChange, onApply, onDismiss }: {
  actions: DemoCandidateAction[];
  results: Record<string, DemoActionResult>;
  dismissed: Record<string, boolean>;
  drafts: Record<string, Record<string, string>>;
  subjectDrafts: Record<string, Record<string, string>>;
  onDraftChange: (actionId: string, effectId: string, value: string) => void;
  onSubjectDraftChange: (actionId: string, effectId: string, value: string) => void;
  onApply: (actionId: string) => void;
  onDismiss: (actionId: string, dismissed: boolean) => void;
}) {
  const [dialog, setDialog] = useState<{ actionId: string; view: 'sources' | 'prepare' | 'result' } | null>(null);
  const dialogTitleRef = useRef<HTMLHeadingElement>(null);
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null);
  const primaryButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const lastActionIdRef = useRef<string | null>(null);
  const restoreRef = useRef<HTMLButtonElement>(null);
  const optionsRef = useRef<HTMLButtonElement>(null);
  const detail = actions.find(action => action.id === dialog?.actionId);
  const result = detail ? results[detail.id] : undefined;
  const reviewingResult = !!result;
  const showingSources = dialog?.view === 'sources';
  const visible = actions.filter(action => !dismissed[action.id] || results[action.id]);
  const primaryAction = visible.find(action => !results[action.id]) ?? visible[0];
  const otherActions = visible.filter(action => action.id !== primaryAction?.id);
  const canApply = !!detail && !result && detail.effects.length > 0 && detail.effects.every(effect =>
    (drafts[detail.id]?.[effect.id] ?? effect.content).trim().length > 0
    && (effect.kind !== 'message' || !effect.subject || (subjectDrafts[detail.id]?.[effect.id] ?? effect.subject).trim().length > 0));
  const reviewEffects: GuidedReviewEffect[] = detail?.effects.map(effect => ({
    ...effect,
    content: drafts[detail.id]?.[effect.id] ?? effect.content,
    ...(effect.kind === 'message' ? {
      subject: subjectDrafts[detail.id]?.[effect.id] ?? effect.subject,
      requiresSubject: !!effect.subject,
    } : {}),
  })) ?? [];

  function restoreDialogFocus(event: Event) {
    const target = detailTriggerRef.current?.isConnected ? detailTriggerRef.current : restoreRef.current ?? primaryButtonRefs.current[lastActionIdRef.current ?? ''];
    const fallback = target?.isConnected ? target : optionsRef.current;
    if (fallback?.isConnected) { event.preventDefault(); fallback.focus(); }
  }

  function openDialog(actionId: string, view: 'sources' | 'prepare' | 'result', trigger: HTMLButtonElement) {
    detailTriggerRef.current = trigger;
    lastActionIdRef.current = actionId;
    setDialog({ actionId, view });
  }

  function applyAction() {
    if (!detail || !canApply) return;
    onApply(detail.id);
    setDialog(null);
  }

  function dismissAction() {
    if (!detail || result) return;
    onDismiss(detail.id, true);
    setDialog(null);
  }
  function actionCard(action: DemoCandidateAction, secondary = false) {
    const applied = results[action.id];
    return <article key={action.id} className={applied || secondary ? cn(ACTION_CARD, 'border border-border bg-card') : texturedCard('teal', ACTION_CARD)} aria-label={action.title}>
      <div className="min-w-0 space-y-1.5">
        <h4 className="line-clamp-2 break-words text-sm font-semibold text-foreground" title={action.title}>{action.title}</h4>
        <CandidateActionSummary effects={action.effects} />
        {applied && <p className="flex items-center gap-1.5 text-xs text-foreground" role="status"><Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />Actions réalisées dans la démo</p>}
      </div>
      <Button ref={node => { primaryButtonRefs.current[action.id] = node; }} variant={applied || secondary ? 'outline' : 'primary'} size="sm" className="min-h-11 shrink-0 self-start sm:self-center" onClick={event => openDialog(action.id, applied ? 'result' : 'prepare', event.currentTarget)}>{applied ? 'Voir le résultat' : 'Voir les actions'}</Button>
    </article>;
  }

  return <section className="space-y-2" aria-label="Prochaine action" data-component="demo-candidate-actions">
    {primaryAction && actionCard(primaryAction)}
    {otherActions.length > 0 && <Collapsible><CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="min-h-11 gap-2">Autres propositions ({otherActions.length})<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger><CollapsibleContent className="space-y-2">{otherActions.map(action => actionCard(action, true))}</CollapsibleContent></Collapsible>}
    {visible.some(action => !results[action.id]) && <Collapsible><CollapsibleTrigger asChild><Button ref={optionsRef} variant="ghost" size="sm" className="min-h-11 gap-2 px-0">Détails et réglages<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger><CollapsibleContent className="space-y-1">{visible.filter(action => !results[action.id]).map(action => <div key={action.id} className="flex items-center justify-between gap-3"><p className="min-w-0 line-clamp-2 break-words text-sm text-foreground">{action.title}</p><Button variant="ghost" size="sm" className="min-h-11 shrink-0 text-muted-foreground" aria-label={`Ignorer la proposition : ${action.title}`} onClick={() => {
      onDismiss(action.id, true);
      requestAnimationFrame(() => {
        const target = restoreRef.current ?? optionsRef.current ?? primaryButtonRefs.current[visible.find(item => item.id !== action.id)?.id ?? ''];
        target?.focus();
      });
    }}>Ignorer</Button></div>)}</CollapsibleContent></Collapsible>}
    {visible.length === 0 && <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-muted-foreground" role="status">Vous avez ignoré cette suggestion.</p>
      <Button ref={restoreRef} variant="ghost" size="sm" className="min-h-11 md:min-h-8" onClick={() => {
        actions.forEach(action => onDismiss(action.id, false));
        requestAnimationFrame(() => primaryButtonRefs.current[actions[0]?.id]?.focus());
      }}>Revoir la suggestion</Button>
    </div>}
    <Dialog open={!!detail} onOpenChange={open => { if (!open) setDialog(null); }}>
      {detail && dialog?.view === 'prepare' && !result ? <GuidedActionReview
        key={detail.id}
        title={detail.title}
        reason={detail.reason}
        effects={reviewEffects}
        sources={<ActionSources sources={detail.sources} />}
        followUp={detail.followUp}
        confirmationNote="Démonstration : aucun envoi réel."
        confirmLabel={detail.applyLabel}
        onClose={() => setDialog(null)}
        onConfirm={applyAction}
        onChange={(effectId, field, value) => {
          if (field === 'subject') onSubjectDraftChange(detail.id, effectId, value);
          else onDraftChange(detail.id, effectId, value);
        }}
        onReviewStep={effectId => reviewEffects.find(effect => effect.id === effectId) ?? null}
        onCloseAutoFocus={restoreDialogFocus}
      /> : detail && <DialogContent className="flex max-h-[90dvh] w-[calc(100%_-_1rem)] max-w-2xl flex-col gap-0 overflow-hidden border-border-strong p-0 [&>button]:h-11 [&>button]:w-11" onOpenAutoFocus={event => {
        event.preventDefault();
        dialogTitleRef.current?.focus();
      }} onCloseAutoFocus={restoreDialogFocus}>
        <DialogHeader className="shrink-0 border-b border-border-strong bg-card px-4 py-4 pr-14 text-left md:px-5 md:pr-14">
          <p className="text-xs font-medium text-foreground-secondary">{reviewingResult && !showingSources ? 'Résultat dans la démo' : 'Proposition de l’assistant'}</p>
          <DialogTitle ref={dialogTitleRef} tabIndex={-1} className="text-lg">{detail.title}</DialogTitle>
          <DialogDescription className="leading-relaxed text-foreground-secondary">{reviewingResult && !showingSources ? detail.successLabel : detail.reason}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto bg-background p-4 md:p-5">
          {showingSources ? <section className="space-y-3" aria-label="Contexte de la suggestion">
            <h5 className="text-sm font-semibold text-foreground">Ce qui motive cette action</h5>
            <ActionSources sources={detail.sources} />
          </section> : <>
            <div className="space-y-4">{detail.effects.map(effect => {
              const value = result ? result.contents[effect.id] ?? effect.content : drafts[detail.id]?.[effect.id] ?? effect.content;
              const subject = effect.kind === 'message' ? result?.subjects?.[effect.id] ?? effect.subject : undefined;
              return <section key={effect.id} className="overflow-hidden rounded-xl border border-border-strong bg-card" aria-label={effect.label}>
                <div className="space-y-3 border-b border-border-strong bg-muted p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="flex items-start gap-2 text-sm font-medium leading-snug">
                      {effect.kind === 'message' ? <ServiceLogo service={effect.service} decorative /> : <FileText className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />}
                      {effect.label}
                    </h5>
                  </div>
                  {effect.kind === 'message' ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-xs text-foreground-secondary">Destinataire</dt><dd className="font-medium text-foreground">{effect.audience === 'team' ? 'Équipe' : 'Candidat'}</dd>
                    <dt className="text-xs text-foreground-secondary">Via</dt><dd className="text-foreground">{SERVICE_LABELS[effect.service]}</dd>
                    <dt className="text-xs text-foreground-secondary">À</dt><dd className="break-words text-foreground [overflow-wrap:anywhere]">{effect.recipient}</dd>
                    {subject && <><dt className="text-xs text-foreground-secondary">Objet</dt><dd className="break-words font-medium text-foreground">{subject}</dd></>}
                  </dl> : <p className="text-xs leading-relaxed text-foreground-secondary">{reviewingResult ? 'Enregistré dans' : 'Sera enregistré dans'} : <span className="text-sm font-medium text-foreground">{effect.destination}</span></p>}
                </div>
                <div className="space-y-3 p-4">
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{value}</p>
                </div>
              </section>;
            })}</div>
            {detail.followUp && <section className="space-y-2 rounded-xl border border-border-strong bg-muted p-4" aria-label="Suite en attente">
              <p className="text-xs font-medium text-foreground">{reviewingResult ? 'Suite en attente' : 'À proposer après réception'}</p>
              <h5 className="text-sm font-semibold text-foreground">{detail.followUp.title}</h5>
              <p className="text-xs leading-relaxed text-foreground-secondary">Retour attendu : {detail.followUp.waitingFor}</p>
              <p className="text-sm leading-relaxed text-foreground-secondary">{detail.followUp.description}</p>
            </section>}
            <Collapsible>
              <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="min-h-11 gap-2 px-0 md:min-h-8">Pourquoi cette action ?<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger>
              <CollapsibleContent><section aria-label="Contexte de la suggestion"><ActionSources sources={detail.sources} /></section></CollapsibleContent>
            </Collapsible>
            {result && <p className="text-xs text-muted-foreground">Réalisé le {dateLabel(result.appliedAt)}.</p>}
          </>}
        </div>
        <div className="shrink-0 space-y-2 border-t border-border-strong bg-card px-4 py-3 md:px-5">
          <p className="text-xs text-foreground-secondary">Démonstration : aucun envoi réel.</p>
          <div className="flex flex-wrap justify-end gap-2">
            {reviewingResult ? <Button variant="outline" size="sm" className="min-h-11" onClick={() => setDialog(null)}>{showingSources ? 'Fermer le détail' : 'Fermer le résultat'}</Button> : <>
              {showingSources ? <Button variant="ghost" size="sm" className="min-h-11 text-foreground-secondary" onClick={dismissAction}>Ignorer la suggestion</Button> : <Button variant="ghost" size="sm" className="min-h-11" onClick={() => setDialog(null)}>Annuler</Button>}
              <Button variant="primary" size="sm" className="min-h-11" onClick={() => setDialog({ actionId: detail.id, view: 'prepare' })}>{detail.prepareLabel}</Button>
            </>}
          </div>
        </div>
      </DialogContent>}
    </Dialog>
  </section>;
}
