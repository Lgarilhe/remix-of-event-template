import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LinkedInProfile } from './types';
import { JobScoreDisplay, JobMatchResult } from './JobScoreDisplay';

import { PreScoreBar } from './result-card/PreScoreBar';
import { PreScoreResult } from '@/hooks/linkedin/preScoring';
import { Job } from '@/types/jobs';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  MapPin, Building2, TrendingUp, X, Linkedin,
} from 'lucide-react';
import { SourcingProject } from '@/hooks/useSourcingProjects';

// Sub-components
import { CardStatusBadges } from './result-card/CardStatusBadges';
import { CardActions } from './result-card/CardActions';
import { useProfileData } from './result-card/useProfileData';
import { LinkedInResultCardProps } from './result-card/types';

interface ExtendedResultCardProps extends LinkedInResultCardProps {
  onOpenDetail?: () => void;
  isBatchScoring?: boolean;
  onFindSimilar?: (profile: LinkedInProfile) => void;
}

export const LinkedInResultCard: React.FC<ExtendedResultCardProps> = ({
  profile,
  selectedJob,
  isSelected = false,
  onToggleSelect,
  jobScore,
  onScoreProfile,
  accountId,
  onMessageSent,
  onSequenceEnroll,
  activeProject,
  onProfileTreated,
  onArchive,
  candidateStatus,
  airtableMatch,
  notionMatch,
  onOpenDetail,
  isBatchScoring = false,
  onFindSimilar,
}) => {
  const [isScoring, setIsScoring] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [scoreFlash, setScoreFlash] = useState<'go' | 'maybe' | 'skip' | null>(null);
  const prevScoreRef = useRef<number | undefined>(jobScore?.match_score);

  // Score flash effect when a score first appears
  useEffect(() => {
    const currentRec = jobScore?.recommendation;
    const currentScore = jobScore?.match_score;
    if (currentRec && currentScore !== undefined && prevScoreRef.current === undefined) {
      setScoreFlash(currentRec as 'go' | 'maybe' | 'skip');
      const timer = setTimeout(() => setScoreFlash(null), 1000);
      prevScoreRef.current = currentScore;
      return () => clearTimeout(timer);
    }
    prevScoreRef.current = currentScore;
  }, [jobScore?.match_score, jobScore?.recommendation]);

  const profileData = useProfileData(profile);
  const {
    fullName, initials, currentCompany, currentRole, currentJobTenure,
    networkDistance, profileUrl, otherCurrentJobs, pastJobs, totalExperience,
  } = profileData;

  const showScoringOverlay = isBatchScoring && isSelected;
  const hasHighScore = jobScore && jobScore.match_score > 80;
  const flashColorMap = {
    go: 'hsl(var(--accent))',
    maybe: 'hsl(var(--primary))',
    skip: 'hsl(var(--destructive))',
  };

  return (
    <div
      className="relative bg-background border border-border transition-all max-w-full cursor-pointer group shadow-sm hover:shadow-sm"
      style={{ wordBreak: 'break-word' }}
      onClick={(e) => {
        if (showScoringOverlay) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, [role="checkbox"], [data-no-detail]')) return;
        onOpenDetail?.();
      }}
    >
      {/* LinkedIn public link — top right */}
      {profileUrl && (
        <a
          href={profileUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="absolute top-2 right-2 z-10 text-muted-foreground/50 hover:text-[#0A66C2] transition-colors"
          title="Voir sur LinkedIn"
          data-no-detail
        >
          <Linkedin className="w-4 h-4" />
        </a>
      )}

      {/* High score indicator — left accent bar */}
      {hasHighScore && (
        <div className="absolute left-0 top-0 bottom-0 w-1 bg-accent" />
      )}

      {/* Score flash overlay */}
      <AnimatePresence>
        {scoreFlash && (
          <motion.div
            initial={{ opacity: 0.5 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1, ease: 'easeOut' }}
            className="absolute inset-0 z-10 pointer-events-none"
            style={{ backgroundColor: flashColorMap[scoreFlash] }}
          />
        )}
      </AnimatePresence>

      {/* Scoring overlay */}
      {showScoringOverlay && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-[8px]">
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent animate-[shimmer_1.8s_infinite]" />
          </div>
          <div className="relative flex items-center gap-2.5 px-4 py-2 bg-background/80 border border-border shadow-sm">
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '300ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '600ms' }} />
            </div>
            <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Scoring…
            </span>
          </div>
        </div>
      )}

      {/* Main card content */}
      <div className={`p-2.5 sm:p-3 transition-all duration-300 ${showScoringOverlay ? 'select-none pointer-events-none' : ''}`}>
        <div className="relative flex items-start gap-2 sm:gap-3 min-w-0 w-full">
          {/* Checkbox */}
          {selectedJob && onToggleSelect && (
            <>
              <div className="hidden sm:block pt-2" data-no-detail>
                {jobScore?.recommendation === 'skip' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="w-4 h-4 rounded border border-destructive/30 bg-destructive/5 flex items-center justify-center cursor-not-allowed">
                        <X className="w-3 h-3 text-destructive/40" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">Profil peu adapté</p>
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={onToggleSelect}
                    className="border-primary/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                )}
              </div>
              <div className="sm:hidden absolute top-0 right-0 z-10" data-no-detail>
                {jobScore?.recommendation === 'skip' ? (
                  <div className="w-5 h-5 rounded border border-destructive/30 bg-destructive/5 flex items-center justify-center cursor-not-allowed">
                    <X className="w-3 h-3 text-destructive/40" />
                  </div>
                ) : (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={onToggleSelect}
                    className="border-primary/30 data-[state=checked]:bg-primary data-[state=checked]:border-primary w-5 h-5"
                  />
                )}
              </div>
            </>
          )}

          {/* Avatar — desktop */}
          <div className="relative shrink-0 hidden sm:block">
            <Avatar className="w-10 h-10 border border-border">
              <AvatarImage src={profile.profile_picture_url} alt={fullName} className="object-cover" />
              <AvatarFallback className="bg-muted text-muted-foreground text-sm font-medium">
                {initials || '?'}
              </AvatarFallback>
            </Avatar>
            {networkDistance && networkDistance <= 3 && (
              <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-background border border-border rounded-full flex items-center justify-center text-[8px] font-bold text-muted-foreground">
                {networkDistance}°
              </span>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            {/* Name + status badges */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap min-w-0 max-w-full">
                  {/* Avatar inline on mobile */}
                  <div className="relative shrink-0 sm:hidden">
                    <Avatar className="w-7 h-7 border border-border">
                      <AvatarImage src={profile.profile_picture_url} alt={fullName} className="object-cover" />
                      <AvatarFallback className="bg-muted text-muted-foreground text-[10px] font-medium">
                        {initials || '?'}
                      </AvatarFallback>
                    </Avatar>
                    {networkDistance && networkDistance <= 3 && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 bg-background border border-border rounded-full flex items-center justify-center text-[7px] font-bold text-muted-foreground">
                        {networkDistance}°
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-foreground text-sm leading-tight truncate">
                    {fullName || 'Profil LinkedIn'}
                  </h3>
                  <CardStatusBadges
                    candidateStatus={candidateStatus}
                    jobScore={jobScore}
                    profile={profile}
                    isLikelyToRespond={false}
                    airtableMatch={airtableMatch}
                    notionMatch={notionMatch}
                  />
                </div>
              </div>

              {/* Desktop actions */}
              <div className="flex shrink-0" data-no-detail>
                <CardActions
                  profile={profile}
                  profileUrl={profileUrl}
                  fullName={fullName}
                  selectedJob={selectedJob}
                  jobScore={jobScore}
                  accountId={accountId}
                  activeProject={activeProject}
                  isScoring={isScoring}
                  isAnalyzing={isAnalyzing}
                  onScoreProfile={onScoreProfile}
                  onOpenMessage={() => onOpenDetail?.()}
                  onAiAnalysis={() => onOpenDetail?.()}
                  onArchive={onArchive}
                  onSequenceEnroll={onSequenceEnroll}
                  onProfileTreated={onProfileTreated}
                  onFindSimilar={onFindSimilar ? () => onFindSimilar(profile) : undefined}
                />
              </div>
            </div>

            {/* Headline */}
            <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5 leading-snug">
              {profile.headline || currentRole || 'Profil LinkedIn'}
            </p>

            {/* Company + Location + Experience */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
              {currentCompany && (
                <span className="flex items-center gap-1 font-medium text-foreground/80 min-w-0">
                  {profileData.currentJob?.logo ? (
                    <img src={profileData.currentJob.logo} alt={currentCompany} className="w-3.5 h-3.5 rounded object-contain bg-card border border-border/30 shrink-0" />
                  ) : (
                    <Building2 className="w-3 h-3 text-muted-foreground shrink-0" />
                  )}
                  <span className="truncate">{currentCompany}</span>
                  {currentJobTenure && (
                    <span className="text-muted-foreground/40 font-normal shrink-0">· {currentJobTenure}</span>
                  )}
                </span>
              )}
              {profile.location && (
                <span className="flex items-center gap-1 min-w-0">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">{profile.location}</span>
                </span>
              )}
              {totalExperience && (
                <span className="flex items-center gap-1 text-success font-medium">
                  <TrendingUp className="w-3 h-3" />
                  {totalExperience}
                </span>
              )}
            </div>

            {/* Pre-score + Job Score */}
            {(profile as any)._preScore && (
              <div className="mt-1.5">
                <PreScoreBar
                  preScore={(profile as any)._preScore as PreScoreResult}
                  hasLLMScore={!!jobScore}
                />
              </div>
            )}
            {jobScore && (
              <div className="mt-1.5">
                <JobScoreDisplay result={jobScore} jobTitle={selectedJob?.title} compact />
              </div>
            )}

            {/* Experience preview — max 2 lines */}
            {(otherCurrentJobs.length > 0 || pastJobs.length > 0) && (
              <div className="mt-1.5 pt-1.5 border-t border-border/30 space-y-0.5">
                {[...otherCurrentJobs.slice(0, 1), ...pastJobs.slice(0, 1)].map((pos: any, index: number) => (
                  <div key={index} className="flex items-center gap-1.5 text-xs min-w-0">
                    {pos.logo ? (
                      <img src={pos.logo} alt={pos.company || ''} className="w-3.5 h-3.5 rounded object-contain bg-card border border-border/30 shrink-0" />
                    ) : (
                      <div className="w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0" />
                    )}
                    <span className="text-muted-foreground truncate">
                      {pos.role || pos.position} <span className="text-muted-foreground/40">·</span> {pos.company}
                    </span>
                  </div>
                ))}
                {(otherCurrentJobs.length + pastJobs.length) > 2 && (
                  <span className="text-[10px] text-muted-foreground/60">
                    +{otherCurrentJobs.length + pastJobs.length - 2} autres
                  </span>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
};
