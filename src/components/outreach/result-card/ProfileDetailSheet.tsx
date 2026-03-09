import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  Building2, MapPin, TrendingUp, ExternalLink, Bot, Loader2,
  Target, CheckCircle2, AlertTriangle, PenLine, Archive, Mail,
  MessageSquare, FolderPlus, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

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
  const [isAnalyzing, setIsAnalyzing] = useState(false);
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
  const [aiAnalysis, setAiAnalysis] = useState<{
    summary: string;
    strengths: string[];
    concerns: string[];
    fit_score: number;
    recommendation: string;
  } | null>(null);

  // Reset AI analysis when profile changes
  useEffect(() => { setAiAnalysis(null); }, [profile?.id]);

  // Auto-enrich pool profiles that have no work_experience data
  const [enrichedProfile, setEnrichedProfile] = useState<LinkedInProfile | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);

  useEffect(() => {
    setEnrichedProfile(null);
  }, [profile?.id]);

  useEffect(() => {
    if (!open || !profile || !accountId) return;
    const isPoolShell = (profile as any)._fromPool &&
      (!profile.work_experience || profile.work_experience.length === 0) &&
      (!profile.skills || profile.skills.length === 0);
    if (!isPoolShell) return;

    const profileUrl = profile.public_profile_url || profile.profile_url;
    if (!profileUrl) return;

    let cancelled = false;
    setIsEnriching(true);

    (async () => {
      try {
        const { data: response } = await invokeUnipile({
          body: {
            action: 'get_profile',
            account_id: accountId,
            profile_url: profileUrl,
          },
        });
        if (cancelled) return;
        if (response?.success && response.profile) {
          const p = response.profile as Record<string, any>;
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

          // Also persist the enriched data in DB for future use
          const { error } = await supabase
            .from('job_candidate_status')
            .update({ linkedin_profile_data: response.profile as any })
            .eq('candidate_id', profile.id)
            .is('linkedin_profile_data', null);
          if (error) console.warn('[ProfileDetail] Failed to persist enriched data:', error);
        }
      } catch (err) {
        console.warn('[ProfileDetail] Auto-enrich failed:', err);
      } finally {
        if (!cancelled) setIsEnriching(false);
      }
    })();

    return () => { cancelled = true; };
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

  if (!profile) return null;

  // Use enriched version if available (pool profiles auto-fetched from Unipile)
  const displayProfile = enrichedProfile || profile;

  const {
    fullName, initials, currentCompany, currentRole, currentJobTenure,
    networkDistance, profileUrl, skills, education, educationPreview,
    otherCurrentJobs, pastJobs, connectionsCount, isLikelyToRespond, totalExperience,
  } = profileData;

  const handleAiAnalysis = async () => {
    if (aiAnalysis) { setAiAnalysis(null); return; }
    setIsAnalyzing(true);
    try {
      const profileSummary = {
        name: fullName,
        headline: profile.headline,
        currentRole,
        currentCompany,
        location: profile.location,
        skills: skills.map((s: any) => s.name || s).slice(0, 10),
        pastPositions: pastJobs.map((p: any) => `${p.role || p.position} chez ${p.company}`),
        education: education.map((e: any) => `${e.degree || ''} - ${e.school}`),
      };
      const { data, error } = await invokeEdgeFunction<{ analysis?: any }>('analyze-linkedin-profile', { profile: profileSummary });
      if (error) throw error;
      setAiAnalysis(data.analysis);
    } catch (error) {
      console.error('AI analysis error:', error);
      toast.error("Erreur lors de l'analyse IA");
    } finally {
      setIsAnalyzing(false);
    }
  };

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
        <SheetContent side="right" className="!w-full !max-w-[100vw] min-w-0 sm:!w-[95vw] sm:!max-w-[820px] p-0 flex flex-col overflow-x-auto overflow-y-hidden rounded-none border-l border-foreground">
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
          {/* ─── HEADER ─── */}
          <SheetHeader className="px-3 sm:px-6 pt-4 sm:pt-5 pb-3 sm:pb-4 bg-background border-b border-foreground shrink-0">
            <div className="flex items-start gap-2.5 sm:gap-4">
               <Avatar className="w-11 h-11 sm:w-16 sm:h-16 border border-foreground shrink-0 rounded-none">
                <AvatarImage src={displayProfile.profile_picture_url} alt={fullName} className="object-cover" />
                <AvatarFallback className="bg-brutal-accent text-foreground text-base sm:text-xl font-bold rounded-none">
                  {initials || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <SheetTitle className="text-base sm:text-xl font-bold text-foreground truncate uppercase tracking-wide">
                    {fullName || 'Profil LinkedIn'}
                  </SheetTitle>
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
                <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 mt-0.5 sm:mt-1 leading-relaxed">
                  {displayProfile.headline || currentRole || 'Profil LinkedIn'}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 sm:gap-x-4 gap-y-1 mt-1.5 sm:mt-2.5 text-[11px] sm:text-xs text-muted-foreground">
                  {currentCompany && (
                    <span className="flex items-center gap-1 font-medium text-foreground/80">
                      <Building2 className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      <span className="truncate max-w-[120px] sm:max-w-none">{currentCompany}</span>
                      {currentJobTenure && <span className="text-muted-foreground/50 font-normal hidden sm:inline">• {currentJobTenure}</span>}
                    </span>
                  )}
                  {displayProfile.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      <span className="truncate max-w-[100px] sm:max-w-none">{displayProfile.location}</span>
                    </span>
                  )}
                  {totalExperience && (
                    <span className="flex items-center gap-1 font-medium text-foreground">
                      <TrendingUp className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                      {totalExperience}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* ─── ACTIONS BAR ─── */}
            <div className="flex items-center gap-1.5 sm:gap-2 mt-3 sm:mt-4 pt-2.5 sm:pt-3 border-t border-foreground/20 flex-wrap">
              {/* Primary actions */}
              {selectedJob && (
                <Button
                  size="sm"
                  onClick={() => setShowMessageModal(true)}
                  className="h-7 sm:h-8 gap-1 sm:gap-1.5 text-[11px] sm:text-xs rounded-none border border-foreground bg-brutal-accent text-foreground hover:bg-brutal-accent/80 px-2 sm:px-3 uppercase tracking-wider font-semibold"
                >
                  <PenLine className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  <span className="hidden sm:inline">Message</span>
                  <span className="sm:hidden">Msg</span>
                </Button>
              )}

              {selectedJob && onScoreProfile && !jobScore && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleScore}
                  disabled={isScoring}
                  className="h-7 sm:h-8 gap-1 sm:gap-1.5 text-[11px] sm:text-xs rounded-none border border-foreground text-foreground hover:bg-brutal-accent/20 px-2 sm:px-3 uppercase tracking-wider font-semibold"
                >
                  {isScoring ? <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" /> : <Target className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
                  {isScoring ? '...' : 'Scorer'}
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                onClick={handleAiAnalysis}
                disabled={isAnalyzing}
                className="h-7 sm:h-8 gap-1 sm:gap-1.5 text-[11px] sm:text-xs rounded-none border border-foreground text-foreground hover:bg-brutal-accent/20 px-2 sm:px-3 uppercase tracking-wider font-semibold"
              >
                {isAnalyzing ? <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" /> : <Bot className="w-3 h-3 sm:w-3.5 sm:h-3.5" />}
                <span className="hidden sm:inline">{aiAnalysis ? 'Masquer IA' : 'Analyse IA'}</span>
                <span className="sm:hidden">{aiAnalysis ? 'IA ✕' : 'IA'}</span>
              </Button>

              {/* Sequence enroll */}
              {accountId && jobScore?.recommendation !== 'skip' && (
                <SequenceEnrollButton
                  selectedProfiles={[profile]}
                  accountId={accountId}
                  selectedJob={selectedJob ? { id: selectedJob.id, title: selectedJob.title } : undefined}
                  onSuccess={() => { onSequenceEnroll?.(); onProfileTreated?.(); }}
                />
              )}

              {/* Add to project */}
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

              {/* Spacer */}
              <div className="flex-1" />

              {/* Secondary actions */}
              {onArchive && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="ghost" size="sm" onClick={onArchive} className="h-7 sm:h-8 w-7 sm:w-8 p-0 text-muted-foreground hover:text-destructive rounded-none">
                      <Archive className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent><p className="text-xs">Archiver</p></TooltipContent>
                </Tooltip>
              )}

              {profileUrl && (
                <Button variant="outline" size="sm" asChild className="h-7 sm:h-8 gap-1 sm:gap-1.5 text-[11px] sm:text-xs rounded-none border border-foreground px-2 sm:px-3 uppercase tracking-wider font-semibold">
                  <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                    <span className="hidden sm:inline">LinkedIn</span>
                    <span className="sm:hidden">LI</span>
                  </a>
                </Button>
              )}
            </div>
          </SheetHeader>

          {/* ─── CONTENT ─── */}
          <div className="flex-1 overflow-y-auto overflow-x-auto">
            <div className="p-2 sm:p-6 space-y-3 sm:space-y-5 min-w-0 max-w-full">
              {/* Job Score */}
              {jobScore && (
                <div className="border border-foreground p-5 bg-background">
                  <JobScoreDisplay result={jobScore} jobTitle={selectedJob?.title} compact={false} />
                </div>
              )}

              {/* AI Analysis */}
              {aiAnalysis && (
                <div className="p-4 bg-background border border-foreground">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-foreground" />
                      <span className="text-xs font-bold text-foreground uppercase tracking-wider">Analyse IA</span>
                    </div>
                    <span className={`text-sm font-bold px-2 py-0.5 border ${
                      aiAnalysis.fit_score >= 70 ? 'border-foreground bg-brutal-accent/30 text-foreground' :
                      aiAnalysis.fit_score >= 50 ? 'border-foreground bg-muted text-foreground' : 'border-foreground bg-destructive/10 text-destructive'
                    }`}>
                      {aiAnalysis.fit_score}/100
                    </span>
                  </div>
                  <p className="text-sm text-foreground/80 leading-relaxed mb-4">{aiAnalysis.summary}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-foreground uppercase tracking-widest flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" /> Points forts
                      </p>
                      {(aiAnalysis.strengths || []).map((s, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-foreground/70 bg-brutal-accent/10 px-2.5 py-1.5 border border-foreground/20">
                          <span className="text-foreground mt-0.5 shrink-0">✓</span><span>{s}</span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-2">
                      <p className="text-[10px] font-bold text-foreground uppercase tracking-widest flex items-center gap-1">
                        <AlertTriangle className="w-3 h-3" /> À vérifier
                      </p>
                      {(aiAnalysis.concerns || []).map((c, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-foreground/70 bg-muted px-2.5 py-1.5 border border-foreground/20">
                          <span className="text-foreground mt-0.5 shrink-0">!</span><span>{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {aiAnalysis.recommendation && (
                    <div className="mt-3 pt-3 border-t border-foreground/20">
                      <p className="text-xs text-foreground/70 italic">💡 {aiAnalysis.recommendation}</p>
                    </div>
                  )}
                </div>
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
                <div className="border border-foreground bg-background p-3 sm:p-4">
                  <h3 className="text-xs font-bold text-foreground mb-2 uppercase tracking-wider">À propos</h3>
                  <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{displayProfile.summary}</p>
                </div>
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
