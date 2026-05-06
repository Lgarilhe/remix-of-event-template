/**
 * SequenceTreeView — visualisation arborescente d'une séquence outreach.
 *
 * Gère 2 cas :
 *  1. Séquences LINÉAIRES : timeline verticale avec décisions stylées
 *     (wait_connection, wait_reply, check_connection, condition_branch)
 *     rendues comme des "diamants" entre les actions.
 *  2. Séquences BRANCHÉES (parent_step_id + branch='yes'/'no'/'timeout') :
 *     vraie arbo avec splits horizontaux et labels OUI/NON.
 *
 * Pour le moment l'app traite les séquences en linéaire (pas de
 * parent_step_id en DB), mais on visualise quand même les décisions
 * implicites pour donner du sens au parcours.
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import type { SequenceStepPreview } from '@/hooks/useEnrollmentPreview';
import {
  Mail, MessageSquare, Linkedin, Eye, Clock, GitBranch,
  ArrowDown, type LucideIcon,
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

type StepNode = {
  step: SequenceStepPreview;
  isDecision: boolean;
  isMessage: boolean;
};

interface Props {
  steps: SequenceStepPreview[];
  /** Renderer custom pour chaque step (utilisé pour montrer les previews
   *  IA des steps message). Si non fourni, on affiche juste un summary. */
  renderStep?: (step: SequenceStepPreview, idx: number) => React.ReactNode;
}

export function SequenceTreeView({ steps, renderStep }: Props) {
  const nodes: StepNode[] = useMemo(() => {
    return [...steps]
      .sort((a, b) => a.stepOrder - b.stepOrder)
      .map(step => ({
        step,
        isDecision: DECISION_TYPES.has(step.actionType),
        isMessage: MESSAGE_TYPES.has(step.actionType),
      }));
  }, [steps]);

  return (
    <div className="relative space-y-2">
      {nodes.map((node, idx) => {
        const isLast = idx === nodes.length - 1;
        const next = nodes[idx + 1];
        // Si le step courant est une décision et qu'on a un step suivant,
        // on dessine un connecteur "branche" (avec label OUI/NON ou similaire).
        const showBranchLabel = node.isDecision && next;

        return (
          <React.Fragment key={node.step.stepId}>
            {node.isDecision ? (
              <DecisionNode node={node} index={idx} />
            ) : (
              <ActionNode node={node} index={idx} renderStep={renderStep} />
            )}

            {!isLast && (
              <Connector
                fromDecision={node.isDecision}
                toDecision={next?.isDecision || false}
                branchLabel={showBranchLabel ? getBranchLabel(node.step.actionType) : undefined}
                delayDays={next?.step.delayDays}
                delayHours={next?.step.delayHours}
              />
            )}
          </React.Fragment>
        );
      })}
    </div>
  );
}

// ─── ActionNode (message / invitation / visite) ─────────────────────

function ActionNode({
  node, index, renderStep,
}: {
  node: StepNode;
  index: number;
  renderStep?: (step: SequenceStepPreview, idx: number) => React.ReactNode;
}) {
  // Si renderStep retourne quelque chose (typiquement MessageStepCard
  // pour les steps message), on l'utilise. Sinon (renderStep null/undefined
  // → c'est un step non-message comme profile_visit / connection_request),
  // on tombe sur le rendu compact par défaut.
  const custom = renderStep?.(node.step, index);
  if (custom !== null && custom !== undefined && custom !== false) {
    return <>{custom}</>;
  }

  const Icon = ACTION_ICONS[node.step.actionType] || MessageSquare;
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
            {ACTION_LABELS[node.step.actionType] || node.step.actionType}
          </p>
          <p className="text-[10.5px] text-muted-foreground tabular-nums uppercase tracking-wider mt-0.5">
            Étape {node.step.stepOrder + 1}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

// ─── DecisionNode (wait_connection / check_connection / wait_reply) ──

function DecisionNode({ node, index }: { node: StepNode; index: number }) {
  const Icon = ACTION_ICONS[node.step.actionType] || GitBranch;
  const label = ACTION_LABELS[node.step.actionType] || 'Décision';
  // Description contextuelle du point de décision
  const description = (() => {
    switch (node.step.actionType) {
      case 'wait_connection':
        return 'Attend que le candidat accepte la demande de connexion';
      case 'wait_reply':
        return 'Attend une réponse au message précédent';
      case 'wait_profile_visit':
        return 'Attend que le candidat visite ton profil';
      case 'check_connection':
        return 'Vérifie si une connexion existe déjà';
      case 'condition_branch':
        return node.step.condition || 'Branchement conditionnel';
      default:
        return '';
    }
  })();
  const timeoutDays = node.step.timeoutDays;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1], delay: index * 0.04 }}
      className="relative my-1"
    >
      {/* Diamant en background avec dashed border */}
      <div className="rounded-2xl border border-dashed border-brand-purple/30 bg-brand-purple/[0.04] px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-lg bg-brand-purple/10 grid place-items-center shrink-0 rotate-45">
            <Icon className="w-4 h-4 text-brand-purple -rotate-45" strokeWidth={2.25} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-[10px] uppercase tracking-wider font-bold text-brand-purple">
                Décision
              </p>
              <span className="text-[10px] text-muted-foreground tabular-nums uppercase tracking-wider">
                · Étape {node.step.stepOrder + 1}
              </span>
            </div>
            <p className="text-[13px] font-semibold text-foreground tracking-tight mt-0.5">
              {label}
            </p>
            {description && (
              <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug">
                {description}
              </p>
            )}
            {timeoutDays && (
              <p className="text-[10.5px] text-warning mt-1.5 inline-flex items-center gap-1">
                <Clock className="w-2.5 h-2.5" />
                Timeout après {timeoutDays} jour{timeoutDays > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Connector — flèche/ligne entre 2 steps ─────────────────────────

function Connector({
  fromDecision,
  toDecision,
  branchLabel,
  delayDays,
  delayHours,
}: {
  fromDecision: boolean;
  toDecision: boolean;
  branchLabel?: string;
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
      <div className="flex items-center gap-1.5">
        {branchLabel && (
          <span className="text-[10px] uppercase tracking-wider font-bold text-brand-purple bg-brand-purple/10 border border-brand-purple/30 rounded-full px-2 py-0.5">
            {branchLabel}
          </span>
        )}
        <ArrowDown className="w-3.5 h-3.5 text-muted-foreground/60" strokeWidth={2} />
        {delayText && (
          <span className="text-[10px] text-muted-foreground tabular-nums">
            {delayText}
          </span>
        )}
      </div>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function getBranchLabel(actionType: string): string {
  switch (actionType) {
    case 'wait_connection':
      return 'si accepté';
    case 'wait_reply':
      return 'si réponse';
    case 'wait_profile_visit':
      return 'si visite';
    case 'check_connection':
      return 'résultat';
    case 'condition_branch':
      return 'oui';
    default:
      return '';
  }
}
