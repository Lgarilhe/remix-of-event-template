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
  inmail:             { bg: 'bg-info/10',            iconBg: 'bg-info text-info-foreground',            border: 'border-info/30',            accent: 'shadow-info/20' },
  connection_request: { bg: 'bg-success/10',         iconBg: 'bg-success text-success-foreground',     border: 'border-success/30',         accent: 'shadow-success/20' },
  profile_visit:      { bg: 'bg-info/10',            iconBg: 'bg-info text-info-foreground',            border: 'border-info/30',            accent: 'shadow-info/20' },
  message:            { bg: 'bg-warning/10',         iconBg: 'bg-warning text-warning-foreground',     border: 'border-warning/30',         accent: 'shadow-warning/20' },
  smart_message:      { bg: 'bg-brand-purple/10',    iconBg: 'bg-brand-purple text-white',              border: 'border-brand-purple/30',    accent: 'shadow-brand-purple/20' },
  whatsapp_message:   { bg: 'bg-whatsapp/10',        iconBg: 'bg-whatsapp text-white',                  border: 'border-whatsapp/30',        accent: 'shadow-whatsapp/20' },
  email:              { bg: 'bg-brand-purple/10',     iconBg: 'bg-brand-purple text-white',              border: 'border-brand-purple/30',    accent: 'shadow-brand-purple/20' },
  wait_connection:    { bg: 'bg-warning/10',         iconBg: 'bg-warning text-warning-foreground',     border: 'border-warning/30',         accent: 'shadow-warning/20' },
  wait_reply:         { bg: 'bg-warning/10',         iconBg: 'bg-warning text-warning-foreground',     border: 'border-warning/30',         accent: 'shadow-warning/20' },
  wait_profile_visit: { bg: 'bg-warning/10',         iconBg: 'bg-warning text-warning-foreground',     border: 'border-warning/30',         accent: 'shadow-warning/20' },
  condition_branch:   { bg: 'bg-destructive/10',     iconBg: 'bg-destructive text-destructive-foreground', border: 'border-destructive/30', accent: 'shadow-destructive/20' },
  check_connection:   { bg: 'bg-info/10',            iconBg: 'bg-info text-info-foreground',            border: 'border-info/30',            accent: 'shadow-info/20' },
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
              <div className="text-3xs text-muted-foreground/50 leading-none mb-0.5 font-medium uppercase tracking-wider">
                Étape {index + 1}
              </div>
            )}
            <div className={cn(
              "font-semibold truncate leading-tight",
              compact ? "text-xs" : "text-xs"
            )}>
              {STEP_LABELS[step.actionType] || step.actionType}
            </div>
            {!compact && msgType && (
              <div className={cn("text-3xs font-semibold px-1.5 py-0.5 rounded-full w-fit mt-1", msgType.color)}>
                {msgType.shortLabel}
              </div>
            )}
            {hasDelay && (
              <div className={cn("flex items-center gap-1 text-muted-foreground/60 mt-0.5", compact ? "text-3xs" : "text-3xs")}>
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
