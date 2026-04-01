import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { 
  Mail, UserPlus, Eye, MessageSquare, Sparkles, 
  GitBranch, Timer, Trash2, Clock
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SequenceStep } from '../../SequenceBuilder';
import { getStepMessageType } from '../messageTypeUtils';
import whatsappLogo from '@/assets/whatsapp-logo.svg';

const STEP_ICONS: Record<string, React.ElementType | null> = {
  inmail: Mail, connection_request: UserPlus, profile_visit: Eye,
  message: MessageSquare, smart_message: Sparkles, whatsapp_message: null,
  email: Mail, wait_connection: Timer, wait_reply: MessageSquare,
  wait_profile_visit: Eye, condition_branch: GitBranch, check_connection: GitBranch,
};

const STEP_STYLES: Record<string, { bg: string; iconBg: string; border: string; accent: string }> = {
  inmail:             { bg: 'bg-blue-50/80 dark:bg-blue-950/30',    iconBg: 'bg-blue-500 text-white',    border: 'border-blue-200 dark:border-blue-800/50',    accent: 'shadow-blue-200/40' },
  connection_request: { bg: 'bg-emerald-50/80 dark:bg-emerald-950/30', iconBg: 'bg-emerald-500 text-white', border: 'border-emerald-200 dark:border-emerald-800/50', accent: 'shadow-emerald-200/40' },
  profile_visit:      { bg: 'bg-sky-50/80 dark:bg-sky-950/30',     iconBg: 'bg-sky-500 text-white',     border: 'border-sky-200 dark:border-sky-800/50',     accent: 'shadow-sky-200/40' },
  message:            { bg: 'bg-orange-50/80 dark:bg-orange-950/30',  iconBg: 'bg-orange-500 text-white',  border: 'border-orange-200 dark:border-orange-800/50',  accent: 'shadow-orange-200/40' },
  smart_message:      { bg: 'bg-purple-50/80 dark:bg-purple-950/30',  iconBg: 'bg-purple-500 text-white',  border: 'border-purple-200 dark:border-purple-800/50',  accent: 'shadow-purple-200/40' },
  whatsapp_message:   { bg: 'bg-green-50/80 dark:bg-green-950/30',   iconBg: 'bg-green-500 text-white',   border: 'border-green-200 dark:border-green-800/50',   accent: 'shadow-green-200/40' },
  email:              { bg: 'bg-violet-50/80 dark:bg-violet-950/30',  iconBg: 'bg-violet-500 text-white',  border: 'border-violet-200 dark:border-violet-800/50',  accent: 'shadow-violet-200/40' },
  wait_connection:    { bg: 'bg-amber-50/80 dark:bg-amber-950/30',   iconBg: 'bg-amber-500 text-white',   border: 'border-amber-200 dark:border-amber-800/50',   accent: 'shadow-amber-200/40' },
  wait_reply:         { bg: 'bg-amber-50/80 dark:bg-amber-950/30',   iconBg: 'bg-amber-500 text-white',   border: 'border-amber-200 dark:border-amber-800/50',   accent: 'shadow-amber-200/40' },
  wait_profile_visit: { bg: 'bg-amber-50/80 dark:bg-amber-950/30',   iconBg: 'bg-amber-500 text-white',   border: 'border-amber-200 dark:border-amber-800/50',   accent: 'shadow-amber-200/40' },
  condition_branch:   { bg: 'bg-rose-50/80 dark:bg-rose-950/30',    iconBg: 'bg-rose-500 text-white',    border: 'border-rose-200 dark:border-rose-800/50',    accent: 'shadow-rose-200/40' },
  check_connection:   { bg: 'bg-indigo-50/80 dark:bg-indigo-950/30', iconBg: 'bg-indigo-500 text-white',  border: 'border-indigo-200 dark:border-indigo-800/50', accent: 'shadow-indigo-200/40' },
};

const STEP_LABELS: Record<string, string> = {
  inmail: 'InMail', connection_request: 'Invitation', profile_visit: 'Visite profil',
  message: 'Message', smart_message: 'Smart Msg', whatsapp_message: 'WhatsApp',
  email: 'Email', wait_connection: 'Attendre', wait_reply: 'Att. réponse',
  wait_profile_visit: 'Att. visite', condition_branch: 'Branchement', check_connection: 'Vérifier connexion',
};

type StepNodeData = {
  step: SequenceStep;
  index: number;
  allSteps: SequenceStep[];
  isSelected: boolean;
  canRemove: boolean;
  onRemove: () => void;
  compact?: boolean;
};

export const WorkflowStepNode = memo(({ data }: NodeProps) => {
  const { step, index, allSteps, isSelected, canRemove, onRemove, compact } = data as unknown as StepNodeData;
  const Icon = STEP_ICONS[step.actionType];
  const isWhatsApp = step.actionType === 'whatsapp_message';
  const styles = STEP_STYLES[step.actionType] || { bg: 'bg-muted/40', iconBg: 'bg-muted text-muted-foreground', border: 'border-border', accent: '' };
  const msgType = getStepMessageType(step, allSteps);

  const hasDelay = step.delayDays > 0 || step.delayHours > 0 || (step.delayMinutes && step.delayMinutes > 0);
  const delayLabel = [
    step.delayDays > 0 ? `${step.delayDays}j` : '',
    step.delayHours > 0 ? `${step.delayHours}h` : '',
    step.delayMinutes && step.delayMinutes > 0 ? `${step.delayMinutes}m` : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-transparent !border-transparent" />
      
      <div className={cn(
        "group relative rounded-xl border-2 transition-all duration-200 cursor-pointer backdrop-blur-sm",
        styles.bg, styles.border,
        isSelected 
          ? `ring-2 ring-primary/40 ring-offset-2 ring-offset-background shadow-lg scale-[1.03] ${styles.accent}` 
          : "shadow-sm hover:shadow-md hover:scale-[1.01]",
        compact ? "px-3 py-2.5 min-w-[150px]" : "px-4 py-3 min-w-[200px] max-w-[220px]",
      )}>
        <div className="flex items-center gap-3">
          {/* Icon */}
          <div className={cn(
            "rounded-lg flex items-center justify-center shrink-0 shadow-sm",
            styles.iconBg,
            compact ? "w-7 h-7" : "w-9 h-9"
          )}>
            {isWhatsApp ? (
              <img src={whatsappLogo} alt="WhatsApp" className={compact ? "w-3.5 h-3.5" : "w-4.5 h-4.5"} />
            ) : Icon ? (
              <Icon className={compact ? "w-3.5 h-3.5" : "w-4.5 h-4.5"} />
            ) : (
              <Mail className={compact ? "w-3.5 h-3.5" : "w-4.5 h-4.5"} />
            )}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {!compact && (
              <div className="text-[10px] text-muted-foreground/50 leading-none mb-0.5 font-medium uppercase tracking-wider">
                Étape {index + 1}
              </div>
            )}
            <div className={cn(
              "font-semibold truncate leading-tight",
              compact ? "text-[12px]" : "text-[13px]"
            )}>
              {STEP_LABELS[step.actionType] || step.actionType}
            </div>
            {!compact && msgType && (
              <div className={cn("text-[9px] font-semibold px-1.5 py-0.5 rounded-full w-fit mt-1", msgType.color)}>
                {msgType.shortLabel}
              </div>
            )}
            {hasDelay && (
              <div className={cn("flex items-center gap-1 text-muted-foreground/60 mt-0.5", compact ? "text-[9px]" : "text-[10px]")}>
                <Clock className="w-2.5 h-2.5" />
                {delayLabel}
              </div>
            )}
          </div>
        </div>

        {/* Remove button */}
        {canRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-150 shadow-md hover:scale-110"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-transparent !border-transparent" />
    </>
  );
});

WorkflowStepNode.displayName = 'WorkflowStepNode';
