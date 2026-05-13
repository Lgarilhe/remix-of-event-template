import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LinkedInProfile } from './types';
import { useCandidateHistory, NotionShortlistHistoryItem } from '@/hooks/useCandidateHistory';
import { computeLikelyToSwitch } from '@/hooks/linkedin/likelyToSwitch';
import { LikelyToSwitchBadge } from './LikelyToSwitchBadge';
import { CandidateHistoryPanel } from './CandidateHistoryPanel';
import { useNotionShortlist } from '@/hooks/useNotionCandidates';
import { JobMatchResult } from './JobScoreDisplay';

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
import { ProfileExperienceList } from './result-card/ProfileExperienceList';
import { ProfileEducationList } from './result-card/ProfileEducationList';
import { useProfileData } from './result-card/useProfileData';
import { LinkedInResultCardProps } from './result-card/types';

interface ExtendedResultCardProps extends LinkedInResultCardProps {
  onOpenDetail?: () => void;
  isBatchScoring?: boolean;
  /** Mode d'affichage : 'compact' = scan rapide (cache exp/edu/skills),
      'detailed' = mini-CV complet (default). Persisté en localStorage par le parent. */
  viewMode?: 'compact' | 'detailed';
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
  enrollmentInfo,
  onOpenDetail,
  isBatchScoring = false,
  viewMode = 'detailed',
}) => {
  const isCompactMode = viewMode === 'compact';
  const [isScoring, setIsScoring] = useState(false);
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
  const hasHighScore = jobScore && jobScore.match_score > 80;
  const flashColorMap = {
    go: 'hsl(var(--accent))',
    maybe: 'hsl(var(--primary))',
    skip: 'hsl(var(--destructive))',
  };

  return (
    <div
      className={`relative bg-card border-2 transition-all max-w-full cursor-pointer group focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
        isSelected
          ? 'border-primary shadow-lg ring-2 ring-primary/25 bg-primary/[0.04]'
          : 'border-border shadow hover:shadow-md hover:border-foreground/50'
      }`}
      style={{ wordBreak: 'break-word' }}
      role="button"
      tabIndex={0}
      aria-label={`Candidat ${profile.name || 'sans nom'}${profile.headline ? ', ' + profile.headline : ''}${jobScore ? ', score ' + jobScore.match_score + ' sur 100' : ''}`}
      onClick={(e) => {
        if (showScoringOverlay) return;
        const target = e.target as HTMLElement;
        if (target.closest('button, a, input, [role="checkbox"], [data-no-detail]')) return;
        onOpenDetail?.();
      }}
      onKeyDown={(e) => {
        // 🆕 Opus audit B2 : keyboard nav sur les cards de résultats sourcing
        // (avant aucune gestion — impossible de parcourir les profils au clavier)
        if (showScoringOverlay) return;
        if (e.key === 'Enter' || e.key === ' ') {
          // Ignore si l'utilisateur est dans un input/bouton interne
          const target = e.target as HTMLElement;
          if (target.closest('button, a, input, [role="checkbox"], [data-no-detail]')) return;
          e.preventDefault();
          onOpenDetail?.();
        }
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
            <span className="text-xs font-medium text-muted-foreground">
              Scoring…
            </span>
          </div>
        </div>
      )}
      {/* Main card content — padding reduit (p-2 sm:p-3 au lieu de p-2.5 sm:p-4)
          pour gagner ~8px hauteur globale par card */}
      <div className={`p-2 sm:p-3 transition-all duration-300 ${showScoringOverlay ? 'select-none pointer-events-none' : ''}`}>
        <div className="relative flex items-start gap-2 sm:gap-3 min-w-0 w-full">
          {/* Checkbox - top-right on mobile, left column on desktop.
              Renforcée : h-5 w-5 + border-2 + bg-background pour ressortir
              du fond de la card et donner un vrai relief de zone cliquable. */}
          {selectedJob && onToggleSelect && (
            <>
              {/* Desktop: left column */}
              <div className="hidden sm:block pt-3" data-no-detail>
                {jobScore?.recommendation === 'skip' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="w-5 h-5 rounded border-2 border-destructive/40 bg-destructive/5 flex items-center justify-center cursor-not-allowed">
                        <X className="w-3 h-3 text-destructive/50" />
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
                    className="w-5 h-5 border-2 border-foreground/50 bg-background hover:border-foreground hover:bg-muted shadow data-[state=checked]:bg-primary data-[state=checked]:border-primary transition-colors"
                  />
                )}
              </div>
              {/* Mobile: absolute top-right */}
              <div className="sm:hidden absolute top-1 right-1 z-10" data-no-detail>
                {jobScore?.recommendation === 'skip' ? (
                  <div className="w-6 h-6 rounded border-2 border-destructive/40 bg-destructive/5 flex items-center justify-center cursor-not-allowed">
                    <X className="w-3.5 h-3.5 text-destructive/50" />
                  </div>
                ) : (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={onToggleSelect}
                    className="w-6 h-6 border-2 border-foreground/50 bg-background hover:border-foreground shadow data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                  />
                )}
              </div>
            </>
          )}

          {/* Avatar - separate column on desktop only */}
          <div className="relative shrink-0 hidden sm:block">
            <Avatar className="w-14 h-14 border border-border shadow-md">
              <AvatarImage src={profile.profile_picture_url} alt={fullName} className="object-cover" />
              <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-lg font-medium">
                {initials || '?'}
              </AvatarFallback>
            </Avatar>
            {networkDistance && networkDistance <= 3 && (
              <span className="absolute -bottom-1 -right-1 w-5 h-5 bg-background border-2 border-primary rounded-full flex items-center justify-center text-xs font-bold text-primary">
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
                      <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-background border border-primary rounded-full flex items-center justify-center text-3xs font-bold text-primary">
                        {networkDistance}°
                      </span>
                    )}
                  </div>
                  <h3 className="font-semibold text-foreground text-sm sm:text-base leading-tight break-words sm:truncate">
                    {fullName || 'Profil LinkedIn'}
                  </h3>
                  {(profile as any)._fromPool && (
                    <Badge variant="outline" className="text-xs px-1.5 py-0 border-muted-foreground/30 text-muted-foreground/70 gap-0.5 shrink-0">
                      🔄 Pool
                    </Badge>
                  )}
                  <CardStatusBadges
                    candidateStatus={candidateStatus}
                    profile={profile}
                    airtableMatch={airtableMatch}
                    notionMatch={notionMatch}
                    historyData={historyData}
                    historyLoading={historyLoading}
                    jobScore={jobScore}
                    isLikelyToRespond={isLikelyToRespond}
                    enrollmentInfo={enrollmentInfo}
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
                  onScoreProfile={onScoreProfile}
                  onOpenMessage={() => onOpenDetail?.()}
                  onArchive={onArchive}
                  onSequenceEnroll={onSequenceEnroll}
                  onProfileTreated={onProfileTreated}
                />
              </div>
            </div>

            {/* Row 2: Headline */}
            <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mt-0.5 leading-snug break-words">
              {profile.headline || currentRole || 'Profil LinkedIn'}
            </p>

            {/* Row 3: Meta — refonte 2026-04-27.
                Avant : icônes partout, items flex séparés -> bruit visuel.
                Après : single line wrapping avec puces • séparatrices,
                icône uniquement sur le 1er item (Building2/logo), tabular-nums
                sur chiffres pour alignement vertical entre cards. */}
            <div className="flex items-center gap-x-1.5 gap-y-0.5 mt-1.5 text-xs text-muted-foreground flex-wrap min-w-0">
              {currentCompany && (
                <span className="flex items-center gap-1.5 font-medium text-foreground/85 min-w-0">
                  {profileData.currentJob?.logo ? (
                    <img src={profileData.currentJob.logo} alt={currentCompany || ''} className="w-4 h-4 rounded object-contain bg-card border border-border/30 shrink-0" />
                  ) : (
                    <Building2 className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
                  )}
                  <span className="min-w-0 break-words sm:truncate">{currentCompany}</span>
                  {companyType && companyType.type !== 'other' && (
                    <span className="text-3xs font-bold px-1 py-0.5 border border-border text-muted-foreground shrink-0" title={companyType.signals.join(' · ')}>
                      {companyType.label}
                    </span>
                  )}
                </span>
              )}
              {currentJobTenure && (
                <>
                  <span className="text-muted-foreground/30 select-none" aria-hidden="true">•</span>
                  <span className="text-muted-foreground/80 shrink-0">{currentJobTenure}</span>
                </>
              )}
              {profile.location && (
                <>
                  <span className="text-muted-foreground/30 select-none" aria-hidden="true">•</span>
                  <span className="min-w-0 break-words sm:truncate">{profile.location.split(',')[0]}</span>
                </>
              )}
              {totalExperience && (
                <>
                  <span className="text-muted-foreground/30 select-none" aria-hidden="true">•</span>
                  <span className="text-success font-medium tabular-nums">{totalExperience}</span>
                </>
              )}
              {connectionsCount && (
                <>
                  <span className="text-muted-foreground/30 select-none" aria-hidden="true">•</span>
                  <span className="tabular-nums">
                    {connectionsCount >= 1000 ? `${Math.round(connectionsCount / 100) / 10}k` : connectionsCount}
                    {' '}rel.
                  </span>
                </>
              )}
              {switchResult.score > 0 && (
                <span className="ml-1">
                  <LikelyToSwitchBadge result={switchResult} />
                </span>
              )}
            </div>

            {/* Row 4 (ancien) : JobScoreDisplay — RETIRÉ.
                Le score est maintenant promu inline dans CardStatusBadges (row 1
                à côté du nom) pour être visible immédiatement. Le détail complet
                (matching skills, missing, summary) reste accessible dans le sheet
                de détail au clic sur la card. */}

            {/* Rows 5-7 cachees en mode compact (defaut detaille = mini-CV complet,
                compact = juste header + meta pour scan rapide) */}
            {!isCompactMode && (
              <>
                {/* Row 5: Expériences pro complètes — logo + titre + dates + durée */}
                {profile.work_experience && profile.work_experience.length > 0 && (
                  <ProfileExperienceList experiences={profile.work_experience} defaultLimit={2} />
                )}

                {/* Row 6: Formation — logo + diplôme + dates */}
                {profile.education && profile.education.length > 0 && (
                  <ProfileEducationList education={profile.education} defaultLimit={1} />
                )}

                {/* Row 7: Skills compacts */}
                {skills.length > 0 && (
                  <div className="flex flex-wrap gap-0.5 mt-1.5 pt-1.5 border-t border-border/40">
                    {skills.slice(0, 6).map((skill: any, index: number) => (
                      <Badge key={index} variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-muted/60 text-muted-foreground font-normal leading-none">
                        {skill.name || skill}
                      </Badge>
                    ))}
                    {skills.length > 6 && (
                      <Badge variant="secondary" className="text-3xs px-1.5 py-0 h-4 bg-primary/10 text-primary font-medium leading-none">
                        +{skills.length - 6}
                      </Badge>
                    )}
                  </div>
                )}
              </>
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
                onScoreProfile={onScoreProfile}
                onOpenMessage={() => onOpenDetail?.()}
                onArchive={onArchive}
                onSequenceEnroll={onSequenceEnroll}
                onProfileTreated={onProfileTreated}
                compact
              />
            </div>

            {/* "Voir détails" */}
            <div
              className="mt-1.5 text-xs text-primary font-medium sm:text-primary/60 sm:opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 cursor-pointer py-0.5"
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
