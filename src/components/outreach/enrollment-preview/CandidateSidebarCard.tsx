import React, { useMemo } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { CandidateState, computeYearsOfExperience, getChannelAvailability } from './types';
import { cn } from '@/lib/utils';
import { Check, Pencil, MapPin, Briefcase, MoreVertical, X as XIcon, SkipForward, BarChart3, History, ExternalLink, Mail, Linkedin, MessageCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
// I3 — primitive partagée pour avatar candidat
import { CandidateAvatar } from '@/components/candidates/shared/CandidateAvatar';

interface Props {
  profile: LinkedInProfile;
  isSelected: boolean;
  allGenerated: boolean;
  hasEdits: boolean;
  state: CandidateState;
  score: number | null | undefined;
  onSelect: () => void;
  onRemove: () => void;
  onSkip: () => void;
  onViewScoring: () => void;
  onViewHistory: () => void;
}

export const CandidateSidebarCard = React.memo(function CandidateSidebarCard({
  profile, isSelected, allGenerated, hasEdits, state, score,
  onSelect, onRemove, onSkip, onViewScoring, onViewHistory,
}: Props) {
  const yearsXP = useMemo(() => computeYearsOfExperience(profile), [profile]);
  const channels = useMemo(() => getChannelAvailability(profile), [profile]);

  if (state.removed) return null;

  const linkedinUrl = profile.profile_url || profile.public_profile_url;

  return (
    <div
      onClick={onSelect}
      className={cn(
        "group w-full flex flex-col gap-2 px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer relative border",
        state.skipped && "opacity-50",
        isSelected
          ? "bg-foreground/[0.04] border-foreground/20 shadow-sm"
          : "bg-transparent border-transparent hover:bg-muted/40 hover:border-border"
      )}
    >
      {/* Active indicator bar (left) */}
      {isSelected && (
        <span
          className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full bg-foreground"
          aria-hidden="true"
        />
      )}

      <div className="flex items-start gap-2.5">
        {/* Avatar — taille augmentée pour plus de présence */}
        <div className="relative shrink-0">
          <CandidateAvatar
            name={profile.name}
            imageUrl={profile.profile_picture_url}
            size="sm"
            className="!w-9 !h-9 ring-1 ring-border"
          />
          {allGenerated && (
            <span
              className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full bg-success border-2 border-background grid place-items-center"
              title="Tous les messages générés"
            >
              <Check className="w-2 h-2 text-white" strokeWidth={3} />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className={cn(
              "text-[13px] font-semibold truncate text-foreground tracking-tight leading-tight",
              state.skipped && "line-through"
            )}>
              {profile.name}
            </p>
            {state.skipped && (
              <Badge variant="outline" className="text-[9px] h-4 px-1.5 border-warning/30 bg-warning/10 text-warning shrink-0">
                Passé
              </Badge>
            )}
            {hasEdits && (
              <span title="Édité manuellement">
                <Pencil className="w-2.5 h-2.5 text-warning shrink-0" />
              </span>
            )}
          </div>
          <p className="text-[11.5px] text-muted-foreground truncate mt-0.5 leading-snug">
            {profile.headline || '—'}
          </p>
        </div>

        {/* Action menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={e => e.stopPropagation()}
              className="h-6 w-6 grid place-items-center rounded-md opacity-0 group-hover:opacity-100 hover:bg-muted transition-all shrink-0"
            >
              <MoreVertical className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuItem onClick={e => { e.stopPropagation(); onRemove(); }}>
              <XIcon className="w-3.5 h-3.5 mr-2" /> Retirer de la sélection
            </DropdownMenuItem>
            <DropdownMenuItem onClick={e => { e.stopPropagation(); onSkip(); }}>
              <SkipForward className="w-3.5 h-3.5 mr-2" /> {state.skipped ? 'Réintégrer' : 'Passer'}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={e => { e.stopPropagation(); onViewScoring(); }}>
              <BarChart3 className="w-3.5 h-3.5 mr-2" /> Voir le scoring
            </DropdownMenuItem>
            <DropdownMenuItem onClick={e => { e.stopPropagation(); onViewHistory(); }}>
              <History className="w-3.5 h-3.5 mr-2" /> Voir l'historique
            </DropdownMenuItem>
            {linkedinUrl && (
              <DropdownMenuItem onClick={e => { e.stopPropagation(); window.open(linkedinUrl, '_blank'); }}>
                <ExternalLink className="w-3.5 h-3.5 mr-2" /> Ouvrir LinkedIn
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Meta row : meilleure typographie + score plus visible */}
      <div className="flex items-center gap-2 pl-[44px] flex-wrap text-[10.5px]">
        {profile.location && (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <MapPin className="w-2.5 h-2.5" />
            {profile.location.split(',')[0]}
          </span>
        )}
        {yearsXP != null && (
          <span className="inline-flex items-center gap-1 text-muted-foreground tabular-nums">
            <Briefcase className="w-2.5 h-2.5" />
            {yearsXP}<span className="opacity-60">ans</span>
          </span>
        )}
        {score != null && (
          <span className={cn(
            "inline-flex items-center px-1.5 py-0.5 rounded-full font-semibold tabular-nums border",
            score >= 70 ? "bg-success/10 text-success border-success/30"
              : score >= 50 ? "bg-warning/10 text-warning border-warning/30"
              : "bg-muted/50 text-muted-foreground border-border"
          )}>
            {score}
          </span>
        )}
      </div>

      {/* Channel badges — icônes Lucide color-coded au lieu de croix/check
          textuelles. Plus scannable d'un coup d'œil : icône colorée =
          dispo, icône grisée = manquante. */}
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-1 pl-10">
          <ChannelBadge available={channels.email} icon={Mail} label="Email" tooltipMissing="Pas d'email — étapes Email skippées" tooltipAvailable="Email disponible" />
          <ChannelBadge available={channels.linkedin} icon={Linkedin} label="LinkedIn" tooltipMissing="Pas de profil LinkedIn" tooltipAvailable="LinkedIn disponible" />
          <ChannelBadge available={channels.whatsapp} icon={MessageCircle} label="WhatsApp" tooltipMissing="Pas de téléphone — étapes WhatsApp skippées" tooltipAvailable="WhatsApp disponible" />
        </div>
      </TooltipProvider>
    </div>
  );
});

function ChannelBadge({
  available, icon: Icon, label, tooltipMissing, tooltipAvailable,
}: {
  available: boolean;
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  tooltipMissing: string;
  tooltipAvailable: string;
}) {
  const badge = (
    <span
      className={cn(
        'inline-flex items-center justify-center h-5 w-5 rounded border transition-colors',
        available
          ? 'border-success/30 text-success bg-success/10'
          : 'border-border text-muted-foreground/50 bg-muted/30',
      )}
      aria-label={`${label}${available ? ' disponible' : ' indisponible'}`}
    >
      <Icon className="w-3 h-3" />
    </span>
  );

  return (
    <Tooltip>
      <TooltipTrigger asChild>{badge}</TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs">
        {available ? tooltipAvailable : tooltipMissing}
      </TooltipContent>
    </Tooltip>
  );
}
