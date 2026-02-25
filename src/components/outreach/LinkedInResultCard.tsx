import React, { useState } from 'react';
import { LinkedInProfile } from './types';
import { useCandidateHistory } from '@/hooks/useCandidateHistory';
import { CandidateHistoryPanel } from './CandidateHistoryPanel';
import { JobScoreDisplay, JobMatchResult, SalaryBadge } from './JobScoreDisplay';
import { OutreachMessageModal } from './OutreachMessageModal';
import { Job } from '@/pages/JobSpace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Briefcase, MapPin, ChevronDown, GraduationCap,
  Building2, Users, TrendingUp, AlertTriangle,
  Bot, Loader2, CheckCircle2, Target, X,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SourcingProject } from '@/hooks/useSourcingProjects';

// Sub-components
import { CardStatusBadges } from './result-card/CardStatusBadges';
import { CardActions } from './result-card/CardActions';
import { CardExpandedContent } from './result-card/CardExpandedContent';
import { useProfileData } from './result-card/useProfileData';
import { LinkedInResultCardProps } from './result-card/types';

export const LinkedInResultCard: React.FC<LinkedInResultCardProps> = ({
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
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showMessageModal, setShowMessageModal] = useState(false);
  const [aiAnalysis, setAiAnalysis] = useState<{
    summary: string;
    strengths: string[];
    concerns: string[];
    fit_score: number;
    recommendation: string;
  } | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isScoring, setIsScoring] = useState(false);

  const profileData = useProfileData(profile);
  const {
    fullName, initials, currentCompany, currentRole, currentJobTenure,
    networkDistance, profileUrl, skills, education, educationPreview,
    otherCurrentJobs, pastJobs, connectionsCount,
    isLikelyToRespond, totalExperience,
  } = profileData;

  // Airtable history
  const candidateProfileUrl = profile.profile_url || profile.public_profile_url;
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

  // AI Analysis
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
    <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
      <div className={`bg-background rounded-xl border transition-all overflow-hidden max-w-full ${
        isExpanded
          ? 'border-primary/30 shadow-lg shadow-primary/5'
          : 'border-border hover:border-primary/20 hover:shadow-md'
      }`} style={{ wordBreak: 'break-word' }}>
        {/* Main card content */}
        <div className="p-2.5 sm:p-4 overflow-hidden">
          <div className="flex items-start gap-2 sm:gap-4 min-w-0">
            {/* Checkbox */}
            {selectedJob && onToggleSelect && (
              <div className="pt-3">
                {jobScore?.recommendation === 'skip' ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="w-4 h-4 rounded border border-red-300 bg-red-50 flex items-center justify-center cursor-not-allowed">
                        <X className="w-3 h-3 text-red-400" />
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
                    className="border-purple-300 data-[state=checked]:bg-purple-600 data-[state=checked]:border-purple-600"
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
                  <div className="hidden sm:flex">
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
                  </div>
                </div>

                {/* Mobile actions */}
                <div className="flex sm:hidden items-center gap-0.5 mt-1 overflow-x-auto max-w-full no-scrollbar">
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
                    compact
                  />
                </div>
              </div>

              {/* Meta info row */}
              <div className="flex flex-wrap items-center gap-x-2 sm:gap-x-4 gap-y-1 mt-2 sm:mt-3 text-[10px] sm:text-xs text-muted-foreground">
                {currentCompany && (
                  <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                    <Building2 className="w-3.5 h-3.5 text-primary" />
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

              {/* Job Score Display */}
              {jobScore && (
                <div className="mt-3">
                  <JobScoreDisplay
                    result={jobScore}
                    jobTitle={selectedJob?.title}
                    compact={!isExpanded}
                  />
                  {jobScore.recommendation === 'skip' && jobScore.summary && (
                    <div className="mt-2 flex items-start gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-red-500" />
                      <div>
                        <span className="font-semibold">Raison du rejet : </span>
                        <span>{jobScore.summary}</span>
                        {jobScore.missing_skills && jobScore.missing_skills.length > 0 && (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {jobScore.missing_skills.map((skill, i) => (
                              <span key={i} className="inline-flex items-center px-1.5 py-0.5 rounded bg-red-100 text-red-600 text-[10px] border border-red-200">
                                ✗ {skill}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* AI Analysis panel */}
              {aiAnalysis && (
                <div className="mt-3 p-3 bg-gradient-to-br from-purple-50 via-blue-50 to-indigo-50 rounded-lg border border-purple-200/50">
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

              {/* Experience preview */}
              {(otherCurrentJobs.length > 0 || pastJobs.length > 0) && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <Briefcase className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider truncate">
                      {otherCurrentJobs.length > 0 ? 'Postes actuels + Parcours' : 'Parcours récent'}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {otherCurrentJobs.slice(0, 2).map((pos: any, index: number) => (
                      <div key={`current-${index}`} className="flex items-center gap-2 text-xs min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
                        <span className="text-muted-foreground truncate">
                          <span className="font-medium">{pos.role}</span>
                          <span className="text-muted-foreground/40"> chez </span>
                          <span>{pos.company}</span>
                          <Badge variant="outline" className="ml-1.5 h-4 px-1 text-[9px] border-green-300 text-green-600 bg-green-50">Actuel</Badge>
                        </span>
                      </div>
                    ))}
                    {pastJobs.slice(0, otherCurrentJobs.length > 0 ? 1 : 2).map((pos: any, index: number) => (
                      <div key={`past-${index}`} className="flex items-center gap-2 text-xs min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-primary/40 shrink-0" />
                        <span className="text-muted-foreground truncate">
                          <span className="font-medium">{pos.role}</span>
                          <span className="text-muted-foreground/40"> chez </span>
                          <span>{pos.company}</span>
                          {pos.start?.year && pos.end?.year && (
                            <span className="text-muted-foreground/30 ml-1">({pos.start.year}-{pos.end.year})</span>
                          )}
                        </span>
                      </div>
                    ))}
                    {(otherCurrentJobs.length + pastJobs.length) > 2 && (
                      <span className="text-[10px] text-primary font-medium">
                        +{otherCurrentJobs.length + pastJobs.length - 2} autres expériences
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Education preview */}
              {educationPreview.length > 0 && (
                <div className="mt-3 pt-3 border-t border-border/50">
                  <div className="flex items-center gap-2 mb-2">
                    <GraduationCap className="w-3.5 h-3.5 text-amber-500" />
                    <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">Formation</span>
                  </div>
                  <div className="space-y-1.5">
                    {educationPreview.map((edu: any, index: number) => (
                      <div key={index} className="flex items-center gap-2 text-xs min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
                        <span className="text-muted-foreground truncate">
                          <span className="font-medium">{edu.degree || edu.school}</span>
                          {edu.degree && edu.school && <span className="text-muted-foreground/40"> - {edu.school}</span>}
                          {edu.end?.year && <span className="text-muted-foreground/30 ml-1">({edu.end.year})</span>}
                        </span>
                      </div>
                    ))}
                    {education.length > 2 && (
                      <span className="text-[10px] text-amber-600 font-medium">+{education.length - 2} autres formations</span>
                    )}
                  </div>
                </div>
              )}

              {/* Skills preview */}
              {skills.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3 overflow-hidden">
                  {skills.slice(0, 5).map((skill: any, index: number) => (
                    <Badge key={index} variant="secondary" className="text-[10px] px-2 py-0.5 bg-muted text-muted-foreground font-normal">
                      {skill.name || skill}
                    </Badge>
                  ))}
                  {skills.length > 5 && (
                    <Badge variant="secondary" className="text-[10px] px-2 py-0.5 bg-primary/10 text-primary font-medium">
                      +{skills.length - 5}
                    </Badge>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Expand trigger */}
          <CollapsibleTrigger asChild>
            <button className="w-full mt-3 pt-3 border-t border-border/50 flex items-center justify-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors">
              <span>{isExpanded ? 'Moins de détails' : 'Plus de détails'}</span>
              <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
            </button>
          </CollapsibleTrigger>
        </div>

        {/* Expanded content */}
        <CollapsibleContent>
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
            onClose={() => setIsExpanded(false)}
            onOpenMessage={() => setShowMessageModal(true)}
            onMessageSent={onMessageSent}
            onProfileTreated={onProfileTreated}
          />
        </CollapsibleContent>

        {/* Outreach message modal */}
        {selectedJob && (
          <OutreachMessageModal
            open={showMessageModal}
            onOpenChange={setShowMessageModal}
            profile={profile}
            job={selectedJob}
            selectedAccount={accountId}
            candidateHistory={historyData ? {
              shortlists: historyData.shortlists,
              placements: historyData.placements,
              notes: historyData.notes?.slice(0, 5),
              appointments: historyData.appointments?.slice(0, 3),
            } : undefined}
            onMessageSent={async () => {
              try {
                const { data: { user } } = await supabase.auth.getUser();
                const userId = user?.id || '00000000-0000-0000-0000-000000000000';
                const pUrl = profile.profile_url || profile.public_profile_url;

                await supabase.from('job_candidate_status').upsert({
                  job_id: selectedJob.id,
                  candidate_id: profile.id,
                  candidate_name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
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
      </div>
    </Collapsible>
  );
};
