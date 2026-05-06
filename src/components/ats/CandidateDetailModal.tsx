import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { supabase } from '@/integrations/supabase/client';
import { ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useCandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import {
  X, Mail, User, Target, CheckCircle2, AlertTriangle,
  MapPin, Briefcase, TrendingUp, Building2, Link2, Zap,
  Activity, StickyNote, Phone, GitBranch
} from 'lucide-react';
import { ScorecardTab } from './ScorecardTab';
import { PrepSheetTab } from './candidate-detail/PrepSheetTab';
import { FraudDetectionTab } from './FraudDetectionTab';
import { CandidateSequencesPanel } from '@/components/outreach/CandidateSequencesPanel';
import { RichCandidateHeader } from './candidate-detail/RichCandidateHeader';
import { useAgent } from '@/contexts/AgentContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Sub-components
import {
  ProfileTab, ActivityTab, NotesTab, ActionsTab, ScoringCard,
  BrutalButton, CollapsibleSection, CollapsibleCard,
  ExperienceItem, EducationItem,
} from './candidate-detail';

interface CandidateDetailModalProps {
  candidate: ATSCandidate;
  onClose: () => void;
  onStageChange: (candidateId: string, newStage: string) => void;
  onTagsChange?: (candidateId: string, tags: string[]) => void;
  onRefresh: () => void;
}

interface Note {
  id: string;
  content: string;
  created_at: string;
  created_by: string;
}

interface Reminder {
  id: string;
  title: string;
  description: string | null;
  due_at: string;
  completed_at: string | null;
}

const tabsConfig = [
  { key: 'profile', label: 'Profil', icon: User, emoji: '👤' },
  { key: 'prep', label: 'Préparer', icon: Phone, emoji: '📞' },
  { key: 'evaluation', label: 'Évaluation', icon: Target, emoji: '🎯' },
  { key: 'sequences', label: 'Séquences', icon: GitBranch, emoji: '🔀' },
  { key: 'activity', label: 'Activité', icon: Activity, emoji: '⚡' },
  { key: 'notes', label: 'Notes', icon: StickyNote, emoji: '📝' },
  { key: 'actions', label: 'Actions', icon: Zap, emoji: '🚀' },
] as const;

export const CandidateDetailModal: React.FC<CandidateDetailModalProps> = ({
  candidate, onClose, onStageChange, onTagsChange, onRefresh,
}) => {
  // Default toujours sur "Profil" (Opus audit : le "smart default Évaluation
  // si score" était un anti-pattern — la majorité des candidats ont un score
  // via le scoring IA auto, donc le user atterrissait toujours sur Évaluation
  // et devait cliquer Profil. Le score reste visible dans le header et signalé
  // par un badge sur l'onglet Évaluation si besoin).
  const [activeTab, setActiveTab] = useState<string>('profile');
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);
  const isSplitMode = activeTab === 'evaluation';
  const [notes, setNotes] = useState<Note[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [newTag, setNewTag] = useState('');
  const { openAgent } = useAgent();

  const fullProfile = useCandidateFullProfile(candidate.candidateId, candidate.linkedin);
  const { data: notionJobs } = useNotionJobs();
  const [profileSnapshot, setProfileSnapshot] = useState<any | null>(candidate.linkedinProfileData ?? null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);

  useEffect(() => {
    setProfileSnapshot(candidate.linkedinProfileData ?? null);

    if (candidate.linkedinProfileData) {
      setSnapshotLoading(false);
      return;
    }

    let isMounted = true;

    const fetchLinkedInSnapshot = async () => {
      setSnapshotLoading(true);
      try {
        const { data, error } = await supabase
          .from('job_candidate_status')
          .select('linkedin_profile_data')
          .eq('candidate_id', candidate.candidateId)
          .not('linkedin_profile_data', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (error) throw error;

        if (isMounted && data?.linkedin_profile_data) {
          setProfileSnapshot(data.linkedin_profile_data);
        }
      } catch (error) {
        console.warn('[ATS] Snapshot LinkedIn indisponible:', error);
      } finally {
        if (isMounted) setSnapshotLoading(false);
      }
    };

    void fetchLinkedInSnapshot();

    return () => {
      isMounted = false;
    };
  }, [candidate.candidateId, candidate.linkedinProfileData]);

  const candidateWithProfileData = React.useMemo<ATSCandidate>(() => ({
    ...candidate,
    linkedinProfileData: profileSnapshot ?? candidate.linkedinProfileData ?? null,
  }), [candidate, profileSnapshot]);

  // Build enriched profile from stored LinkedIn data
  const enrichedProfile: EnrichedProfile | null = React.useMemo(() => {
    const raw = candidateWithProfileData.linkedinProfileData;
    if (!raw) return null;
    
    const workExperience = raw.work_experience || [];
    const currentJob = workExperience.find((exp: any) => !exp.end) || workExperience[0];
    
    let yearsOfExperience: number | undefined;
    const allStartYears = workExperience
      .map((exp: any) => exp.start?.year)
      .filter(Boolean) as number[];
    if (allStartYears.length > 0) {
      const earliest = Math.min(...allStartYears);
      yearsOfExperience = new Date().getFullYear() - earliest;
    }

    return {
      name: raw.name || `${raw.first_name || ''} ${raw.last_name || ''}`.trim() || candidate.name,
      headline: raw.headline || candidate.headline || undefined,
      summary: raw.summary,
      currentRole: currentJob?.role,
      currentCompany: currentJob?.company,
      location: typeof raw.location === 'string' ? raw.location : raw.location?.name,
      skills: raw.skills?.map((s: any) => typeof s === 'string' ? s : s.name).filter(Boolean) || [],
      experiences: workExperience.slice(0, 6).map((exp: any) => ({
        title: exp.role || exp.title || '',
        company: exp.company || exp.company_name || '',
        logo: exp.company_logo || exp.logo_url || exp.logo || undefined,
        description: exp.description,
        startDate: exp.start ? `${exp.start.year || ''}${exp.start.month ? `-${String(exp.start.month).padStart(2, '0')}` : ''}` : undefined,
        endDate: exp.end ? `${exp.end.year || ''}${exp.end.month ? `-${String(exp.end.month).padStart(2, '0')}` : ''}` : undefined,
        isCurrent: !exp.end,
      })),
      education: (raw.education || []).slice(0, 4).map((edu: any) => {
        const schoolName = typeof edu.school === 'string'
          ? edu.school
          : edu.school?.name || edu.school_name || edu.school_details?.name || '';
        const schoolLogo =
          edu.school_logo || edu.logo_url || edu.logo ||
          edu.school_details?.logo || edu.school_details?.logo_url ||
          edu.school_details?.image ||
          (typeof edu.school === 'object' ? edu.school?.logo : undefined);
        return {
          school: schoolName,
          logo: schoolLogo || undefined,
          degree: edu.degree || edu.degree_name || '',
          field: edu.field_of_study || edu.field || '',
          startYear: edu.start?.year?.toString(),
          endYear: edu.end?.year?.toString(),
        };
      }),
      yearsOfExperience,
      languages: raw.languages?.map((l: any) => typeof l === 'string' ? l : l.name).filter(Boolean) || [],
    };
  }, [candidateWithProfileData.linkedinProfileData, candidate.name, candidate.headline]);

  const enrichLoading = snapshotLoading && !candidateWithProfileData.linkedinProfileData;

  // Job details
  const [projectNotes, setProjectNotes] = useState<string | null>(null);
  const [projectCalendly, setProjectCalendly] = useState<string | null>(null);

  const jobDetails = React.useMemo(() => {
    if (!candidate.jobId) return null;
    const notionJob = notionJobs?.find(j => j.id === candidate.jobId);
    if (!notionJob) return null;
    return {
      title: notionJob.title, client: notionJob.client?.name,
      clientSector: notionJob.client?.sector, location: notionJob.location,
      remote: notionJob.remote, seniority: notionJob.seniority,
      contractType: notionJob.contractType, salaryMin: notionJob.salaryMin,
      salaryMax: notionJob.salaryMax, skills: notionJob.skills,
      mustHave: notionJob.mustHave, shouldHave: notionJob.shouldHave,
      niceToHave: notionJob.niceToHave, description: notionJob.description,
      requirements: notionJob.requirements, interviewProcess: notionJob.interviewProcess,
      sourcingCriteria: notionJob.sourcingCriteria, teamInfo: notionJob.teamInfo,
      bodyContent: notionJob.bodyContent, xpMin: notionJob.xpMin, xpMax: notionJob.xpMax,
      accompagnement: notionJob.accompagnement, transversalCriteria: notionJob.transversalCriteria,
      entity: notionJob.entity, notes: projectNotes,
    };
  }, [candidate.jobId, notionJobs, projectNotes]);

  // Load data
  useEffect(() => {
    const fetchData = async () => {
      setLoading(true);
      try {
        const [{ data: notesData }, { data: remindersData }] = await Promise.all([
          supabase.from('candidate_notes').select('*').eq('candidate_id', candidate.candidateId).order('created_at', { ascending: false }),
          supabase.from('candidate_reminders').select('*').eq('candidate_id', candidate.candidateId).order('due_at', { ascending: true }),
        ]);
        setNotes(notesData || []);
        setReminders(remindersData || []);

        if (candidate.jobId) {
          const { data: projectData } = await supabase
            .from('sourcing_projects')
            .select('notes, calendly_link')
            .eq('job_id', candidate.jobId)
            .maybeSingle();
          if (projectData) {
            setProjectNotes(projectData.notes || null);
            setProjectCalendly(projectData.calendly_link || null);
          }
        }
      } finally { setLoading(false); }
    };
    fetchData();
  }, [candidate.candidateId, candidate.jobId]);

  // Handlers
  const handleAddNote = async (content: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error: insertErr } = await supabase.from('candidate_notes').insert({
      candidate_id: candidate.candidateId, shortlist_id: candidate.notionShortlistId || null,
      content, created_by: user.id,
    });
    if (insertErr) { toast.error('Erreur lors de l\'ajout de la note'); return; }
    const { data } = await supabase.from('candidate_notes').select('*').eq('candidate_id', candidate.candidateId).order('created_at', { ascending: false });
    setNotes(data || []);
    toast.success('Note ajoutée');
    onRefresh();
  };

  const handleDeleteNote = async (id: string) => {
    const { error: delErr } = await supabase.from('candidate_notes').delete().eq('id', id);
    if (delErr) { toast.error('Erreur lors de la suppression'); return; }
    setNotes(prev => prev.filter(n => n.id !== id));
    toast.success('Note supprimée');
    onRefresh();
  };

  const handleAddReminder = async (title: string, date: string) => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    const { error: insertErr } = await supabase.from('candidate_reminders').insert({
      candidate_id: candidate.candidateId, candidate_name: candidate.name,
      shortlist_id: candidate.notionShortlistId || null, job_id: candidate.jobId,
      job_title: candidate.jobTitle, title,
      due_at: new Date(date).toISOString(), created_by: user.id,
    });
    if (insertErr) { toast.error('Erreur lors de la création du rappel'); return; }
    const { data } = await supabase.from('candidate_reminders').select('*').eq('candidate_id', candidate.candidateId).order('due_at', { ascending: true });
    setReminders(data || []);
    toast.success('Rappel créé');
    onRefresh();
  };

  const handleDeleteReminder = async (id: string) => {
    const { error: delErr } = await supabase.from('candidate_reminders').delete().eq('id', id);
    if (delErr) { toast.error('Erreur lors de la suppression'); return; }
    setReminders(prev => prev.filter(r => r.id !== id));
    toast.success('Rappel supprimé');
    onRefresh();
  };

  const handleCreatePortalLink = async () => {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;
      const { data: tokenData, error: insertError } = await supabase
        .from('candidate_portal_tokens')
        .insert({
          candidate_id: candidate.candidateId,
          candidate_name: candidate.name,
          job_id: candidate.jobId,
          job_title: candidate.jobTitle,
          pipeline_stage: candidate.stage,
          created_by: user.id,
          recruiter_name: user.user_metadata?.full_name || user.email?.split('@')[0] || null,
          recruiter_email: user.email || null,
          stage_updated_at: new Date().toISOString(),
        })
        .select('token')
        .single();
      if (insertError || !tokenData) throw insertError || new Error('Impossible de créer le token');
      const url = `${window.location.origin}/portal/${tokenData.token}`;
      await navigator.clipboard.writeText(url);
      toast.success('Lien portail copié !');
    } catch (e: any) {
      toast.error('Erreur : ' + (e.message || 'impossible de créer le lien'));
    }
  };

  const activeRemindersCount = reminders.filter(r => !r.completed_at).length;

  return (
    <>
    <Dialog open onOpenChange={onClose}>
       <DialogContent 
        onInteractOutside={(e) => { if (mobileProfileOpen) e.preventDefault(); }}
        onPointerDownOutside={(e) => { if (mobileProfileOpen) e.preventDefault(); }}
        className={cn(
         "overflow-hidden flex flex-col p-0 rounded-lg border-border gap-0 [&>button]:hidden transition-all duration-300",
         "w-[100vw] h-[100dvh] max-w-[100vw] max-h-[100dvh]",
         "sm:w-auto sm:h-auto",
         isSplitMode
           ? "sm:max-w-[95vw] sm:max-h-[95vh] sm:w-[95vw] sm:h-[95vh]"
           : "sm:max-w-2xl sm:max-h-[90vh]"
       )}>
        {/* Header riche — mirror du visuel sourcing card.
            Avant : header basique nom + score + 3 metas inline.
            Après : avatar + degré connexion + skills preview + meta riche
            (tenure, XP, connexions). Les détails complets restent dans
            les onglets Profil / Évaluation / Activité. */}
        <RichCandidateHeader
          candidate={candidate}
          linkedinProfileData={candidateWithProfileData.linkedinProfileData}
          newTag={newTag}
          onNewTagChange={setNewTag}
          onAddTag={() => {
            const tag = newTag.trim().toLowerCase();
            if (!tag || (candidate.tags || []).includes(tag)) return;
            onTagsChange?.(candidate.id, [...(candidate.tags || []), tag]);
            setNewTag('');
          }}
          onRemoveTag={(tag) => onTagsChange?.(candidate.id, (candidate.tags || []).filter(t => t !== tag))}
          onStageChange={(v) => onStageChange(candidate.id, v)}
          onScoreClick={() => setActiveTab('evaluation')}
          onClose={onClose}
          onCreatePortalLink={handleCreatePortalLink}
        />

        {/* Tabs */}
        <div className="px-3 sm:px-6 pt-2 sm:pt-4">
          <div className="flex gap-0 border-b border-border overflow-x-auto no-scrollbar">
            {tabsConfig.map(tab => {
              const isActive = activeTab === tab.key;
              const count = tab.key === 'notes' ? notes.length
                : tab.key === 'actions' ? activeRemindersCount
                : tab.key === 'activity' ? fullProfile.timeline.length
                : tab.key === 'evaluation' ? fullProfile.scoringHistory.length
                : null;
              return (
                <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                  className={cn(
                    "relative flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 px-3 sm:px-3 py-2 sm:py-2.5 text-xs font-medium uppercase tracking-wider transition-all -mb-px whitespace-nowrap group",
                    isActive ? "text-foreground" : "text-muted-foreground/60 hover:text-foreground/80"
                  )}>
                  <span className={cn(
                    "text-lg sm:text-base leading-none transition-transform duration-150",
                    isActive ? "scale-110 drop-shadow-sm" : "opacity-70 grayscale-[30%] group-hover:opacity-100 group-hover:grayscale-0"
                  )}>
                    {tab.emoji}
                  </span>
                  <span className="hidden sm:inline">{tab.label}</span>
                  {count !== null && count > 0 && (
                    <span className={cn(
                      "text-[8px] sm:text-xs font-bold leading-none tabular-nums",
                      isActive ? "text-foreground" : "text-muted-foreground/50"
                    )}>
                      {count}
                    </span>
                  )}
                  <span className={cn(
                    "absolute bottom-0 left-1/2 -translate-x-1/2 h-0.5 bg-foreground transition-all duration-200 rounded-full",
                    isActive ? "w-full" : "w-0 group-hover:w-1/2"
                  )} />
                </button>
              );
            })}
          </div>
        </div>

        {/* Tab content */}
        {isSplitMode ? (
          <div className="flex-1 min-h-0 flex flex-col lg:flex-row divide-y lg:divide-y-0 lg:divide-x divide-foreground/15 relative">
            {/* LEFT: Evaluation */}
            <div className="flex-1 min-w-0 min-h-0 overflow-y-auto px-4 sm:px-6 pt-4 pb-20 lg:pb-6 space-y-4">
              {candidate.score != null && (
                <ScoreSummary candidate={candidate} />
              )}
              <ScorecardTab candidate={candidate} enrichedProfile={enrichedProfile} onOpenProfile={() => setMobileProfileOpen(true)} />
              <CollapsibleSection title="🛡️ Vérification du profil" defaultOpen={false}>
                <FraudDetectionTab candidate={candidateWithProfileData} />
              </CollapsibleSection>
              {fullProfile.scoringHistory.length > 0 && (
                <CollapsibleSection title={`📊 Historique des scorings (${fullProfile.scoringHistory.length})`} defaultOpen={false}>
                  <div className="space-y-3">
                    {fullProfile.scoringHistory.map((sr) => (
                      <ScoringCard key={sr.id} scoring={sr} />
                    ))}
                  </div>
                </CollapsibleSection>
              )}
            </div>

            {/* Mobile floating button */}
            <button
              onClick={() => setMobileProfileOpen(true)}
              className="lg:hidden fixed bottom-6 right-4 z-[2600] h-14 w-14 rounded-full flex items-center justify-center bg-foreground text-background shadow-xl animate-pulse"
              style={{ animationDuration: '2s' }}
            >
              <User className="w-5 h-5" />
              <span className="absolute inset-0 rounded-full border border-border animate-ping" style={{ animationDuration: '3s' }} />
            </button>

            {/* RIGHT: Compact profile sidebar (desktop) */}
            <div className="hidden lg:block w-[400px] shrink-0 overflow-y-auto px-4 pt-4 pb-6 space-y-3">
              <CollapsibleCard
                title={enrichedProfile?.name || candidate.name}
                subtitle={enrichedProfile?.headline || candidate.headline}
                icon={<User className="w-3.5 h-3.5" />}
                variant="dark"
                defaultOpen={false}
              >
                <CandidateProfileSidebarContent
                  candidate={candidate}
                  enrichedProfile={enrichedProfile}
                  onCreatePortalLink={handleCreatePortalLink}
                />
              </CollapsibleCard>

              {(jobDetails || candidate.jobTitle) && (
                <CollapsibleCard
                  title={jobDetails?.title || candidate.jobTitle || 'Poste'}
                  subtitle={jobDetails?.client ? `${jobDetails.client}${jobDetails.location ? ` · ${jobDetails.location}` : ''}` : undefined}
                  icon={<Target className="w-3.5 h-3.5" />}
                  variant="accent"
                  defaultOpen={false}
                >
                  <JobDetailsSidebarContent jobDetails={jobDetails} />
                </CollapsibleCard>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-y-auto px-3 sm:px-6 pt-4 pb-6 sm:pb-8">
            {activeTab === 'profile' && (
              <ProfileTab
                candidate={candidate}
                enrichedProfile={enrichedProfile}
                enrichLoading={enrichLoading}
                fullProfile={fullProfile}
              />
            )}
            {activeTab === 'prep' && (
              <PrepSheetTab
                candidateId={candidate.candidateId}
                jobId={candidate.jobId}
                candidateName={candidate.name}
              />
            )}
            {activeTab === 'evaluation' && (
              <div className="space-y-4">
                {candidate.score != null && <ScoreSummary candidate={candidate} />}
                <ScorecardTab candidate={candidate} enrichedProfile={enrichedProfile} onOpenProfile={() => setMobileProfileOpen(true)} />
                <CollapsibleSection title="🛡️ Vérification du profil" defaultOpen={false}>
                  <FraudDetectionTab candidate={candidateWithProfileData} />
                </CollapsibleSection>
                {fullProfile.scoringHistory.length > 0 && (
                  <CollapsibleSection title={`📊 Historique des scorings (${fullProfile.scoringHistory.length})`} defaultOpen={false}>
                    <div className="space-y-3">
                      {fullProfile.scoringHistory.map((sr) => (
                        <ScoringCard key={sr.id} scoring={sr} />
                      ))}
                    </div>
                  </CollapsibleSection>
                )}
              </div>
            )}
            {activeTab === 'sequences' && (
              <CandidateSequencesPanel profileId={candidate.candidateId} hideTitle />
            )}
            {activeTab === 'activity' && (
              <ActivityTab loading={fullProfile.loading} timeline={fullProfile.timeline} />
            )}
            {activeTab === 'notes' && (
              <NotesTab
                candidateId={candidate.candidateId}
                candidateName={candidate.name}
                jobId={candidate.jobId}
                notes={notes}
                loading={loading}
                onAddNote={handleAddNote}
                onDeleteNote={handleDeleteNote}
              />
            )}
            {activeTab === 'actions' && (
              <ActionsTab
                reminders={reminders}
                onAddReminder={handleAddReminder}
                onDeleteReminder={handleDeleteReminder}
                onOpenAgent={openAgent}
                candidateLinkedin={candidate.linkedin}
              />
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>

    {/* Mobile profile overlay */}
    {mobileProfileOpen && createPortal(
      <div className="fixed inset-0 z-[2700] bg-background overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between p-3 bg-background border-b border-border">
          <h3 className="text-sm font-bold text-foreground uppercase tracking-wider">Profil candidat</h3>
          <button onClick={() => setMobileProfileOpen(false)} className="h-8 w-8 flex items-center justify-center border border-border text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          <ProfileTab
            candidate={candidate}
            enrichedProfile={enrichedProfile}
            enrichLoading={enrichLoading}
            fullProfile={fullProfile}
          />
        </div>
      </div>,
      document.body
    )}
    </>
  );
};

// ========== Small inline sub-components ==========

const ScoreSummary = React.memo<{ candidate: ATSCandidate }>(({ candidate }) => (
  <div className="flex items-center gap-4 p-4 border border-border bg-foreground/[0.03]">
    <div className={cn("h-14 w-14 flex items-center justify-center border-2 text-xl font-black shrink-0",
      (candidate.score ?? 0) >= 70 ? 'border-success/40 bg-success/10 text-success' :
      (candidate.score ?? 0) >= 40 ? 'border-warning/40 bg-warning/10 text-warning' :
      'border-destructive/40 bg-destructive/5 text-destructive'
    )}>{candidate.score}</div>
    <div className="flex-1 min-w-0">
      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Score global /100</span>
      {candidate.recommendation && (
        <span className={cn("text-xs px-2 py-0.5 border font-medium uppercase tracking-wider mt-1 inline-block",
          candidate.recommendation === 'shortlist' ? 'border-success/40 text-success bg-success/10' :
          candidate.recommendation === 'skip' ? 'border-destructive/30 text-destructive bg-destructive/5' :
          'border-warning/40 text-warning bg-warning/10'
        )}>{candidate.recommendation === 'shortlist' ? 'Recommandé' : candidate.recommendation === 'skip' ? 'Non recommandé' : 'À évaluer'}</span>
      )}
      {candidate.scoringDetails && (
        <div className="flex flex-wrap gap-3 mt-2">
          {candidate.scoringDetails.matching_skills?.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-success font-medium">
              <CheckCircle2 className="w-3 h-3" /> {candidate.scoringDetails.matching_skills.length} matchées
            </span>
          )}
          {candidate.scoringDetails.missing_skills?.length > 0 && (
            <span className="flex items-center gap-1 text-xs text-warning font-medium">
              <AlertTriangle className="w-3 h-3" /> {candidate.scoringDetails.missing_skills.length} manquantes
            </span>
          )}
        </div>
      )}
    </div>
  </div>
));
ScoreSummary.displayName = 'ScoreSummary';

const CandidateProfileSidebarContent = React.memo<{
  candidate: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
  onCreatePortalLink: () => void;
}>(({ candidate, enrichedProfile, onCreatePortalLink }) => (
  <div className="space-y-3">
    <div className="flex items-center gap-3 text-xs text-muted-foreground">
      {enrichedProfile?.location && (
        <span className="flex items-center gap-1"><MapPin className="w-3 h-3" /> {enrichedProfile.location}</span>
      )}
      {enrichedProfile?.yearsOfExperience && (
        <span className="flex items-center gap-1"><Briefcase className="w-3 h-3" /> ~{enrichedProfile.yearsOfExperience} ans</span>
      )}
    </div>
    {candidate.linkedin && (
      <a href={candidate.linkedin} target="_blank" rel="noopener noreferrer"
        className="flex items-center gap-1.5 text-xs text-foreground font-medium uppercase tracking-wider hover:text-blue-600">
        <Link2 className="w-3 h-3" /> Voir sur LinkedIn
      </a>
    )}
    <button
      onClick={onCreatePortalLink}
      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-success text-success-foreground text-xs font-semibold hover:bg-success/90 transition-colors"
    >
      <Link2 className="w-3.5 h-3.5" /> Portail candidat
    </button>
    {candidate.score != null && (
      <div className="border border-border p-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Score IA</span>
          <span className={cn("text-sm font-bold",
            candidate.score >= 75 ? "text-success" :
            candidate.score >= 50 ? "text-warning" : "text-destructive"
          )}>{candidate.score}/100</span>
        </div>
      </div>
    )}
    {enrichedProfile?.summary && (
      <CollapsibleSection title="À propos" defaultOpen={false}>
        <p className="text-xs text-muted-foreground leading-relaxed">{enrichedProfile.summary}</p>
      </CollapsibleSection>
    )}
    {enrichedProfile?.experiences && enrichedProfile.experiences.length > 0 && (
      <CollapsibleSection title="Expériences" defaultOpen={false}>
        <div className="space-y-0 relative">
          <div className="absolute left-[5px] top-2 bottom-2 w-px bg-foreground/15" />
          {enrichedProfile.experiences.map((exp, i) => (
            <ExperienceItem key={i} exp={exp} />
          ))}
        </div>
      </CollapsibleSection>
    )}
    {enrichedProfile?.education && enrichedProfile.education.length > 0 && (
      <CollapsibleSection title="Formation" defaultOpen={false}>
        <div className="space-y-0 relative">
          <div className="absolute left-[5px] top-2 bottom-2 w-px bg-foreground/15" />
          {enrichedProfile.education.map((edu, i) => (
            <EducationItem key={i} edu={edu} />
          ))}
        </div>
      </CollapsibleSection>
    )}
    {enrichedProfile?.skills && enrichedProfile.skills.length > 0 && (
      <CollapsibleSection title="Compétences" defaultOpen={false}>
        <div className="flex flex-wrap gap-1">
          {enrichedProfile.skills.map(s => (
            <span key={s} className="text-xs px-1.5 py-0.5 border border-border text-muted-foreground font-medium uppercase tracking-wider">{s}</span>
          ))}
        </div>
      </CollapsibleSection>
    )}
    {enrichedProfile?.languages && enrichedProfile.languages.length > 0 && (
      <CollapsibleSection title="Langues" defaultOpen={false}>
        <div className="flex flex-wrap gap-1">
          {enrichedProfile.languages.map(l => (
            <span key={l} className="text-xs px-1.5 py-0.5 border border-border text-muted-foreground font-medium uppercase tracking-wider">{l}</span>
          ))}
        </div>
      </CollapsibleSection>
    )}
  </div>
));
CandidateProfileSidebarContent.displayName = 'CandidateProfileSidebarContent';

const JobDetailsSidebarContent = React.memo<{ jobDetails: any }>(({ jobDetails }) => {
  if (!jobDetails) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {jobDetails.contractType && (
          <span className="px-1.5 py-0.5 border border-border font-medium uppercase tracking-wider text-xs">{jobDetails.contractType}</span>
        )}
        {jobDetails.remote && (
          <span className="px-1.5 py-0.5 border border-border font-medium uppercase tracking-wider text-xs">{jobDetails.remote}</span>
        )}
        {jobDetails.seniority && (
          <span className="px-1.5 py-0.5 border border-border font-medium uppercase tracking-wider text-xs">{jobDetails.seniority}</span>
        )}
        {(jobDetails.salaryMin || jobDetails.salaryMax) && (
          <span className="px-1.5 py-0.5 border border-border font-medium uppercase tracking-wider text-xs">
            {jobDetails.salaryMin && jobDetails.salaryMax
              ? `${jobDetails.salaryMin}-${jobDetails.salaryMax}k€`
              : jobDetails.salaryMin ? `${jobDetails.salaryMin}k€+` : `≤${jobDetails.salaryMax}k€`}
          </span>
        )}
      </div>
      {jobDetails.skills?.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {jobDetails.skills.slice(0, 8).map((s: string) => (
            <span key={s} className="text-xs px-1.5 py-0.5 border border-border text-muted-foreground font-medium uppercase tracking-wider">{s}</span>
          ))}
        </div>
      )}
      {jobDetails.mustHave && (
        <CollapsibleSection title="Must-have" defaultOpen={false}>
          <p className="text-xs text-muted-foreground whitespace-pre-line">{jobDetails.mustHave}</p>
        </CollapsibleSection>
      )}
      {jobDetails.shouldHave && (
        <CollapsibleSection title="Should-have" defaultOpen={false}>
          <p className="text-xs text-muted-foreground whitespace-pre-line">{jobDetails.shouldHave}</p>
        </CollapsibleSection>
      )}
      {jobDetails.description && (
        <CollapsibleSection title="Description" defaultOpen={false}>
          <p className="text-xs text-muted-foreground whitespace-pre-line line-clamp-10">{jobDetails.description}</p>
        </CollapsibleSection>
      )}
    </div>
  );
});
JobDetailsSidebarContent.displayName = 'JobDetailsSidebarContent';
