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
 * complète avec preview IA). Les autres actions (visite, invitation) sont
 * rendues compactes.
 */

import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import type { SequenceStepPreview, StepConfigOverride } from '@/hooks/useEnrollmentPreview';
import {
  Mail, MessageSquare, Eye, Clock, GitBranch,
  ArrowDown, CheckCheck, XCircle, Pencil, RotateCcw,
  type LucideIcon,
} from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.svg';
import whatsappLogo from '@/assets/whatsapp-logo.svg';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * Wrapper pour utiliser un asset SVG comme une icône Lucide-like
 * (accepte className pour styling).
 */
const makeBrandIcon = (src: string): LucideIcon => {
  const BrandIcon: any = ({ className }: { className?: string }) => (
    <img
      src={src}
      alt=""
      className={`object-contain ${className || ''}`}
      aria-hidden="true"
    />
  );
  BrandIcon.displayName = 'BrandIcon';
  return BrandIcon as LucideIcon;
};

const LinkedInBrand = makeBrandIcon(linkedinLogo);
const WhatsAppBrand = makeBrandIcon(whatsappLogo);

const ACTION_ICONS: Record<string, LucideIcon> = {
  email: Mail,
  message: LinkedInBrand,
  smart_message: LinkedInBrand,
  inmail: LinkedInBrand,
  connection_request: LinkedInBrand,
  whatsapp_message: WhatsAppBrand,
  profile_visit: Eye,
  wait_connection: Clock,
  wait_reply: Clock,
  wait_profile_visit: Clock,
  check_connection: GitBranch,
  condition_branch: GitBranch,
};

const ACTION_LABELS: Record<string, string> = {
  email: 'Email',
  message: 'Message LinkedIn',
  smart_message: 'Smart Message',
  inmail: 'InMail',
  connection_request: 'Invitation LinkedIn',
  whatsapp_message: 'WhatsApp',
  profile_visit: 'Visite de profil',
  wait_connection: 'Attendre acceptation',
  wait_reply: 'Attendre réponse',
  wait_profile_visit: 'Attendre visite',
  check_connection: 'Vérifier connexion',
  condition_branch: 'Condition',
};

const DECISION_TYPES = new Set([
  'wait_connection',
  'wait_reply',
  'wait_profile_visit',
  'check_connection',
  'condition_branch',
]);

const MESSAGE_TYPES = new Set([
  'message', 'inmail', 'smart_message', 'email', 'connection_request', 'whatsapp_message',
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

  const Icon = ACTION_ICONS[step.actionType] || MessageSquare;
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1], delay: index * 0.04 }}
      className="rounded-xl border border-border bg-card overflow-hidden"
    >
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="h-9 w-9 rounded-lg bg-foreground/[0.06] grid place-items-center shrink-0">
          <Icon className="w-4 h-4 text-foreground/70" strokeWidth={2} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-foreground tracking-tight">
            {ACTION_LABELS[step.actionType] || step.actionType}
          </p>
          <p className="text-[10.5px] text-muted-foreground tabular-nums uppercase tracking-wider mt-0.5">
            Étape {step.stepOrder + 1}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ─── DecisionFork — décision + 2 branches côte à côte ────────────────

function DecisionFork({
  step, index, mainStep, fallbackInmailStep, renderStep,
  getStepConfig, setStepConfig,
}: {
  step: SequenceStepPreview;
  index: number;
  mainStep: SequenceStepPreview | null;
  fallbackInmailStep: SequenceStepPreview | null;
  renderStep?: (step: SequenceStepPreview, idx: number) => React.ReactNode;
  getStepConfig?: (stepId: string) => StepConfigOverride | undefined;
  setStepConfig?: (stepId: string, config: StepConfigOverride | null) => void;
}) {
  const Icon = ACTION_ICONS[step.actionType] || GitBranch;
  const label = ACTION_LABELS[step.actionType] || 'Décision';
  const branches = getBranches(step.actionType);
  const description = (() => {
    switch (step.actionType) {
      case 'wait_connection':
        return 'Attend que le candidat accepte la demande de connexion';
      case 'wait_reply':
        return 'Attend une réponse au message précédent';
      case 'wait_profile_visit':
        return 'Attend que le candidat visite ton profil';
      case 'check_connection':
        return 'Vérifie si une connexion existe déjà';
      case 'condition_branch':
        return step.condition || 'Branchement conditionnel';
      default:
        return '';
    }
  })();

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: index * 0.04 }}
      className="relative"
    >
      {/* Diamant DÉCISION (centré, max-w plus serré) */}
      <div className="flex justify-center mb-2">
        <div className="rounded-xl border-2 border-dashed border-brand-purple/40 bg-gradient-to-br from-brand-purple/[0.07] to-brand-pink/[0.04] px-4 py-3 shadow-sm w-full max-w-sm">
          <div className="flex items-start gap-2.5">
            <div className="h-9 w-9 rounded-lg bg-brand-purple/15 grid place-items-center shrink-0 rotate-45 shadow-sm">
              <Icon className="w-3.5 h-3.5 text-brand-purple -rotate-45" strokeWidth={2.5} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="text-[9.5px] uppercase tracking-wider font-bold text-brand-purple">
                  Décision · Étape {step.stepOrder + 1}
                </p>
              </div>
              <p className="text-[13.5px] font-bold text-foreground tracking-tight font-display leading-tight mt-0.5">
                {label}
              </p>
              {description && (
                <p className="text-[11.5px] text-muted-foreground mt-1 leading-snug">
                  {description}
                </p>
              )}
              {step.timeoutDays != null && step.timeoutDays > 0 && (
                <div className="mt-1.5">
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

      {/* Wrapper du fork : layout 2-cols avec connecteurs CSS purs (plus de SVG bizarre).
          La structure : chaque colonne a une "branche" qui démarre par une ligne
          verticale courte + le label pill, puis le contenu. Les 2 colonnes sont
          connectées en haut par un T-fork CSS (border-top + border-l + border-r). */}
      <div className="relative">
        {/* T-fork CSS : ligne horizontale en haut qui relie les 2 colonnes,
            avec petites lignes verticales descendant vers chaque label */}
        <div className="absolute top-0 left-1/4 right-1/4 h-3 pointer-events-none" aria-hidden="true">
          {/* Ligne horizontale qui couvre la largeur entre le centre des 2 colonnes */}
          <div className="absolute top-0 left-0 right-0 h-px bg-brand-purple/40" />
          {/* Verticale gauche (solide) */}
          <div className="absolute top-0 bottom-0 left-0 w-px bg-brand-purple/40" />
          {/* Verticale droite (dashed) */}
          <div
            className="absolute top-0 bottom-0 right-0 w-px"
            style={{ backgroundImage: 'linear-gradient(to bottom, hsl(271 81% 56% / 0.4) 50%, transparent 50%)', backgroundSize: '1px 4px' }}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr] gap-4 lg:gap-6 pt-4 items-start">
          {/* Colonne gauche : branche principale */}
          <div className="min-w-0 space-y-2">
            <BranchHeader label={branches.main.label} variant="primary" />
            {mainStep ? (
              <ActionCard step={mainStep} index={index + 1} renderStep={renderStep} />
            ) : (
              <BranchPlaceholder text="Continue le parcours principal" tone="info" />
            )}
          </div>

          {/* Colonne droite : branche alternative.
              Si fallbackInmailStep existe → on rend le step InMail
              comme une vraie carte (avec preview AI), précédée d'une
              petite annotation expliquant que c'est la branche timeout.
              Sinon → placeholder info contextuelle. */}
          <div className="min-w-0 space-y-2">
            <BranchHeader label={branches.alt.label} variant="secondary" />
            {fallbackInmailStep ? (
              <>
                <FallbackHint />
                <ActionCard
                  step={fallbackInmailStep}
                  index={index + 99}
                  renderStep={renderStep}
                />
              </>
            ) : (
              <BranchPlaceholder
                text={branches.alt.placeholder}
                tone={branches.alt.tone}
              />
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── BranchHeader — label "SI ACCEPTÉ" / "SI TIMEOUT" ────────────────

function BranchHeader({
  label, variant,
}: {
  label: string;
  variant: 'primary' | 'secondary';
}) {
  return (
    <div className="flex justify-center">
      <span className={
        variant === 'primary'
          ? 'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-brand-purple bg-brand-purple/10 border border-brand-purple/40 rounded-full px-2.5 py-1'
          : 'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold text-muted-foreground bg-muted/40 border border-border rounded-full px-2.5 py-1'
      }>
        {variant === 'primary' ? (
          <CheckCheck className="w-3 h-3" strokeWidth={2.5} />
        ) : (
          <XCircle className="w-3 h-3" strokeWidth={2.5} />
        )}
        {label}
      </span>
    </div>
  );
}

// ─── BranchPlaceholder — info "fallback" pour la branche secondaire ──

function BranchPlaceholder({
  text, tone,
}: {
  text: string;
  tone: 'info' | 'muted' | 'success' | 'warning';
}) {
  const colors = {
    info: 'border-info/30 bg-info/5 text-info',
    muted: 'border-border bg-muted/20 text-muted-foreground',
    success: 'border-success/30 bg-success/5 text-success',
    warning: 'border-warning/30 bg-warning/5 text-warning',
  }[tone];
  return (
    <div className={`rounded-xl border border-dashed ${colors} px-3 py-3 text-center`}>
      <p className="text-[11.5px] font-medium leading-snug">
        {text}
      </p>
    </div>
  );
}

// ─── FallbackHint — petit bandeau au-dessus de l'InMail fallback ────
// Indique que ce step n'est utilisé QUE dans le cas timeout.

function FallbackHint() {
  return (
    <div className="rounded-lg bg-warning/5 border border-warning/30 px-2.5 py-1.5">
      <p className="text-[10.5px] text-warning leading-snug">
        ⓘ Utilisé uniquement si le candidat n'accepte pas la connexion dans le délai
      </p>
    </div>
  );
}

// ─── SimpleConnector — flèche entre 2 actions consécutives ───────────
// Le label "+5j 2h" est cliquable → ouvre un popover pour éditer le délai
// AVANT le step suivant, juste pour cette inscription. L'override est
// stocké côté hook (puis tracking_data sur sequence_enrollments) — pas
// de mutation du template séquence.

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

  const formatDelay = (d: number, h: number): string => {
    if (!d && !h) return 'immédiat';
    const parts: string[] = [];
    if (d) parts.push(`${d}j`);
    if (h) parts.push(`${h}h`);
    return `+${parts.join(' ')}`;
  };

  return (
    <div className="flex items-center justify-center py-1 gap-2 -my-1">
      <div className="flex-1 h-px bg-border/40" />
      <ArrowDown className="w-3.5 h-3.5 text-muted-foreground/60" strokeWidth={2} />
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
            <button
              type="button"
              className={cn(
                'inline-flex items-center gap-1 text-[10px] tabular-nums px-1.5 py-0.5 rounded-full border transition-colors',
                isOverridden
                  ? 'bg-brand-purple/10 text-brand-purple border-brand-purple/30 font-semibold'
                  : 'bg-muted/40 text-muted-foreground border-transparent hover:bg-muted hover:border-border hover:text-foreground'
              )}
              title={isOverridden ? `Délai modifié pour cette inscription (défaut : ${formatDelay(delayDays ?? 0, delayHours ?? 0)})` : 'Modifier le délai pour cette inscription'}
            >
              {formatDelay(effDays, effHours)}
              <Pencil className="w-2.5 h-2.5 opacity-60" />
            </button>
          </DelayEditor>
        ) : (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {formatDelay(effDays, effHours)}
          </span>
        )
      )}
      <div className="flex-1 h-px bg-border/40" />
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

  const formatDelay = (d: number, h: number): string => {
    if (!d && !h) return 'démarre immédiatement';
    const parts: string[] = [];
    if (d) parts.push(`${d}j`);
    if (h) parts.push(`${h}h`);
    return `démarre dans ${parts.join(' ')}`;
  };

  if (!onChange) {
    // Pas d'éditeur → simple texte
    return (
      <p className="text-[10.5px] uppercase tracking-wider text-muted-foreground text-center mb-1">
        {formatDelay(effDays, effHours)}
      </p>
    );
  }

  return (
    <div className="flex justify-center mb-1">
      <DelayEditor
        stepId={stepId}
        currentDays={effDays}
        currentHours={effHours}
        defaultDays={delayDays ?? 0}
        defaultHours={delayHours ?? 0}
        isOverridden={isOverridden}
        onChange={onChange}
        title="Délai avant le premier step"
      >
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-semibold px-2.5 py-1 rounded-full border transition-colors',
            isOverridden
              ? 'bg-brand-purple/10 text-brand-purple border-brand-purple/40'
              : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground'
          )}
        >
          <Clock className="w-2.5 h-2.5" strokeWidth={2.5} />
          {formatDelay(effDays, effHours)}
          <Pencil className="w-2.5 h-2.5 opacity-60" />
        </button>
      </DelayEditor>
    </div>
  );
}

// ─── DelayEditor — popover pour éditer days + hours ──────────────────

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
      <PopoverContent
        className="w-72 p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
            {title || 'Délai avant ce step'}
          </p>
          <p className="text-[11.5px] text-muted-foreground leading-snug">
            Modifie le délai pour <span className="font-semibold text-foreground">cette inscription uniquement</span>. Le template de la séquence n'est pas modifié.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80 block mb-1">
              Jours
            </label>
            <input
              type="number"
              min={0}
              max={90}
              value={days}
              onChange={e => setDays(Math.max(0, Math.min(90, Number(e.target.value) || 0)))}
              className="w-full h-9 px-2.5 text-[13px] font-semibold tabular-nums bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30"
            />
          </div>
          <div>
            <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80 block mb-1">
              Heures
            </label>
            <input
              type="number"
              min={0}
              max={23}
              value={hours}
              onChange={e => setHours(Math.max(0, Math.min(23, Number(e.target.value) || 0)))}
              className="w-full h-9 px-2.5 text-[13px] font-semibold tabular-nums bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30"
            />
          </div>
        </div>

        {isOverridden && (
          <div className="text-[10.5px] text-muted-foreground bg-muted/30 rounded-md px-2.5 py-1.5">
            Défaut séquence : <span className="font-semibold tabular-nums">{defaultDays}j {defaultHours}h</span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {isOverridden && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted"
              title="Revenir au délai du template"
            >
              <RotateCcw className="w-3 h-3" />
              Réinitialiser
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="text-[11px] font-semibold bg-foreground text-background px-3 py-1.5 rounded-md hover:bg-foreground/90 transition-colors"
          >
            Appliquer
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── TimeoutEditor — popover pour éditer le timeout des steps wait_* ─

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

  if (!onChange) {
    return (
      <p className="text-[10px] text-warning inline-flex items-center gap-1">
        <Clock className="w-2.5 h-2.5" />
        Timeout après {effTimeout} jour{effTimeout > 1 ? 's' : ''}
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
      <button
        type="button"
        className={cn(
          'inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border transition-colors',
          isOverridden
            ? 'bg-brand-purple/10 text-brand-purple border-brand-purple/30 font-semibold'
            : 'bg-warning/10 text-warning border-warning/30 hover:bg-warning/15'
        )}
        title={isOverridden ? `Timeout modifié (défaut : ${timeoutDays}j)` : 'Modifier le timeout'}
      >
        <Clock className="w-2.5 h-2.5" />
        Timeout : {effTimeout} jour{effTimeout > 1 ? 's' : ''}
        <Pencil className="w-2.5 h-2.5 opacity-60" />
      </button>
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
      <PopoverContent
        className="w-72 p-4 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1">
            Timeout
          </p>
          <p className="text-[11.5px] text-muted-foreground leading-snug">
            Nombre de jours d'attente avant de basculer sur la branche alternative (ex : InMail si l'invitation n'est pas acceptée).
          </p>
        </div>

        <div>
          <label className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80 block mb-1">
            Jours d'attente
          </label>
          <input
            type="number"
            min={1}
            max={90}
            value={days}
            onChange={e => setDays(Math.max(1, Math.min(90, Number(e.target.value) || 1)))}
            className="w-full h-9 px-2.5 text-[13px] font-semibold tabular-nums bg-background border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-foreground/10 focus:border-foreground/30"
          />
        </div>

        {isOverridden && (
          <div className="text-[10.5px] text-muted-foreground bg-muted/30 rounded-md px-2.5 py-1.5">
            Défaut séquence : <span className="font-semibold tabular-nums">{defaultDays} jour{defaultDays > 1 ? 's' : ''}</span>
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {isOverridden && (
            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2 py-1.5 rounded-md hover:bg-muted"
            >
              <RotateCcw className="w-3 h-3" />
              Réinitialiser
            </button>
          )}
          <div className="flex-1" />
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5"
          >
            Annuler
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="text-[11px] font-semibold bg-foreground text-background px-3 py-1.5 rounded-md hover:bg-foreground/90 transition-colors"
          >
            Appliquer
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Helpers : labels des branches selon le type de décision ────────

function getBranches(actionType: string): {
  main: { label: string };
  alt: { label: string; placeholder: string; tone: 'info' | 'muted' | 'success' | 'warning' };
} {
  switch (actionType) {
    case 'wait_connection':
      return {
        main: { label: 'si accepté' },
        alt: {
          label: 'si timeout',
          placeholder: 'Si le candidat n\'accepte pas, la séquence passe à l\'InMail de fallback.',
          tone: 'warning',
        },
      };
    case 'wait_reply':
      return {
        main: { label: 'pas de réponse' },
        alt: {
          label: 'si réponse',
          placeholder: 'Le candidat a répondu : la séquence s\'arrête, conversation ouverte.',
          tone: 'success',
        },
      };
    case 'wait_profile_visit':
      return {
        main: { label: 'si visite' },
        alt: {
          label: 'sinon',
          placeholder: 'Si le candidat ne visite pas, la séquence continue normalement.',
          tone: 'muted',
        },
      };
    case 'check_connection':
      return {
        main: { label: 'connecté' },
        alt: {
          label: 'pas connecté',
          placeholder: 'Si pas connecté, le step suivant est skippé ou l\'InMail est utilisé.',
          tone: 'info',
        },
      };
    case 'condition_branch':
      return {
        main: { label: 'oui' },
        alt: {
          label: 'non',
          placeholder: 'Branche alternative non définie dans cette séquence.',
          tone: 'muted',
        },
      };
    default:
      return {
        main: { label: 'oui' },
        alt: { label: 'non', placeholder: '—', tone: 'muted' },
      };
  }
}
