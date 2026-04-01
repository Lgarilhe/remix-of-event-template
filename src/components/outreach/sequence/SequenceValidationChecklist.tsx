import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Check, X, AlertTriangle, Shield, Users, MessageSquare, Clock, Mail } from 'lucide-react';
import { Sequence } from '../SequenceBuilder';

interface ValidationItem {
  id: string;
  label: string;
  description: string;
  status: 'pass' | 'fail' | 'warning';
  icon: typeof Check;
  category: 'required' | 'recommended';
}

interface SequenceValidationChecklistProps {
  sequence: Sequence;
  className?: string;
}

export const SequenceValidationChecklist: React.FC<SequenceValidationChecklistProps> = ({
  sequence,
  className,
}) => {
  const items = useMemo((): ValidationItem[] => {
    const result: ValidationItem[] = [];

    // Required: Name
    result.push({
      id: 'name',
      label: 'Nom de la séquence',
      description: sequence.name.trim() ? sequence.name : 'Non défini',
      status: sequence.name.trim() ? 'pass' : 'fail',
      icon: Check,
      category: 'required',
    });

    // Required: At least one step
    result.push({
      id: 'steps',
      label: 'Étapes définies',
      description: `${sequence.steps.length} étape${sequence.steps.length !== 1 ? 's' : ''}`,
      status: sequence.steps.length > 0 ? 'pass' : 'fail',
      icon: MessageSquare,
      category: 'required',
    });

    // Required: Messages filled
    const messageSteps = sequence.steps.filter(s =>
      ['inmail', 'email', 'connection_request', 'message', 'smart_message', 'whatsapp_message'].includes(s.actionType)
    );
    const emptyMessages = messageSteps.filter(s => !s.useAiPersonalization && !s.messageTemplate?.trim());
    result.push({
      id: 'messages',
      label: 'Messages rédigés',
      description: emptyMessages.length > 0
        ? `${emptyMessages.length} message${emptyMessages.length > 1 ? 's' : ''} vide${emptyMessages.length > 1 ? 's' : ''}`
        : 'Tous les messages sont remplis',
      status: emptyMessages.length > 0 ? 'fail' : 'pass',
      icon: MessageSquare,
      category: 'required',
    });

    // Required: Email subjects
    const emailSteps = sequence.steps.filter(s => ['email', 'inmail'].includes(s.actionType));
    const emptySubjects = emailSteps.filter(s => !s.useAiPersonalization && !s.subjectTemplate?.trim());
    if (emailSteps.length > 0) {
      result.push({
        id: 'subjects',
        label: 'Objets email',
        description: emptySubjects.length > 0
          ? `${emptySubjects.length} objet${emptySubjects.length > 1 ? 's' : ''} manquant${emptySubjects.length > 1 ? 's' : ''}`
          : 'Tous les objets sont définis',
        status: emptySubjects.length > 0 ? 'fail' : 'pass',
        icon: Mail,
        category: 'required',
      });
    }

    // Required: Connection request length
    const longInvites = sequence.steps.filter(
      s => s.actionType === 'connection_request' && (s.messageTemplate?.length || 0) > 300
    );
    if (longInvites.length > 0) {
      result.push({
        id: 'invite_length',
        label: 'Longueur invitation',
        description: 'Invitation(s) > 300 caractères',
        status: 'fail',
        icon: AlertTriangle,
        category: 'required',
      });
    }

    // Recommended: Senders configured
    result.push({
      id: 'senders',
      label: 'Expéditeurs',
      description: sequence.multiSenderEnabled
        ? `${(sequence.senderAccounts || []).length} sender${(sequence.senderAccounts || []).length !== 1 ? 's' : ''} configuré${(sequence.senderAccounts || []).length !== 1 ? 's' : ''}`
        : 'Mode mono-sender',
      status: sequence.multiSenderEnabled && (sequence.senderAccounts || []).length === 0 ? 'warning' : 'pass',
      icon: Users,
      category: 'recommended',
    });

    // Recommended: Daily limits
    if (sequence.multiSenderEnabled && sequence.senderAccounts) {
      const highLimits = sequence.senderAccounts.filter(s => s.daily_limit > 80);
      if (highLimits.length > 0) {
        result.push({
          id: 'daily_limits',
          label: 'Limites quotidiennes',
          description: `${highLimits.length} sender${highLimits.length > 1 ? 's' : ''} avec limite > 80/jour`,
          status: 'warning',
          icon: Shield,
          category: 'recommended',
        });
      }
    }

    // Recommended: Delays between steps
    const noDelaySteps = sequence.steps.filter(
      (s, i) => i > 0 && s.delayDays === 0 && s.delayHours === 0 && (s.delayMinutes || 0) === 0
        && !['check_connection', 'wait_connection', 'wait_reply', 'wait_profile_visit'].includes(s.actionType)
    );
    if (noDelaySteps.length > 0) {
      result.push({
        id: 'delays',
        label: 'Délais entre étapes',
        description: `${noDelaySteps.length} étape${noDelaySteps.length > 1 ? 's' : ''} sans délai`,
        status: 'warning',
        icon: Clock,
        category: 'recommended',
      });
    }

    // Recommended: Stop conditions
    const hasStopConditions = sequence.stopConditions &&
      (sequence.stopConditions.on_reply || sequence.stopConditions.on_click || sequence.stopConditions.on_unsubscribe);
    result.push({
      id: 'stop_conditions',
      label: 'Conditions d\'arrêt',
      description: hasStopConditions ? 'Configurées' : 'Aucune condition d\'arrêt',
      status: hasStopConditions ? 'pass' : 'warning',
      icon: Shield,
      category: 'recommended',
    });

    return result;
  }, [sequence]);

  const requiredItems = items.filter(i => i.category === 'required');
  const recommendedItems = items.filter(i => i.category === 'recommended');
  const hasBlockers = requiredItems.some(i => i.status === 'fail');
  const warningCount = items.filter(i => i.status === 'warning').length;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Summary */}
      <div className={cn(
        "p-3 border text-xs",
        hasBlockers
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : warningCount > 0
            ? "border-amber-500/30 bg-amber-50 text-amber-700"
            : "border-green-500/30 bg-green-50 text-green-700"
      )}>
        {hasBlockers
          ? `⛔ ${requiredItems.filter(i => i.status === 'fail').length} problème(s) bloquant(s)`
          : warningCount > 0
            ? `⚠️ ${warningCount} recommandation${warningCount > 1 ? 's' : ''}`
            : '✅ Prêt à activer'}
      </div>

      {/* Required */}
      <div>
        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Obligatoire</div>
        <div className="space-y-1">
          {requiredItems.map(item => (
            <ChecklistItem key={item.id} item={item} />
          ))}
        </div>
      </div>

      {/* Recommended */}
      {recommendedItems.length > 0 && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Recommandé</div>
          <div className="space-y-1">
            {recommendedItems.map(item => (
              <ChecklistItem key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const ChecklistItem: React.FC<{ item: ValidationItem }> = ({ item }) => (
  <div className="flex items-center gap-2 py-1.5 px-2">
    <div className={cn(
      "w-4 h-4 flex items-center justify-center shrink-0",
      item.status === 'pass' ? "text-green-600"
        : item.status === 'warning' ? "text-amber-500"
          : "text-destructive"
    )}>
      {item.status === 'pass' ? <Check className="w-3 h-3" /> :
        item.status === 'warning' ? <AlertTriangle className="w-3 h-3" /> :
          <X className="w-3 h-3" />}
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-xs font-medium truncate">{item.label}</div>
      <div className="text-[10px] text-muted-foreground truncate">{item.description}</div>
    </div>
  </div>
);
