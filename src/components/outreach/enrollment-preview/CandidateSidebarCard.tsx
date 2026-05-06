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
        "group w-full flex flex-col gap-1 px-2 py-2 rounded-md text-left transition-colors cursor-pointer relative",
        state.skipped && "opacity-50",
        isSelected ? "bg-accent/50 ring-1 ring-foreground/10" : "hover:bg-muted/50"
      )}
    >
      <div className="flex items-start gap-2">
        {/* Avatar — primitive partagée I3 */}
        <CandidateAvatar
          name={profile.name}
          imageUrl={profile.profile_picture_url}
          size="sm"
        />

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className={cn("text-xs font-medium truncate", state.skipped && "line-through")}>{profile.name}</p>
            {state.skipped && (
              <Badge variant="outline" className="text-[9px] h-4 px-1 border-warning/30 bg-warning/10 text-warning shrink-0">Passé</Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground truncate">{profile.headline}</p>
        </div>

        {/* Status indicators */}
        <div className="flex items-center gap-0.5 shrink-0">
          {allGenerated && <Check className="w-3 h-3 text-success" />}
          {hasEdits && <Pencil className="w-2.5 h-2.5 text-warning" />}
        </div>

        {/* Action menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              onClick={e => e.stopPropagation()}
              className="p-0.5 rounded opacity-0 group-hover:opacity-100 hover:bg-muted transition-all shrink-0"
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

      {/* Meta row */}
      <div className="flex items-center gap-1.5 pl-10 flex-wrap">
        {profile.location && (
          <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
            <MapPin className="w-2.5 h-2.5" /> {profile.location.split(',')[0]}
          </span>
        )}
        {yearsXP != null && (
          <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
            <Briefcase className="w-2.5 h-2.5" /> {yearsXP} ans
          </span>
        )}
        {score != null && (
          <Badge variant="outline" className="text-[9px] h-4 px-1 gap-0.5">
            {score}%
          </Badge>
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
