import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Info, Search, User, UserPlus, Mail, Shield, Send, CirclePause } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLinkedInQuotaStatus, rampStageLabel, LinkedInQuotaStatus } from '@/hooks/useLinkedInQuotaStatus';

const SafeModeBadge = () => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider bg-success/10 text-success border border-success/20 cursor-help">
          <Shield className="w-2.5 h-2.5" />
          Mode protégé
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="text-xs leading-relaxed">
          Konekt protège votre compte LinkedIn : actions uniquement aux heures ouvrées, du lundi au vendredi,
          dans votre fuseau ; 80 actions visibles par jour ; 100 invitations par 7 jours ; 5 à 15 secondes
          entre deux actions d'une séquence ; pause automatique de 16 h dès 90 % d'usage ou au premier signal
          de limite ; montée en charge sur trois semaines pour un compte neuf ; anti-doublon dans votre organisation.
        </p>
      </TooltipContent>
    </Tooltip>
  </TooltipProvider>
);

interface QuotaItemProps {
  label: string;
  current: number;
  limit: number;
  icon: React.ReactNode;
}

const QuotaItem: React.FC<QuotaItemProps> = ({ label, current, limit, icon }) => {
  const percentUsed = limit > 0 ? Math.min(100, (current / limit) * 100) : 0;
  const isWarning = percentUsed >= 80;
  const isCritical = percentUsed >= 95;

  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "w-6 h-6 flex items-center justify-center",
        isCritical ? "bg-destructive/10 text-destructive" :
        isWarning ? "bg-warning/10 text-warning" :
        "bg-muted text-muted-foreground"
      )}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground truncate">{label}</span>
          <span className={cn(
            "font-medium tabular-nums",
            isCritical ? "text-destructive" :
            isWarning ? "text-warning" :
            "text-foreground"
          )}>
            {current}/{limit}
          </span>
        </div>
        <Progress
          value={percentUsed}
          className={cn(
            "h-1.5 mt-1",
            isCritical ? "[&>div]:bg-destructive" :
            isWarning ? "[&>div]:bg-warning" :
            "[&>div]:bg-linkedin"
          )}
        />
      </div>
      {(isWarning || isCritical) && (
        <AlertTriangle className={cn(
          "w-3.5 h-3.5 shrink-0",
          isCritical ? "text-destructive" : "text-warning"
        )} />
      )}
    </div>
  );
};

interface QuotaDisplayProps {
  /** Compte LinkedIn sélectionné. Rien n'est affiché sans compte. */
  accountId: string | null | undefined;
  compact?: boolean;
}

const formatHourMinute = (iso: string, timeZone: string): string => {
  try {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone });
  } catch {
    return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  }
};

const isPaused = (status: LinkedInQuotaStatus): boolean =>
  !!status.paused_until && new Date(status.paused_until).getTime() > Date.now();

/** Part la plus consommée parmi les plafonds, en pourcentage. */
const maxPercentUsed = (status: LinkedInQuotaStatus): number => {
  const ratios = [
    [status.today.visible_actions, status.caps.visible_actions],
    [status.today.profile_views, status.caps.profile_views],
    [status.today.searches, status.caps.searches],
    [status.today.inmails, status.caps.inmails],
    [status.week.invitations, status.caps.weekly_invitations],
  ].map(([used, cap]) => (cap > 0 ? (used / cap) * 100 : 0));
  return Math.min(100, Math.max(0, ...ratios));
};

const QuotaItems: React.FC<{ status: LinkedInQuotaStatus; className?: string }> = ({ status, className }) => (
  <div className={className}>
    <QuotaItem
      label="Actions visibles"
      current={status.today.visible_actions}
      limit={status.caps.visible_actions}
      icon={<Send className="w-3.5 h-3.5" />}
    />
    <QuotaItem
      label="Visites de profils"
      current={status.today.profile_views}
      limit={status.caps.profile_views}
      icon={<User className="w-3.5 h-3.5" />}
    />
    <QuotaItem
      label="Recherches"
      current={status.today.searches}
      limit={status.caps.searches}
      icon={<Search className="w-3.5 h-3.5" />}
    />
    <QuotaItem
      label="InMails"
      current={status.today.inmails}
      limit={status.caps.inmails}
      icon={<Mail className="w-3.5 h-3.5" />}
    />
    <QuotaItem
      label="Invitations (7 jours)"
      current={status.week.invitations}
      limit={status.caps.weekly_invitations}
      icon={<UserPlus className="w-3.5 h-3.5" />}
    />
  </div>
);

const QuotaFooter: React.FC<{ status: LinkedInQuotaStatus }> = ({ status }) => (
  <div className="text-xs text-muted-foreground mt-3 space-y-1">
    {isPaused(status) && status.paused_until && (
      <p className="flex items-start gap-1 text-warning">
        <CirclePause className="w-3 h-3 mt-0.5 shrink-0" />
        Pause en cours jusqu'à {formatHourMinute(status.paused_until, status.timezone)}
      </p>
    )}
    <p className="flex items-start gap-1">
      <Info className="w-3 h-3 mt-0.5 shrink-0" />
      {rampStageLabel(status.ramp_stage)}. Compteurs du jour remis à zéro à {formatHourMinute(status.day_resets_at, status.timezone)}.
    </p>
  </div>
);

export const QuotaDisplay: React.FC<QuotaDisplayProps> = ({ accountId, compact = false }) => {
  const { data: status } = useLinkedInQuotaStatus(accountId);

  // Aucun compte sélectionné, chargement, ou compte non rattaché : rien à afficher.
  if (!accountId || !status) return null;

  if (compact) {
    const percentUsed = maxPercentUsed(status);
    const paused = isPaused(status);
    const isWarning = percentUsed >= 70;
    const isCritical = percentUsed >= 90 || paused;

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 text-xs font-medium cursor-help border",
              isCritical ? "bg-destructive/10 text-destructive border-destructive/30" :
              isWarning ? "bg-warning/10 text-warning border-warning/30" :
              "bg-muted text-foreground border-border"
            )}>
              {paused ? <CirclePause className="w-3 h-3" /> : (isWarning || isCritical) && <AlertTriangle className="w-3 h-3" />}
              <span>{paused ? 'En pause' : `Quota : ${Math.round(percentUsed)} %`}</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="w-64 p-3">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-medium">Plafonds LinkedIn du jour</p>
              <SafeModeBadge />
            </div>
            <QuotaItems status={status} className="space-y-2.5" />
            <QuotaFooter status={status} />
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="bg-background border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">Plafonds LinkedIn du jour</h4>
          <SafeModeBadge />
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-4 h-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p className="text-xs">
                Compteurs mesurés côté serveur pour ce compte. Les plafonds tiennent compte du palier
                de montée en charge et des limites définies dans vos paramètres.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>

      <QuotaItems status={status} className="space-y-3" />
      <QuotaFooter status={status} />
    </div>
  );
};
