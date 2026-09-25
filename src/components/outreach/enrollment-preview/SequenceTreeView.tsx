/**
 * SequenceTreeView — visualisation arborescente d'une séquence outreach.
 *
 * Pour chaque décision (wait_connection, wait_reply, check_connection,
 * condition_branch), on rend un VRAI fork à 2 branches :
 *   - Branche principale (à gauche) : le step suivant en ordre linéaire
 *   - Branche alternative (à droite) : info contextuelle sur ce qui se
 *     passe dans l'autre cas (timeout / réponse reçue / etc.)
 *
 * Les actions message sont rendues via renderStep callback (= MessageStepCard
 * complète avec preview AI). Les autres actions (visite, invitation) sont
 * rendues compactes.
 *
 * Libellés et icônes des étapes : catalogue commun (`sequenceCatalog`,
 * `SequenceBadges`). Aucune couleur de canal sur une étape ni une décision :
 * les décisions sont neutres, à filet pointillé (revue design D-48, D-49).
 */

import React, { useId, useMemo, useState } from 'react';
import type { SequenceStepPreview, StepConfigOverride } from '@/hooks/useEnrollmentPreview';
import { ArrowDown, Clock, CornerDownRight, Info, Pencil, RotateCcw } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { SequenceActionIcon, SequenceActionLabel } from '@/components/outreach/SequenceBadges';
import { sequenceActionLabel, formatStepDelay } from '@/lib/sequenceCatalog';
import { cn } from '@/lib/utils';

const DECISION_TYPES = new Set([
  'wait_connection',
  'wait_reply',
  'wait_profile_visit',
  'check_connection',
  'condition_branch',
]);

interface Props {
  steps: SequenceStepPreview[];
  renderStep?: (step: SequenceStepPreview, idx: number) => React.ReactNode;
  /** Lit l'override de timing pour un step (s'il existe). Si non fourni,
   *  les valeurs par défaut du template sont utilisées. */
  getStepConfig?: (stepId: string) => StepConfigOverride | undefined;
  /** Persist un override de timing pour un step (passer null pour reset). */
  setStepConfig?: (stepId: string, config: StepConfigOverride | null) => void;
}

function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n > 1 ? pluralForm : singular}`;
}

export function SequenceTreeView({ steps, renderStep, getStepConfig, setStepConfig }: Props) {
  const sortedSteps = useMemo(
    () => [...steps].sort((a, b) => a.stepOrder - b.stepOrder),
    [steps],
  );

  // Trouve le step InMail final (souvent fallback de la branche timeout
  // d'un wait_connection). On le détache du flux principal pour le placer
  // dans la branche droite du fork.
  const fallbackInmailIdx = useMemo(() => {
    const hasWaitConnection = sortedSteps.some(s => s.actionType === 'wait_connection');
    if (!hasWaitConnection) return -1;
    for (let i = sortedSteps.length - 1; i >= 0; i--) {
      if (sortedSteps[i].actionType === 'inmail') return i;
    }
    return -1;
  }, [sortedSteps]);

  // Construit la liste de "consumed" : steps déjà affichés dans une fork
  // (ne pas re-render dans le flux principal).
  const consumed = new Set<string>();
  if (fallbackInmailIdx >= 0) {
    consumed.add(sortedSteps[fallbackInmailIdx].stepId);
  }

  // Render items
  const items: React.ReactNode[] = [];

  // Délai initial AVANT le 1er step : si l'user veut décaler le démarrage
  // de la séquence, c'est ICI qu'il édite (pas dans un connecteur entre
  // 2 steps puisqu'il n'y a pas de step précédent).
  if (sortedSteps.length > 0) {
    const firstStep = sortedSteps[0];
    const firstHasDelay = (firstStep.delayDays || 0) > 0 || (firstStep.delayHours || 0) > 0;
    const firstHasOverride = !!getStepConfig?.(firstStep.stepId);
    if (firstHasDelay || firstHasOverride || setStepConfig) {
      items.push(
        <InitialDelayChip
          key="initial-delay"
          stepId={firstStep.stepId}
          delayDays={firstStep.delayDays}
          delayHours={firstStep.delayHours}
          override={getStepConfig?.(firstStep.stepId)}
          onChange={setStepConfig}
        />
      );
    }
  }

  for (let idx = 0; idx < sortedSteps.length; idx++) {
    const step = sortedSteps[idx];
    if (consumed.has(step.stepId)) continue;

    const isDecision = DECISION_TYPES.has(step.actionType);
    const next = sortedSteps[idx + 1];
    const nextNext = sortedSteps[idx + 2];

    if (isDecision) {
      // Trouve le step "main path" (next step non-décision)
      // ET le step "alt path" (pour wait_connection : le fallback InMail)
      const mainStep = next && !DECISION_TYPES.has(next.actionType) ? next : null;
      const fallbackStep =
        step.actionType === 'wait_connection' && fallbackInmailIdx > idx
          ? sortedSteps[fallbackInmailIdx]
          : null;

      // Marque le mainStep comme consommé (rendu dans la fork)
      if (mainStep) consumed.add(mainStep.stepId);

      items.push(
        <DecisionFork
          key={step.stepId}
          step={step}
          index={idx}
          mainStep={mainStep}
          fallbackInmailStep={fallbackStep}
          fallbackIndex={fallbackInmailIdx}
          renderStep={renderStep}
          getStepConfig={getStepConfig}
          setStepConfig={setStepConfig}
        />
      );

      // Connector vers la suite (si encore des steps après le mainStep).
      // Le délai éditable porte sur nextNext (= step après le mainStep).
      if (mainStep && nextNext) {
        items.push(
          <SimpleConnector
            key={`conn-after-fork-${step.stepId}`}
            stepId={nextNext.stepId}
            delayDays={nextNext.delayDays}
            delayHours={nextNext.delayHours}
            override={getStepConfig?.(nextNext.stepId)}
            onChange={setStepConfig}
          />
        );
      }
      continue;
    }

    items.push(
      <ActionCard
        key={step.stepId}
        step={step}
        index={idx}
        renderStep={renderStep}
      />
    );

    // Connector vers le step suivant si pas la fin et le suivant n'est pas une décision
    // (les décisions ont leur propre fork qui inclut son propre connector).
    // Le délai éditable porte sur le NEXT step (= ce qu'on attend avant qu'il fire).
    if (next && !DECISION_TYPES.has(next.actionType) && !consumed.has(next.stepId)) {
      items.push(
        <SimpleConnector
          key={`conn-${step.stepId}`}
          stepId={next.stepId}
          delayDays={next.delayDays}
          delayHours={next.delayHours}
          override={getStepConfig?.(next.stepId)}
          onChange={setStepConfig}
        />
      );
    }
  }

  return <div className="space-y-2">{items}</div>;
}

// ─── Numéro d'une étape, le même sur toutes les cartes ─────────────────

export function StepNumber({ index }: { index: number }) {
  return (
    <span
      className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-muted px-1 text-3xs font-semibold tabular-nums text-muted-foreground"
      aria-hidden="true"
    >
      {index + 1}
    </span>
  );
}

// ─── ActionCard (rendu d'un step action — message, visite, invitation) ──

function ActionCard({
  step, index, renderStep,
}: {
  step: SequenceStepPreview;
  index: number;
  renderStep?: (step: SequenceStepPreview, idx: number) => React.ReactNode;
}) {
  const custom = renderStep?.(step, index);
  if (custom !== null && custom !== undefined && custom !== false) {
    return <>{custom}</>;
  }

  return (
    <div className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-4 py-3">
      <StepNumber index={index} />
      <span className="sr-only">Étape {index + 1} : </span>
      <SequenceActionLabel type={step.actionType} className="text-sm font-medium text-foreground" />
    </div>
  );
}

// ─── DecisionFork — décision + 2 branches côte à côte ────────────────

function DecisionFork({
  step, index, mainStep, fallbackInmailStep, fallbackIndex, renderStep,
  getStepConfig, setStepConfig,
}: {
  step: SequenceStepPreview;
  index: number;
  mainStep: SequenceStepPreview | null;
  fallbackInmailStep: SequenceStepPreview | null;
  fallbackIndex: number;
  renderStep?: (step: SequenceStepPreview, idx: number) => React.ReactNode;
  getStepConfig?: (stepId: string) => StepConfigOverride | undefined;
  setStepConfig?: (stepId: string, config: StepConfigOverride | null) => void;
}) {
  const branches = getBranches(step.actionType);
  const description = (() => {
    switch (step.actionType) {
      case 'wait_connection':
        return "Attend que le candidat accepte l'invitation.";
      case 'wait_reply':
        return 'Attend une réponse au message précédent.';
      case 'wait_profile_visit':
        return 'Attend que le candidat visite votre profil.';
      case 'check_connection':
        return 'Vérifie si vous êtes déjà en relation avec le candidat.';
      case 'condition_branch':
        return 'Poursuit selon la condition définie dans la séquence.';
      default:
        return '';
    }
  })();

  return (
    <div className="relative">
      {/* Décision : neutre, filet pointillé */}
      <div className="mb-2 flex justify-center">
        <div className="w-full max-w-sm rounded-xl border border-dashed border-border-strong bg-card px-4 py-3">
          <div className="flex items-start gap-3">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
              <SequenceActionIcon type={step.actionType} className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-xs tabular-nums text-muted-foreground">Étape {index + 1} · décision</p>
              <p className="text-sm font-semibold leading-snug text-foreground">
                {sequenceActionLabel(step.actionType)}
              </p>
              {description && (
                <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
              )}
              {step.timeoutDays != null && step.timeoutDays > 0 && (
                <div className="mt-2">
                  <TimeoutEditor
                    stepId={step.stepId}
                    timeoutDays={step.timeoutDays}
                    override={getStepConfig?.(step.stepId)}
                    onChange={setStepConfig}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Deux branches côte à côte sur grand écran, l'une sous l'autre sinon.
          Le T de liaison n'a de sens qu'avec les deux colonnes. */}
      <div className="relative">
        <div className="pointer-events-none absolute left-1/4 right-1/4 top-0 hidden h-3 lg:block" aria-hidden="true">
          <div className="absolute left-0 right-0 top-0 h-px bg-border-strong" />
          <div className="absolute bottom-0 left-0 top-0 w-px bg-border-strong" />
          <div className="absolute bottom-0 right-0 top-0 border-l border-dashed border-border-strong" />
        </div>

        <div className="grid grid-cols-1 items-start gap-4 pt-4 lg:grid-cols-2 lg:gap-6">
          {/* Colonne gauche : branche principale */}
          <div className="min-w-0 space-y-2">
            <BranchHeader label={branches.main.label} />
            {mainStep ? (
              <ActionCard step={mainStep} index={index + 1} renderStep={renderStep} />
            ) : (
              <BranchPlaceholder text="Le parcours principal continue." />
            )}
          </div>

          {/* Colonne droite : branche alternative.
              Si fallbackInmailStep existe → on rend le step InMail
              comme une vraie carte (avec preview AI), précédée d'une
              petite annotation expliquant que c'est la branche timeout.
              Sinon → placeholder info contextuelle. */}
          <div className="min-w-0 space-y-2">
            <BranchHeader label={branches.alt.label} alternative />
            {fallbackInmailStep ? (
              <>
                <FallbackHint />
                <ActionCard step={fallbackInmailStep} index={fallbackIndex} renderStep={renderStep} />
              </>
            ) : (
              <BranchPlaceholder text={branches.alt.placeholder} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── BranchHeader — « Si l'invitation est acceptée », « Sinon »… ────────

function BranchHeader({ label, alternative = false }: { label: string; alternative?: boolean }) {
  return (
    <div className="flex justify-center">
      <span
        className={cn(
          'inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs font-medium',
          alternative ? 'text-muted-foreground' : 'bg-card text-foreground',
        )}
      >
        <CornerDownRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
        {label}
      </span>
    </div>
  );
}

// ─── BranchPlaceholder — ce qui se passe dans l'autre cas ──────────────

function BranchPlaceholder({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-3 py-3 text-center">
      <p className="text-xs leading-snug text-muted-foreground">{text}</p>
    </div>
  );
}

// ─── FallbackHint — l'InMail de secours ne part que dans ce cas ────────

function FallbackHint() {
  return (
    <p className="flex items-start gap-1.5 px-1 text-xs leading-snug text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      Envoyé seulement si le candidat n'accepte pas l'invitation dans le délai.
    </p>
  );
}

// ─── SimpleConnector — flèche entre 2 actions consécutives ───────────
// Le délai « +5 j 2 h » s'ouvre en fenêtre pour être modifié avant l'étape
// suivante, pour cette inscription seulement. L'override est stocké côté
// hook (puis tracking_data sur sequence_enrollments) : la séquence n'est
// pas modifiée.

function SimpleConnector({
  stepId, delayDays, delayHours, override, onChange,
}: {
  stepId?: string;
  delayDays?: number;
  delayHours?: number;
  override?: StepConfigOverride;
  onChange?: (stepId: string, config: StepConfigOverride | null) => void;
}) {
  // Valeurs effectives = override si défini, sinon défaut du template.
  const effDays = override?.delayDays ?? delayDays ?? 0;
  const effHours = override?.delayHours ?? delayHours ?? 0;
  const isOverridden =
    override !== undefined &&
    (override.delayDays !== undefined || override.delayHours !== undefined);

  const hasDelay = effDays > 0 || effHours > 0;
  const editable = !!stepId && !!onChange;
  const text = hasDelay ? `+${formatStepDelay(effDays, effHours)}` : 'Sans délai';

  return (
    <div className="-my-1 flex items-center justify-center gap-2 py-1">
      <div className="h-px flex-1 bg-border" />
      <ArrowDown className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      {(hasDelay || editable) && (
        editable ? (
          <DelayEditor
            stepId={stepId!}
            currentDays={effDays}
            currentHours={effHours}
            defaultDays={delayDays ?? 0}
            defaultHours={delayHours ?? 0}
            isOverridden={isOverridden}
            onChange={onChange!}
          >
            <Button
              type="button"
              variant="ghost"
              size="xs"
              aria-label={`Délai avant l'étape suivante : ${text}${isOverridden ? ' (modifié)' : ''}. Modifier pour cette inscription`}
              className={cn('gap-1 px-2 tabular-nums max-md:h-11', isOverridden ? 'text-brand' : 'text-muted-foreground')}
            >
              {text}
              {isOverridden && <span className="font-normal">(modifié)</span>}
              <Pencil className="!size-3" aria-hidden="true" />
            </Button>
          </DelayEditor>
        ) : (
          <span className="text-xs tabular-nums text-muted-foreground">{text}</span>
        )
      )}
      <div className="h-px flex-1 bg-border" />
    </div>
  );
}

// ─── InitialDelayChip — délai avant le 1er step (démarrage séquence) ─

function InitialDelayChip({
  stepId, delayDays, delayHours, override, onChange,
}: {
  stepId: string;
  delayDays?: number;
  delayHours?: number;
  override?: StepConfigOverride;
  onChange?: (stepId: string, config: StepConfigOverride | null) => void;
}) {
  const effDays = override?.delayDays ?? delayDays ?? 0;
  const effHours = override?.delayHours ?? delayHours ?? 0;
  const isOverridden =
    override !== undefined &&
    (override.delayDays !== undefined || override.delayHours !== undefined);

  const text = effDays || effHours ? `Démarre dans ${formatStepDelay(effDays, effHours)}` : 'Démarre dès l\'inscription';

  if (!onChange) {
    // Pas d'éditeur → simple texte
    return <p className="mb-1 text-center text-xs text-muted-foreground">{text}</p>;
  }

  return (
    <div className="mb-1 flex justify-center">
      <DelayEditor
        stepId={stepId}
        currentDays={effDays}
        currentHours={effHours}
        defaultDays={delayDays ?? 0}
        defaultHours={delayHours ?? 0}
        isOverridden={isOverridden}
        onChange={onChange}
        title="Délai avant la première étape"
      >
        <Button
          type="button"
          variant="outline"
          size="xs"
          aria-label={`${text}${isOverridden ? ' (modifié)' : ''}. Modifier pour cette inscription`}
          className={cn('gap-1.5 max-md:h-11', isOverridden ? 'text-brand' : 'text-muted-foreground')}
        >
          <Clock className="!size-3" aria-hidden="true" />
          {text}
          {isOverridden && <span className="font-normal">(modifié)</span>}
          <Pencil className="!size-3" aria-hidden="true" />
        </Button>
      </DelayEditor>
    </div>
  );
}

// ─── DelayEditor — fenêtre pour modifier jours et heures ──────────────

function DelayEditor({
  stepId, currentDays, currentHours, defaultDays, defaultHours,
  isOverridden, onChange, children, title,
}: {
  stepId: string;
  currentDays: number;
  currentHours: number;
  defaultDays: number;
  defaultHours: number;
  isOverridden: boolean;
  onChange: (stepId: string, config: StepConfigOverride | null) => void;
  children: React.ReactNode;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(currentDays);
  const [hours, setHours] = useState(currentHours);
  const fieldId = useId();

  // Quand le popover s'ouvre, on resync les valeurs locales avec le state
  // courant (au cas où l'override aurait été modifié ailleurs entre-temps).
  React.useEffect(() => {
    if (open) {
      setDays(currentDays);
      setHours(currentHours);
    }
  }, [open, currentDays, currentHours]);

  const handleSave = () => {
    // Si l'user a remis les valeurs par défaut → on retire l'override
    if (days === defaultDays && hours === defaultHours) {
      onChange(stepId, null);
    } else {
      onChange(stepId, { delayDays: days, delayHours: hours });
    }
    setOpen(false);
  };

  const handleReset = () => {
    onChange(stepId, null);
    setDays(defaultDays);
    setHours(defaultHours);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">{title || 'Délai avant cette étape'}</p>
          <p className="text-xs leading-snug text-muted-foreground">
            Modifiez le délai pour cette inscription uniquement. La séquence n'est pas modifiée.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-jours`} className="text-xs">Jours</Label>
            <Input
              id={`${fieldId}-jours`}
              type="number"
              min={0}
              max={90}
              value={days}
              onChange={e => setDays(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
              className="tabular-nums"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${fieldId}-heures`} className="text-xs">Heures</Label>
            <Input
              id={`${fieldId}-heures`}
              type="number"
              min={0}
              max={23}
              value={hours}
              onChange={e => setHours(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
              className="tabular-nums"
            />
          </div>
        </div>

        {isOverridden && (
          <p className="text-xs text-muted-foreground">
            Délai prévu par la séquence : <span className="font-medium tabular-nums text-foreground">{formatStepDelay(defaultDays, defaultHours) || 'aucun'}</span>
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {isOverridden && (
            <Button type="button" variant="ghost" size="xs" onClick={handleReset}>
              <RotateCcw className="!size-3.5" aria-hidden="true" />
              Réinitialiser
            </Button>
          )}
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={handleSave}>
            Appliquer
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── TimeoutEditor — délai maximal d'une attente (wait_*) ──────────────

function TimeoutEditor({
  stepId, timeoutDays, override, onChange,
}: {
  stepId: string;
  timeoutDays: number;
  override?: StepConfigOverride;
  onChange?: (stepId: string, config: StepConfigOverride | null) => void;
}) {
  const effTimeout = override?.timeoutDays ?? timeoutDays;
  const isOverridden = override?.timeoutDays !== undefined;
  const text = `Délai maximal : ${plural(effTimeout, 'jour')}`;

  if (!onChange) {
    return (
      <p className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" aria-hidden="true" />
        {text}
      </p>
    );
  }

  return (
    <TimeoutEditorPopover
      stepId={stepId}
      currentDays={effTimeout}
      defaultDays={timeoutDays}
      isOverridden={isOverridden}
      onChange={onChange}
    >
      <Button
        type="button"
        variant="outline"
        size="xs"
        aria-label={`${text}${isOverridden ? ' (modifié)' : ''}. Modifier pour cette inscription`}
        className={cn('gap-1.5 max-md:h-11', isOverridden ? 'text-brand' : 'text-muted-foreground')}
      >
        <Clock className="!size-3" aria-hidden="true" />
        {text}
        {isOverridden && <span className="font-normal">(modifié)</span>}
        <Pencil className="!size-3" aria-hidden="true" />
      </Button>
    </TimeoutEditorPopover>
  );
}

function TimeoutEditorPopover({
  stepId, currentDays, defaultDays, isOverridden, onChange, children,
}: {
  stepId: string;
  currentDays: number;
  defaultDays: number;
  isOverridden: boolean;
  onChange: (stepId: string, config: StepConfigOverride | null) => void;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(currentDays);
  const fieldId = useId();

  React.useEffect(() => {
    if (open) setDays(currentDays);
  }, [open, currentDays]);

  const handleSave = () => {
    if (days === defaultDays) {
      // Reset à défaut
      onChange(stepId, null);
    } else {
      onChange(stepId, { timeoutDays: days });
    }
    setOpen(false);
  };

  const handleReset = () => {
    onChange(stepId, null);
    setDays(defaultDays);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild onClick={(e) => e.stopPropagation()}>
        {children}
      </PopoverTrigger>
      <PopoverContent className="w-72 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">Délai maximal</p>
          <p className="text-xs leading-snug text-muted-foreground">
            Nombre de jours d'attente avant de passer à la branche alternative (par exemple l'InMail si l'invitation n'est pas acceptée).
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={`${fieldId}-attente`} className="text-xs">Jours d'attente</Label>
          <Input
            id={`${fieldId}-attente`}
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={e => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
            className="tabular-nums"
          />
        </div>

        {isOverridden && (
          <p className="text-xs text-muted-foreground">
            Délai prévu par la séquence : <span className="font-medium tabular-nums text-foreground">{plural(defaultDays, 'jour')}</span>
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {isOverridden && (
            <Button type="button" variant="ghost" size="xs" onClick={handleReset}>
              <RotateCcw className="!size-3.5" aria-hidden="true" />
              Réinitialiser
            </Button>
          )}
          <div className="flex-1" />
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            Annuler
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={handleSave}>
            Appliquer
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Helpers : libellés des branches selon le type de décision ────────

function getBranches(actionType: string): {
  main: { label: string };
  alt: { label: string; placeholder: string };
} {
  switch (actionType) {
    case 'wait_connection':
      return {
        main: { label: "Si l'invitation est acceptée" },
        alt: {
          label: 'Sans acceptation dans le délai',
          placeholder: "Si le candidat n'accepte pas, la séquence passe à l'InMail de secours.",
        },
      };
    case 'wait_reply':
      return {
        main: { label: 'Sans réponse' },
        alt: {
          label: 'En cas de réponse',
          placeholder: 'Le candidat a répondu : la séquence s\'arrête et la conversation reste ouverte.',
        },
      };
    case 'wait_profile_visit':
      return {
        main: { label: 'Si le candidat visite votre profil' },
        alt: {
          label: 'Sinon',
          placeholder: 'Sans visite, la séquence continue normalement.',
        },
      };
    case 'check_connection':
      return {
        main: { label: 'Déjà en relation' },
        alt: {
          label: 'Pas encore en relation',
          placeholder: "Sans relation, l'étape suivante est ignorée ou l'InMail prend le relais.",
        },
      };
    case 'condition_branch':
      return {
        main: { label: 'Si la condition est remplie' },
        alt: {
          label: 'Sinon',
          placeholder: 'Aucune suite définie pour ce cas dans la séquence.',
        },
      };
    default:
      return {
        main: { label: 'Si la condition est remplie' },
        alt: { label: 'Sinon', placeholder: 'Aucune suite définie pour ce cas dans la séquence.' },
      };
  }
}
