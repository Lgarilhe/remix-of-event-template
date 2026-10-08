import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ChevronDown, FileText, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { texturedCard } from '@/components/layout/texturedCard';
import { candidateActionCompleted, candidateActionCanResume, candidateActionConfirmLabel, candidateActionNeedsReview, candidateActionWarningLabels, candidateEffectStatus, type CandidateActionPlan, type CandidateActionEdits, type CandidateActionEffect, type CandidateActionSource, type CandidateActionMessageRecord } from '@/lib/candidateActions';
import { activityMessageText } from '@/lib/inboxTimeline';
import { useMemberName } from '@/hooks/useTeamMembers';
import { SERVICE_LABELS } from '@/lib/messagingServices';
import type { CandidateActionsController } from '@/hooks/useCandidateActions';
import { GuidedActionReview } from './GuidedActionReview';
import { CandidateActionSummary } from './CandidateActionSummary';
import type { GuidedReviewEffect } from '@/lib/guidedActionReview';
import { toast } from 'sonner';

const dateLabel = (value: string) => new Date(value).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function reviewEffect(effect: CandidateActionEffect, edit?: CandidateActionEdits[string]): GuidedReviewEffect {
  return {
    id: effect.id, kind: effect.kind, label: effect.label,
    identityKey: effect.kind === 'message' ? JSON.stringify([effect.targetId, effect.senderAccountId, effect.chatId]) : effect.kind === 'document' ? effect.evaluationId ?? '' : JSON.stringify(effect.mentions),
    content: edit?.content ?? effect.content,
    ...(effect.kind === 'message' ? {
      subject: edit?.subject ?? effect.subject,
      requiresSubject: effect.channel === 'email', service: effect.service,
      audience: effect.audience, recipient: effect.recipient, senderAddress: effect.senderAddress,
    } : { destination: effect.destination }),
  };
}

function ActionSources({ sources }: { sources: CandidateActionSource[] }) {
  return <div className="space-y-3">{sources.map(source => <Collapsible key={source.id}>
    <div className="rounded-xl border border-border-strong bg-card p-4">
      <div className="flex items-start gap-2">
        {source.service ? <ServiceLogo service={source.service} decorative /> : <FileText className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />}
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold text-foreground">{source.title}</p><p className="mt-1 text-xs text-foreground-secondary">{source.author}{source.timestamp && ` · ${dateLabel(source.timestamp)}`}</p></div>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-foreground-secondary">{source.summary}</p>
      <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="mt-1 min-h-11 gap-1">Lire l’extrait<ChevronDown className="h-3.5 w-3.5" aria-hidden="true" /></Button></CollapsibleTrigger>
      <CollapsibleContent><p className="mt-2 whitespace-pre-line break-words border-l-2 border-border-strong pl-3 text-sm leading-relaxed text-foreground">{source.detail}</p></CollapsibleContent>
    </div>
  </Collapsible>)}</div>;
}

/** Changer de candidat ou de compte ferme le dialogue et réinitialise les éditions locales. */
export function CandidateActions({ controller }: { controller: CandidateActionsController }) {
  return <CandidateActionsContent key={controller.scopeKey} controller={controller} />;
}

function CandidateActionsContent({ controller }: { controller: CandidateActionsController }) {
  const [dialog, setDialog] = useState<{ planId: string; view: 'sources' | 'prepare' | 'result' } | null>(null);
  const [edits, setEdits] = useState<Record<string, CandidateActionEdits>>({});
  const [editedRevisions, setEditedRevisions] = useState<Record<string, number>>({});
  const titleRef = useRef<HTMLHeadingElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const planButtons = useRef<Record<string, HTMLButtonElement | null>>({});
  const refreshButton = useRef<HTMLButtonElement>(null);
  const detail = controller.plans.find(plan => plan.id === dialog?.planId);
  const busy = !!controller.operation;
  const completed = detail ? candidateActionCompleted(detail) : false;
  const editable = detail?.status === 'draft';
  const sendingReview = dialog?.view === 'prepare' && controller.operation?.type === 'execute';
  const uncertain = detail ? candidateActionNeedsReview(detail) || detail.status === 'needs_review' || controller.unverifiedPlanIds.includes(detail.id) : false;
  const sourcesView = dialog?.view === 'sources';
  const next = controller.plans.filter(plan => plan.status !== 'dismissed' && !candidateActionCompleted(plan));
  const primaryPlan = next.find(plan => candidateActionNeedsReview(plan) || plan.status === 'needs_review' || controller.unverifiedPlanIds.includes(plan.id)) ?? next.find(plan => plan.status !== 'draft') ?? next[0];
  const otherPlans = next.filter(plan => plan.id !== primaryPlan?.id);
  const results = controller.plans.filter(candidateActionCompleted).slice(0, 3);
  const dismissed = controller.plans.filter(plan => plan.status === 'dismissed');
  const contents = detail ? edits[detail.id] ?? {} : {};
  const staleEdits = !!detail && Object.keys(contents).length > 0 && editedRevisions[detail.id] !== detail.revision;
  const valid = detail?.effects.every(effect => (contents[effect.id]?.content ?? effect.content).trim() && (effect.kind !== 'message' || effect.channel !== 'email' || (contents[effect.id]?.subject ?? effect.subject)?.trim()));

  function open(plan: CandidateActionPlan, view: 'sources' | 'prepare' | 'result', trigger: HTMLButtonElement) {
    triggerRef.current = trigger;
    setDialog({ planId: plan.id, view });
  }
  function edit(effectId: string, field: 'content' | 'subject', value: string) {
    if (!detail || !editable || busy) return;
    const effect = detail.effects.find(item => item.id === effectId);
    if (!effect) return;
    setEditedRevisions(previous => ({ ...previous, [detail.id]: previous[detail.id] ?? detail.revision }));
    setEdits(previous => ({ ...previous, [detail.id]: { ...previous[detail.id], [effectId]: { content: effect.content, ...(effect.kind === 'message' ? { subject: effect.subject } : {}), ...previous[detail.id]?.[effectId], [field]: value } } }));
  }
  async function reviewStep(effectId: string): Promise<GuidedReviewEffect | null> {
    if (!detail || !editable || busy || uncertain || staleEdits) return null;
    const effect = detail.effects.find(item => item.id === effectId);
    if (!effect) return null;
    const change = contents[effectId];
    const content = change?.content ?? effect.content;
    const subject = change?.subject ?? (effect.kind === 'message' ? effect.subject : undefined);
    if (!content.trim() || (effect.kind === 'message' && effect.channel === 'email' && !subject?.trim())) return null;
    if (!change) return reviewEffect(effect);
    const saved = await controller.save(detail, { [effectId]: change });
    if (!saved) return null;
    setEdits(previous => {
      const remaining = { ...previous[saved.id] };
      delete remaining[effectId];
      return { ...previous, [saved.id]: remaining };
    });
    setEditedRevisions(previous => ({ ...previous, [saved.id]: saved.revision }));
    const savedEffect = saved.effects.find(item => item.id === effectId);
    return savedEffect ? reviewEffect(savedEffect) : null;
  }
  async function confirm() {
    if (!detail || !valid || busy || uncertain || staleEdits) return;
    const result = await controller.execute(detail, contents);
    if (!result) return;
    setEdits(previous => ({ ...previous, [result.id]: {} }));
    setEditedRevisions(previous => ({ ...previous, [result.id]: result.revision }));
    if (candidateActionCompleted(result)) {
      const sent = result.effects.filter(effect => effect.kind === 'message' && effect.status === 'succeeded').length;
      const recorded = result.effects.filter(effect => effect.kind !== 'message' && effect.status === 'succeeded').length;
      const already = result.effects.filter(effect => effect.status === 'skipped').length;
      toast.success('Les actions sont terminées', { description: [
        sent > 0 && `${sent} message${sent > 1 ? 's' : ''} envoyé${sent > 1 ? 's' : ''}`,
        recorded > 0 && `${recorded} contenu${recorded > 1 ? 's' : ''} enregistré${recorded > 1 ? 's' : ''}`,
        already > 0 && `${already} action${already > 1 ? 's' : ''} déjà traitée${already > 1 ? 's' : ''}`,
      ].filter(Boolean).join(' · ') });
      setDialog(null);
    } else setDialog({ planId: result.id, view: 'result' });
  }
  async function prepareAgain() {
    const result = await controller.generate();
    const fresh = result?.plans.find(plan => plan.status === 'draft');
    if (fresh) setDialog({ planId: fresh.id, view: 'prepare' });
  }
  function planCard(plan: CandidateActionPlan, secondary = false) {
    const needsReview = candidateActionNeedsReview(plan) || plan.status === 'needs_review' || controller.unverifiedPlanIds.includes(plan.id);
    const draft = plan.status === 'draft';
    return <article key={plan.id} className={draft && !needsReview && !secondary ? texturedCard('teal', 'flex flex-col gap-3 rounded-xl p-4 sm:flex-row sm:items-center sm:justify-between') : 'flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between'} aria-label={plan.title}>
      <div className="min-w-0 space-y-1.5">
        <h5 className="line-clamp-2 break-words text-sm font-semibold text-foreground" title={plan.title}>{plan.title}</h5>
        <CandidateActionSummary effects={plan.effects} />
        {(!draft || needsReview) && <p className="text-xs text-foreground-secondary" role="status">{needsReview ? 'Résultat à vérifier' : 'Action à terminer'} · {plan.effects.filter(effect => effect.status === 'succeeded' || effect.status === 'skipped').length}/{plan.effects.length} actions traitées</p>}
      </div>
      <Button ref={node => { planButtons.current[plan.id] = node; }} variant={draft && !needsReview && !secondary ? 'primary' : 'outline'} size="sm" className="min-h-11 shrink-0 self-start sm:self-center" disabled={busy} onClick={event => open(plan, draft && !needsReview ? 'prepare' : 'result', event.currentTarget)}>{needsReview ? 'Vérifier le résultat' : draft ? 'Voir les actions' : 'Reprendre les actions'}</Button>
    </article>;
  }
  if (!controller.enabled) return null;

  return <section className="mt-4 space-y-2" aria-label="Prochaines actions" data-component="candidate-actions">
    {controller.loading && <p className="flex items-center gap-2 text-sm text-muted-foreground" role="status"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Chargement des actions enregistrées…</p>}
    {controller.readError && <div className="space-y-2 rounded-xl border border-border-strong bg-muted p-4 text-sm leading-relaxed text-foreground" role="alert"><p>{controller.readError}</p>{controller.contextLoaded && <p className="text-xs text-foreground-secondary">Les derniers contenus chargés restent disponibles.</p>}<Button variant="outline" size="sm" className="min-h-11" disabled={busy || controller.fetching} loading={controller.fetching} onClick={() => void controller.refresh()}>Réessayer la lecture</Button></div>}
    {controller.operationError && <div className="space-y-2 rounded-xl border border-border-strong bg-muted p-4 text-sm leading-relaxed text-foreground" role="alert"><p>{controller.operationError.message}</p>{controller.operationError.type === 'generate' ? <><Button variant="outline" size="sm" className="min-h-11" disabled={busy || controller.loading || controller.fetching || !controller.contextLoaded} loading={controller.operation?.type === 'generate'} onClick={event => { triggerRef.current = event.currentTarget; void prepareAgain(); }}>Réessayer la préparation</Button>{controller.generation && <p className="text-xs text-foreground-secondary">Environ {controller.generation.estimated} crédits IA</p>}</> : <Button variant="outline" size="sm" className="min-h-11" disabled={busy || controller.fetching} onClick={() => void controller.refresh()}>Vérifier l’état enregistré</Button>}</div>}
    {controller.warnings.length > 0 && <Collapsible className="space-y-1"><div className="flex flex-wrap items-center gap-x-2 text-xs text-foreground-secondary"><ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="Informations du contexte à vérifier">{candidateActionWarningLabels(controller.warnings).map(label => <li key={label}>{label}</li>)}</ul><CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="min-h-11 gap-1 px-0">Voir les précisions<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger></div><CollapsibleContent className="space-y-2 rounded-lg bg-muted p-3 text-xs leading-relaxed text-foreground-secondary">{controller.warnings.map(warning => <p key={warning}>{warning}</p>)}</CollapsibleContent></Collapsible>}
    {primaryPlan && planCard(primaryPlan)}
    {otherPlans.length > 0 && <Collapsible><CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="min-h-11 gap-2">Autres propositions ({otherPlans.length})<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger><CollapsibleContent className="space-y-2">{otherPlans.map(plan => planCard(plan, true))}</CollapsibleContent></Collapsible>}
    {!controller.loading && controller.contextLoaded && next.length === 0 && controller.operationError?.type !== 'generate' && <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <Button variant="outline" size="sm" className="min-h-11" loading={controller.operation?.type === 'generate'} disabled={busy || controller.loading || controller.fetching || !controller.contextLoaded} onClick={event => { triggerRef.current = event.currentTarget; void prepareAgain(); }}>{next.length ? 'Préparer une nouvelle proposition' : 'Préparer les prochaines actions'}</Button>
      {controller.generation && <p className="text-xs text-muted-foreground">Environ {controller.generation.estimated} crédits IA</p>}
    </div>}
    <Collapsible>
      <CollapsibleTrigger asChild><Button ref={refreshButton} variant="ghost" size="sm" className="min-h-11 gap-2 px-0">Détails et réglages<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 rounded-lg bg-muted p-3">
        <div className="flex flex-wrap items-center gap-2"><Button variant="ghost" size="sm" className="min-h-11" disabled={busy || controller.fetching} loading={controller.fetching} onClick={() => void controller.refresh()}>Actualiser les actions</Button>
          {next.length > 0 && controller.operationError?.type !== 'generate' && <div className="space-y-1"><Button variant="outline" size="sm" className="min-h-11" loading={controller.operation?.type === 'generate'} disabled={busy || controller.loading || controller.fetching || !controller.contextLoaded} onClick={event => { triggerRef.current = event.currentTarget; void prepareAgain(); }}>Préparer une nouvelle proposition</Button>{controller.generation && <p className="text-xs text-muted-foreground">Environ {controller.generation.estimated} crédits IA</p>}</div>}
        </div>
        {next.filter(plan => plan.status === 'draft' && !controller.unverifiedPlanIds.includes(plan.id)).map(plan => <div key={plan.id} className="flex items-center justify-between gap-3"><p className="min-w-0 line-clamp-2 break-words text-sm text-foreground">{plan.title}</p><Button variant="ghost" size="sm" className="min-h-11 shrink-0 text-muted-foreground" aria-label={`Ignorer la proposition : ${plan.title}`} disabled={busy} onClick={async () => {
          if (await controller.setDismissed(plan, true)) requestAnimationFrame(() => refreshButton.current?.focus());
        }}>Ignorer</Button></div>)}
        {controller.generation && <p className="text-xs text-foreground-secondary">Rédaction : {controller.generation.styleSummary}</p>}
        {controller.channels.length > 0 ? <p className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs text-foreground-secondary">{controller.channels.map(channel => <span key={`${channel.service}-${channel.address}`} className="inline-flex min-w-0 items-center gap-1.5"><ServiceLogo service={channel.service} decorative />{SERVICE_LABELS[channel.service]}<span className="break-all">{channel.address}</span></span>)}</p> : !controller.loading && controller.contextLoaded && !controller.readError && <p className="text-xs leading-relaxed text-muted-foreground">Aucun canal d’envoi disponible. Les contenus peuvent être enregistrés dans la fiche.</p>}
        <Link className="inline-block min-h-11 py-3 text-sm text-foreground underline underline-offset-4" to="/settings/account/connections">Gérer mes connexions</Link>
    {results.length > 0 && <Collapsible>
      <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="min-h-11 gap-2">Derniers résultats<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">{results.map(plan => <div key={plan.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-strong bg-card p-3"><p className="flex min-w-0 items-center gap-2 text-sm text-foreground"><Check className="h-4 w-4 shrink-0" aria-hidden="true" />{plan.title}</p><Button variant="outline" size="sm" className="min-h-11" onClick={event => open(plan, 'result', event.currentTarget)}>Voir le résultat</Button></div>)}</CollapsibleContent>
    </Collapsible>}
    {dismissed.length > 0 && <Collapsible>
      <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="min-h-11">Suggestions ignorées</Button></CollapsibleTrigger>
      <CollapsibleContent className="space-y-2">{dismissed.map(plan => <div key={plan.id} className="flex flex-wrap items-center justify-between gap-2"><p className="text-sm text-muted-foreground">{plan.title}</p><Button variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => void controller.setDismissed(plan, false)}>Revoir la suggestion</Button></div>)}</CollapsibleContent>
    </Collapsible>}
      </CollapsibleContent>
    </Collapsible>
    <Dialog open={!!detail} onOpenChange={opened => { if (!opened && !busy) setDialog(null); }}>
      {detail && (((editable && dialog?.view === 'prepare') || sendingReview) && !sourcesView ? <GuidedActionReview
        key={detail.id}
        title={detail.title}
        reason={detail.reason}
        effects={detail.effects.map(effect => reviewEffect(effect, contents[effect.id]))}
        sources={<ActionSources sources={detail.sources} />}
        followUp={detail.followUp}
        busy={busy}
        blocked={staleEdits || uncertain}
        error={staleEdits ? 'Cette proposition a changé. Votre texte est conservé ; relisez la version enregistrée.' : uncertain ? 'Le résultat reste à vérifier. Relisez le journal avant de poursuivre.' : controller.error}
        confirmationNote={sendingReview ? 'Envoi et enregistrement en cours… Chaque résultat sera conservé.' : 'Les messages seront envoyés et les contenus enregistrés après votre confirmation finale.'}
        confirmLabel={candidateActionConfirmLabel(detail)}
        onChange={edit}
        onReviewStep={reviewStep}
        onConfirm={confirm}
        onClose={() => setDialog(null)}
        onReleread={staleEdits ? () => {
          setEdits(previous => ({ ...previous, [detail.id]: {} }));
          setEditedRevisions(previous => ({ ...previous, [detail.id]: detail.revision }));
          void controller.refresh();
        } : uncertain ? () => { void controller.refresh(); } : undefined}
        onCloseAutoFocus={event => {
          const target = triggerRef.current?.isConnected ? triggerRef.current : planButtons.current[detail.id] ?? refreshButton.current;
          if (target?.isConnected) { event.preventDefault(); target.focus(); }
        }}
      /> : <DialogContent className="flex max-h-[90dvh] w-[calc(100%_-_1rem)] max-w-2xl flex-col gap-0 overflow-hidden border-border-strong p-0 [&>button]:h-11 [&>button]:w-11" onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }} onCloseAutoFocus={event => {
        const target = triggerRef.current?.isConnected ? triggerRef.current : planButtons.current[detail.id] ?? refreshButton.current;
        if (target?.isConnected) { event.preventDefault(); target.focus(); }
      }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
        <DialogHeader className="shrink-0 border-b border-border-strong bg-card px-4 py-4 pr-14 text-left md:px-5 md:pr-14">
          <p className="text-xs font-medium text-foreground-secondary">{sourcesView || editable ? 'Proposition de l’assistant' : completed ? 'Résultat enregistré' : 'Suivi de l’action'}</p>
          <DialogTitle ref={titleRef} tabIndex={-1} className="text-lg">{detail.title}</DialogTitle>
          <DialogDescription className="leading-relaxed text-foreground-secondary">{detail.reason}</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 space-y-4 overflow-y-auto bg-background p-4 md:p-5">
          {controller.error && <p className="rounded-xl border border-border-strong bg-muted p-4 text-sm text-foreground" role="alert">{controller.error}</p>}
          {staleEdits && <div className="space-y-2 rounded-xl border border-border-strong bg-muted p-4" role="alert"><p className="text-sm text-foreground">Cette proposition a changé pendant votre modification. Votre texte est conservé. Relisez la version enregistrée avant de reprendre.</p><Button variant="outline" size="sm" className="min-h-11" disabled={busy} onClick={() => { setEdits(previous => ({ ...previous, [detail.id]: {} })); setEditedRevisions(previous => ({ ...previous, [detail.id]: detail.revision })); }}>Relire la version enregistrée</Button></div>}
          {sourcesView ? <section className="space-y-3" aria-label="Contexte de la suggestion"><h5 className="text-sm font-semibold text-foreground">Ce qui motive cette action</h5><ActionSources sources={detail.sources} /></section> : <>
            <p className="text-sm font-medium text-foreground">{completed ? 'Ces effets sont enregistrés dans le journal.' : 'Relisez chaque contenu et ses destinataires avant de valider.'}</p>
            <div className="space-y-4">{detail.effects.map(effect => {
              const content = contents[effect.id]?.content ?? effect.content;
              const subject = contents[effect.id]?.subject ?? (effect.kind === 'message' ? effect.subject : undefined);
              return <section key={effect.id} className="overflow-hidden rounded-xl border border-border-strong bg-card" aria-label={effect.label}>
                <div className="space-y-3 border-b border-border-strong bg-muted p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h5 className="flex items-start gap-2 text-sm font-medium leading-snug">{effect.kind === 'message' ? <ServiceLogo service={effect.service} decorative /> : <FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}{effect.label}</h5>
                    <span className="text-xs font-medium text-foreground" role="status">{candidateEffectStatus(effect)}</span>
                  </div>
                  {effect.kind === 'message' ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-baseline gap-x-3 gap-y-1.5 text-sm">
                    <dt className="text-xs text-foreground-secondary">Destinataire</dt><dd className="font-medium text-foreground">{effect.audience === 'team' ? 'Équipe' : 'Candidat'}</dd>
                    <dt className="text-xs text-foreground-secondary">Via</dt><dd className="text-foreground">{SERVICE_LABELS[effect.service]}</dd>
                    <dt className="text-xs text-foreground-secondary">De</dt><dd className="break-words text-foreground [overflow-wrap:anywhere]">{effect.senderAddress}</dd>
                    <dt className="text-xs text-foreground-secondary">À</dt><dd className="break-words text-foreground [overflow-wrap:anywhere]">{effect.recipient}</dd>
                    {(subject !== undefined || effect.channel === 'email') && <><dt className="text-xs text-foreground-secondary">Objet</dt><dd className="break-words font-medium text-foreground">{subject}</dd></>}
                  </dl> : <p className="text-xs leading-relaxed text-foreground-secondary">{effect.status === 'succeeded' ? 'Enregistré dans' : 'Sera enregistré dans'} : <span className="text-sm font-medium text-foreground">{effect.destination}</span></p>}
                </div>
                <div className="space-y-3 p-4">
                  <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{content}</p>
                  {effect.status === 'unknown' && <p className="text-sm text-foreground-secondary" role="status">Le service n’a pas confirmé le résultat. Vérifiez votre messagerie avant de reprendre : ce message peut déjà avoir été envoyé.</p>}
                  {effect.status === 'failed' && <p className="text-sm text-foreground-secondary" role="status">Cet effet n’a pas été réalisé. Les effets déjà réussis seront conservés.</p>}
                  {effect.status === 'skipped' && <p className="text-sm text-foreground-secondary" role="status">Ce contenu est celui de la proposition. Cet effet a déjà été traité ; retrouvez son résultat et le contenu effectivement envoyé dans l’historique.</p>}
                  {effect.result?.message && <p className="text-xs text-foreground-secondary">{effect.result.message}</p>}
                  {effect.result?.completedAt && <p className="text-xs text-muted-foreground">{dateLabel(effect.result.completedAt)}</p>}
                </div>
              </section>;
            })}</div>
            {detail.followUp && <section className="space-y-2 rounded-xl border border-border-strong bg-muted p-4" aria-label="Suite en attente"><p className="text-xs font-medium text-foreground">Suite en attente</p><h5 className="text-sm font-semibold text-foreground">{detail.followUp.title}</h5><p className="text-xs leading-relaxed text-foreground-secondary">Retour attendu : {detail.followUp.waitingFor}</p><p className="text-sm leading-relaxed text-foreground-secondary">{detail.followUp.description}</p><p className="text-xs text-foreground-secondary">Une nouvelle proposition sera préparée à partir du retour réel, avant validation.</p></section>}
            <Collapsible><CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="min-h-11 gap-2 px-0">Pourquoi cette action ?<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger><CollapsibleContent><ActionSources sources={detail.sources} /></CollapsibleContent></Collapsible>
          </>}
        </div>
        <div className="shrink-0 space-y-2 border-t border-border-strong bg-card px-4 py-3 md:px-5">
          <p className="text-xs text-foreground-secondary" role="status">{busy ? controller.operation?.type === 'execute' ? 'Exécution en cours. Chaque résultat est enregistré séparément.' : 'Enregistrement du brouillon en cours…' : uncertain ? 'Actualisez le journal pour vérifier le résultat. Aucun nouvel envoi ne sera déclenché.' : completed ? 'Tous les résultats sont disponibles dans cette fiche.' : 'Votre validation déclenche les envois réels et enregistre les contenus indiqués.'}</p>
          {detail.status === 'needs_review' && !candidateActionNeedsReview(detail) && !controller.unverifiedPlanIds.includes(detail.id) && controller.generation && <p className="text-xs text-foreground-secondary">Nouvelle préparation : environ {controller.generation.estimated} crédits IA</p>}
          <div className="flex flex-wrap justify-end gap-2">
            {sourcesView && editable ? <><Button variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={async () => { if (await controller.setDismissed(detail, true)) setDialog(null); }}>Ignorer la suggestion</Button><Button variant="primary" size="sm" className="min-h-11" disabled={busy} onClick={() => setDialog({ planId: detail.id, view: 'prepare' })}>Préparer</Button></> : <>
              <Button variant="ghost" size="sm" className="min-h-11" disabled={busy} onClick={() => setDialog(null)}>{completed ? 'Fermer le résultat' : !editable ? 'Fermer le suivi' : 'Annuler'}</Button>
              {detail.status === 'needs_review' && !candidateActionNeedsReview(detail) && !controller.unverifiedPlanIds.includes(detail.id) ? <Button variant="primary" size="sm" className="min-h-11" disabled={busy || controller.fetching} loading={controller.operation?.type === 'generate'} onClick={() => void prepareAgain()}>Préparer à nouveau</Button> : uncertain ? <Button variant="outline" size="sm" className="min-h-11" disabled={busy || controller.fetching} onClick={() => void controller.refresh()}>Vérifier le résultat</Button> : editable ? <Button variant="primary" size="sm" className="min-h-11" disabled={busy || staleEdits} onClick={() => setDialog({ planId: detail.id, view: 'prepare' })}>Voir les actions</Button> : !completed && candidateActionCanResume(detail) && <Button variant="primary" size="sm" className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-center" disabled={!valid || busy || staleEdits} loading={controller.operation?.type === 'execute'} onClick={() => void confirm()}>{candidateActionConfirmLabel(detail)}</Button>}
            </>}
          </div>
        </div>
      </DialogContent>)}
    </Dialog>
  </section>;
}

/** Le suivi interne reste séparé des messages adressés au candidat. */
export function CandidateActionHistory({ plans, messages = [] }: { plans: CandidateActionPlan[]; messages?: CandidateActionMessageRecord[] }) {
  const memberName = useMemberName();
  const recorded = [...new Map(messages.filter(row => row.audience === 'team').map(row => [`${row.account_id}:${row.provider_message_id}`, row])).values()];
  const team = [
    ...recorded.map(row => ({ key: row.id, label: row.direction === 'inbound' ? 'Retour de l’équipe' : 'Message à l’équipe', service: row.service, sender: row.sender, recipient: row.recipient, subject: row.subject, content: activityMessageText(row.content), author: row.direction === 'inbound' ? `Reçu de ${row.sender}` : `Envoyé par ${memberName(row.owner_user_id) || row.sender}`, date: row.occurred_at })),
    ...plans.flatMap(plan => plan.effects.flatMap(effect => effect.kind === 'message' && effect.audience === 'team' && effect.status === 'succeeded' && !recorded.some(row => row.action_plan_id === plan.id && row.effect_id === effect.id) ? [{ key: `${plan.id}-${effect.id}`, label: effect.label, service: effect.service, sender: effect.senderAddress, recipient: effect.recipient, subject: effect.subject, content: effect.content, author: `Envoyé par ${memberName(plan.createdBy) || effect.senderAddress}`, date: effect.result?.completedAt ?? plan.updatedAt }] : [])),
  ].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const documents = plans.flatMap(plan => plan.effects.filter(effect => effect.kind !== 'message' && effect.status === 'succeeded').map(effect => ({ plan, effect })));
  if (!team.length && !documents.length) return null;
  return <div className="mt-6 space-y-5" data-component="candidate-action-history">
    {!!team.length && <section className="space-y-3" aria-label="Coordination avec l’équipe"><h4 className="text-sm font-semibold text-foreground">Coordination avec l’équipe</h4><p className="text-xs text-muted-foreground">Échanges avec vos collègues pour ce candidat.</p>{team.map(message => <article key={message.key} className="space-y-2 rounded-xl border border-border-strong bg-card p-4" aria-label={message.label}><h5 className="flex items-center gap-2 text-sm font-medium text-foreground"><ServiceLogo service={message.service} decorative />{message.label}</h5><p className="text-xs font-medium text-foreground">{message.author}</p><p className="break-words text-xs text-foreground-secondary [overflow-wrap:anywhere]">De : {message.sender} · À : {message.recipient}</p>{message.subject && <p className="text-sm font-medium text-foreground">{message.subject}</p>}<p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{message.content}</p><p className="text-xs text-muted-foreground">{dateLabel(message.date)}</p></article>)}</section>}
    {!!documents.length && <section className="space-y-3" aria-label="Contenus enregistrés"><h4 className="text-sm font-semibold text-foreground">Contenus enregistrés</h4>{documents.map(({ plan, effect }) => effect.kind !== 'message' && <Collapsible key={`${plan.id}-${effect.id}`}><article className="rounded-xl border border-border-strong bg-card p-4"><h5 className="text-sm font-medium text-foreground">{effect.label}</h5><p className="mt-1 text-xs text-foreground-secondary">{effect.destination}</p><CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="mt-1 min-h-11 gap-2">Lire le contenu<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger><CollapsibleContent><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{effect.content}</p></CollapsibleContent></article></Collapsible>)}</section>}
  </div>;
}
