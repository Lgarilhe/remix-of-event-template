import React, { useMemo, useRef } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { CandidateState, computeYearsOfExperience, getChannelAvailability } from './types';
import { cn } from '@/lib/utils';
import { Check, ExternalLink, History, MailX, MoreHorizontal, PhoneOff, Pencil, SkipForward, BarChart3, X as XIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ScoreBadge } from '@/components/ui/score-badge';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
// I3 — primitive partagée pour avatar candidat
import { CandidateAvatar } from '@/components/candidates/shared/CandidateAvatar';

interface Props {
  profile: LinkedInProfile;
  isSelected: boolean;
  allGenerated: boolean;
  hasEdits: boolean;
  state: CandidateState;
  score: number | null | undefined;
  /** Texte d'aide des raccourcis de la liste (aria-describedby). */
  shortcutsHelpId?: string;
  onSelect: () => void;
  onRemove: () => void;
  onSkip: () => void;
  onViewScoring: () => void;
  onViewHistory: () => void;
}

/**
 * Ligne d'un candidat dans la préparation : un bouton qui affiche ses aperçus
 * et un menu « Actions » toujours visible, au doigt comme au clavier. Les
 * raccourcis (↑ ↓, P, X ou Suppr) sont gérés par la liste (revue design D-44).
 */
export const CandidateSidebarCard = React.memo(function CandidateSidebarCard({
  profile, isSelected, allGenerated, hasEdits, state, score, shortcutsHelpId,
  onSelect, onRemove, onSkip, onViewScoring, onViewHistory,
}: Props) {
  const yearsXP = useMemo(() => computeYearsOfExperience(profile), [profile]);
  const channels = useMemo(() => getChannelAvailability(profile), [profile]);
  // La fenêtre du score ou de l'historique ne s'ouvre qu'une fois le menu
  // refermé : ouverte pendant sa fermeture, elle perdait aussitôt le focus et
  // se refermait (souris comme clavier).
  const pendingPanelRef = useRef<'score' | 'history' | null>(null);

  if (state.removed) return null;

  const linkedinUrl = profile.profile_url || profile.public_profile_url;
  const name = profile.name || 'Candidat sans nom';
  const city = profile.location?.split(',')[0];

  return (
    <div className="relative">
      <Button
        type="button"
        variant="ghost"
        data-candidate-id={profile.id}
        aria-current={isSelected ? 'true' : undefined}
        aria-describedby={shortcutsHelpId}
        onClick={onSelect}
        className={cn(
          // Ligne de liste : pleine largeur, sur plusieurs lignes, sans effet d'appui.
          'h-auto w-full min-w-0 items-start justify-start gap-2.5 whitespace-normal border px-3 py-2.5 pr-11 text-left font-normal active:scale-100 max-md:pr-14 [&_svg]:size-3',
          isSelected ? 'border-border-strong bg-accent' : 'border-transparent',
        )}
      >
        <CandidateAvatar name={profile.name} imageUrl={profile.profile_picture_url} size="sm" className="mt-0.5" />

        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn('truncate text-sm font-semibold leading-tight', state.skipped ? 'text-muted-foreground' : 'text-foreground')}>
              {name}
            </span>
            {state.skipped && <Badge variant="muted" className="shrink-0 px-1.5 py-0 text-3xs">Passé</Badge>}
          </span>
          {profile.headline && (
            <span className="mt-0.5 line-clamp-2 break-words text-xs text-muted-foreground">{profile.headline}</span>
          )}

          {(city || yearsXP != null || score != null) && (
            <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              {city && <span>{city}</span>}
              {yearsXP != null && <span className="tabular-nums">{yearsXP} ans d'exp.</span>}
              <ScoreBadge score={score} className="px-1.5 py-0" />
            </span>
          )}

          {/* Canaux : logo ou icône quand le candidat est joignable, le manque
              écrit en toutes lettres (jamais la couleur ni l'opacité seules). */}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <ChannelAvailability available={channels.linkedin} channel="linkedin" />
            <ChannelAvailability available={channels.email} channel="email" />
            <ChannelAvailability available={channels.whatsapp} channel="whatsapp" />
            {(allGenerated || hasEdits) && (
              <span className="ml-auto inline-flex items-center gap-1">
                {hasEdits ? <Pencil aria-hidden="true" /> : <Check aria-hidden="true" />}
                {hasEdits ? 'Retouché' : 'Aperçus prêts'}
              </span>
            )}
          </span>
        </span>
      </Button>

      {/* Actions : toujours visibles (plus d'apparition au survol seul). */}
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={`Actions pour ${name}`}
                className="absolute right-1.5 top-1.5 text-muted-foreground max-md:h-11 max-md:w-11"
              >
                <MoreHorizontal aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          <TooltipContent side="left">Actions</TooltipContent>
        </Tooltip>
        <DropdownMenuContent
          align="end"
          className="w-56"
          onCloseAutoFocus={(e) => {
            const panel = pendingPanelRef.current;
            if (!panel) return;
            e.preventDefault();
            pendingPanelRef.current = null;
            if (panel === 'score') onViewScoring();
            else onViewHistory();
          }}
        >
          <DropdownMenuItem onSelect={onRemove}>
            <XIcon className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Retirer de la sélection
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onSkip}>
            <SkipForward className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> {state.skipped ? 'Réintégrer' : 'Passer ce candidat'}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { pendingPanelRef.current = 'score'; }}>
            <BarChart3 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Voir le détail du score
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => { pendingPanelRef.current = 'history'; }}>
            <History className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Voir l'historique
          </DropdownMenuItem>
          {linkedinUrl && (
            <DropdownMenuItem onSelect={() => window.open(linkedinUrl, '_blank', 'noopener,noreferrer')}>
              <ExternalLink className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Ouvrir le profil LinkedIn
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});

const MISSING: Record<'linkedin' | 'email' | 'whatsapp', { icon: React.ElementType; text: string; label: string }> = {
  linkedin: { icon: XIcon, text: 'sans LinkedIn', label: 'Pas de profil LinkedIn' },
  email: { icon: MailX, text: 'sans e-mail', label: "Pas d'adresse e-mail : les étapes e-mail seront ignorées" },
  whatsapp: { icon: PhoneOff, text: 'sans tél.', label: 'Pas de téléphone : les messages WhatsApp seront ignorés' },
};

const AVAILABLE: Record<'linkedin' | 'email' | 'whatsapp', string> = {
  linkedin: 'LinkedIn disponible',
  email: 'Adresse e-mail disponible',
  whatsapp: 'Téléphone disponible pour WhatsApp',
};

/** Canal joignable (logo ou icône du canal) ou manquant (icône et mot). */
function ChannelAvailability({ available, channel }: { available: boolean; channel: 'linkedin' | 'email' | 'whatsapp' }) {
  if (available) {
    return (
      <span className="inline-flex" title={AVAILABLE[channel]}>
        <span className="sr-only">{AVAILABLE[channel]}</span>
        <span aria-hidden="true" className="inline-flex">
          <ChannelIcon channel={channel} size="xs" />
        </span>
      </span>
    );
  }
  const Missing = MISSING[channel].icon;
  return (
    <span className="inline-flex items-center gap-0.5" title={MISSING[channel].label}>
      <Missing aria-hidden="true" />
      <span aria-hidden="true">{MISSING[channel].text}</span>
      <span className="sr-only">{MISSING[channel].label}</span>
    </span>
  );
}
