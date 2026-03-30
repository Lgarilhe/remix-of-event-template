import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LinkedInProfile } from './types';
import { useCandidateHistory, NotionShortlistHistoryItem } from '@/hooks/useCandidateHistory';
import { computeLikelyToSwitch } from '@/hooks/linkedin/likelyToSwitch';
import { LikelyToSwitchBadge } from './LikelyToSwitchBadge';
import { CandidateHistoryPanel } from './CandidateHistoryPanel';
import { useNotionShortlist } from '@/hooks/useNotionCandidates';
import { JobScoreDisplay, JobMatchResult } from './JobScoreDisplay';
import { BorderBeam } from '@/components/magicui/border-beam';
import { PreScoreBar } from './result-card/PreScoreBar';
import { PreScoreResult } from '@/hooks/linkedin/preScoring';
import { Job } from '@/types/jobs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Briefcase, MapPin, GraduationCap,
  Building2, Users, TrendingUp, AlertTriangle,
  X, ExternalLink,
} from 'lucide-react';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { classifyFromProfile } from '@/lib/companyClassification';

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
  const prevRecommendationRef = useRef<string | undefined>(undefined);

  // Score flash effect when recommendation changes
  useEffect(() => {
    const currentRec = jobScore?.recommendation;
    if (currentRec && currentRec !== prevRecommendationRef.current && prevRecommendationRef.current === undefined && jobScore) {
      // Only flash on initial score arrival (not on mount with existing score from DB)
      if (prevRecommendationRef.current !== undefined || !jobScore) {
        setScoreFlash(currentRec as 'go' | 'maybe' | 'skip');
        const timer = setTimeout(() => setScoreFlash(null), 1000);
        return () => clearTimeout(timer);
      }
    }
    prevRecommendationRef.current = currentRec;
  }, [jobScore?.recommendation]); // eslint-disable-line react-hooks/exhaustive-deps

  const profileData = useProfileData(profile);
  const switchResult = useMemo(() => computeLikelyToSwitch(profile), [profile]);
  const {
    fullName, initials, currentCompany, currentRole, currentJobTenure,
    networkDistance, profileUrl, skills, education, educationPreview,
    otherCurrentJobs, pastJobs, connectionsCount,
    isLikelyToRespond, totalExperience,
  } = profileData;
  const companyType = useMemo(() => {
    if (!currentCompany) return null;
    return classifyFromProfile({
      current_company: currentCompany,
      company_description: (profile as any).company_description,
      company_headcount: (profile as any).employee_count || (profile as any).company_headcount,
      company_industry: (profile as any).industry,
      company_type: (profile as any).organization_type,
    });
  }, [currentCompany, profile]);

  // Airtable history
  const candidateProfileUrl = profile.public_profile_url || profile.profile_url;
  const { data: historyData, loading: historyLoading } = useCandidateHistory(
    airtableMatch
      ? { linkedinUrl: candidateProfileUrl, airtableId: airtableMatch.airtable_id }
      : null
  );

  // Notion shortlist data for this candidate
  const { data: notionShortlistData, isLoading: notionShortlistLoading } = useNotionShortlist();
  const notionShortlistsForCandidate: NotionShortlistHistoryItem[] = React.useMemo(() => {
    if (!notionShortlistData) return [];

    const normalizeName = (value?: string | null) =>
      (value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const profileNames = [
      fullName,
      profile.name,
      [profile.first_name, profile.last_name].filter(Boolean).join(' '),
    ]
      .map(normalizeName)
      .filter(Boolean);

    const matched = notionShortlistData.filter((s: any) => {
      if (!s.candidate) return false;
      if (notionMatch && s.candidate.id === notionMatch.id) return true;

      const candidateName = normalizeName(s.candidate.name);
      if (!candidateName || profileNames.length === 0) return false;

      return profileNames.some((profileName) =>
        profileName === candidateName ||
        profileName.includes(candidateName) ||
        candidateName.includes(profileName)
      );
    });

    const seen = new Set<string>();
    return matched
      .filter((s: any) => {
        if (!s.id || seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      })
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        stage: s.stage,
        entity: s.entity,
        positions: s.positions || [],
        createdAt: s.createdAt,
        preQualifDate: s.preQualifDate,
        cvPresentationDate: s.cvPresentationDate,
        startDate: s.startDate,
      }));
  }, [fullName, notionMatch, notionShortlistData, profile.first_name, profile.last_name, profile.name]);

  const formatHistoryDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1].slice(2)}`;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const historyLatestDate = historyData
    ? [
        ...historyData.placements.map((p: any) => p.start_date),
        ...historyData.shortlists.map((s: any) => s.date_added),
        ...historyData.notes.map((n: any) => n.note_date),
        ...historyData.appointments.map((a: any) => a.appointment_date),
      ]
        .filter((d): d is string => Boolean(d))
        .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))[0] ?? null
    : null;
  const historyLatestDateLabel = formatHistoryDate(historyLatestDate);

  const showScoringOverlay = isBatchScoring && isSelected;
  const shouldWaitForNotionHistory = Boolean(notionMatch) && notionShortlistsForCandidate.length === 0 && !historyData;
  const historyPanelLoading = historyLoading || (shouldWaitForNotionHistory && notionShortlistLoading);

  return (
    <div
      className={`relative bg-background border border-foreground transition-all max-w-full cursor-pointer group shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] hover:translate-x-[1px] hover:translate-y-[1px] hover:shadow-[1px_1px_0px_0px_hsl(var(--brutal-accent))]`}
      style={{ wordBreak: 'break-word' }}
      onClick={(e) => {
        if (showScoringOverlay) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, [role="checkbox"], [data-no-detail]')) return;
        onOpenDetail?.();
      }}
    >
      {/* Scoring overlay */}
      {showScoringOverlay && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/70 backdrop-blur-[8px]">
          {/* Shimmer sweep across the card */}
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-r from-transparent via-foreground/[0.06] to-transparent animate-[shimmer_1.8s_infinite]" />
          </div>
          <div className="relative flex items-center gap-2.5 px-4 py-2 bg-background/80 border border-border shadow-sm">
            {/* Three pulsing dots */}
            <div className="flex items-center gap-1">
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '300ms' }} />
              <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" style={{ animationDelay: '600ms' }} />
            </div>
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Scoring…
            </span>
          </div>
        </div>
      )}
      {/* Main card content */}
      <div className={`p-2.5 sm:p-4 transition-all duration-300 ${showScoringOverlay ? 'select-none pointer-events-none' : ''}`}>
        <div className="relative flex items-start gap-2 sm:gap-4 min-w-0 w-full">
          {/* Checkbox - top-right on mobile, left column on desktop */}
          {selectedJob && onToggleSelect && (
            <>
              {/* Desktop: left column */}
              <div className="hidden sm:block pt-3" data-no-detail>
                {jobScore?.recommendation === 'skip' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="w-4 h-4 rounded border border-destructive/30 bg-destructive/5 flex items-center justify-center cursor-not-allowed">
                        <X className="w-3 h-3 text-destructive/40" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">Profil peu adapté (score &lt; 40%) — sélection désactivée</p>
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
              {/* Mobile: absolute top-right */}
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

          {/* Avatar - separate column on desktop only */}
          <div className="relative shrink-0 hidden sm:block">
            <Avatar className="w-14 h-14 border-2 border-border shadow-md">
              <AvatarImage src={profile.profile_picture_url} alt={fullName} className="object-cover" />
              <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-lg font-medium">
                {initials || '?'}
              </AvatarFallback>
            </Avatar>
            {networkDistance && networkDistance <= 3 && (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-background border-2 border-primary rounded-full flex items-center justify-center text-[10px] font-bold text-primary">
                {networkDistance}°
              </span>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            {/* Row 1: Name + badges + actions */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap min-w-0 max-w-full">
                  {/* Avatar inline next to name on mobile */}
                  <div className="relative shrink-0 sm:hidden">
                    <Avatar className="w-8 h-8 border border-border shadow-sm">
                      <AvatarImage src={profile.profile_picture_url} alt={fullName} className="object-cover" />
                      <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-xs font-medium">
                        {initials || '?'}
                      </AvatarFallback>
                    </Avatar>
                    {networkDistance && networkDistance <= 3 && (
                      <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-background border border-primary rounded-full flex items-center justify-center text-[8px] font-bold text-primary">
                        {networkDistance}°
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-foreground text-sm sm:text-base leading-tight break-words sm:truncate">
                    {fullName || 'Profil LinkedIn'}
                  </h3>
                  {(profile as any)._fromPool && (
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0 border-muted-foreground/30 text-muted-foreground/70 gap-0.5 shrink-0">
                      🔄 Pool
                    </Badge>
                  )}
                  <CardStatusBadges
                    candidateStatus={candidateStatus}
                    jobScore={jobScore}
                    profile={profile}
                    isLikelyToRespond={isLikelyToRespond}
                    airtableMatch={airtableMatch}
                    notionMatch={notionMatch}
                    historyData={historyData}
                    historyLoading={historyLoading}
                    historyLatestDateLabel={historyLatestDateLabel}
                  />
                </div>
              </div>

              {/* Desktop actions */}
              <div className="hidden sm:flex shrink-0" data-no-detail>
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

            {/* Row 2: Headline */}
            <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mt-0.5 leading-snug break-words">
              {profile.headline || currentRole || 'Profil LinkedIn'}
            </p>

            {/* Row 3: Company + Location + Experience + Connections */}
            <div className="flex flex-col sm:flex-row sm:flex-wrap items-start sm:items-center gap-x-2 sm:gap-x-4 gap-y-0.5 mt-1.5 text-[10px] sm:text-xs text-muted-foreground">
              {currentCompany && (
                <span className="flex items-center gap-1.5 font-medium text-foreground/80 min-w-0">
                  {profileData.currentJob?.logo ? (
                    <img src={profileData.currentJob.logo} alt="" className="w-4 h-4 rounded object-contain bg-white border border-border/30 shrink-0" />
                  ) : (
                    <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
                  )}
                  <span className="min-w-0 break-words sm:truncate">{currentCompany}</span>
                  {companyType && companyType.type !== 'other' && (
                    <span className="text-[8px] font-bold uppercase tracking-wider px-1 py-0.5 border border-foreground/15 text-muted-foreground shrink-0" title={companyType.signals.join(' · ')}>
                      {companyType.label}
                    </span>
                  )}
                  {currentJobTenure && (
                    <span className="text-muted-foreground/40 font-normal shrink-0">• {currentJobTenure}</span>
                  )}
                </span>
              )}
              {profile.location && (
                <span className="flex items-center gap-1 min-w-0">
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span className="min-w-0 break-words sm:truncate">{profile.location}</span>
                </span>
              )}
              {totalExperience && (
                <span className="flex items-center gap-1 text-emerald-600 font-medium">
                  <TrendingUp className="w-3.5 h-3.5" />
                  {totalExperience}
                </span>
              )}
              {connectionsCount && (
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {connectionsCount.toLocaleString()} connexions
                </span>
              )}
              {switchResult.score > 0 && (
                <LikelyToSwitchBadge result={switchResult} />
              )}
            </div>

            {/* Row 4: Pre-score + Job Score */}
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

            {/* Row 5: Experience preview */}
            {(otherCurrentJobs.length > 0 || pastJobs.length > 0) && (
              <div className="mt-2 pt-2 border-t border-border/50">
                <div className="space-y-1">
                  {[...otherCurrentJobs.slice(0, 1), ...pastJobs.slice(0, 1)].map((pos: any, index: number) => (
                    <div key={index} className="flex items-center gap-2 text-xs min-w-0">
                      {pos.logo ? (
                        <img src={pos.logo} alt="" className="w-4 h-4 rounded object-contain bg-white border border-border/30 shrink-0" />
                      ) : (
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${index === 0 && otherCurrentJobs.length > 0 ? 'bg-green-500' : 'bg-primary/40'}`} />
                      )}
                      <span className="text-muted-foreground truncate">
                        <span className="font-medium">{pos.role || pos.position}</span>
                        <span className="text-muted-foreground/40"> chez </span>
                        <span>{pos.company}</span>
                      </span>
                    </div>
                  ))}
                  {(otherCurrentJobs.length + pastJobs.length) > 2 && (
                    <span className="text-[10px] text-primary font-medium">
                      +{otherCurrentJobs.length + pastJobs.length - 2} autres
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Row 6: Skills */}
            {skills.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2 overflow-hidden">
                {skills.slice(0, 4).map((skill: any, index: number) => (
                  <Badge key={index} variant="secondary" className="text-[10px] px-1.5 py-0 bg-muted text-muted-foreground font-normal">
                    {skill.name || skill}
                  </Badge>
                ))}
                {skills.length > 4 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary font-medium">
                    +{skills.length - 4}
                  </Badge>
                )}
              </div>
            )}

            {/* Row 7: History (Airtable / Notion) */}
            {(historyData || notionShortlistsForCandidate.length > 0 || historyPanelLoading) && (
              <div className="mt-2">
                <CandidateHistoryPanel data={historyData} loading={historyPanelLoading} compact notionShortlists={notionShortlistsForCandidate} />
              </div>
            )}

            {/* Row 8: Mobile actions */}
            <div className="flex sm:hidden items-center gap-0.5 mt-2 overflow-x-auto max-w-full no-scrollbar" data-no-detail>
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
                compact
              />
            </div>

            {/* "Voir détails" */}
            <div
              className="mt-1.5 text-[10px] text-primary font-medium sm:text-primary/60 sm:opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 cursor-pointer py-0.5"
              onClick={(e) => { e.stopPropagation(); onOpenDetail?.(); }}
            >
              <ExternalLink className="w-3 h-3" />
              Voir les détails
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
