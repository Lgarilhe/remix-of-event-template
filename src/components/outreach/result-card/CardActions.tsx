import React from 'react';
import { LinkedInProfile } from '../types';
import { JobMatchResult } from '../JobScoreDisplay';
import { Job } from '@/types/jobs';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  ExternalLink, Mail, Sparkles, PenLine, Loader2, Archive, MoreHorizontal, Linkedin,
} from 'lucide-react';
import { SequenceEnrollButton } from '../SequenceEnrollButton';
import { AddToProjectButton } from '../projects/AddToProjectButton';
import { EnrichContactButton } from './EnrichContactButton';

interface CardActionsProps {
  profile: LinkedInProfile;
  profileUrl?: string;
  fullName: string;
  selectedJob?: Job | null;
  jobScore?: JobMatchResult;
  accountId?: string;
  activeProject?: SourcingProject | null;
  isScoring: boolean;
  onScoreProfile?: () => void;
  onOpenMessage: () => void;
  onArchive?: () => void;
  onSequenceEnroll?: () => void;
  onProfileTreated?: () => void;
  compact?: boolean;
}

/**
 * CardActions — refonte UX 2026-04-27.
 *
 * Avant : 9 boutons éparpillés (score, message, ai, inmail, link, séq, pipe, archive)
 * → fouillis visuel, hiérarchie plate, l'user ne sait pas quoi cliquer en premier.
 *
 * Après : hiérarchie claire en 3 niveaux
 *   1. PRIMARY CTA (1 bouton, contextuel selon l'état du profil)
 *      - Pas encore scoré → "Scorer" (ShimmerButton)
 *      - Scoré "go" → "Séquence" (SequenceEnroll)
 *      - Scoré "maybe" → "Message"
 *      - Scoré "skip" → rien (juste archive en menu)
 *   2. SECONDARY (1 bouton "Pipe" pour add to project, si selectedJob)
 *   3. OVERFLOW MENU (⋯) : LinkedIn profile, InMail, Archive
 *      (l'item "Analyse IA détaillée" a été retiré 2026-04-27 — redondant avec
 *      le scoring IA principal qui couvre déjà ce besoin)
 *
 * Compact mode (mobile) : pas de séparateur, juste des icon-only buttons
 * pour la primary + 1 menu ⋯ horizontal scroll.
 */
export const CardActions: React.FC<CardActionsProps> = ({
  profile,
  profileUrl,
  fullName,
  selectedJob,
  jobScore,
  accountId,
  activeProject,
  isScoring,
  onScoreProfile,
  onOpenMessage,
  onArchive,
  onSequenceEnroll,
  onProfileTreated,
  compact = false,
}) => {
  const iconSize = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';

  // Détermine le CTA primaire selon l'état du profil
  const recommendation = jobScore?.recommendation;
  const showScore = !!selectedJob && !!onScoreProfile && !jobScore;
  const showSequenceCTA = !!accountId && !!jobScore && recommendation !== 'skip';

  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
      {/* ═══ PRIMARY CTA — Score IA (gradient violet/indigo inspiré 21st.dev) ═══
          Bouton CTA dédié à l'action AI scoring. Gradient indigo→violet→fuchsia
          + shadow halo coloré + shine sweep au hover + sparkle pulse. Reste
          compact (h-7/h-8) pour s'intégrer dans le rang d'actions. */}
      {showScore && (
        <button
          onClick={onScoreProfile}
          disabled={isScoring}
          title={isScoring ? 'Analyse IA en cours…' : `Scorer pour ${selectedJob?.title}`}
          aria-busy={isScoring}
          className={`group relative inline-flex items-center justify-center gap-1.5 overflow-hidden rounded-md font-bold uppercase tracking-wider text-white transition-all duration-200 ${
            compact ? 'h-7 px-2.5 text-[11px]' : 'h-8 px-3.5 text-xs'
          } ${isScoring ? 'cursor-wait' : 'cursor-pointer'}`}
          style={{
            backgroundImage: 'linear-gradient(110deg, #4f46e5 0%, #7c3aed 50%, #c026d3 100%)',
            boxShadow: isScoring
              ? '0 0 0 2px rgba(124, 58, 237, 0.35), 0 4px 18px 0 rgba(124, 58, 237, 0.55)'
              : '0 4px 14px 0 rgba(124, 58, 237, 0.4)',
          }}
          onMouseEnter={(e) => {
            if (isScoring) return;
            e.currentTarget.style.boxShadow = '0 6px 22px 0 rgba(124, 58, 237, 0.6)';
            e.currentTarget.style.transform = 'translateY(-1px) scale(1.02)';
          }}
          onMouseLeave={(e) => {
            if (isScoring) return;
            e.currentTarget.style.boxShadow = '0 4px 14px 0 rgba(124, 58, 237, 0.4)';
            e.currentTarget.style.transform = '';
          }}
        >
          {/* Loading state : shimmer continu (pas seulement au hover) + ring
              + label "ANALYSE…". Donne 3 signaux visuels au lieu d'un simple
              spinner perdu sur le gradient. */}
          {isScoring && (
            <span
              aria-hidden
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/40 to-transparent animate-[shimmer_1.4s_ease-in-out_infinite]"
            />
          )}
          {/* Shine sweep au hover (état idle uniquement) */}
          {!isScoring && (
            <span
              aria-hidden
              className="absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 ease-out group-hover:translate-x-full"
            />
          )}
          {/* Subtle inner highlight (top edge) */}
          <span
            aria-hidden
            className="absolute inset-x-0 top-0 h-px bg-white/30"
          />
          {isScoring ? (
            <>
              <Loader2 className={`relative ${iconSize} animate-spin`} aria-hidden="true" />
              <span className="relative">Analyse…</span>
            </>
          ) : (
            <>
              <Sparkles className={`relative ${iconSize} group-hover:animate-pulse`} aria-hidden="true" />
              <span className="relative">SCORE</span>
            </>
          )}
        </button>
      )}

      {showSequenceCTA && (
        <SequenceEnrollButton
          selectedProfiles={[profile]}
          accountId={accountId}
          selectedJob={selectedJob ? { id: selectedJob.id, title: selectedJob.title } : undefined}
          onSuccess={() => {
            onSequenceEnroll?.();
            onProfileTreated?.();
          }}
        />
      )}

      {/* Message rapide — si scoré et pas en séquence directe.
          Relief : bg-muted (vraie teinte grise) + border foreground/30
          + shadow pour ressortir du fond blanc de la card. */}
      {selectedJob && !showScore && !compact && (
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenMessage}
          className="h-8 px-2.5 text-xs gap-1.5 bg-muted border-foreground/30 shadow-sm hover:bg-accent hover:border-foreground/50 hover:shadow-md transition-all font-medium"
          title="Composer un message d'approche"
        >
          <PenLine className={iconSize} aria-hidden="true" />
          <span className="hidden sm:inline">Message</span>
        </Button>
      )}

      {/* ═══ SECONDARY — Add to project ═══ */}
      {selectedJob && !compact && (
        <AddToProjectButton
          candidateId={profile.id}
          candidateName={fullName}
          candidateHeadline={profile.headline}
          linkedinProfileUrl={profileUrl}
          score={jobScore?.match_score}
          recommendation={jobScore?.recommendation}
          skipReason={jobScore?.missing_skills?.join(', ')}
          jobId={selectedJob.id}
          activeProject={activeProject}
          compact
          onAdded={onProfileTreated}
        />
      )}

      {/* ═══ ENRICHMENT — Récupérer email/téléphone ═══
          Visible uniquement en mode non-compact (sinon ça surcharge la liste).
          Si profil a déjà un email/phone (Unipile contact_info ou cache), affiche
          directement, sinon bouton qui lance l'enrichment async via Better Contact. */}
      {!compact && profileUrl && (
        <EnrichContactButton profile={profile} compact />
      )}

      {/* ═══ OVERFLOW MENU ⋯ ═══ */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={`${compact ? 'h-7 w-7' : 'h-8 w-8'} bg-muted border border-foreground/30 shadow-sm hover:bg-accent hover:border-foreground/50 hover:shadow-md transition-all`}
            aria-label={`Plus d'actions pour ${fullName}`}
          >
            <MoreHorizontal className={iconSize} aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {profileUrl && (
            <DropdownMenuItem
              onSelect={() => window.open(profileUrl, '_blank', 'noopener,noreferrer')}
              className="cursor-pointer"
            >
              <Linkedin className="w-4 h-4 mr-2 text-info" aria-hidden="true" />
              <span>Ouvrir le profil LinkedIn</span>
              <ExternalLink className="w-3 h-3 ml-auto text-muted-foreground" aria-hidden="true" />
            </DropdownMenuItem>
          )}

          {compact && selectedJob && !showScore && (
            <DropdownMenuItem onSelect={onOpenMessage} className="cursor-pointer">
              <PenLine className="w-4 h-4 mr-2" aria-hidden="true" />
              Composer un message
            </DropdownMenuItem>
          )}

          {profile.can_send_inmail && (
            <DropdownMenuItem
              onSelect={() => onOpenMessage()}
              className="cursor-pointer"
            >
              <Mail className="w-4 h-4 mr-2" aria-hidden="true" />
              Envoyer un InMail
            </DropdownMenuItem>
          )}

          {onArchive && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onArchive}
                className="cursor-pointer text-destructive focus:text-destructive focus:bg-destructive/10"
              >
                <Archive className="w-4 h-4 mr-2" aria-hidden="true" />
                Archiver
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
};
