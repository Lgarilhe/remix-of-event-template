import { useEffect, useId, useRef, useState, type ComponentProps, type ReactNode } from 'react';
import { Check, ChevronDown, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SERVICE_LABELS } from '@/lib/messagingServices';
import {
  guidedReviewAcknowledged, guidedReviewCanConfirm, guidedReviewIdentity,
  guidedReviewSavedAcknowledgement, guidedReviewSummary, guidedReviewValid, type GuidedReviewEffect,
  type GuidedReviewAcknowledgements,
} from '@/lib/guidedActionReview';
import { cn } from '@/lib/utils';

export type { GuidedReviewEffect } from '@/lib/guidedActionReview';

export interface GuidedActionReviewProps {
  title: string;
  reason: string;
  effects: GuidedReviewEffect[];
  sources?: ReactNode;
  followUp?: { title: string; waitingFor: string; description: string };
  busy?: boolean;
  error?: string | null;
  blocked?: boolean;
  confirmationNote: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => Promise<void> | void;
  onChange: (effectId: string, field: 'content' | 'subject', value: string) => void;
  /** Enregistre éventuellement le brouillon ; ne déclenche aucun envoi. */
  onReviewStep: (effectId: string) => Promise<GuidedReviewEffect | null> | GuidedReviewEffect | null;
  onReleread?: () => void;
  onCloseAutoFocus?: ComponentProps<typeof DialogContent>['onCloseAutoFocus'];
}

function EffectLogo({ effect }: { effect: GuidedReviewEffect }) {
  return effect.service ? <ServiceLogo service={effect.service} size="md" decorative />
    : <FileText className="h-5 w-5 shrink-0 text-foreground" aria-hidden="true" />;
}

/** Une seule page de contenu est montée. La relecture précède une confirmation globale. */
export function GuidedActionReview({
  title, reason, effects, sources, followUp, busy = false, error, blocked = false,
  confirmationNote, confirmLabel, onClose, onConfirm, onChange, onReviewStep,
  onReleread, onCloseAutoFocus,
}: GuidedActionReviewProps) {
  const prefix = useId();
  const [step, setStep] = useState(0);
  const [editing, setEditing] = useState(false);
  const [reviewed, setReviewed] = useState<GuidedReviewAcknowledgements>({});
  const [pending, setPending] = useState<'review' | 'confirm' | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const stepRef = useRef<HTMLHeadingElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(true);
  const previousStep = useRef(step);
  const latestEffects = useRef(effects);
  latestEffects.current = effects;
  const locked = busy || pending !== null;
  const recap = step >= effects.length;
  const effect = recap ? undefined : effects[step];
  const canConfirm = guidedReviewCanConfirm(effects, reviewed);
  const reviewedCount = effects.filter(item => guidedReviewAcknowledged(item, reviewed)).length;
  const stepNumber = Math.min(step + 1, effects.length + 1);
  const errorId = `${prefix}-content-error`;
  const valid = !!effect && guidedReviewValid(effect);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    bodyRef.current?.scrollTo({ top: 0 });
    stepRef.current?.focus();
  }, [step]);

  function goTo(index: number, edit = false) {
    if (locked) return;
    setLocalError(null);
    setEditing(edit);
    setStep(index);
  }

  function change(field: 'content' | 'subject', value: string) {
    if (!effect || locked || blocked) return;
    setReviewed(previous => {
      const next = { ...previous };
      delete next[effect.id];
      return next;
    });
    setLocalError(null);
    onChange(effect.id, field, value);
  }

  async function reviewStep() {
    if (!effect || !valid || blocked || locked || pendingRef.current) return;
    const identity = guidedReviewIdentity(effect);
    pendingRef.current = true;
    setPending('review');
    setLocalError(null);
    try {
      const saved = await onReviewStep(effect.id);
      if (!mounted.current) return;
      const savedIdentity = guidedReviewSavedAcknowledgement(identity, saved);
      if (!savedIdentity) {
        setLocalError(saved ? 'Ce contenu a changé. Relisez la version enregistrée avant de continuer.' : 'Le brouillon n’a pas pu être enregistré. Réessayez cette étape.');
        return;
      }
      setReviewed(previous => ({ ...previous, [effect.id]: savedIdentity }));
      setEditing(false);
      setStep(previous => Math.min(previous + 1, latestEffects.current.length));
    } catch {
      if (mounted.current) setLocalError('Le brouillon n’a pas pu être enregistré. Réessayez cette étape.');
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(null);
    }
  }

  async function confirm() {
    if (!recap || !canConfirm || blocked || locked || pendingRef.current) return;
    pendingRef.current = true;
    setPending('confirm');
    setLocalError(null);
    try {
      await onConfirm();
    } catch {
      if (mounted.current) setLocalError('L’action n’a pas pu être confirmée. Vérifiez son état avant de reprendre.');
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(null);
    }
  }

  return <DialogContent
    data-component="guided-action-review"
    className={cn('flex h-[min(44rem,calc(100dvh_-_1rem))] w-[calc(100%_-_1rem)] max-w-2xl flex-col gap-0 overflow-hidden border-border-strong p-0 [&>button]:h-11 [&>button]:w-11', locked && '[&>button]:invisible')}
    onOpenAutoFocus={event => { event.preventDefault(); titleRef.current?.focus(); }}
    onCloseAutoFocus={onCloseAutoFocus}
    onEscapeKeyDown={event => { if (locked) event.preventDefault(); }}
    onPointerDownOutside={event => { if (locked) event.preventDefault(); }}
  >
    <DialogHeader className="shrink-0 space-y-2 border-b border-border bg-card px-4 py-3 pr-14 text-left md:px-6 md:py-4 md:pr-14">
      <p className="text-xs font-medium text-foreground-secondary">{recap ? canConfirm && !blocked ? 'Tout est prêt' : 'Récapitulatif' : 'Préparons la suite'}</p>
      <DialogTitle ref={titleRef} tabIndex={-1} className="break-words text-lg">{title}</DialogTitle>
      <DialogDescription className="sr-only">{reason} Relisez les contenus un par un, puis confirmez les envois et les enregistrements.</DialogDescription>
      <div className="flex items-center gap-3" aria-label={`Étape ${stepNumber} sur ${effects.length + 1}`}>
        <div className="flex min-w-0 flex-1 gap-1" aria-hidden="true">{Array.from({ length: effects.length + 1 }, (_, index) => <span key={index} className={cn('h-1.5 flex-1 rounded-full', index === step || (index < effects.length && guidedReviewAcknowledged(effects[index], reviewed)) ? 'bg-brand' : 'bg-muted')} />)}</div>
        <span className="shrink-0 text-xs text-foreground-secondary">{stepNumber}/{effects.length + 1}</span>
      </div>
    </DialogHeader>

    <div ref={bodyRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-background p-4 md:p-6">
      {(error || localError) && <p className="rounded-lg border border-border-strong bg-muted p-3 text-sm leading-relaxed text-foreground" role="alert">{error || localError}</p>}
      {blocked && onReleread && <Button variant="outline" className="min-h-11" disabled={locked} onClick={onReleread}>Relire la version enregistrée</Button>}

      {effect ? <section key={effect.id} aria-label={effect.label} className="overflow-hidden rounded-xl border border-border-strong bg-card duration-150 motion-safe:animate-in motion-safe:fade-in-0">
        <div className="space-y-3 border-b border-border bg-muted p-4">
          <div className="flex items-start gap-3">
            <div className="pt-1"><EffectLogo effect={effect} /></div>
            <h3 ref={stepRef} tabIndex={-1} className="min-w-0 flex-1 break-words text-lg font-semibold leading-snug text-foreground">{effect.label}</h3>
            {effect.editable !== false && <Button variant="ghost" size="sm" className="min-h-11 shrink-0" disabled={locked || blocked} aria-label={`${editing ? 'Voir le contenu' : 'Modifier'} : ${effect.label}`} onClick={() => setEditing(previous => !previous)}>{editing ? 'Aperçu' : 'Modifier'}</Button>}
          </div>
          {effect.kind === 'message' ? <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
            <dt className="text-xs text-foreground-secondary">À</dt><dd className="break-words font-medium text-foreground [overflow-wrap:anywhere]">{effect.recipient}<span className="ml-2 text-xs font-normal text-foreground-secondary">{effect.audience === 'team' ? 'Équipe' : 'Candidat'}</span></dd>
            {effect.service && <><dt className="text-xs text-foreground-secondary">Via</dt><dd className="text-foreground">{SERVICE_LABELS[effect.service]}</dd></>}
            {effect.senderAddress && <><dt className="text-xs text-foreground-secondary">De</dt><dd className="break-words text-foreground [overflow-wrap:anywhere]">{effect.senderAddress}</dd></>}
          </dl> : <p className="break-words text-sm text-foreground-secondary">Dans : <span className="font-medium text-foreground">{effect.destination || 'Fiche candidat'}</span></p>}
          {effect.statusLabel && <p className="text-xs font-medium text-foreground" role="status">{effect.statusLabel}</p>}
        </div>
        <div className="space-y-4 p-4">
          {(effect.subject !== undefined || effect.requiresSubject) && <div className="space-y-2">
            <Label htmlFor={editing ? `${prefix}-subject` : undefined} className="text-xs text-foreground-secondary">Objet</Label>
            {editing ? <Input id={`${prefix}-subject`} className="min-h-11" value={effect.subject ?? ''} disabled={locked || blocked} aria-invalid={effect.requiresSubject && !effect.subject?.trim() || undefined} aria-describedby={!valid ? errorId : undefined} onChange={event => change('subject', event.target.value)} /> : <p className="break-words text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{effect.subject || 'Objet à compléter'}</p>}
          </div>}
          {editing ? <div className="space-y-2">
            <Label htmlFor={`${prefix}-content`}>{effect.kind === 'message' ? 'Message' : 'Contenu'}</Label>
            <Textarea id={`${prefix}-content`} value={effect.content} rows={10} autoFocus disabled={locked || blocked} aria-invalid={!effect.content.trim() || undefined} aria-describedby={!valid ? errorId : undefined} className="leading-relaxed" onChange={event => change('content', event.target.value)} />
          </div> : <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">{effect.content}</p>}
          {!valid && <p id={errorId} className="text-xs text-destructive" role="status">Complétez {effect.requiresSubject ? 'l’objet et le contenu' : 'le contenu'} avant de continuer.</p>}
        </div>
      </section> : <section key="recap" aria-label="Récapitulatif" className="space-y-4 duration-150 motion-safe:animate-in motion-safe:fade-in-0">
        <div className="space-y-1">
          <h3 ref={stepRef} tabIndex={-1} className="text-lg font-semibold text-foreground">Vérifiez, puis lancez les actions</h3>
          <p className="text-sm text-foreground-secondary">{guidedReviewSummary(effects) || 'Aucun contenu à confirmer.'}</p>
        </div>
        <div className="divide-y divide-border rounded-xl border border-border-strong bg-card">{effects.map((item, index) => {
          const acknowledged = guidedReviewAcknowledged(item, reviewed);
          return <div key={item.id} className="flex items-start gap-3 p-4">
            <div className="pt-1"><EffectLogo effect={item} /></div>
            <div className="min-w-0 flex-1 space-y-1">
              <p className="break-words text-sm font-semibold text-foreground">{item.label}</p>
              <p className="break-words text-xs leading-relaxed text-foreground-secondary [overflow-wrap:anywhere]">{item.kind === 'message' ? `${item.audience === 'team' ? 'Équipe' : 'Candidat'} : ${item.recipient}${item.service ? ` · ${SERVICE_LABELS[item.service]}` : ''}` : item.destination || 'Fiche candidat'}</p>
              {item.senderAddress && <p className="break-words text-xs leading-relaxed text-foreground-secondary [overflow-wrap:anywhere]">De : {item.senderAddress}</p>}
              {item.subject && <p className="break-words text-xs leading-relaxed text-foreground [overflow-wrap:anywhere]">Objet : {item.subject}</p>}
              <p className="flex items-center gap-1 text-xs text-foreground">{acknowledged && <Check className="h-3.5 w-3.5" aria-hidden="true" />}{acknowledged ? 'Relu' : 'À relire'}</p>
            </div>
            <Button variant="ghost" size="sm" className="min-h-11 shrink-0" disabled={locked} aria-label={`${item.editable === false ? 'Relire' : 'Modifier'} : ${item.label}`} onClick={() => goTo(index, item.editable !== false)}>{item.editable === false ? 'Relire' : 'Modifier'}</Button>
          </div>;
        })}</div>
        {!canConfirm && effects.length > 0 && <p className="text-xs text-foreground-secondary" role="status">Un contenu a changé. Relisez-le avant de confirmer.</p>}
      </section>}

      {sources && <Collapsible>
        <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="min-h-11 gap-2 px-0">Pourquoi cette proposition ?<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2"><p className="text-sm leading-relaxed text-foreground-secondary">{reason}</p>{sources}</CollapsibleContent>
      </Collapsible>}
      {recap && followUp && <Collapsible>
        <CollapsibleTrigger asChild><Button variant="ghost" size="sm" className="min-h-11 gap-2 px-0">Et ensuite ?<ChevronDown className="h-4 w-4" aria-hidden="true" /></Button></CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 rounded-lg bg-muted p-4"><h4 className="text-sm font-semibold text-foreground">{followUp.title}</h4><p className="text-xs leading-relaxed text-foreground-secondary">Retour attendu : {followUp.waitingFor}</p><p className="text-sm leading-relaxed text-foreground-secondary">{followUp.description}</p></CollapsibleContent>
      </Collapsible>}
    </div>

    <div className="shrink-0 space-y-2 border-t border-border-strong bg-card px-4 py-3 md:px-6">
      <p className="text-xs leading-relaxed text-foreground-secondary" role="status">{recap ? confirmationNote : 'Rien n’est envoyé pendant la relecture.'}</p>
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" className="min-h-11 shrink-0" disabled={locked} onClick={() => step === 0 ? onClose() : goTo(Math.max(step - 1, 0))}>{step === 0 ? 'Annuler' : 'Retour'}</Button>
        {recap ? <Button variant="primary" size="sm" className="ml-auto h-auto min-h-11 whitespace-normal text-center" disabled={locked || blocked || !canConfirm} loading={pending === 'confirm' || busy} onClick={event => { if (event.detail <= 1) void confirm(); }}>{confirmLabel}</Button>
          : <Button variant="primary" size="sm" className="ml-auto h-auto min-h-11 whitespace-normal text-center" disabled={locked || blocked || !valid} loading={pending === 'review' || busy} onClick={event => { if (event.detail <= 1) void reviewStep(); }}>{step === effects.length - 1 ? 'Valider et récapituler' : 'Valider et continuer'}</Button>}
      </div>
      <span className="sr-only" aria-live="polite">{reviewedCount} contenu{reviewedCount > 1 ? 's' : ''} relu{reviewedCount > 1 ? 's' : ''} sur {effects.length}.</span>
    </div>
  </DialogContent>;
}
