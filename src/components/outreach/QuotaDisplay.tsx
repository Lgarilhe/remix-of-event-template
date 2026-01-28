import React from 'react';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { AlertTriangle, Info, Search, User, MessageSquare, UserPlus, Mail } from 'lucide-react';
import { cn } from '@/lib/utils';

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
        "w-6 h-6 rounded flex items-center justify-center",
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
  isPremium?: boolean;
  compact?: boolean;
}

export const QuotaDisplay: React.FC<QuotaDisplayProps> = ({
  searchResultsFetched,
  profileVisits,
  messagesSent,
  invitationsSent,
  inmailsSent,
  isPremium = false,
  compact = false,
}) => {
  const searchLimit = isPremium ? 2500 : 1000;
  const profileLimit = isPremium ? 1000 : 100;
  const inviteLimit = isPremium ? 80 : 5;
  const inmailLimit = isPremium ? 50 : 10;

  if (compact) {
    const totalUsed = searchResultsFetched + profileVisits + messagesSent;
    const totalLimit = searchLimit + 100 + 100;
    const percentUsed = Math.min(100, (totalUsed / totalLimit) * 100);
    const isWarning = percentUsed >= 70;
    const isCritical = percentUsed >= 90;

    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium cursor-help",
              isCritical ? "bg-red-100 text-red-700" :
              isWarning ? "bg-amber-100 text-amber-700" :
              "bg-[#0077B5]/10 text-[#0077B5]"
            )}>
              {(isWarning || isCritical) && <AlertTriangle className="w-3 h-3" />}
              <span>Quota: {Math.round(percentUsed)}%</span>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="w-64 p-3">
            <p className="text-xs font-medium mb-3">Quotas LinkedIn journaliers</p>
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
                limit={100}
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
              Limites recommandées par Unipile pour éviter les restrictions LinkedIn
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-medium">Quotas LinkedIn (journaliers)</h4>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger>
              <Info className="w-4 h-4 text-muted-foreground" />
            </TooltipTrigger>
            <TooltipContent side="left" className="max-w-xs">
              <p className="text-xs">
                Limites recommandées par Unipile pour éviter les restrictions de compte LinkedIn.
                Ces quotas se réinitialisent chaque jour.
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
          limit={100}
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
