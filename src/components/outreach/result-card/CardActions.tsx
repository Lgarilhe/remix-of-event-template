import React from 'react';
import { LinkedInProfile } from '../types';
import { JobMatchResult, isDegradedScore } from '../JobScoreDisplay';
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
  /** Nouvelle page mission : boutons discrets (aucun bouton plein ni contour), cibles de 44 px sur téléphone. */
  variant?: 'default' | 'mission-v3';
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
  variant = 'default',
}) => {
  const isV3 = variant === 'mission-v3';
  const iconSize = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';

  // Détermine le CTA primaire selon l'état du profil.
  // Un score dégradé (passe IA échouée) doit pouvoir être relancé.
  const recommendation = jobScore?.recommendation;
  const showScore = !!selectedJob && !!onScoreProfile && (!jobScore || isDegradedScore(jobScore));
  const showSequenceCTA = !!accountId && !!jobScore && recommendation !== 'skip';

  return (
    <div className={`flex items-center ${compact ? 'gap-1' : 'gap-1.5'}`}>
      {/* Action principale : noter le profil sur les critères du poste. */}
      {showScore && (
        <Button
          variant={isV3 ? 'ghost' : 'primary'}
          size={compact ? 'xs' : 'sm'}
          onClick={onScoreProfile}
          loading={isScoring}
          title={isScoring ? 'Notation en cours' : `Noter pour ${selectedJob?.title}`}
          aria-busy={isScoring}
          className={isV3 ? 'shrink-0 max-sm:min-h-11' : 'shrink-0'}
        >
          {!isScoring && <Sparkles aria-hidden="true" />}
          {isScoring ? 'Notation…' : 'Noter'}
        </Button>
      )}

      {showSequenceCTA && (
        <SequenceEnrollButton
          selectedProfiles={[profile]}
          accountId={accountId}
          selectedJob={selectedJob ?? undefined}
          onSuccess={() => {
            onSequenceEnroll?.();
            onProfileTreated?.();
          }}
          quiet={isV3}
        />
      )}

      {/* Message rapide — si scoré et pas en séquence directe.
          Relief : bg-muted (vraie teinte grise) + border foreground/30
          + shadow pour ressortir du fond blanc de la card. */}
      {selectedJob && !showScore && !compact && (
        <Button
          variant={isV3 ? 'ghost' : 'outline'}
          size="sm"
          onClick={onOpenMessage}
          className={isV3 ? 'shrink-0 max-sm:min-h-11' : 'shrink-0'}
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
          profile={profile}
          jobId={selectedJob.id}
          activeProject={activeProject}
          compact
          quiet={isV3}
          onAdded={onProfileTreated}
        />
      )}

      {/* ═══ ENRICHMENT — Récupérer email/téléphone ═══
          Visible uniquement en mode non-compact (sinon ça surcharge la liste).
          Si profil a déjà un email/phone (Unipile contact_info ou cache), affiche
          directement, sinon bouton qui lance l'enrichment async via Better Contact. */}
      {!compact && profileUrl && (
        <EnrichContactButton
          profile={profile}
          compact
          className={isV3 ? 'border-transparent hover:border-transparent dark:border-transparent dark:hover:border-transparent max-sm:min-h-11' : undefined}
        />
      )}

      {/* ═══ OVERFLOW MENU ⋯ ═══ */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={isV3
              ? 'h-8 w-8 max-sm:h-11 max-sm:w-11'
              : `${compact ? 'h-7 w-7' : 'h-8 w-8'} bg-muted border border-foreground/30 shadow-sm hover:bg-accent hover:border-foreground/50 hover:shadow-md transition-all`}
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
              <ExternalLink className="w-3 h-3 ml-auto" aria-hidden="true" />
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
