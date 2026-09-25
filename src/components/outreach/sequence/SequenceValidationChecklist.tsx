import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { AlertCircle, Check, X, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Sequence } from '../SequenceBuilder';
import { plural } from '@/lib/plural';

interface ValidationItem {
  id: string;
  label: string;
  description: string;
  status: 'pass' | 'fail' | 'warning';
  category: 'required' | 'recommended';
}

interface SequenceValidationChecklistProps {
  sequence: Sequence;
  className?: string;
}

const MESSAGE_ACTIONS = ['inmail', 'email', 'connection_request', 'message', 'smart_message', 'whatsapp_message'];
const WAIT_ACTIONS = ['wait_connection', 'wait_reply', 'wait_profile_visit'];

const stepList = (steps: Sequence['steps']) => {
  const numbers = [...new Set(steps.map(s => s.order + 1))];
  if (numbers.length === 1) return `étape ${numbers[0]}`;
  return `étapes ${numbers.slice(0, -1).join(', ')} et ${numbers[numbers.length - 1]}`;
};

/** Points de contrôle d'une séquence : le bloquant d'abord, le recommandé ensuite. */
function getValidationItems(sequence: Sequence): ValidationItem[] {
  const result: ValidationItem[] = [];

  result.push({
    id: 'name', label: 'Nom de la séquence',
    description: sequence.name.trim() ? sequence.name : 'À renseigner',
    status: sequence.name.trim() ? 'pass' : 'fail', category: 'required',
  });

  result.push({
    id: 'steps', label: 'Étapes',
    description: sequence.steps.length > 0
      ? plural(sequence.steps.length, 'étape')
      : 'Aucune étape',
    status: sequence.steps.length > 0 ? 'pass' : 'fail', category: 'required',
  });

  const emptyMessages = sequence.steps.filter(s =>
    MESSAGE_ACTIONS.includes(s.actionType) && !s.useAiPersonalization && !s.messageTemplate?.trim()
  );
  result.push({
    id: 'messages', label: 'Messages rédigés',
    // Numéros d'étapes en clair pour savoir où chercher.
    description: emptyMessages.length > 0 ? `À rédiger : ${stepList(emptyMessages)}` : 'Tous rédigés',
    status: emptyMessages.length > 0 ? 'fail' : 'pass', category: 'required',
  });

  const emailSteps = sequence.steps.filter(s => ['email', 'inmail'].includes(s.actionType));
  if (emailSteps.length > 0) {
    const emptySubjects = emailSteps.filter(s => !s.useAiPersonalization && !s.subjectTemplate?.trim());
    result.push({
      id: 'subjects', label: 'Objets des e-mails et InMails',
      description: emptySubjects.length > 0 ? `À rédiger : ${stepList(emptySubjects)}` : 'Tous renseignés',
      status: emptySubjects.length > 0 ? 'fail' : 'pass', category: 'required',
    });
  }

  const longInvites = sequence.steps.filter(
    s => s.actionType === 'connection_request' && (s.messageTemplate?.length || 0) > 300
  );
  if (longInvites.length > 0) {
    result.push({
      id: 'invite_length', label: "Note d'invitation",
      description: `Plus de 300 caractères : ${stepList(longInvites)}`,
      status: 'fail', category: 'required',
    });
  }

  // Sans délai maximal, une inscription peut rester bloquée indéfiniment si
  // l'événement attendu ne se produit jamais.
  const waitStepsWithoutTimeout = sequence.steps.filter(s =>
    WAIT_ACTIONS.includes(s.actionType) && (!s.timeoutDays || s.timeoutDays <= 0)
  );
  if (waitStepsWithoutTimeout.length > 0) {
    result.push({
      id: 'wait_timeouts', label: 'Délai maximal des attentes',
      description: `À renseigner : ${stepList(waitStepsWithoutTimeout)}`,
      status: 'fail', category: 'required',
    });
  }

  const senderCount = (sequence.senderAccounts || []).length;
  result.push({
    id: 'senders', label: 'Expéditeurs',
    description: sequence.multiSenderEnabled
      ? senderCount > 0 ? `${senderCount} expéditeur${senderCount > 1 ? 's' : ''}` : 'Aucun expéditeur choisi'
      : 'Un seul expéditeur',
    status: sequence.multiSenderEnabled && senderCount === 0 ? 'warning' : 'pass',
    category: 'recommended',
  });

  if (sequence.multiSenderEnabled && sequence.senderAccounts) {
    const highLimits = sequence.senderAccounts.filter(s => s.daily_limit > 80);
    if (highLimits.length > 0) {
      result.push({
        id: 'daily_limits', label: 'Limites quotidiennes',
        description: `${highLimits.length} expéditeur${highLimits.length > 1 ? 's' : ''} au-delà de 80 envois par jour`,
        status: 'warning', category: 'recommended',
      });
    }
  }

  const noDelaySteps = sequence.steps.filter(
    (s, i) => i > 0 && s.delayDays === 0 && s.delayHours === 0 && (s.delayMinutes || 0) === 0
      && !['check_connection', ...WAIT_ACTIONS].includes(s.actionType)
  );
  if (noDelaySteps.length > 0) {
    result.push({
      id: 'delays', label: 'Délais entre étapes',
      description: `${plural(noDelaySteps.length, 'étape')} sans délai`,
      status: 'warning', category: 'recommended',
    });
  }

  const hasStopConditions = sequence.stopConditions &&
    (sequence.stopConditions.on_reply || sequence.stopConditions.on_click || sequence.stopConditions.on_unsubscribe);
  result.push({
    id: 'stop_conditions', label: "Conditions d'arrêt",
    description: hasStopConditions ? 'Configurées' : 'Aucune',
    status: hasStopConditions ? 'pass' : 'warning', category: 'recommended',
  });

  return result;
}

interface ValidationSummary {
  blockers: number;
  warnings: number;
}

function summarizeValidation(items: ValidationItem[]): ValidationSummary {
  return {
    blockers: items.filter(i => i.category === 'required' && i.status === 'fail').length,
    warnings: items.filter(i => i.status === 'warning').length,
  };
}

/** « 1 point bloquant », « 2 recommandations », « Tout est prêt ». */
function validationSummaryLabel({ blockers, warnings }: ValidationSummary): string {
  if (blockers > 0) return `${blockers} point${blockers > 1 ? 's' : ''} bloquant${blockers > 1 ? 's' : ''}`;
  if (warnings > 0) return `${warnings} recommandation${warnings > 1 ? 's' : ''}`;
  return 'Tout est prêt';
}

function useValidationItems(sequence: Sequence) {
  return useMemo(
    () => getValidationItems(sequence),
    // On dépend des champs observés plutôt que de l'objet `sequence` entier.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sequence.name, sequence.steps, sequence.multiSenderEnabled, sequence.senderAccounts, sequence.stopConditions],
  );
}

type SummaryTone = 'danger' | 'warning' | 'success';

const toneOf = ({ blockers, warnings }: ValidationSummary): SummaryTone =>
  blockers > 0 ? 'danger' : warnings > 0 ? 'warning' : 'success';

function SummaryIcon({ tone }: { tone: SummaryTone }) {
  if (tone === 'danger') return <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  if (tone === 'warning') return <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
  return <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />;
}

/** Résumé en une ligne (icône et mots), pour le bouton qui ouvre la liste sous 1 024 px. */
export const SequenceValidationSummary: React.FC<SequenceValidationChecklistProps & { labelClassName?: string }> = ({
  sequence,
  className,
  labelClassName,
}) => {
  const summary = summarizeValidation(useValidationItems(sequence));
  const tone = toneOf(summary);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5',
        tone === 'danger' && 'text-danger',
        tone === 'warning' && 'text-warning',
        tone === 'success' && 'text-success',
        className,
      )}
    >
      <SummaryIcon tone={tone} />
      <span className={labelClassName}>{validationSummaryLabel(summary)}</span>
    </span>
  );
};

export const SequenceValidationChecklist: React.FC<SequenceValidationChecklistProps> = ({
  sequence,
  className,
}) => {
  const items = useValidationItems(sequence);
  const requiredItems = items.filter(i => i.category === 'required');
  const recommendedItems = items.filter(i => i.category === 'recommended');
  const summary = summarizeValidation(items);
  const tone = toneOf(summary);

  return (
    <div className={cn('space-y-4', className)}>
      {/* Résumé */}
      <p
        className={cn(
          'flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium',
          tone === 'danger' && 'bg-danger-muted text-danger',
          tone === 'warning' && 'bg-warning-muted text-warning',
          tone === 'success' && 'bg-success-muted text-success',
        )}
      >
        <SummaryIcon tone={tone} />
        {validationSummaryLabel(summary)}
      </p>

      <ChecklistGroup title="Obligatoire" items={requiredItems} />
      {recommendedItems.length > 0 && <ChecklistGroup title="Recommandé" items={recommendedItems} />}
    </div>
  );
};

const STATUS_TEXT: Record<ValidationItem['status'], string> = {
  pass: 'Validé',
  warning: 'À vérifier',
  fail: 'Bloquant',
};

const ChecklistGroup: React.FC<{ title: string; items: ValidationItem[] }> = ({ title, items }) => (
  <div>
    <p className="eyebrow mb-1.5 px-1">{title}</p>
    <ul className="space-y-0.5">
      {items.map(item => (
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
            <span className="mt-0.5 block break-words text-2xs leading-tight text-muted-foreground">{item.description}</span>
          </span>
        </li>
      ))}
    </ul>
  </div>
);
