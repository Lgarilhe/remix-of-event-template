import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AlertCircle, Check, X, AlertTriangle, CheckCircle2, Shield, Users, MessageSquare, Clock, Mail } from 'lucide-react';
import { Sequence } from '../SequenceBuilder';
import { plural } from '@/lib/plural';
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
  /** Comptes LinkedIn reliés à l'équipe (null tant qu'ils ne sont pas connus), voir validateSequence. */
  linkedSenderIds?: ReadonlySet<string> | null;
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
  { check: 'sender_pool', label: 'Expéditeurs reliés à l\'équipe', icon: Users },
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

type SummaryTone = 'danger' | 'warning' | 'success';

function SummaryIcon({ tone }: { tone: SummaryTone }) {
  if (tone === 'danger') return <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  if (tone === 'warning') return <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
}

/**
 * Liste de vérification. Elle lit validateSequence, comme l'enregistrement et
 * le fil du mode Guidé : ce qu'elle dit bloquant bloque l'enregistrement, et
 * « Prête » veut dire que l'enregistrement passera.
 */
export const SequenceValidationChecklist: React.FC<SequenceValidationChecklistProps> = ({
  sequence,
  linkedSenderIds = null,
  className,
}) => {
  const items = useMemo((): ValidationItem[] => {
    const { errors, warnings } = validateSequence(sequence, linkedSenderIds);
    const result: ValidationItem[] = [];
    const stepCount = sequence.steps.length;
    const needsSubjects = sequence.steps.some(s => stepNeedsSubject(s.actionType));

    // Toujours affichés, au vert quand rien ne bloque.
    const passSummary: Record<string, string | null> = {
      name: sequence.name.trim() || null,
      steps: stepCount > 0 ? plural(stepCount, 'étape') : null,
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
        : [sequence.multiSenderEnabled ? plural(senderCount, 'expéditeur') : 'Un seul expéditeur'],
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
    linkedSenderIds,
  ]);

  const requiredItems = items.filter(i => i.category === 'required');
  const recommendedItems = items.filter(i => i.category === 'recommended');
  const blockerCount = items
    .filter(i => i.status === 'fail')
    .reduce((sum, i) => sum + i.details.length, 0);
  const warningCount = items.filter(i => i.status === 'warning').length;
  const tone: SummaryTone = blockerCount > 0 ? 'danger' : warningCount > 0 ? 'warning' : 'success';

  return (
    <div className={cn('space-y-4', className)}>
      {/* Résumé */}
      <p
        role="status"
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium',
          tone === 'danger' && 'bg-danger-muted text-danger',
          tone === 'warning' && 'bg-warning-muted text-warning',
          tone === 'success' && 'bg-success-muted text-success',
        )}
      >
        <SummaryIcon tone={tone} />
        {blockerCount > 0
          ? `${plural(blockerCount, 'point')} à corriger avant d'enregistrer`
          : warningCount > 0
            ? `Prête, avec ${plural(warningCount, 'recommandation')}`
            : 'Prête à être enregistrée'}
      </p>

      <ChecklistGroup title="Obligatoire" items={requiredItems} />
      {recommendedItems.length > 0 && <ChecklistGroup title="Recommandé" items={recommendedItems} />}
    </div>
  );
};

const STATUS_TEXT: Record<ValidationItem['status'], string> = {
  pass: 'Correct',
  warning: 'Recommandation',
  fail: 'À corriger',
};

/** Au-delà, les points suivants sont résumés en « et N autres ». */
const MAX_DETAILS = 4;

const ChecklistGroup: React.FC<{ title: string; items: ValidationItem[] }> = ({ title, items }) => (
  <div>
    <p className="eyebrow mb-1.5 px-1">{title}</p>
    <ul className="space-y-0.5">
      {items.map(item => {
        const shown = item.details.slice(0, MAX_DETAILS);
        const hidden = item.details.length - shown.length;
        return (
          <li key={item.id} className="flex items-start gap-2.5 px-1 py-1.5">
            <span
              className={cn(
                'mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full',
                item.status === 'pass' ? 'bg-success-muted text-success'
                  : item.status === 'warning' ? 'bg-warning-muted text-warning'
                    : 'bg-danger-muted text-danger',
              )}
              aria-hidden="true"
            >
              {item.status === 'pass' ? <Check className="h-2.5 w-2.5" /> :
                item.status === 'warning' ? <AlertTriangle className="h-2.5 w-2.5" /> :
                  <X className="h-2.5 w-2.5" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-medium leading-tight text-foreground">
                {item.label}
                <span className="sr-only"> : {STATUS_TEXT[item.status]}.</span>
              </span>
              {shown.map((detail, i) => (
                <span key={i} className="mt-0.5 block break-words text-2xs leading-snug text-muted-foreground">{detail}</span>
              ))}
              {hidden > 0 && (
                <span className="mt-0.5 block text-2xs leading-snug text-muted-foreground">et {plural(hidden, 'autre')}</span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  </div>
);
