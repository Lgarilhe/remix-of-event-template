import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Info, Search, User, MessageSquare, UserPlus, Mail, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { LinkedInApiMode, LINKEDIN_LIMITS } from '@/hooks/useUnipileQuota';

const SafeModeBadge = () => (
  <TooltipProvider>
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 cursor-help">
          <Shield className="w-2.5 h-2.5" />
          Safe mode
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        <p className="text-xs">
          Quotas conservateurs activés pour protéger votre compte LinkedIn.
          Limites réduites, délais de 45-90s entre actions, warm-up progressif sur 2 semaines.
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
  const percentUsed = Math.min(100, (current / limit) * 100);
  const remaining = Math.max(0, limit - current);
  const isWarning = percentUsed >= 80;
  const isCritical = percentUsed >= 95;

  return (
    <div className="flex items-center gap-2">
      <div className={cn(
        "w-6 h-6 flex items-center justify-center",
        isCritical ? "bg-red-100 text-red-600" :
        isWarning ? "bg-amber-100 text-amber-600" :
        "bg-muted text-muted-foreground"
      )}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground truncate">{label}</span>
          <span className={cn(
            "font-medium",
            isCritical ? "text-red-600" :
            isWarning ? "text-amber-600" :
            "text-foreground"
          )}>
            {remaining}/{limit}
          </span>
        </div>
        <Progress 
          value={percentUsed} 
          className={cn(
            "h-1.5 mt-1",
            isCritical ? "[&>div]:bg-red-500" :
            isWarning ? "[&>div]:bg-amber-500" :
            "[&>div]:bg-[#0077B5]"
          )}
        />
      </div>
      {(isWarning || isCritical) && (
        <AlertTriangle className={cn(
          "w-3.5 h-3.5 shrink-0",
          isCritical ? "text-red-500" : "text-amber-500"
        )} />
      )}
    </div>
  );
};

interface QuotaDisplayProps {
  searchResultsFetched: number;
  profileVisits: number;
  messagesSent: number;
  invitationsSent: number;
  inmailsSent: number;
  apiMode?: LinkedInApiMode;
  compact?: boolean;
}

const getApiModeLabel = (mode: LinkedInApiMode): string => {
  switch (mode) {
    case 'recruiter': return 'Recruiter';
    case 'sales_navigator': return 'Sales Nav';
    case 'database': return 'Base Konekt';
    default: return 'Classic';
  }
};

export const QuotaDisplay: React.FC<QuotaDisplayProps> = ({
  searchResultsFetched,
  profileVisits,
  messagesSent,
  invitationsSent,
  inmailsSent,
  apiMode = 'classic',
  compact = false,
}) => {
  const isDatabaseMode = apiMode === 'database';
  const searchLimit = isDatabaseMode ? 999999 : LINKEDIN_LIMITS.SEARCH_RESULTS[apiMode];
  const profileLimit = isDatabaseMode ? 1 : LINKEDIN_LIMITS.PROFILE_VISITS[apiMode];
  const messageLimit = isDatabaseMode ? 1 : LINKEDIN_LIMITS.MESSAGES[apiMode];
  const inviteLimit = isDatabaseMode ? 1 : LINKEDIN_LIMITS.INVITATIONS[apiMode];
  const inmailLimit = isDatabaseMode ? 1 : LINKEDIN_LIMITS.INMAIL_DAILY[apiMode];

  if (compact) {
    if (isDatabaseMode) {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium border bg-muted text-foreground border-foreground">
          <span>Base Konekt</span>
        </div>
      );
    }

    const totalUsed = searchResultsFetched + profileVisits + messagesSent;
    const totalLimit = searchLimit + profileLimit + messageLimit;
    const percentUsed = Math.min(100, (totalUsed / totalLimit) * 100);
    const isWarning = percentUsed >= 70;
    const isCritical = percentUsed >= 90;

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 text-xs font-medium cursor-help border",
              isCritical ? "bg-destructive/10 text-destructive border-destructive/30" :
              isWarning ? "bg-amber-100 text-amber-700 border-amber-300" :
              "bg-muted text-foreground border-foreground"
            )}>
              {(isWarning || isCritical) && <AlertTriangle className="w-3 h-3" />}
              <span>Quota: {Math.round(percentUsed)}%</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="w-64 p-3">
            <div className="flex items-center gap-2 mb-3">
              <p className="text-xs font-medium">Quotas LinkedIn ({getApiModeLabel(apiMode)})</p>
              <SafeModeBadge />
            </div>
            <div className="space-y-2.5">
              <QuotaItem
                label="Résultats recherche"
                current={searchResultsFetched}
                limit={searchLimit}
                icon={<Search className="w-3.5 h-3.5" />}
              />
              <QuotaItem
                label="Visites profils"
                current={profileVisits}
                limit={profileLimit}
                icon={<User className="w-3.5 h-3.5" />}
              />
              <QuotaItem
                label="Messages"
                current={messagesSent}
                limit={messageLimit}
                icon={<MessageSquare className="w-3.5 h-3.5" />}
              />
              <QuotaItem
                label="Invitations"
                current={invitationsSent}
                limit={inviteLimit}
                icon={<UserPlus className="w-3.5 h-3.5" />}
              />
              <QuotaItem
                label="InMails"
                current={inmailsSent}
                limit={inmailLimit}
                icon={<Mail className="w-3.5 h-3.5" />}
              />
            </div>
            <p className="text-[10px] text-muted-foreground mt-3 flex items-start gap-1">
              <Info className="w-3 h-3 mt-0.5 shrink-0" />
              Limites pour {getApiModeLabel(apiMode)} - se réinitialisent chaque jour
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="bg-background border border-foreground p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-medium">Quotas LinkedIn ({getApiModeLabel(apiMode)})</h4>
          <SafeModeBadge />
        </div>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-4 h-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p className="text-xs">
              Safe mode activé : quotas conservateurs pour protéger votre compte LinkedIn.
              Limites réduites vs les maximums techniques. Réinitialisation quotidienne.
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      
      <div className="space-y-3">
        <QuotaItem
          label="Résultats recherche"
          current={searchResultsFetched}
          limit={searchLimit}
          icon={<Search className="w-3.5 h-3.5" />}
        />
        <QuotaItem
          label="Visites profils"
          current={profileVisits}
          limit={profileLimit}
          icon={<User className="w-3.5 h-3.5" />}
        />
        <QuotaItem
          label="Messages"
          current={messagesSent}
          limit={messageLimit}
          icon={<MessageSquare className="w-3.5 h-3.5" />}
        />
        <QuotaItem
          label="Invitations"
          current={invitationsSent}
          limit={inviteLimit}
          icon={<UserPlus className="w-3.5 h-3.5" />}
        />
        <QuotaItem
          label="InMails"
          current={inmailsSent}
          limit={inmailLimit}
          icon={<Mail className="w-3.5 h-3.5" />}
        />
      </div>
    </div>
  );
};
