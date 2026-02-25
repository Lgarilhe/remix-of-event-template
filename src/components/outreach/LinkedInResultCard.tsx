import React, { useState } from 'react';
import { LinkedInProfile } from './types';
import { useCandidateHistory } from '@/hooks/useCandidateHistory';
import { CandidateHistoryPanel } from './CandidateHistoryPanel';
import { JobScoreDisplay, JobMatchResult } from './JobScoreDisplay';
import { Job } from '@/pages/JobSpace';
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

// Sub-components
import { CardStatusBadges } from './result-card/CardStatusBadges';
import { CardActions } from './result-card/CardActions';
import { useProfileData } from './result-card/useProfileData';
import { LinkedInResultCardProps } from './result-card/types';

interface ExtendedResultCardProps extends LinkedInResultCardProps {
  onOpenDetail?: () => void;
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
}) => {
  const [isScoring, setIsScoring] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const profileData = useProfileData(profile);
  const {
    fullName, initials, currentCompany, currentRole, currentJobTenure,
    networkDistance, profileUrl, skills, education, educationPreview,
    otherCurrentJobs, pastJobs, connectionsCount,
    isLikelyToRespond, totalExperience,
  } = profileData;

  // Airtable history
  const candidateProfileUrl = profile.public_profile_url || profile.profile_url;
  const { data: historyData, loading: historyLoading } = useCandidateHistory(
    airtableMatch
      ? { linkedinUrl: candidateProfileUrl, airtableId: airtableMatch.airtable_id }
      : null
  );

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

  return (
    <div
      className={`bg-background rounded-xl border transition-all overflow-hidden max-w-full cursor-pointer group ${
        'border-border hover:border-primary/20 hover:shadow-md'
      }`}
      style={{ wordBreak: 'break-word' }}
      onClick={(e) => {
        // Don't open detail if clicking on interactive elements
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, [role="checkbox"], [data-no-detail]')) return;
        onOpenDetail?.();
      }}
    >
      {/* Main card content */}
      <div className="p-2.5 sm:p-4 overflow-hidden">
        <div className="flex items-start gap-2 sm:gap-4 min-w-0">
          {/* Checkbox */}
          {selectedJob && onToggleSelect && (
            <div className="pt-3" data-no-detail>
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
          )}

          {/* Avatar */}
          <div className="relative shrink-0">
            <Avatar className="w-10 h-10 sm:w-14 sm:h-14 border-2 border-background shadow-md">
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
          <div className="flex-1 min-w-0 overflow-hidden">
            <div className="flex flex-col gap-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                    <h3 className="font-semibold text-foreground text-sm sm:text-base truncate">
                      {fullName || 'Profil LinkedIn'}
                    </h3>
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

                  <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mt-0.5 sm:mt-1 leading-snug">
                    {profile.headline || currentRole || 'Profil LinkedIn'}
                  </p>
                  {historyData && !historyLoading && (
                    <CandidateHistoryPanel data={historyData} loading={false} compact />
                  )}
                </div>

                {/* Desktop actions */}
                <div className="hidden sm:flex" data-no-detail>
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
                  />
                </div>
              </div>

              {/* Mobile actions */}
              <div className="flex sm:hidden items-center gap-0.5 mt-1 overflow-x-auto max-w-full no-scrollbar" data-no-detail>
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
                  compact
                />
              </div>
            </div>

            {/* Meta info row */}
            <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-4 gap-y-1 mt-2 sm:mt-3 text-[10px] sm:text-xs text-muted-foreground">
              {currentCompany && (
                <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                  {profileData.currentJob?.logo ? (
                    <img src={profileData.currentJob.logo} alt="" className="w-4 h-4 rounded object-contain bg-white border border-border/30" />
                  ) : (
                    <Building2 className="w-3.5 h-3.5 text-primary" />
                  )}
                  {currentCompany}
                  {currentJobTenure && (
                    <span className="text-muted-foreground/40 font-normal">• {currentJobTenure}</span>
                  )}
                </span>
              )}
              {profile.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="w-3.5 h-3.5" />
                  {profile.location}
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
            </div>

            {/* Job Score Display - compact inline */}
            {jobScore && (
              <div className="mt-2">
                <JobScoreDisplay
                  result={jobScore}
                  jobTitle={selectedJob?.title}
                  compact
                />
              </div>
            )}

            {/* Experience preview - compact */}
            {(otherCurrentJobs.length > 0 || pastJobs.length > 0) && (
              <div className="mt-2 pt-2 border-t border-border/50">
              <div className="space-y-1.5">
                  {[...otherCurrentJobs.slice(0, 1), ...pastJobs.slice(0, 1)].map((pos: any, index: number) => (
                    <div key={index} className="flex items-center gap-2 text-xs min-w-0">
                      {pos.logo ? (
                        <img src={pos.logo} alt="" className="w-4 h-4 rounded object-contain bg-white border border-border/30 shrink-0" />
                      ) : (
                        <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${index === 0 && otherCurrentJobs.length > 0 ? 'bg-green-500' : 'bg-primary/40'}`} />
                      )}
                      <span className="text-muted-foreground truncate">
                        <span className="font-medium">{pos.role}</span>
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

            {/* Skills preview - compact */}
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

            {/* "Voir détails" - visible on mobile, hover on desktop */}
            <div
              className="mt-2 text-[10px] text-primary font-medium sm:text-primary/60 sm:opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 cursor-pointer py-1"
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
