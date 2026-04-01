import React, { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { 
  Mail, UserPlus, Eye, MessageSquare, Sparkles, 
  GitBranch, Timer, Trash2 
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

const STEP_STYLES: Record<string, { bg: string; iconBg: string; border: string }> = {
  inmail: { bg: 'bg-blue-50 dark:bg-blue-950/40', iconBg: 'bg-blue-100 text-blue-600 dark:bg-blue-900 dark:text-blue-400', border: 'border-blue-200/80 dark:border-blue-800/60' },
  connection_request: { bg: 'bg-emerald-50 dark:bg-emerald-950/40', iconBg: 'bg-emerald-100 text-emerald-600 dark:bg-emerald-900 dark:text-emerald-400', border: 'border-emerald-200/80 dark:border-emerald-800/60' },
  profile_visit: { bg: 'bg-sky-50 dark:bg-sky-950/40', iconBg: 'bg-sky-100 text-sky-600 dark:bg-sky-900 dark:text-sky-400', border: 'border-sky-200/80 dark:border-sky-800/60' },
  message: { bg: 'bg-orange-50 dark:bg-orange-950/40', iconBg: 'bg-orange-100 text-orange-600 dark:bg-orange-900 dark:text-orange-400', border: 'border-orange-200/80 dark:border-orange-800/60' },
  smart_message: { bg: 'bg-purple-50 dark:bg-purple-950/40', iconBg: 'bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-400', border: 'border-purple-200/80 dark:border-purple-800/60' },
  whatsapp_message: { bg: 'bg-green-50 dark:bg-green-950/40', iconBg: 'bg-green-100 text-green-600 dark:bg-green-900 dark:text-green-400', border: 'border-green-200/80 dark:border-green-800/60' },
  email: { bg: 'bg-violet-50 dark:bg-violet-950/40', iconBg: 'bg-violet-100 text-violet-600 dark:bg-violet-900 dark:text-violet-400', border: 'border-violet-200/80 dark:border-violet-800/60' },
  wait_connection: { bg: 'bg-amber-50 dark:bg-amber-950/40', iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-400', border: 'border-amber-200/80 dark:border-amber-800/60' },
  wait_reply: { bg: 'bg-amber-50 dark:bg-amber-950/40', iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-400', border: 'border-amber-200/80 dark:border-amber-800/60' },
  wait_profile_visit: { bg: 'bg-amber-50 dark:bg-amber-950/40', iconBg: 'bg-amber-100 text-amber-600 dark:bg-amber-900 dark:text-amber-400', border: 'border-amber-200/80 dark:border-amber-800/60' },
  condition_branch: { bg: 'bg-rose-50 dark:bg-rose-950/40', iconBg: 'bg-rose-100 text-rose-600 dark:bg-rose-900 dark:text-rose-400', border: 'border-rose-200/80 dark:border-rose-800/60' },
  check_connection: { bg: 'bg-indigo-50 dark:bg-indigo-950/40', iconBg: 'bg-indigo-100 text-indigo-600 dark:bg-indigo-900 dark:text-indigo-400', border: 'border-indigo-200/80 dark:border-indigo-800/60' },
};

const STEP_LABELS: Record<string, string> = {
  inmail: 'InMail', connection_request: 'Invitation', profile_visit: 'Visite profil',
  message: 'Message', smart_message: 'Smart Msg', whatsapp_message: 'WhatsApp',
  email: 'Email', wait_connection: 'Attendre', wait_reply: 'Att. réponse',
  wait_profile_visit: 'Att. visite', condition_branch: 'Branchement', check_connection: 'Vérifier co.',
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
  const styles = STEP_STYLES[step.actionType] || { bg: 'bg-muted/40', iconBg: 'bg-muted text-muted-foreground', border: 'border-border' };
  const msgType = getStepMessageType(step, allSteps);

  const hasDelay = step.delayDays > 0 || step.delayHours > 0 || (step.delayMinutes && step.delayMinutes > 0);
  const delayLabel = [
    step.delayDays > 0 ? `${step.delayDays}j` : '',
    step.delayHours > 0 ? `${step.delayHours}h` : '',
    step.delayMinutes && step.delayMinutes > 0 ? `${step.delayMinutes}m` : '',
  ].filter(Boolean).join(' ');

  return (
    <>
      <Handle type="target" position={Position.Top} className="!w-2 !h-2 !bg-border !border-background !-top-1" />
      
      <div className={cn(
        "group relative rounded-xl border shadow-sm transition-all duration-200 cursor-pointer",
        styles.bg, styles.border,
        isSelected && "ring-2 ring-primary/30 ring-offset-2 ring-offset-background shadow-lg scale-[1.02]",
        compact ? "px-3 py-2 min-w-[140px]" : "px-4 py-3 min-w-[190px] max-w-[220px]",
      )}>
        <div className="flex items-center gap-3">
          <div className={cn(
            "rounded-lg flex items-center justify-center shrink-0",
            styles.iconBg,
            compact ? "w-6 h-6" : "w-9 h-9"
          )}>
            {isWhatsApp ? (
              <img src={whatsappLogo} alt="WhatsApp" className={compact ? "w-3 h-3" : "w-4.5 h-4.5"} />
            ) : Icon ? (
              <Icon className={compact ? "w-3 h-3" : "w-4.5 h-4.5"} />
            ) : (
              <Mail className={compact ? "w-3 h-3" : "w-4.5 h-4.5"} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            {!compact && (
              <div className="text-[10px] text-muted-foreground/50 leading-none mb-0.5 font-medium">
                Étape {index + 1}
              </div>
            )}
            <div className={cn(
              "font-semibold truncate leading-tight",
              compact ? "text-[12px]" : "text-[13px]"
            )}>
              {STEP_LABELS[step.actionType]}
            </div>
            {!compact && msgType && (
              <div className={cn("text-[9px] font-medium px-1.5 py-0.5 rounded-full w-fit mt-1", msgType.color)}>
                {msgType.shortLabel}
              </div>
            )}
            {hasDelay && (
              <div className={cn("text-muted-foreground/50 mt-0.5", compact ? "text-[9px]" : "text-[10px]")}>
                ⏱ {delayLabel}
              </div>
            )}
          </div>
        </div>

        {/* Remove button */}
        {canRemove && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="absolute -top-2 -right-2 w-5 h-5 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all duration-150 shadow-sm hover:scale-110"
          >
            <Trash2 className="w-2.5 h-2.5" />
          </button>
        )}
      </div>

      <Handle type="source" position={Position.Bottom} className="!w-2 !h-2 !bg-border !border-background !-bottom-1" />
    </>
  );
});

WorkflowStepNode.displayName = 'WorkflowStepNode';
