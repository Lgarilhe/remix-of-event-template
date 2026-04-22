/**
 * CandidateBadge — micro-card candidat compacte, partagée (I3).
 *
 * Usage : tout endroit où on veut afficher "ce candidat" en inline :
 * - cartes d'approbation tool (AgentToolApprovalCard)
 * - feed d'activité
 * - liste de prospects dans modal
 * - panneau historique
 *
 * Variantes :
 * - inline : avatar xs + name 1 ligne (pour mentions)
 * - compact : avatar sm + name + headline 1 ligne (pour listes denses)
 * - card : avatar md + name + headline + meta optionnelle (pour cards)
 */

import React from 'react';
import { cn } from '@/lib/utils';
import { CandidateAvatar, type AvatarSize } from './CandidateAvatar';
import { ExternalLink } from 'lucide-react';

export type CandidateBadgeVariant = 'inline' | 'compact' | 'card';

export interface CandidateBadgeProps {
  name?: string | null;
  headline?: string | null;
  imageUrl?: string | null;
  linkedinUrl?: string | null;

  /** Variante de densité */
  variant?: CandidateBadgeVariant;

  /** Meta optionnelle (ex. "Paris · 5 ans XP", "Score 87%") */
  meta?: React.ReactNode;

  /** Action ligne droite (badges, boutons) */
  trailing?: React.ReactNode;

  /** Si fourni, rend la zone cliquable */
  onClick?: (e: React.MouseEvent) => void;

  className?: string;
}

const VARIANT_AVATAR_SIZE: Record<CandidateBadgeVariant, AvatarSize> = {
  inline: 'xs',
  compact: 'sm',
  card: 'md',
};

export const CandidateBadge = React.memo(function CandidateBadge({
  name,
  headline,
  imageUrl,
  linkedinUrl,
  variant = 'compact',
  meta,
  trailing,
  onClick,
  className,
}: CandidateBadgeProps) {
  const isInteractive = !!onClick;
  const Comp = isInteractive ? 'button' : 'div';

  return (
    <Comp
      type={isInteractive ? 'button' : undefined}
      onClick={onClick}
      className={cn(
        'flex items-start gap-2 text-left w-full',
        variant === 'inline' && 'items-center gap-1.5',
        variant === 'card' && 'p-2 border border-border bg-background hover:bg-muted/50 transition-colors rounded',
        isInteractive && variant !== 'card' && 'hover:bg-muted/30 px-1 py-0.5 rounded transition-colors cursor-pointer',
        className,
      )}
    >
      <CandidateAvatar
        name={name}
        imageUrl={imageUrl}
        size={VARIANT_AVATAR_SIZE[variant]}
      />

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <p className={cn(
            'font-medium truncate text-foreground',
            variant === 'inline' ? 'text-xs' : variant === 'compact' ? 'text-xs' : 'text-sm',
          )}>
            {name || 'Candidat sans nom'}
          </p>
          {linkedinUrl && variant !== 'inline' && (
            <a
              href={linkedinUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
              aria-label="Ouvrir le profil LinkedIn"
            >
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          )}
        </div>

        {variant !== 'inline' && headline && (
          <p className={cn(
            'text-muted-foreground truncate',
            variant === 'compact' ? 'text-[10px]' : 'text-xs',
          )}>
            {headline}
          </p>
        )}

        {meta && variant !== 'inline' && (
          <div className={cn(
            'flex items-center gap-1.5 flex-wrap mt-0.5',
            variant === 'compact' ? 'text-[10px]' : 'text-xs',
            'text-muted-foreground',
          )}>
            {meta}
          </div>
        )}
      </div>

      {trailing && (
        <div className="shrink-0 flex items-center gap-1">
          {trailing}
        </div>
      )}
    </Comp>
  );
});
