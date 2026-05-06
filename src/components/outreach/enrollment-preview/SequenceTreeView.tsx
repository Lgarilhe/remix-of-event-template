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

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import type { SequenceStepPreview } from '@/hooks/useEnrollmentPreview';
import {
  Mail, MessageSquare, Linkedin, Eye, Clock, GitBranch,
  ArrowDown, CheckCheck, XCircle, Send, type LucideIcon,
} from 'lucide-react';

const ACTION_ICONS: Record<string, LucideIcon> = {
  email: Mail,
  message: MessageSquare,
  smart_message: MessageSquare,
  inmail: Linkedin,
  connection_request: Linkedin,
  whatsapp_message: MessageSquare,
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
}

export function SequenceTreeView({ steps, renderStep }: Props) {
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
        />
      );

      // Connector vers la suite (si encore des steps après le mainStep)
      if (mainStep && nextNext) {
        items.push(
          <SimpleConnector
            key={`conn-after-fork-${step.stepId}`}
            delayDays={nextNext.delayDays}
            delayHours={nextNext.delayHours}
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
    // (les décisions ont leur propre fork qui inclut son propre connector)
    if (next && !DECISION_TYPES.has(next.actionType) && !consumed.has(next.stepId)) {
      items.push(
        <SimpleConnector
          key={`conn-${step.stepId}`}
          delayDays={next.delayDays}
          delayHours={next.delayHours}
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
}: {
  step: SequenceStepPreview;
  index: number;
  mainStep: SequenceStepPreview | null;
  fallbackInmailStep: SequenceStepPreview | null;
  renderStep?: (step: SequenceStepPreview, idx: number) => React.ReactNode;
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
              {step.timeoutDays && (
                <p className="text-[10px] text-warning mt-1.5 inline-flex items-center gap-1">
                  <Clock className="w-2.5 h-2.5" />
                  Timeout après {step.timeoutDays} jour{step.timeoutDays > 1 ? 's' : ''}
                </p>
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

          {/* Colonne droite : branche alternative */}
          <div className="min-w-0 space-y-2">
            <BranchHeader label={branches.alt.label} variant="secondary" />
            {fallbackInmailStep ? (
              <FallbackInmailCard step={fallbackInmailStep} />
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

// ─── FallbackInmailCard — card spéciale pour l'InMail de fallback ────

function FallbackInmailCard({ step }: { step: SequenceStepPreview }) {
  return (
    <div className="rounded-xl border border-warning/30 bg-warning/5 px-4 py-3">
      <div className="flex items-center gap-2 mb-1.5">
        <div className="h-7 w-7 rounded-lg bg-warning/15 grid place-items-center shrink-0">
          <Send className="w-3.5 h-3.5 text-warning" strokeWidth={2.25} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-bold text-warning">
            Fallback InMail
          </p>
          <p className="text-[12px] font-semibold text-foreground tracking-tight">
            Étape {step.stepOrder + 1}
          </p>
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground leading-snug">
        Si le candidat n'accepte pas la connexion dans le délai, on bascule sur un InMail Recruiter.
      </p>
    </div>
  );
}

// ─── SimpleConnector — flèche entre 2 actions consécutives ───────────

function SimpleConnector({
  delayDays, delayHours,
}: {
  delayDays?: number;
  delayHours?: number;
}) {
  const delayText = (() => {
    if (!delayDays && !delayHours) return null;
    const parts = [];
    if (delayDays) parts.push(`${delayDays}j`);
    if (delayHours) parts.push(`${delayHours}h`);
    return `+${parts.join(' ')}`;
  })();

  return (
    <div className="flex items-center justify-center py-1 gap-2 -my-1">
      <div className="flex-1 h-px bg-border/40" />
      <ArrowDown className="w-3.5 h-3.5 text-muted-foreground/60" strokeWidth={2} />
      {delayText && (
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {delayText}
        </span>
      )}
      <div className="flex-1 h-px bg-border/40" />
    </div>
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
