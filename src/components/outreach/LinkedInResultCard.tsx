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
import { useProfileData, getTenureDisplay } from './result-card/useProfileData';
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
            {/* Row 1: Name + actions */}
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1.5 min-w-0 flex-1">
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
              <div className="flex items-center shrink-0" data-no-detail>
                {profileUrl && (
                  <a
                    href={profileUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center w-6 h-6 opacity-40 hover:opacity-100 transition-opacity"
                    title="Voir sur LinkedIn"
                  >
                    <svg viewBox="0 0 24 24" fill="#0A66C2" className="w-3.5 h-3.5">
                      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                    </svg>
                  </a>
                )}
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

            {/* Row 2: Location + Experience years */}
            <div className="flex items-center gap-x-3 mt-0.5 text-[11px] text-muted-foreground">
              {profile.location && (
                <span className="flex items-center gap-1 min-w-0">
                  <MapPin className="w-3 h-3 shrink-0" />
                  <span className="truncate">{profile.location}</span>
                </span>
              )}
              {totalExperience && (
                <span className="flex items-center gap-1 text-success font-medium shrink-0">
                  <TrendingUp className="w-3 h-3" />
                  {totalExperience}
                </span>
              )}
            </div>

            {/* Row 3: Score */}
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

            {/* Row 4: Last 3 experiences with duration */}
            {(() => {
              const allJobs = [
                ...(profileData.currentJob ? [profileData.currentJob] : []),
                ...otherCurrentJobs,
                ...pastJobs,
              ].slice(0, 3);
              if (allJobs.length === 0) return null;
              return (
                <div className="mt-1.5 pt-1.5 border-t border-border/30 space-y-0.5">
                  {allJobs.map((pos: any, i: number) => {
                    const tenure = getTenureDisplay(pos.start, pos.end);
                    const isCurrent = !pos.end && pos.current !== false;
                    return (
                      <div key={i} className="flex items-center gap-1.5 text-[11px] min-w-0">
                        {pos.logo ? (
                          <img src={pos.logo} alt={pos.company || ''} className="w-3.5 h-3.5 rounded object-contain bg-card border border-border/30 shrink-0" />
                        ) : (
                          <div className="w-3.5 h-3.5 rounded bg-muted flex items-center justify-center shrink-0">
                            <Building2 className="w-2.5 h-2.5 text-muted-foreground/50" />
                          </div>
                        )}
                        <span className={`truncate ${isCurrent ? 'text-foreground/80 font-medium' : 'text-muted-foreground'}`}>
                          {pos.role || pos.position}
                        </span>
                        <span className="text-muted-foreground/40 shrink-0">·</span>
                        <span className="text-muted-foreground truncate shrink-0">{pos.company}</span>
                        {tenure && (
                          <span className="text-muted-foreground/40 text-[10px] shrink-0">{tenure}</span>
                        )}
                      </div>
                    );
                  })}
                  {(otherCurrentJobs.length + pastJobs.length + (profileData.currentJob ? 1 : 0)) > 3 && (
                    <span className="text-[10px] text-muted-foreground/50">
                      +{otherCurrentJobs.length + pastJobs.length + (profileData.currentJob ? 1 : 0) - 3} autres
                    </span>
                  )}
                </div>
              );
            })()}

            {/* Row 5: Education */}
            {profileData.educationPreview.length > 0 && (() => {
              const edu = profileData.educationPreview[0];
              const eduName = edu.school || edu.institution || edu.name;
              const eduLogo = edu.school_picture_url || edu.logo || edu.school_logo || edu.school_details?.logo;
              const eduDegree = edu.degree || edu.field_of_study;
              if (!eduName) return null;
              return (
                <div className="flex items-center gap-1.5 mt-1 text-[11px] text-muted-foreground min-w-0">
                  {eduLogo ? (
                    <img src={eduLogo} alt={eduName} className="w-3.5 h-3.5 rounded object-contain bg-card border border-border/30 shrink-0" />
                  ) : (
                    <span className="text-[10px] shrink-0">🎓</span>
                  )}
                  <span className="truncate">{eduDegree ? `${eduDegree} · ` : ''}{eduName}</span>
                </div>
              );
            })()}

          </div>
        </div>
      </div>
    </div>
  );
};