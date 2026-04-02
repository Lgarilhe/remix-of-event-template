import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { Check, X, AlertTriangle, Shield, Users, MessageSquare, Clock, Mail, CheckCircle2 } from 'lucide-react';
import { Sequence } from '../SequenceBuilder';
import { motion, AnimatePresence } from 'framer-motion';

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

    result.push({
      id: 'name', label: 'Nom de la séquence',
      description: sequence.name.trim() ? sequence.name : 'Non défini',
      status: sequence.name.trim() ? 'pass' : 'fail', icon: Check, category: 'required',
    });

    result.push({
      id: 'steps', label: 'Étapes définies',
      description: `${sequence.steps.length} étape${sequence.steps.length !== 1 ? 's' : ''}`,
      status: sequence.steps.length > 0 ? 'pass' : 'fail', icon: MessageSquare, category: 'required',
    });

    const messageSteps = sequence.steps.filter(s =>
      ['inmail', 'email', 'connection_request', 'message', 'smart_message', 'whatsapp_message'].includes(s.actionType)
    );
    const emptyMessages = messageSteps.filter(s => !s.useAiPersonalization && !s.messageTemplate?.trim());
    result.push({
      id: 'messages', label: 'Messages rédigés',
      description: emptyMessages.length > 0
        ? `${emptyMessages.length} message${emptyMessages.length > 1 ? 's' : ''} vide${emptyMessages.length > 1 ? 's' : ''}`
        : 'Tous remplis',
      status: emptyMessages.length > 0 ? 'fail' : 'pass', icon: MessageSquare, category: 'required',
    });

    const emailSteps = sequence.steps.filter(s => ['email', 'inmail'].includes(s.actionType));
    const emptySubjects = emailSteps.filter(s => !s.useAiPersonalization && !s.subjectTemplate?.trim());
    if (emailSteps.length > 0) {
      result.push({
        id: 'subjects', label: 'Objets email',
        description: emptySubjects.length > 0
          ? `${emptySubjects.length} manquant${emptySubjects.length > 1 ? 's' : ''}`
          : 'Tous définis',
        status: emptySubjects.length > 0 ? 'fail' : 'pass', icon: Mail, category: 'required',
      });
    }

    const longInvites = sequence.steps.filter(
      s => s.actionType === 'connection_request' && (s.messageTemplate?.length || 0) > 300
    );
    if (longInvites.length > 0) {
      result.push({
        id: 'invite_length', label: 'Longueur invitation',
        description: '> 300 caractères',
        status: 'fail', icon: AlertTriangle, category: 'required',
      });
    }

    result.push({
      id: 'senders', label: 'Expéditeurs',
      description: sequence.multiSenderEnabled
        ? `${(sequence.senderAccounts || []).length} configuré${(sequence.senderAccounts || []).length !== 1 ? 's' : ''}`
        : 'Mono-sender',
      status: sequence.multiSenderEnabled && (sequence.senderAccounts || []).length === 0 ? 'warning' : 'pass',
      icon: Users, category: 'recommended',
    });

    if (sequence.multiSenderEnabled && sequence.senderAccounts) {
      const highLimits = sequence.senderAccounts.filter(s => s.daily_limit > 80);
      if (highLimits.length > 0) {
        result.push({
          id: 'daily_limits', label: 'Limites quotidiennes',
          description: `${highLimits.length} sender${highLimits.length > 1 ? 's' : ''} > 80/jour`,
          status: 'warning', icon: Shield, category: 'recommended',
        });
      }
    }

    const noDelaySteps = sequence.steps.filter(
      (s, i) => i > 0 && s.delayDays === 0 && s.delayHours === 0 && (s.delayMinutes || 0) === 0
        && !['check_connection', 'wait_connection', 'wait_reply', 'wait_profile_visit'].includes(s.actionType)
    );
    if (noDelaySteps.length > 0) {
      result.push({
        id: 'delays', label: 'Délais entre étapes',
        description: `${noDelaySteps.length} sans délai`,
        status: 'warning', icon: Clock, category: 'recommended',
      });
    }

    const hasStopConditions = sequence.stopConditions &&
      (sequence.stopConditions.on_reply || sequence.stopConditions.on_click || sequence.stopConditions.on_unsubscribe);
    result.push({
      id: 'stop_conditions', label: 'Conditions d\'arrêt',
      description: hasStopConditions ? 'Configurées' : 'Aucune',
      status: hasStopConditions ? 'pass' : 'warning', icon: Shield, category: 'recommended',
    });

    return result;
  }, [sequence]);

  const requiredItems = items.filter(i => i.category === 'required');
  const recommendedItems = items.filter(i => i.category === 'recommended');
  const hasBlockers = requiredItems.some(i => i.status === 'fail');
  const warningCount = items.filter(i => i.status === 'warning').length;
  const passCount = items.filter(i => i.status === 'pass').length;

  return (
    <div className={cn("space-y-4", className)}>
      {/* Progress summary */}
      <div className={cn(
        "px-3 py-2.5 text-xs font-medium flex items-center gap-2 border-l-2",
        hasBlockers
          ? "border-l-destructive bg-destructive/5 text-destructive"
          : warningCount > 0
            ? "border-l-warning bg-warning/10 text-warning"
            : "border-l-success bg-success/10 text-success"
      )}>
        {hasBlockers ? (
          <><X className="w-3.5 h-3.5" />{requiredItems.filter(i => i.status === 'fail').length} bloquant(s)</>
        ) : warningCount > 0 ? (
          <><AlertTriangle className="w-3.5 h-3.5" />{warningCount} recommandation{warningCount > 1 ? 's' : ''}</>
        ) : (
          <><CheckCircle2 className="w-3.5 h-3.5" />Prêt — {passCount}/{items.length}</>
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

const ChecklistItem: React.FC<{ item: ValidationItem }> = ({ item }) => (
  <div className="flex items-center gap-2.5 py-1.5 px-2 rounded-md hover:bg-muted/40 transition-colors">
    <div className={cn(
      "w-4 h-4 rounded-full flex items-center justify-center shrink-0",
      item.status === 'pass' ? "bg-success/10 text-success"
        : item.status === 'warning' ? "bg-warning/10 text-warning"
          : "bg-destructive/10 text-destructive"
    )}>
      {item.status === 'pass' ? <Check className="w-2.5 h-2.5" /> :
        item.status === 'warning' ? <AlertTriangle className="w-2.5 h-2.5" /> :
          <X className="w-2.5 h-2.5" />}
    </div>
    <div className="flex-1 min-w-0">
      <div className="text-[11px] font-medium leading-tight truncate">{item.label}</div>
      <div className="text-[10px] text-muted-foreground/70 leading-tight truncate">{item.description}</div>
    </div>
  </div>
);
