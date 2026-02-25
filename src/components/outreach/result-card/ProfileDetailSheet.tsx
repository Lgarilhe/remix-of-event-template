import React from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { LinkedInProfile } from '../types';
import { JobMatchResult, JobScoreDisplay, SalaryBadge } from '../JobScoreDisplay';
import { Job } from '@/pages/JobSpace';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { CardExpandedContent } from './CardExpandedContent';
import { CardStatusBadges } from './CardStatusBadges';
import { CardActions } from './CardActions';
import { useProfileData } from './useProfileData';
import { useCandidateHistory } from '@/hooks/useCandidateHistory';
import { CandidateHistoryPanel } from '../CandidateHistoryPanel';
import { OutreachMessageModal } from '../OutreachMessageModal';
import {
  Building2, MapPin, Users, TrendingUp, ExternalLink, Bot, Loader2,
  Target, CheckCircle2, AlertTriangle, X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useState } from 'react';

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
}) => {
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isScoring, setIsScoring] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<{
    summary: string;
    strengths: string[];
    concerns: string[];
    fit_score: number;
    recommendation: string;
  } | null>(null);

  // Dummy profile for hook stability (hooks must be called unconditionally)
  const dummyProfile = { id: '', name: '' } as LinkedInProfile;
  const profileData = useProfileData(profile || dummyProfile);

  const candidateProfileUrl = (profile || dummyProfile).profile_url || (profile || dummyProfile).public_profile_url;

  // Airtable history
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
  
  if (!profile) return null;

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
        pastPositions: pastJobs.map((p: any) => `${p.role} chez ${p.company}`),
        education: education.map((e: any) => `${e.degree || ''} - ${e.school}`),
      };
      const { data, error } = await supabase.functions.invoke('analyze-linkedin-profile', {
        body: { profile: profileSummary }
      });
      if (error) throw error;
      setAiAnalysis(data.analysis);
    } catch (error) {
      console.error('AI analysis error:', error);
      toast.error("Erreur lors de l'analyse IA");
    } finally {
      setIsAnalyzing(false);
    }
  };

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="w-[95vw] max-w-[780px] p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-4 bg-gradient-to-b from-muted/40 to-background border-b border-border shrink-0">
            <div className="flex items-start gap-4">
              <Avatar className="w-14 h-14 border-2 border-background shadow-lg ring-2 ring-primary/10 shrink-0">
                <AvatarImage src={profile.profile_picture_url} alt={fullName} className="object-cover" />
                <AvatarFallback className="bg-gradient-to-br from-primary to-primary/80 text-primary-foreground text-lg font-semibold">
                  {initials || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <SheetTitle className="text-lg font-bold text-foreground truncate">
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
                <p className="text-sm text-muted-foreground line-clamp-2 mt-1 leading-relaxed">
                  {profile.headline || currentRole || 'Profil LinkedIn'}
                </p>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-2.5 text-xs text-muted-foreground">
                  {currentCompany && (
                    <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                      <Building2 className="w-3.5 h-3.5 text-primary" />
                      {currentCompany}
                      {currentJobTenure && <span className="text-muted-foreground/50 font-normal">• {currentJobTenure}</span>}
                    </span>
                  )}
                  {profile.location && (
                    <span className="flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      {profile.location}
                    </span>
                  )}
                  {totalExperience && (
                    <span className="flex items-center gap-1.5 text-emerald-600 font-medium">
                      <TrendingUp className="w-3.5 h-3.5" />
                      {totalExperience}
                    </span>
                  )}
                </div>
              </div>
            </div>
            {/* Actions bar */}
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/30">
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
                onOpenMessage={() => setShowMessageModal(true)}
                onAiAnalysis={handleAiAnalysis}
                onArchive={onArchive}
                onSequenceEnroll={onSequenceEnroll}
                onProfileTreated={onProfileTreated}
              />
              {profileUrl && (
                <Button variant="outline" size="sm" asChild className="gap-1.5 text-xs">
                  <a href={profileUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="w-3.5 h-3.5" />
                    LinkedIn
                  </a>
                </Button>
              )}
            </div>
          </SheetHeader>

          <ScrollArea className="flex-1">
            <div className="p-5 space-y-5">
              {/* Job Score */}
              {jobScore && (
                <div>
                  <JobScoreDisplay result={jobScore} jobTitle={selectedJob?.title} compact={false} />
                  {jobScore.recommendation === 'skip' && jobScore.summary && (
                    <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-destructive/10 border border-destructive/20 text-xs text-destructive">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      <div>
                        <span className="font-semibold">Raison du rejet : </span>
                        <span>{jobScore.summary}</span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* AI Analysis */}
              {aiAnalysis && (
                <div className="p-3 bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 rounded-lg border border-purple-200/50">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-purple-600" />
                      <span className="text-xs font-semibold text-purple-700">Analyse IA</span>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Target className="w-3.5 h-3.5 text-purple-500" />
                      <span className={`text-sm font-bold ${
                        aiAnalysis.fit_score >= 70 ? 'text-green-600' :
                        aiAnalysis.fit_score >= 50 ? 'text-amber-600' : 'text-red-500'
                      }`}>
                        {aiAnalysis.fit_score}/100
                      </span>
                    </div>
                  </div>
                  <p className="text-sm text-foreground/80 font-medium mb-3">{aiAnalysis.summary}</p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-green-700 uppercase tracking-wider">
                        <CheckCircle2 className="w-3 h-3" /> Points forts
                      </div>
                      {(aiAnalysis.strengths || []).map((s, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-green-800 bg-green-100/50 px-2 py-1 rounded">
                          <span className="text-green-500 mt-0.5">✓</span><span>{s}</span>
                        </div>
                      ))}
                    </div>
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-1 text-[10px] font-semibold text-amber-700 uppercase tracking-wider">
                        <AlertTriangle className="w-3 h-3" /> À vérifier
                      </div>
                      {(aiAnalysis.concerns || []).map((c, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-xs text-amber-800 bg-amber-100/50 px-2 py-1 rounded">
                          <span className="text-amber-500 mt-0.5">!</span><span>{c}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  {aiAnalysis.recommendation && (
                    <div className="mt-3 pt-2 border-t border-purple-200/50">
                      <p className="text-xs text-purple-700 italic">💡 {aiAnalysis.recommendation}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Expanded content (tabs: experience, education, skills, posts) */}
              {/* Airtable History Panel */}
              {airtableMatch && historyData && !historyLoading && (
                <CandidateHistoryPanel data={historyData} loading={false} compact={false} />
              )}

              <CardExpandedContent
                profile={profile}
                profileData={profileData}
                selectedJob={selectedJob}
                jobScore={jobScore}
                accountId={accountId}
                candidateStatus={candidateStatus}
                airtableMatch={airtableMatch}
                historyData={historyData}
                historyLoading={historyLoading}
                onClose={() => onOpenChange(false)}
                onOpenMessage={() => setShowMessageModal(true)}
                onMessageSent={onMessageSent}
                onProfileTreated={onProfileTreated}
              />
            </div>
          </ScrollArea>
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
