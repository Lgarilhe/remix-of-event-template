import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Check, X, AlertTriangle, Shield, Users, MessageSquare, Clock, Mail, CheckCircle2 } from 'lucide-react';
import { Sequence } from '../SequenceBuilder';
import { validateSequence, stepNeedsSubject, type SequenceIssue } from './sequenceGraph';

interface ValidationItem {
  id: string;
  label: string;
  /** Une ligne par point relevé (ou le résumé quand tout va bien). */
  details: string[];
  status: 'pass' | 'fail' | 'warning';
  icon: typeof Check;
  category: 'required' | 'recommended';
}

interface SequenceValidationChecklistProps {
  sequence: Sequence;
  className?: string;
}

/** Contrôles bloquants, dans l'ordre d'affichage. */
const REQUIRED_CHECKS: Array<{ check: string; label: string; icon: typeof Check }> = [
  { check: 'name', label: 'Nom de la séquence', icon: Check },
  { check: 'steps', label: 'Étapes définies', icon: MessageSquare },
  { check: 'messages', label: 'Messages rédigés', icon: MessageSquare },
  { check: 'subjects', label: 'Objets (e-mail et InMail)', icon: Mail },
  { check: 'invite_length', label: 'Longueur des invitations', icon: AlertTriangle },
  { check: 'score', label: 'Seuil de score', icon: AlertTriangle },
  { check: 'wait_timeouts', label: 'Délai des attentes', icon: Clock },
  { check: 'delays', label: 'Délais entre étapes', icon: Clock },
  { check: 'send_window', label: "Fenêtre d'envoi", icon: Clock },
  { check: 'timeout_target', label: 'Étapes de repli', icon: AlertTriangle },
  { check: 'routing', label: 'Enchaînement des étapes', icon: AlertTriangle },
  { check: 'ab_weights', label: 'Tests A/B', icon: AlertTriangle },
];

/** Recommandations, dans l'ordre d'affichage. */
const RECOMMENDED_CHECKS: Array<{ check: string; label: string; icon: typeof Check }> = [
  { check: 'unreachable', label: 'Étapes jamais atteintes', icon: AlertTriangle },
  { check: 'unsupported', label: 'Étapes non prises en charge', icon: AlertTriangle },
  { check: 'retired_condition', label: 'Conditions plus proposées', icon: AlertTriangle },
  { check: 'inmail_cost', label: 'InMail payants', icon: Mail },
  { check: 'daily_limits', label: 'Attribution par expéditeur', icon: Shield },
  { check: 'delays_zero', label: 'Délais entre étapes', icon: Clock },
];

const messagesOf = (issues: SequenceIssue[], check: string) => issues.filter(i => i.check === check).map(i => i.message);

/**
 * Liste de vérification. Elle lit validateSequence, comme l'enregistrement et
 * le fil du mode Guidé : ce qu'elle dit bloquant bloque l'enregistrement, et
 * « Prêt » veut dire que l'enregistrement passera.
 */
export const SequenceValidationChecklist: React.FC<SequenceValidationChecklistProps> = ({
  sequence,
  className,
}) => {
  const items = useMemo((): ValidationItem[] => {
    const { errors, warnings } = validateSequence(sequence);
    const result: ValidationItem[] = [];
    const stepCount = sequence.steps.length;
    const needsSubjects = sequence.steps.some(s => stepNeedsSubject(s.actionType));

    // Toujours affichés, au vert quand rien ne bloque.
    const passSummary: Record<string, string | null> = {
      name: sequence.name.trim() || null,
      steps: stepCount > 0 ? `${stepCount} étape${stepCount !== 1 ? 's' : ''}` : null,
      messages: 'Tous rédigés',
      subjects: needsSubjects ? 'Tous renseignés' : null,
    };

    for (const { check, label, icon } of REQUIRED_CHECKS) {
      const failed = messagesOf(errors, check);
      if (failed.length > 0) {
        result.push({ id: check, label, details: failed, status: 'fail', icon, category: 'required' });
      } else if (passSummary[check]) {
        result.push({ id: check, label, details: [passSummary[check] as string], status: 'pass', icon, category: 'required' });
      }
    }

    for (const { check, label, icon } of RECOMMENDED_CHECKS) {
      const noted = messagesOf(warnings, check);
      if (noted.length > 0) result.push({ id: check, label, details: noted, status: 'warning', icon, category: 'recommended' });
    }

    const senderWarnings = messagesOf(warnings, 'senders');
    const senderCount = (sequence.senderAccounts || []).length;
    result.push({
      id: 'senders', label: 'Expéditeurs',
      details: senderWarnings.length > 0
        ? senderWarnings
        : [sequence.multiSenderEnabled ? `${senderCount} expéditeur${senderCount !== 1 ? 's' : ''}` : 'Un seul expéditeur'],
      status: senderWarnings.length > 0 ? 'warning' : 'pass',
      icon: Users, category: 'recommended',
    });

    // La réponse et la désinscription arrêtent toujours la séquence.
    result.push({
      id: 'stop_conditions', label: 'Conditions d\'arrêt',
      details: ['Arrêt à la réponse et à la désinscription'],
      status: 'pass', icon: Shield, category: 'recommended',
    });

    return result;
    // On dépend des champs vérifiés plutôt que de l'objet `sequence` entier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    sequence.name,
    sequence.steps,
    sequence.multiSenderEnabled,
    sequence.senderAccounts,
  ]);

  const requiredItems = items.filter(i => i.category === 'required');
  const recommendedItems = items.filter(i => i.category === 'recommended');
  const blockerCount = items
    .filter(i => i.status === 'fail')
    .reduce((sum, i) => sum + i.details.length, 0);
  const warningCount = items.filter(i => i.status === 'warning').length;
  const passCount = items.filter(i => i.status === 'pass').length;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Progress summary */}
      <div
        role="status"
        className={cn(
          "px-3 py-2.5 text-xs font-medium flex items-center gap-2 border-l-2",
          blockerCount > 0
            ? "border-l-destructive bg-destructive/5 text-destructive"
            : warningCount > 0
              ? "border-l-warning bg-warning/10 text-warning"
              : "border-l-success bg-success/10 text-success"
        )}
      >
        {blockerCount > 0 ? (
          <><X className="w-3.5 h-3.5" aria-hidden="true" />{blockerCount} point{blockerCount > 1 ? 's' : ''} à corriger avant d'enregistrer</>
        ) : warningCount > 0 ? (
          <><AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />Prête, avec {warningCount} recommandation{warningCount > 1 ? 's' : ''}</>
        ) : (
          <><CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />Prête ({passCount}/{items.length})</>
        )}
      </div>

      {/* Required */}
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5 px-1">
          Obligatoire
        </div>
        <div className="space-y-0.5">
          {requiredItems.map(item => (
            <ChecklistItem key={item.id} item={item} />
          ))}
        </div>
      </div>

      {/* Recommended */}
      {recommendedItems.length > 0 && (
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-1.5 px-1">
            Recommandé
          </div>
          <div className="space-y-0.5">
            {recommendedItems.map(item => (
              <ChecklistItem key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/** Au-delà, les points suivants sont résumés en « et N autres ». */
const MAX_DETAILS = 4;

const ChecklistItem: React.FC<{ item: ValidationItem }> = ({ item }) => {
  const shown = item.details.slice(0, MAX_DETAILS);
  const hidden = item.details.length - shown.length;
  return (
    <div className="flex items-start gap-2.5 py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors">
      <div className={cn(
        "w-4 h-4 rounded-full flex items-center justify-center shrink-0",
        item.status === 'pass' ? "bg-success/10 text-success"
          : item.status === 'warning' ? "bg-warning/10 text-warning"
            : "bg-destructive/10 text-destructive"
      )}>
        {item.status === 'pass' ? <Check className="w-2.5 h-2.5" aria-hidden="true" /> :
          item.status === 'warning' ? <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" /> :
            <X className="w-2.5 h-2.5" aria-hidden="true" />}
        <span className="sr-only">
          {item.status === 'pass' ? 'Correct' : item.status === 'warning' ? 'Recommandation' : 'À corriger'}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[11px] font-medium leading-tight truncate" title={item.label}>{item.label}</div>
        {shown.map((detail, i) => (
          <div key={i} className="text-[10px] text-muted-foreground/70 leading-snug break-words">{detail}</div>
        ))}
        {hidden > 0 && (
          <div className="text-[10px] text-muted-foreground/70 leading-snug">et {hidden} autre{hidden > 1 ? 's' : ''}</div>
        )}
      </div>
    </div>
  );
};
