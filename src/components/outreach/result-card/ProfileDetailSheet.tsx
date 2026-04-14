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

const getProfileQualitySignals = (profile?: LinkedInProfile | null) => {
  const workExperience = profile?.work_experience || [];
  const hasSummary = Boolean(profile?.summary && profile.summary.trim().length > 0);
  const hasEducation = (profile?.education?.length || 0) > 0;
  const hasSkills = (profile?.skills?.length || 0) > 0;
  const hasDetailedExperience = workExperience.some((exp: any) =>
    Boolean(normalizeValue(exp?.description)) ||
    Boolean(normalizeValue(exp?.role || exp?.position)) ||
    Boolean(normalizeValue(exp?.company))
  );

  return {
    hasSummary,
    hasEducation,
    hasSkills,
    hasDetailedExperience,
  };
};

const mergeProfileData = (
  base: LinkedInProfile,
  incoming?: Partial<LinkedInProfile> | null,
): LinkedInProfile => {
  if (!incoming) return base;

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (value == null) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    if (Array.isArray(value) && value.length === 0) continue;
    merged[key] = value;
  }

  merged.id = base.id;
  merged.provider_id = (incoming.provider_id as string | undefined) || base.provider_id || base.id;
  merged._source = (incoming as any)?._source || (base as any)._source;
  merged.source = (incoming as any)?.source || (base as any).source;

  return merged as LinkedInProfile;
};

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
    if (!open || !profile) {
      setIsEnriching(false);
      return;
    }

    const isDatabaseProfile =
      (profile as any)._source === 'database' ||
      (profile as any).source === 'database';
    const isPoolProfile = Boolean((profile as any)._fromPool);

    const baseSignals = getProfileQualitySignals(profile);
    const needsDatabaseDetail = isDatabaseProfile && !baseSignals.hasDetailedExperience && !baseSignals.hasEducation;
    const needsAnyEnrichment =
      needsDatabaseDetail ||
      ((isPoolProfile || isDatabaseProfile) && (
        !baseSignals.hasSummary ||
        !baseSignals.hasEducation ||
        !baseSignals.hasSkills ||
        !baseSignals.hasDetailedExperience
      ));

    if (!needsAnyEnrichment) {
      setIsEnriching(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    setIsEnriching(true);

    (async () => {
      let workingProfile = profile;

      try {
        if (needsDatabaseDetail) {
          const { data: databaseResponse } = await invokeEdgeFunction<Record<string, unknown>>('database-search', {
            action: 'get_profile',
            profile_id: profile.provider_id || profile.id,
          });

          if (!cancelled && databaseResponse?.success && databaseResponse.profile) {
            workingProfile = mergeProfileData(workingProfile, databaseResponse.profile as Partial<LinkedInProfile>);
            setEnrichedProfile(workingProfile);
          }
        }

        const refreshedSignals = getProfileQualitySignals(workingProfile);
        const profileUrl = workingProfile.public_profile_url || workingProfile.profile_url;
        const shouldFetchUnipile = Boolean(
          accountId &&
          profileUrl &&
          ((isPoolProfile || isDatabaseProfile) && (
            !refreshedSignals.hasSummary ||
            !refreshedSignals.hasEducation ||
            !refreshedSignals.hasSkills ||
            !refreshedSignals.hasDetailedExperience
          ))
        );

        if (!shouldFetchUnipile) return;

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
          emitQuotaAction('profileVisits', 1, accountId!);
          const p = unipileResponse.profile as Record<string, any>;

          const enrichedSkills = p.skills?.map((s: any) => typeof s === 'string' ? s : s.name).filter(Boolean);
          const enrichedWorkExp = (p.positions || p.experiences || []).map((exp: any) => ({
            role: exp.title,
            company: exp.company_name || exp.company,
            company_logo: exp.company_logo || exp.logo_url || exp.logo,
            description: exp.description,
            start: exp.start_date || exp.starts_at,
            end: exp.end_date || exp.ends_at,
          }));
          const enrichedEducation = (p.education || []).map((edu: any) => ({
            school: edu.school_name || edu.school,
            degree: edu.degree_name || edu.degree,
            field_of_study: edu.field_of_study || edu.field,
            start: edu.start_date || edu.starts_at,
            end: edu.end_date || edu.ends_at,
          }));

          workingProfile = mergeProfileData(workingProfile, {
            summary: (p.about || p.summary || workingProfile.summary) as string | undefined,
            skills: enrichedSkills?.length ? enrichedSkills : (workingProfile.skills || []),
            work_experience: enrichedWorkExp.length ? enrichedWorkExp : (workingProfile.work_experience || []),
            education: enrichedEducation.length ? enrichedEducation : ((workingProfile as any).education || []),
            location: (p.location?.name || p.location || workingProfile.location) as string | undefined,
            profile_picture_url: (p.profile_picture_url || p.picture_url || workingProfile.profile_picture_url) as string | undefined,
            connections_count: (p.connections_count || workingProfile.connections_count) as number | undefined,
            network_distance: (p.network_distance || workingProfile.network_distance) as string | number | undefined,
          } as Partial<LinkedInProfile>);

          setEnrichedProfile(workingProfile);

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
  }, [open, profile?.id, profile?.provider_id, accountId]);

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
        <SheetContent side="right" className="!w-full !max-w-[100vw] min-w-0 sm:!w-[95vw] sm:!max-w-[820px] p-0 flex flex-col overflow-hidden rounded-xl border-l border-border bg-muted" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {/* ─── NAV BAR ─── */}
          {(onNavigatePrev || onNavigateNext) && (
            <div className="flex items-center justify-between px-3 sm:px-5 py-2 bg-background border-b border-border shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={onNavigatePrev}
                disabled={!onNavigatePrev}
                className="h-7 gap-1 text-xs rounded-lg px-2 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Préc.
              </Button>
              {currentIndex != null && totalCount != null && (
                <span className="text-xs text-muted-foreground tabular-nums font-medium">
                  {currentIndex + 1} / {totalCount}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onNavigateNext}
                disabled={!onNavigateNext}
                className="h-7 gap-1 text-xs rounded-lg px-2 text-muted-foreground hover:text-foreground"
              >
                Suiv.
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {/* ─── SWIPE HINT ─── */}
          {showSwipeHint && (
            <div className="sm:hidden flex items-center justify-center gap-3 py-1.5 bg-primary/10 text-primary text-xs font-medium animate-fade-in shrink-0">
              <ChevronLeft className="w-3.5 h-3.5 animate-[pulse_1s_ease-in-out_infinite]" />
              <span>Swipez pour naviguer</span>
              <ChevronRight className="w-3.5 h-3.5 animate-[pulse_1s_ease-in-out_infinite]" />
            </div>
          )}

          {/* ─── HEADER ─── */}
          <SheetHeader className="px-3 sm:px-5 pt-4 pb-3 bg-background border-b border-border shrink-0">
            <div className="flex items-start gap-3">
              <Avatar className="w-12 h-12 sm:w-14 sm:h-14 border border-border shrink-0 rounded-xl shadow-sm">
                <AvatarImage src={displayProfile.profile_picture_url} alt={fullName} className="object-cover" />
                <AvatarFallback className="bg-muted text-foreground text-base sm:text-lg font-semibold rounded-xl">
                  {initials || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-base sm:text-lg font-bold text-foreground leading-tight truncate">
                    {fullName || 'Profil LinkedIn'}
                  </SheetTitle>
                  {profileUrl && (
                    <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-muted transition-colors shrink-0">
                      <img src={linkedinLogo} alt="LinkedIn" className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 leading-snug">
                  {displayProfile.headline || currentRole || 'Profil LinkedIn'}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-muted-foreground">
                  {currentCompany && (
                    <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                      <CompanyLogo company={currentCompany} logoUrl={profileData.currentJob?.company_logo} />
                      <span className="truncate max-w-[120px] sm:max-w-none">{currentCompany}</span>
                      {currentJobTenure && <span className="text-muted-foreground/60 font-normal hidden sm:inline">· {currentJobTenure}</span>}
                    </span>
                  )}
                  {displayProfile.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate max-w-[100px] sm:max-w-none">{displayProfile.location}</span>
                    </span>
                  )}
                  {totalExperience && (
                    <span className="flex items-center gap-1 font-medium text-foreground/80">
                      <TrendingUp className="w-3 h-3 shrink-0" />
                      {totalExperience}
                    </span>
                  )}
                </div>

                {/* Status badges */}
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
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
            </div>

            {/* ─── CONTACT INFO ─── */}
            {(contactInfo.emails.length > 0 || contactInfo.phones.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5 pt-2 mt-2 border-t border-border">
                {contactInfo.emails.map((email) => (
                  <Badge
                    key={email}
                    variant="outline"
                    className="gap-1 rounded-md border-border bg-muted/50 px-2 py-0.5 text-xs font-normal text-foreground cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => { navigator.clipboard.writeText(email); toast.success('Email copié'); }}
                  >
                    <Mail className="h-3 w-3 text-muted-foreground" />
                    <span className="max-w-[160px] truncate">{email}</span>
                  </Badge>
                ))}
                {contactInfo.phones.map((phone) => (
                  <Badge
                    key={phone}
                    variant="outline"
                    className="gap-1 rounded-md border-border bg-muted/50 px-2 py-0.5 text-xs font-normal text-foreground cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => { navigator.clipboard.writeText(phone); toast.success('Téléphone copié'); }}
                  >
                    <Phone className="h-3 w-3 text-muted-foreground" />
                    <span>{phone}</span>
                  </Badge>
                ))}
              </div>
            )}

            {/* ─── ACTIONS BAR ─── */}
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border overflow-x-auto no-scrollbar" data-no-swipe>
              {selectedJob && onScoreProfile && !jobScore && (
                <Button
                  size="sm"
                  onClick={handleScore}
                  disabled={isScoring}
                  className="h-7 gap-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 px-3 font-medium shrink-0"
                >
                  {isScoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
                  Score
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
                  variant="outline"
                  size="sm"
                  onClick={() => setShowMessageModal(true)}
                  className="h-7 gap-1.5 text-xs rounded-lg px-3 font-medium shrink-0"
                >
                  <PenLine className="w-3 h-3" />
                  Message
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
                <Button variant="ghost" size="sm" onClick={onArchive} className="h-7 gap-1.5 text-xs rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2 font-medium shrink-0 ml-auto">
                  <Archive className="w-3 h-3" />
                  <span className="hidden sm:inline">Archiver</span>
                </Button>
              )}
            </div>
          </SheetHeader>

          {/* ─── CONTENT ─── */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="p-2.5 sm:p-5 space-y-3 sm:space-y-4 min-w-0 max-w-full">
              {/* Job Score */}
              {jobScore && (
                <div className="bg-background rounded-lg border border-border overflow-hidden">
                  <details open className="group">
                    <summary className="flex items-center justify-between p-3 sm:p-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                      <h3 className="text-xs font-semibold text-foreground">Scoring</h3>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="px-3 sm:px-4 pb-4">
                      <JobScoreDisplay result={jobScore} jobTitle={selectedJob?.title} compact={false} />
                    </div>
                  </details>
                </div>
              )}

              {/* Airtable History Panel */}
              {(historyPanelLoading || hasHistory) && (
                <div className="bg-background rounded-lg border border-border overflow-hidden">
                  <CandidateHistoryPanel data={historyData} loading={historyPanelLoading} compact={false} notionShortlists={notionShortlistsForCandidate} />
                </div>
              )}

              {/* Aircall History */}
              {(aircallHistory.loading || aircallHistory.calls.length > 0) && (
                <div className="bg-background rounded-lg border border-border overflow-hidden p-3 sm:p-4">
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
                <div className="bg-background rounded-lg border border-border overflow-hidden">
                  <details className="group">
                    <summary className="flex items-center justify-between p-3 sm:p-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                      <h3 className="text-xs font-semibold text-foreground">À propos</h3>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="px-3 sm:px-4 pb-3 sm:pb-4">
                      <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{displayProfile.summary}</p>
                    </div>
                  </details>
                </div>
              )}

              {/* Loading indicator for pool profile enrichment */}
              {isEnriching && (
                <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-background text-sm text-muted-foreground">
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
