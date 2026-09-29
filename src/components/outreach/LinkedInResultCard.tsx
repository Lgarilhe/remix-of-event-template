import React, { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { LinkedInProfile } from './types';
import { useCandidateHistory } from '@/hooks/useCandidateHistory';
import { computeLikelyToSwitch } from '@/hooks/linkedin/likelyToSwitch';
import { LikelyToSwitchBadge } from './LikelyToSwitchBadge';
import { CandidateHistoryPanel } from './CandidateHistoryPanel';
import { JobMatchResult } from './JobScoreDisplay';

import { Job } from '@/types/jobs';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Briefcase, MapPin, GraduationCap,
  Users, TrendingUp, AlertTriangle,
  X, ExternalLink,
} from 'lucide-react';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { classifyFromProfile } from '@/lib/companyClassification';
import { CompanyLogo } from '@/components/candidates/CompanyLogo';

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
  enrollmentInfo,
  onOpenDetail,
  isBatchScoring = false,
  viewMode = 'detailed',
}) => {
  const isCompactMode = viewMode === 'compact';
  const [isScoring, setIsScoring] = useState(false);
  const [scoreFlash, setScoreFlash] = useState<'go' | 'maybe' | 'skip' | null>(null);
  const prevScoreRef = useRef<number | undefined>(jobScore?.match_score);

  // Score flash effect when a score first appears + reset isScoring quand le
  // score arrive. Avant : setIsScoring n'était jamais appelé → l'user ne voyait
  // aucun feedback de chargement entre le clic sur SCORE et l'arrivée du résultat
  // (typiquement 2-5s d'attente LLM).
  useEffect(() => {
    const currentRec = jobScore?.recommendation;
    const currentScore = jobScore?.match_score;
    if (currentRec && currentScore !== undefined && prevScoreRef.current === undefined) {
      setScoreFlash(currentRec as 'go' | 'maybe' | 'skip');
      setIsScoring(false);
      const timer = setTimeout(() => setScoreFlash(null), 1000);
      prevScoreRef.current = currentScore;
      return () => clearTimeout(timer);
    }
    prevScoreRef.current = currentScore;
  }, [jobScore?.match_score, jobScore?.recommendation]);

  // Wrapper sur le clic SCORE : active immédiatement le loading state local
  // pour donner feedback visuel à l'user. Le useEffect ci-dessus le remet à
  // false dès que le jobScore arrive (ou batch scoring termine).
  const handleScoreClick = useCallback(() => {
    if (!onScoreProfile || isScoring) return;
    setIsScoring(true);
    try {
      const result = onScoreProfile() as unknown;
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).catch(() => setIsScoring(false)).finally(() => {
          // Safety net : si le hook reject sans setJobScores, on relâche le loader.
          // Le cas normal (succès) est géré par le useEffect au-dessus.
        });
      }
    } catch {
      setIsScoring(false);
    }
  }, [onScoreProfile, isScoring]);

  const profileData = useProfileData(profile);
  // Compétences du poste, en minuscules : elles passent en tête des puces du profil.
  const jobSkillSet = useMemo(
    () => new Set(
      ((selectedJob?.skills as unknown[] | undefined) ?? [])
        .map((skill) => String(typeof skill === 'string' ? skill : (skill as { name?: string })?.name ?? '').trim().toLowerCase())
        .filter(Boolean),
    ),
    [selectedJob],
  );
  const switchResult = useMemo(() => computeLikelyToSwitch(profile), [profile]);
  const {
    fullName, initials, currentCompany, currentRole, currentJobTenure,
    networkDistance, profileUrl, skills, education, educationPreview,
    otherCurrentJobs, pastJobs, connectionsCount,
    isLikelyToRespond, totalExperience,
  } = profileData;
  // Logo entreprise par domaine — dispo dès l'aperçu (gratuit). Le site de la
  // société active permet un logo précis ; à défaut, CompanyLogo devine depuis
  // le nom puis tombe sur le favicon.
  const companyLogoUrl = useMemo(() => {
    const website = (profile as any).company_website as string | undefined;
    if (!website || typeof website !== 'string') return undefined;
    try {
      const host = new URL(website.startsWith('http') ? website : `https://${website}`)
        .hostname.replace(/^www\./, '');
      return host ? `https://logo.clearbit.com/${host}` : undefined;
    } catch {
      return undefined;
    }
  }, [profile]);
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
  const hasHighScore = jobScore && jobScore.match_score > 80;
  const flashColorMap = {
    go: 'hsl(var(--accent))',
    maybe: 'hsl(var(--primary))',
    skip: 'hsl(var(--destructive))',
  };

  return (
    <div
      className={`group relative max-w-full cursor-pointer rounded-xl border bg-card transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
        isSelected
          ? 'border-brand/55 bg-brand/10'
          : 'border-border hover:border-border-strong'
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
        <div className="absolute bottom-0 left-0 top-0 w-1 rounded-l-xl bg-brand" />
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
                      <div className="flex h-5 w-5 cursor-not-allowed items-center justify-center rounded border border-border bg-muted">
                        <X className="h-3 w-3 text-muted-foreground" aria-hidden="true" />
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
                    aria-label={`Sélectionner ${fullName || 'ce profil'}`}
                  />
                )}
              </div>
              {/* Mobile: absolute top-right */}
              <div className="sm:hidden absolute top-1 right-1 z-10" data-no-detail>
                {jobScore?.recommendation === 'skip' ? (
                  <div className="flex h-6 w-6 cursor-not-allowed items-center justify-center rounded border border-border bg-muted">
                    <X className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                  </div>
                ) : (
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={onToggleSelect}
                    aria-label={`Sélectionner ${fullName || 'ce profil'}`}
                    className="h-6 w-6"
                  />
                )}
              </div>
            </>
          )}

          {/* Avatar - separate column on desktop only */}
          <div className="relative shrink-0 hidden sm:block">
            <Avatar className="h-12 w-12 border border-border">
              <AvatarImage src={profile.profile_picture_url} alt={fullName} className="object-cover" />
              <AvatarFallback className="bg-muted text-base font-semibold text-foreground-secondary">
                {initials || '?'}
              </AvatarFallback>
            </Avatar>
            {networkDistance && networkDistance <= 3 && (
              <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-background text-2xs tabular-nums text-muted-foreground" title="Degré de relation LinkedIn">
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
                    <Avatar className="h-8 w-8 border border-border">
                      <AvatarImage src={profile.profile_picture_url} alt={fullName} className="object-cover" />
                      <AvatarFallback className="bg-muted text-xs font-semibold text-foreground-secondary">
                        {initials || '?'}
                      </AvatarFallback>
                    </Avatar>
                    {networkDistance && networkDistance <= 3 && (
                      <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full border border-border bg-background text-3xs tabular-nums text-muted-foreground" title="Degré de relation LinkedIn">
                        {networkDistance}°
                      </span>
                    )}
                  </div>
                  <h3 className="break-words text-md font-semibold leading-tight text-foreground sm:truncate">
                    {fullName || 'Profil LinkedIn'}
                  </h3>
                  {(profile as any)._fromPool && (
                    <Badge variant="muted" className="shrink-0">Déjà dans la mission</Badge>
                  )}
                  <CardStatusBadges
                    candidateStatus={candidateStatus}
                    profile={profile}
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
                  onScoreProfile={onScoreProfile ? handleScoreClick : undefined}
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
                <span className="flex min-w-0 items-center gap-1.5 text-foreground-secondary">
                  {profileData.currentJob?.logo ? (
                    <img src={profileData.currentJob.logo} alt={currentCompany || ''} className="w-4 h-4 rounded object-contain bg-card border border-border/30 shrink-0" />
                  ) : (
                    <CompanyLogo company={currentCompany || ''} logoUrl={companyLogoUrl} size="sm" className="w-4 h-4 shrink-0" />
                  )}
                  <span className="min-w-0 break-words sm:truncate">{currentCompany}</span>
                  {companyType && companyType.type !== 'other' && (
                    <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground" title={companyType.signals.join(' · ')}>
                      {companyType.label}
                    </span>
                  )}
                </span>
              )}
              {currentJobTenure && (
                <>
                  <span className="text-muted-foreground select-none" aria-hidden="true">•</span>
                  <span className="shrink-0">{currentJobTenure}</span>
                </>
              )}
              {profile.location && (
                <>
                  <span className="text-muted-foreground select-none" aria-hidden="true">•</span>
                  <span className="min-w-0 break-words sm:truncate">{profile.location.split(',')[0]}</span>
                </>
              )}
              {/* Base Konekt : signaux dispo dès l'aperçu (niveau, département,
                  secteur) — gratuits, ne nécessitent pas de collect. */}
              {(profile as any).seniority_level && (
                <>
                  <span className="text-muted-foreground select-none" aria-hidden="true">•</span>
                  <span className="shrink-0">{(profile as any).seniority_level}</span>
                </>
              )}
              {(profile as any).department && (
                <>
                  <span className="text-muted-foreground select-none" aria-hidden="true">•</span>
                  <span className="min-w-0 break-words sm:truncate">{(profile as any).department}</span>
                </>
              )}
              {(profile as any).source === 'database' && (profile as any).industry && (
                <>
                  <span className="text-muted-foreground select-none" aria-hidden="true">•</span>
                  <span className="min-w-0 break-words sm:truncate">{(profile as any).industry}</span>
                </>
              )}
              {totalExperience && (
                <>
                  <span className="text-muted-foreground select-none" aria-hidden="true">•</span>
                  <span className="font-medium tabular-nums text-foreground">{totalExperience}</span>
                </>
              )}
              {connectionsCount && (
                <>
                  <span className="text-muted-foreground select-none" aria-hidden="true">•</span>
                  <span className="tabular-nums">
                    {connectionsCount >= 1000 ? `${Math.round(connectionsCount / 100) / 10}k` : connectionsCount}
                    {' '}relations
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

                {/* Row 7 : compétences, celles du poste d'abord */}
                {skills.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1 border-t border-border/50 pt-2">
                    {[...skills]
                      .map((skill: any) => {
                        const label = String(skill?.name || skill);
                        return { label, matched: jobSkillSet.has(label.trim().toLowerCase()) };
                      })
                      .sort((a, b) => Number(b.matched) - Number(a.matched))
                      .slice(0, 8)
                      .map(({ label, matched }, index) => (
                        <Badge key={index} variant={matched ? 'brand' : 'muted'} className="font-normal" title={matched ? 'Compétence du poste' : undefined}>
                          {label}
                        </Badge>
                      ))}
                    {skills.length > 8 && (
                      <Badge variant="muted" className="font-normal tabular-nums">+{skills.length - 8}</Badge>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Row 7: History (Airtable) */}
            {(historyData || historyLoading) && (
              <div className="mt-2">
                <CandidateHistoryPanel data={historyData} loading={historyLoading} compact />
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
                onScoreProfile={onScoreProfile ? handleScoreClick : undefined}
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
