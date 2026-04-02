import React from 'react';
import { LinkedInProfile } from '../types';
import { JobMatchResult } from '../JobScoreDisplay';
import { Job } from '@/types/jobs';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ExternalLink, Mail, Target, PenLine, Bot, Loader2, Archive } from 'lucide-react';
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
  isAnalyzing: boolean;
  onScoreProfile?: () => void;
  onOpenMessage: () => void;
  onAiAnalysis: () => void;
  onArchive?: () => void;
  onSequenceEnroll?: () => void;
  onProfileTreated?: () => void;
  compact?: boolean;
}

export const CardActions: React.FC<CardActionsProps> = ({
  profile,
  profileUrl,
  fullName,
  selectedJob,
  jobScore,
  accountId,
  activeProject,
  isScoring,
  isAnalyzing,
  onScoreProfile,
  onOpenMessage,
  onAiAnalysis,
  onArchive,
  onSequenceEnroll,
  onProfileTreated,
  compact = false,
}) => {
  const buttonSize = compact ? 'h-7 w-7 p-0' : 'h-8 w-8 p-0';
  const iconSize = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <div className={`flex items-center gap-0.5 ${compact ? '' : 'gap-1'}`}>
      {/* Score */}
      {selectedJob && onScoreProfile && !jobScore && (
        <ShimmerButton
          onClick={onScoreProfile}
          disabled={isScoring}
          className={compact ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-xs'}
          title={`Scorer pour ${selectedJob.title}`}
        >
          {isScoring ? (
            <Loader2 className={`${iconSize} animate-spin`} />
          ) : (
            <>
              <Target className={iconSize} />
              {!compact && <span className="hidden sm:inline">Score</span>}
            </>
          )}
        </ShimmerButton>
      )}

      {/* Message */}
      {selectedJob && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onOpenMessage}
          className={`text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50 ${compact ? buttonSize : 'h-8 px-2 gap-1'}`}
          title="Générer un message d'approche"
        >
          <PenLine className={iconSize} />
          {!compact && <span className="text-xs hidden sm:inline">Message</span>}
        </Button>
      )}

      {/* AI Analysis */}
      <Button
        variant="ghost"
        size="sm"
        onClick={onAiAnalysis}
        disabled={isAnalyzing}
        className={`text-purple-600 hover:text-purple-700 hover:bg-purple-50 ${buttonSize}`}
        title="Analyse IA du profil"
      >
        {isAnalyzing ? <Loader2 className={`${iconSize} animate-spin`} /> : <Bot className={iconSize} />}
      </Button>

      {/* InMail */}
      {profile.can_send_inmail && !compact && (
        <Button
          variant="ghost"
          size="sm"
          className={`text-primary hover:text-primary/80 hover:bg-primary/10 ${buttonSize}`}
          title="Envoyer InMail"
        >
          <Mail className={iconSize} />
        </Button>
      )}

      {/* Profile link */}
      {profileUrl && (
        <Button
          variant="ghost"
          size="sm"
          asChild
          className={`text-primary hover:text-primary/80 hover:bg-primary/10 ${buttonSize}`}
          title="Voir le profil"
        >
          <a href={profileUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className={iconSize} />
          </a>
        </Button>
      )}

      {/* Sequence enroll */}
      {accountId && jobScore?.recommendation !== 'skip' && (
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

      {/* Add to project */}
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

      {/* Archive */}
      {onArchive && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={onArchive}
              className={`text-muted-foreground hover:text-orange-600 hover:bg-orange-50 ${buttonSize}`}
            >
              <Archive className={iconSize} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Archiver ce profil</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};
