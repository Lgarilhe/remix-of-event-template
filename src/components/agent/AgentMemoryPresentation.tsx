import type { ReactNode } from 'react';
import { Brain, Check, Loader2, Pencil, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  AGENT_MEMORY_EFFECT_LABEL, AGENT_MEMORY_KIND_LABEL, agentMemoryScopeLabel,
  type AgentMemoryDraft,
} from '@/types/agentMemory';

type OrganizationType = 'agency' | 'enterprise' | 'freelance' | null;

/** Shared surfaces contain presentation only; actions and permissions stay with their callers. */
export function AgentMemoryProposalFrame({ legacy = false, children }: { legacy?: boolean; children: ReactNode }) {
  return (
    <Card role="article" aria-label="Proposition de mémoire" className="p-3 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium"><Brain aria-hidden="true" className="h-4 w-4 shrink-0" />À garder en mémoire ?</div>
      {legacy && <p className="text-xs text-muted-foreground">Ancienne mémoire automatique : à vérifier avant de la confirmer.</p>}
      {children}
    </Card>
  );
}

export function AgentMemoryConfirmedFrame({ automatic = false, children }: { automatic?: boolean; children: ReactNode }) {
  return <article aria-label={automatic ? 'Mémoire automatique' : 'Mémoire confirmée'} className="p-4 space-y-2">{children}</article>;
}

interface SummaryProps {
  value: AgentMemoryDraft;
  orgType: OrganizationType;
  variant: 'proposal' | 'confirmed';
  automatic?: boolean;
  date?: { at: string; expiresAt?: string | null };
}

export function AgentMemorySummary({ value, orgType, variant, automatic = false, date }: SummaryProps) {
  const badges = <div className="flex flex-wrap gap-1.5">
    <Badge variant="secondary" data-memory-scope="true">{agentMemoryScopeLabel(value.scope, orgType)}</Badge>
    <Badge variant="outline">{AGENT_MEMORY_KIND_LABEL[value.kind]}</Badge>
    {variant === 'confirmed' && automatic && <Badge variant="outline">Automatique</Badge>}
  </div>;
  return (
    <>
      {variant === 'confirmed' && badges}
      <p className="text-sm whitespace-pre-wrap break-words">{value.content}</p>
      {variant === 'proposal' && badges}
      <p className="text-xs text-muted-foreground">{variant === 'proposal' ? 'Effet' : 'Effets'} : {value.effects.map((effect) => AGENT_MEMORY_EFFECT_LABEL[effect]).join(', ')}.</p>
      {date && <p className="text-xs text-muted-foreground">{automatic ? 'Ajoutée automatiquement le' : 'Confirmée le'} {new Date(date.at).toLocaleDateString('fr-FR')}
        {date.expiresAt && ` · expire le ${new Date(date.expiresAt).toLocaleDateString('fr-FR')}`}</p>}
    </>
  );
}

interface ActionsProps {
  editing?: boolean;
  busy?: 'approve' | 'dismiss' | null;
  disabled?: boolean;
  approveDisabled?: boolean;
  onApprove?: () => void;
  onEdit?: () => void;
  onDismiss?: () => void;
  /** A decorative example keeps the real button styles without controls or event handlers. */
  illustrative?: boolean;
}

export function AgentMemoryProposalActions({ editing = false, busy = null, disabled = false, approveDisabled = false,
  onApprove, onEdit, onDismiss, illustrative = false }: ActionsProps) {
  const actions = [
    { key: 'approve', variant: 'primary' as const, className: 'min-h-11 md:min-h-0', disabled: disabled || approveDisabled,
      onClick: onApprove, busy: busy === 'approve', label: editing ? 'Garder les modifications' : 'Garder',
      icon: busy === 'approve' ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <Check aria-hidden="true" className="h-3.5 w-3.5" /> },
    { key: 'edit', variant: 'ghost' as const, className: 'min-h-11 md:min-h-0', disabled,
      onClick: onEdit, label: editing ? 'Fermer l’édition' : 'Modifier', icon: <Pencil aria-hidden="true" className="h-3.5 w-3.5" /> },
    { key: 'dismiss', variant: 'ghost' as const, className: 'min-h-11 text-muted-foreground md:min-h-0', disabled,
      onClick: onDismiss, busy: busy === 'dismiss', label: 'Ignorer',
      icon: busy === 'dismiss' ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" /> : <X aria-hidden="true" className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.map((action) => {
        const content = <>{action.icon}{action.label}</>;
        return <Button key={action.key} asChild={illustrative} size="sm" variant={action.variant} className={action.className}
          data-memory-keep={action.key === 'approve' ? 'true' : undefined}
          {...(illustrative ? {} : { type: 'button' as const, disabled: action.disabled, onClick: action.onClick, 'aria-busy': action.busy })}>
          {illustrative ? <span aria-hidden="true">{content}</span> : content}
        </Button>;
      })}
    </div>
  );
}
