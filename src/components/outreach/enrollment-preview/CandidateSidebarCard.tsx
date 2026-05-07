import React, { useMemo } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { CandidateState, computeYearsOfExperience, getChannelAvailability } from './types';
import { cn } from '@/lib/utils';
import { Check, Pencil, MapPin, Briefcase, MoreVertical, X as XIcon, SkipForward, BarChart3, History, ExternalLink, Mail } from 'lucide-react';
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
// Logos officiels (cohérence avec le reste de la modal)
import linkedinLogo from '@/assets/linkedin-logo.svg';
import whatsappLogo from '@/assets/whatsapp-logo.svg';

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
        "group w-full max-w-full flex flex-col gap-2 px-3 py-2.5 rounded-xl text-left transition-all cursor-pointer relative border overflow-hidden",
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

      <div className="flex items-start gap-2.5 min-w-0">
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

        <div className="min-w-0 flex-1 overflow-hidden">
          <div className="flex items-center gap-1.5 min-w-0">
            <p className={cn(
              "text-[13px] font-semibold truncate text-foreground tracking-tight leading-tight min-w-0",
              state.skipped && "line-through"
            )}>
              {profile.name}
            </p>
            {state.skipped && (
              <Badge variant="outline" className="text-3xs h-4 px-1.5 border-warning/30 bg-warning/10 text-warning shrink-0">
                Passé
              </Badge>
            )}
            {hasEdits && (
              <span title="Édité manuellement" className="shrink-0">
                <Pencil className="w-2.5 h-2.5 text-warning" />
              </span>
            )}
          </div>
          {/* Headline en 2 lignes max (line-clamp) au lieu de truncate single ligne :
              les headlines LinkedIn sont souvent longues, 2 lignes lisibles >>
              "Tech Lead | Software Architect | Symfony C..." en 1 ligne tronquée */}
          <p
            className="text-2xs text-muted-foreground mt-0.5 leading-snug min-w-0 overflow-hidden"
            style={{
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              wordBreak: 'break-word',
            }}
          >
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
      <div className="flex items-center gap-2 pl-[44px] flex-wrap text-2xs">
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

      {/* Channel badges — vrais logos LinkedIn/WhatsApp + icon Lucide
          pour Email. Logo coloré quand dispo, grisé quand manquant. */}
      <TooltipProvider delayDuration={300}>
        <div className="flex items-center gap-1 pl-[44px]">
          <ChannelBadge
            available={channels.email}
            kind="email"
            tooltipMissing="Pas d'email — étapes Email skippées"
            tooltipAvailable="Email disponible"
          />
          <ChannelBadge
            available={channels.linkedin}
            kind="linkedin"
            tooltipMissing="Pas de profil LinkedIn"
            tooltipAvailable="LinkedIn disponible"
          />
          <ChannelBadge
            available={channels.whatsapp}
            kind="whatsapp"
            tooltipMissing="Pas de téléphone — étapes WhatsApp skippées"
            tooltipAvailable="WhatsApp disponible"
          />
        </div>
      </TooltipProvider>
    </div>
  );
});

function ChannelBadge({
  available, kind, tooltipMissing, tooltipAvailable,
}: {
  available: boolean;
  kind: 'email' | 'linkedin' | 'whatsapp';
  tooltipMissing: string;
  tooltipAvailable: string;
}) {
  const renderIcon = () => {
    if (kind === 'email') {
      return <Mail className="w-3 h-3" strokeWidth={2.25} />;
    }
    if (kind === 'linkedin') {
      return (
        <img
          src={linkedinLogo}
          alt=""
          className={cn(
            'w-3 h-3 object-contain',
            !available && 'opacity-40 grayscale',
          )}
          aria-hidden="true"
        />
      );
    }
    // whatsapp
    return (
      <img
        src={whatsappLogo}
        alt=""
        className={cn(
          'w-3 h-3 object-contain',
          !available && 'opacity-40 grayscale',
        )}
        aria-hidden="true"
      />
    );
  };

  const colorClass = (() => {
    if (!available) return 'border-border text-muted-foreground/50 bg-muted/30';
    if (kind === 'email') return 'border-info/30 text-info bg-info/10';
    if (kind === 'linkedin') return 'border-info/30 bg-info/10';
    return 'border-success/30 bg-success/10';
  })();

  const badge = (
    <span
      className={cn(
        'inline-flex items-center justify-center h-5 w-5 rounded border transition-colors',
        colorClass,
      )}
      aria-label={`${kind}${available ? ' disponible' : ' indisponible'}`}
    >
      {renderIcon()}
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
