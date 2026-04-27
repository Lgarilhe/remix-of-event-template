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
  ExternalLink, Mail, Target, PenLine, Loader2, Archive, MoreHorizontal, Linkedin,
} from 'lucide-react';
import { SequenceEnrollButton } from '../SequenceEnrollButton';
import { AddToProjectButton } from '../projects/AddToProjectButton';
import { ShimmerButton } from '@/components/magicui/shimmer-button';

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
      {/* ═══ PRIMARY CTA — contextuel ═══ */}
      {showScore && (
        <ShimmerButton
          onClick={onScoreProfile}
          disabled={isScoring}
          className={compact ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-xs gap-1.5'}
          title={`Scorer pour ${selectedJob?.title}`}
        >
          {isScoring ? (
            <Loader2 className={`${iconSize} animate-spin`} aria-hidden="true" />
          ) : (
            <>
              <Target className={iconSize} aria-hidden="true" />
              <span className="font-bold">SCORE</span>
            </>
          )}
        </ShimmerButton>
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

      {/* Message rapide — si scoré et pas en séquence directe */}
      {selectedJob && !showScore && !compact && (
        <Button
          variant="outline"
          size="sm"
          onClick={onOpenMessage}
          className="h-8 px-2.5 text-xs gap-1.5 border-border hover:bg-muted/50"
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

      {/* ═══ OVERFLOW MENU ⋯ ═══ */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={compact ? 'h-7 w-7' : 'h-8 w-8'}
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
