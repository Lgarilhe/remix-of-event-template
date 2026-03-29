import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import linkedinLogo from '@/assets/linkedin-logo.svg';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LinkedInProfile } from '../types';
import { JobMatchResult, JobScoreDisplay, SalaryBadge } from '../JobScoreDisplay';
import { Job } from '@/types/jobs';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { CardExpandedContent } from './CardExpandedContent';
import { CardStatusBadges } from './CardStatusBadges';
import { useProfileData } from './useProfileData';
import { useCandidateHistory } from '@/hooks/useCandidateHistory';
import { NotionShortlistHistoryItem } from '@/hooks/useCandidateHistory';
import { CandidateHistoryPanel } from '../CandidateHistoryPanel';
import { useAircallHistory } from '@/hooks/useAircallHistory';
import { AircallHistoryPanel } from '../AircallHistoryPanel';
import { useNotionShortlist } from '@/hooks/useNotionCandidates';
import { OutreachMessageModal } from '../OutreachMessageModal';
import { SequenceEnrollButton } from '../SequenceEnrollButton';
import { AddToProjectButton } from '../projects/AddToProjectButton';
import {
  Building2, MapPin, TrendingUp, ExternalLink, Loader2, Mail, Phone,
  Target, PenLine, Archive,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PHONE_REGEX = /^(\+?[\d().\s-]{6,})$/;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const collectStrings = (input: unknown, depth = 0): string[] => {
  if (depth > 3 || input == null) return [];
  if (typeof input === 'string') return normalizeValue(input) ? [input.trim()] : [];
  if (Array.isArray(input)) return input.flatMap((item) => collectStrings(item, depth + 1));
  if (isRecord(input)) return Object.values(input).flatMap((value) => collectStrings(value, depth + 1));
  return [];
};

const unique = (values: string[]) => Array.from(new Set(values.map((value) => value.trim())));

const CompanyLogo: React.FC<{ company: string; logoUrl?: string }> = ({ company, logoUrl }) => {
  const [fallbackIndex, setFallbackIndex] = useState(0);

  const domainSlug = company
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(inc|inc\.|ltd|ltd\.|llc|sarl|sas|sa|gmbh|group|corp|corp\.)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

  const sources = [
    logoUrl,
    domainSlug ? `https://logo.clearbit.com/${domainSlug}.com` : null,
    domainSlug ? `https://www.google.com/s2/favicons?domain=${domainSlug}.com&sz=128` : null,
  ].filter(Boolean) as string[];

  if (!sources[fallbackIndex]) {
    return <Building2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />;
  }

  return (
    <img
      src={sources[fallbackIndex]}
      alt={company}
      className="w-4 h-4 sm:w-5 sm:h-5 object-contain shrink-0 rounded-sm"
      onError={() => setFallbackIndex((prev) => prev + 1)}
    />
  );
};

interface ProfileDetailSheetProps {
  profile: LinkedInProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedJob: Job | null;
  jobScore?: JobMatchResult;
  accountId?: string;
  activeProject?: SourcingProject | null;
  candidateStatus?: { status: string; score?: number | null; recommendation?: string | null; updated_at: string } | null;
  airtableMatch?: any;
  notionMatch?: any;
  onScoreProfile?: () => void;
  onArchive?: () => void;
  onMessageSent?: () => void;
  onSequenceEnroll?: () => void;
  onProfileTreated?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  currentIndex?: number;
  totalCount?: number;
}

export const ProfileDetailSheet: React.FC<ProfileDetailSheetProps> = ({
  profile,
  open,
  onOpenChange,
  selectedJob,
  jobScore,
  accountId,
  activeProject,
  candidateStatus,
  airtableMatch,
  notionMatch,
  onScoreProfile,
  onArchive,
  onMessageSent,
  onSequenceEnroll,
  onProfileTreated,
  onNavigatePrev,
  onNavigateNext,
  currentIndex,
  totalCount,
}) => {
  const [showMessageModal, setShowMessageModal] = useState(false);

  // Swipe gesture for mobile navigation
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const swipeBlocked = useRef(false);

  // Check if touch started inside a horizontally scrollable element
  const isInsideScrollable = (el: HTMLElement | null): boolean => {
    while (el) {
      if (el.scrollWidth > el.clientWidth + 2) return true;
      if (el.dataset?.noSwipe) return true;
      el = el.parentElement;
    }
    return false;
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeBlocked.current = isInsideScrollable(e.target as HTMLElement);
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current == null || touchStartY.current == null || swipeBlocked.current) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    // Only trigger if horizontal swipe is dominant and > 80px
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0 && onNavigatePrev) onNavigatePrev();
      if (dx < 0 && onNavigateNext) onNavigateNext();
    }
  }, [onNavigatePrev, onNavigateNext]);

  // Swipe hint animation — show only once per session on first candidate
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const hasShownHint = useRef(false);

  useEffect(() => {
    if (open && currentIndex === 0 && !hasShownHint.current && (onNavigateNext || onNavigatePrev)) {
      hasShownHint.current = true;
      const timer = setTimeout(() => setShowSwipeHint(true), 800);
      return () => clearTimeout(timer);
    }
  }, [open, currentIndex, onNavigateNext, onNavigatePrev]);

  useEffect(() => {
    if (showSwipeHint) {
      const timer = setTimeout(() => setShowSwipeHint(false), 3500);
      return () => clearTimeout(timer);
    }
  }, [showSwipeHint]);

  const [isScoring, setIsScoring] = useState(false);

  const handleScore = async () => {
    if (!onScoreProfile) return;
    setIsScoring(true);
    try {
      await onScoreProfile();
    } finally {
      setIsScoring(false);
    }
  };

  // Auto-enrich pool profiles that have no work_experience data
  const [enrichedProfile, setEnrichedProfile] = useState<LinkedInProfile | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);

  useEffect(() => {
    setEnrichedProfile(null);
  }, [profile?.id]);

  useEffect(() => {
    if (!open || !profile || !accountId) {
      setIsEnriching(false);
      return;
    }

    const isPoolShell = (profile as any)._fromPool &&
      (!profile.work_experience || profile.work_experience.length === 0) &&
      (!profile.skills || profile.skills.length === 0);

    if (!isPoolShell) {
      setIsEnriching(false);
      return;
    }

    const profileUrl = profile.public_profile_url || profile.profile_url;
    if (!profileUrl) {
      setIsEnriching(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    setIsEnriching(true);

    (async () => {
      try {
        const response = await Promise.race([
          invokeUnipile({
            body: {
              action: 'get_profile',
              account_id: accountId,
              profile_url: profileUrl,
            },
          }),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error('Auto-enrich timeout after 15s'));
            }, 15000);
          }),
        ]);

        if (cancelled) return;

        const unipileResponse = response.data;
        if (unipileResponse?.success && unipileResponse.profile) {
          emitQuotaAction('profileVisits', 1, accountId);
          const p = unipileResponse.profile as Record<string, any>;
          setEnrichedProfile({
            ...profile,
            summary: p.about || p.summary || profile.summary,
            skills: p.skills?.map((s: any) => typeof s === 'string' ? s : s.name) || [],
            work_experience: (p.positions || p.experiences || []).map((exp: any) => ({
              role: exp.title,
              company: exp.company_name || exp.company,
              company_logo: exp.company_logo || exp.logo_url || exp.logo,
              description: exp.description,
              start: exp.start_date || exp.starts_at,
              end: exp.end_date || exp.ends_at,
            })),
            education: (p.education || []).map((edu: any) => ({
              school: edu.school_name || edu.school,
              degree: edu.degree_name || edu.degree,
              field_of_study: edu.field_of_study || edu.field,
              start: edu.start_date || edu.starts_at,
              end: edu.end_date || edu.ends_at,
            })),
            location: p.location?.name || p.location || profile.location,
            profile_picture_url: p.profile_picture_url || p.picture_url || profile.profile_picture_url,
            connections_count: p.connections_count || profile.connections_count,
            network_distance: p.network_distance || profile.network_distance,
          } as LinkedInProfile);

          const { error } = await supabase
            .from('job_candidate_status')
            .update({ linkedin_profile_data: unipileResponse.profile as any })
            .eq('candidate_id', profile.id)
            .is('linkedin_profile_data', null);

          if (error) {
            console.warn('[ProfileDetail] Failed to persist enriched data:', error);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[ProfileDetail] Auto-enrich failed:', err);
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (!cancelled) setIsEnriching(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      setIsEnriching(false);
    };
  }, [open, profile?.id, accountId]);

  const effectiveProfile = enrichedProfile || profile;

  const dummyProfile = { id: '', name: '' } as LinkedInProfile;
  const profileData = useProfileData(effectiveProfile || dummyProfile);
  const candidateProfileUrl = (effectiveProfile || dummyProfile).public_profile_url || (effectiveProfile || dummyProfile).profile_url;

  // Airtable history — fetch by both URL and direct airtable_id for reliability
  const { data: historyData, loading: historyLoading } = useCandidateHistory(
    airtableMatch
      ? { linkedinUrl: candidateProfileUrl, airtableId: airtableMatch.airtable_id }
      : candidateProfileUrl
        ? { linkedinUrl: candidateProfileUrl }
        : null
  );

  // Notion shortlist data for this candidate
  const { data: notionShortlistData, isLoading: notionShortlistLoading } = useNotionShortlist();

  // Aircall history
  const aircallHistory = useAircallHistory(
    airtableMatch?.airtable_id || null,
    profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') : null,
    historyData?.candidate?.phone || null
  );

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
      profileData.fullName,
      profile?.name,
      [profile?.first_name, profile?.last_name].filter(Boolean).join(' '),
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
  }, [notionMatch, notionShortlistData, profileData.fullName, profile?.name, profile?.first_name, profile?.last_name]);

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

  const contactInfo = useMemo(() => {
    const rawValues = [
      (enrichedProfile || profile)?.contact_info?.emails,
      (enrichedProfile || profile)?.contact_info?.phones,
      airtableMatch,
      historyData?.candidate,
    ].flatMap((value) => collectStrings(value));

    const emails = unique(rawValues.filter((value) => EMAIL_REGEX.test(value.toLowerCase()))).slice(0, 4);
    const phones = unique(
      rawValues
        .map((value) => value.replace(/\s+/g, ' ').trim())
        .filter((value) => PHONE_REGEX.test(value) && !EMAIL_REGEX.test(value.toLowerCase()))
    ).slice(0, 3);

    return { emails, phones };
  }, [airtableMatch, enrichedProfile, historyData?.candidate, profile]);

  if (!profile) return null;

  // Use enriched version if available (pool profiles auto-fetched from Unipile)
  const displayProfile = enrichedProfile || profile;

  const {
    fullName, initials, currentCompany, currentRole, currentJobTenure,
    networkDistance, profileUrl, skills, education, educationPreview,
    otherCurrentJobs, pastJobs, connectionsCount, isLikelyToRespond, totalExperience,
  } = profileData;


  const shouldWaitForNotionHistory = Boolean(notionMatch) && notionShortlistsForCandidate.length === 0 && !historyData;
  const historyPanelLoading = historyLoading || (shouldWaitForNotionHistory && notionShortlistLoading);
  const hasHistory = notionShortlistsForCandidate.length > 0 || (historyData && (
    historyData.placements.length > 0 ||
    historyData.shortlists.length > 0 ||
    historyData.notes.length > 0 ||
    historyData.appointments.length > 0 ||
    historyData.candidate
  ));

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="!w-full !max-w-[100vw] min-w-0 sm:!w-[95vw] sm:!max-w-[820px] p-0 flex flex-col overflow-x-auto overflow-y-hidden rounded-none border-l border-foreground" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {/* ─── NAV + ACCENT BAR ─── */}
          <div className="h-1.5 w-full bg-brutal-accent shrink-0" />
          {(onNavigatePrev || onNavigateNext) && (
            <div className="flex items-center justify-between px-3 sm:px-6 py-1.5 bg-muted/30 border-b border-foreground/10 shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={onNavigatePrev}
                disabled={!onNavigatePrev}
                className="h-7 gap-1 text-[11px] rounded-none uppercase tracking-wider font-semibold px-2"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Préc.
              </Button>
              {currentIndex != null && totalCount != null && (
                <span className="text-[10px] text-muted-foreground tabular-nums font-medium uppercase tracking-wider">
                  {currentIndex + 1} / {totalCount}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onNavigateNext}
                disabled={!onNavigateNext}
                className="h-7 gap-1 text-[11px] rounded-none uppercase tracking-wider font-semibold px-2"
              >
                Suiv.
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}
          {/* ─── SWIPE HINT (mobile, first open only) ─── */}
          {showSwipeHint && (
            <div className="sm:hidden flex items-center justify-center gap-3 py-2 bg-foreground text-background text-[11px] font-medium uppercase tracking-wider animate-fade-in shrink-0">
              <ChevronLeft className="w-4 h-4 animate-[pulse_1s_ease-in-out_infinite]" />
              <span>Swipez pour naviguer</span>
              <ChevronRight className="w-4 h-4 animate-[pulse_1s_ease-in-out_infinite]" />
            </div>
          )}
          {/* ─── HEADER ─── */}
          <SheetHeader className="px-3 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 bg-background border-b border-foreground shrink-0">
            <div className="flex items-start gap-3 sm:gap-4">
               <Avatar className="w-12 h-12 sm:w-16 sm:h-16 border border-foreground shrink-0 rounded-none">
                <AvatarImage src={displayProfile.profile_picture_url} alt={fullName} className="object-cover" />
                <AvatarFallback className="bg-brutal-accent text-foreground text-base sm:text-xl font-bold rounded-none">
                  {initials || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 space-y-1">
                <SheetTitle className="text-base sm:text-xl font-black text-foreground uppercase tracking-wide leading-tight truncate">
                  {fullName || 'Profil LinkedIn'}
                </SheetTitle>
                <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 leading-snug">
                  {displayProfile.headline || currentRole || 'Profil LinkedIn'}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 pt-0.5 text-[11px] sm:text-xs text-muted-foreground">
                  {currentCompany && (
                    <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                      <CompanyLogo company={currentCompany} logoUrl={profileData.currentJob?.company_logo} />
                      <span className="truncate max-w-[120px] sm:max-w-none">{currentCompany}</span>
                      {currentJobTenure && <span className="text-muted-foreground/50 font-normal hidden sm:inline">• {currentJobTenure}</span>}
                    </span>
                  )}
                  {displayProfile.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                      <span className="truncate max-w-[100px] sm:max-w-none">{displayProfile.location}</span>
                    </span>
                  )}
                  {totalExperience && (
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0" />
                      {totalExperience}
                    </span>
                  )}
                </div>
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

              {/* ─── CONTACT INFO ─── */}
              {(contactInfo.emails.length > 0 || contactInfo.phones.length > 0) && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-foreground/10 pt-2">
                  {contactInfo.emails.map((email) => (
                    <Badge
                      key={email}
                      variant="outline"
                      className="gap-1 rounded-none border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium text-foreground"
                    >
                      <Mail className="h-3 w-3" />
                      <span className="max-w-[180px] truncate">{email}</span>
                    </Badge>
                  ))}

                  {contactInfo.phones.map((phone) => (
                    <Badge
                      key={phone}
                      variant="outline"
                      className="gap-1 rounded-none border-border/70 bg-background px-2 py-0.5 text-[10px] font-medium text-foreground"
                    >
                      <Phone className="h-3 w-3" />
                      <span>{phone}</span>
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            {/* ─── ACTIONS BAR ─── */}
            <div className="flex items-center gap-1 mt-2 sm:mt-3 pt-2 sm:pt-3 border-t border-foreground/20 overflow-x-auto no-scrollbar" data-no-swipe>
              {selectedJob && onScoreProfile && !jobScore && (
                <Button
                  size="sm"
                  onClick={handleScore}
                  disabled={isScoring}
                  className="h-7 gap-1 text-[10px] rounded-none border border-foreground bg-foreground text-background hover:bg-foreground/90 px-2 uppercase tracking-wider font-bold shrink-0"
                >
                  {isScoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
                  {isScoring ? '…' : 'Score'}
                </Button>
              )}

              {accountId && jobScore?.recommendation !== 'skip' && (
                <SequenceEnrollButton
                  selectedProfiles={[profile]}
                  accountId={accountId}
                  selectedJob={selectedJob ? { id: selectedJob.id, title: selectedJob.title } : undefined}
                  onSuccess={() => { onSequenceEnroll?.(); onProfileTreated?.(); }}
                />
              )}

              {selectedJob && (
                <Button
                  size="sm"
                  onClick={() => setShowMessageModal(true)}
                  className="h-7 gap-1 text-[10px] rounded-none border border-foreground bg-brutal-accent text-foreground hover:bg-brutal-accent/80 px-2 uppercase tracking-wider font-bold shrink-0"
                >
                  <PenLine className="w-3 h-3" />
                  Msg
                </Button>
              )}

              {selectedJob && (
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

              {onArchive && (
                <Button variant="outline" size="sm" onClick={onArchive} className="h-7 gap-1 text-[10px] rounded-none border border-destructive/60 text-destructive hover:bg-destructive hover:text-destructive-foreground px-2 uppercase tracking-wider font-bold shrink-0">
                  <Archive className="w-3 h-3" />
                  Arch.
                </Button>
              )}

              <div className="flex-1" />

              {profileUrl && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-7 h-7 border border-foreground/30 hover:border-foreground hover:bg-muted transition-colors shrink-0">
                      <img src={linkedinLogo} alt="LinkedIn" className="w-3.5 h-3.5" />
                    </a>
                  </TooltipTrigger>
                  <TooltipContent>Voir sur LinkedIn</TooltipContent>
                </Tooltip>
              )}
            </div>
          </SheetHeader>

          {/* ─── CONTENT ─── */}
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <div className="p-2 sm:p-6 space-y-3 sm:space-y-5 min-w-0 max-w-full">
              {/* Job Score */}
              {jobScore && (
                <details open className="border border-foreground bg-background group">
                  <summary className="flex items-center justify-between p-3 sm:p-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">Scoring</h3>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold group-open:hidden">Voir</span>
                    <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold hidden group-open:inline">Réduire</span>
                  </summary>
                  <div className="px-3 sm:px-5 pb-4">
                    <JobScoreDisplay result={jobScore} jobTitle={selectedJob?.title} compact={false} />
                  </div>
                </details>
              )}


              {/* Airtable History Panel — always show if we have data or are loading */}
              {(historyPanelLoading || hasHistory) && (
                <div className="border border-foreground overflow-hidden bg-background">
                  <CandidateHistoryPanel data={historyData} loading={historyPanelLoading} compact={false} notionShortlists={notionShortlistsForCandidate} />
                </div>
              )}

              {/* Aircall History */}
              {(aircallHistory.loading || aircallHistory.calls.length > 0) && (
                <div className="border border-foreground overflow-hidden bg-background p-3 sm:p-4">
                  <AircallHistoryPanel
                    calls={aircallHistory.calls}
                    loading={aircallHistory.loading}
                    totalCalls={aircallHistory.totalCalls}
                    totalDuration={aircallHistory.totalDuration}
                  />
                </div>
              )}

              {/* À propos */}
              {displayProfile.summary && (
                <details className="border border-foreground bg-background group">
                  <summary className="flex items-center justify-between p-3 sm:p-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                    <h3 className="text-xs font-bold text-foreground uppercase tracking-wider">À propos</h3>
                    <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                  </summary>
                  <div className="px-3 sm:px-4 pb-3 sm:pb-4">
                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{displayProfile.summary}</p>
                  </div>
                </details>
              )}

              {/* Loading indicator for pool profile enrichment */}
              {isEnriching && (
                <div className="flex items-center gap-2 p-3 border border-foreground bg-muted/30 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Chargement du profil complet…
                </div>
              )}

              {/* Tabs: experience, education, skills, messages, posts */}
              <CardExpandedContent
                profile={displayProfile}
                profileData={profileData}
                selectedJob={selectedJob}
                jobScore={jobScore}
                accountId={accountId}
                candidateStatus={candidateStatus}
                airtableMatch={airtableMatch}
                historyData={null}
                historyLoading={false}
                onClose={() => onOpenChange(false)}
                onOpenMessage={() => setShowMessageModal(true)}
                onMessageSent={onMessageSent}
                onProfileTreated={onProfileTreated}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* Outreach message modal */}
      {selectedJob && (
        <OutreachMessageModal
          open={showMessageModal}
          onOpenChange={setShowMessageModal}
          profile={profile}
          job={selectedJob}
          selectedAccount={accountId}
          calendlyLink={activeProject?.calendly_link}
          candidateHistory={historyData ? {
            shortlists: historyData.shortlists,
            placements: historyData.placements,
            notes: historyData.notes,
            appointments: historyData.appointments,
          } : undefined}
          onMessageSent={async () => {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              const userId = user?.id || '00000000-0000-0000-0000-000000000000';
              const pUrl = profile.profile_url || profile.public_profile_url;
              await supabase.from('job_candidate_status').upsert({
                job_id: selectedJob.id,
                candidate_id: profile.id,
                candidate_name: fullName,
                candidate_headline: profile.headline || null,
                linkedin_profile_url: pUrl || null,
                status: 'messaged',
                created_by: userId,
                project_id: activeProject?.id || null,
              }, { onConflict: 'job_id,candidate_id,created_by' });
            } catch (err) {
              console.error('Error saving messaged status:', err);
            }
            onMessageSent?.();
            onProfileTreated?.();
          }}
        />
      )}
    </>
  );
};
