import React from 'react';
import { LinkedInProfile } from '../types';
import { JobMatchResult } from '../JobScoreDisplay';
import { Job } from '@/types/jobs';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { Button } from '@/components/ui/button';
import { Target, Loader2, ExternalLink } from 'lucide-react';
import { SequenceEnrollButton } from '../SequenceEnrollButton';

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
  onFindSimilar?: () => void;
  compact?: boolean;
}

export const CardActions: React.FC<CardActionsProps> = ({
  profile,
  profileUrl,
  selectedJob,
  jobScore,
  accountId,
  isScoring,
  onScoreProfile,
  onSequenceEnroll,
  onProfileTreated,
  compact = false,
}) => {
  const buttonSize = compact ? 'h-7 w-7 p-0' : 'h-8 w-8 p-0';
  const iconSize = compact ? 'w-3.5 h-3.5' : 'w-4 h-4';

  return (
    <div className={`flex items-center ${compact ? 'gap-0' : 'gap-0.5'}`}>
      {/* Score */}
      {selectedJob && onScoreProfile && !jobScore && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onScoreProfile}
          disabled={isScoring}
          className={`text-muted-foreground hover:text-foreground hover:bg-muted ${buttonSize}`}
          title={`Scorer pour ${selectedJob.title}`}
        >
          {isScoring ? (
            <Loader2 className={`${iconSize} animate-spin`} />
          ) : (
            <Target className={iconSize} />
          )}
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

      {/* Profile link */}
      {profileUrl && (
        <Button
          variant="ghost"
          size="sm"
          asChild
          className={`text-muted-foreground hover:text-foreground hover:bg-muted ${buttonSize}`}
          title="Voir le profil"
        >
          <a href={profileUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className={iconSize} />
          </a>
        </Button>
      )}
    </div>
  );
};
