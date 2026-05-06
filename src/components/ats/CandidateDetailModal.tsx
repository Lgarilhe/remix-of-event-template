/**
 * CandidateDetailModal — modale détaillée d'un candidat dans le pipeline.
 *
 * Refonte 2026-05-06 : depuis cette version, CandidateDetailModal est un
 * THIN WRAPPER autour de ProfileDetailSheet (la modale sourcing). C'est
 * le même composant visuel pour les deux surfaces — sourcing révèle un
 * candidat = pipeline ouvre un candidat = MÊME UI.
 *
 * Apport pipeline : on injecte 6 onglets supplémentaires (Préparer,
 * Évaluation, Séquences, Activité, Notes, Actions) via la prop extraTabs
 * de ProfileDetailSheet. Ces onglets contiennent les composants métier
 * existants (ScorecardTab, NotesTab, etc.) sans duplication.
 *
 * Pourquoi : avant, la pipeline avait sa propre modale custom avec un
 * rendu différent du sourcing → friction pour l'user qui devait
 * réapprendre la disposition. Maintenant : 1 seul composant visuel,
 * 1 seule UX, 1 seule source de vérité côté code.
 */

import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { useCandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import {
  Target, Activity as ActivityIcon, StickyNote, Zap,
  GitBranch, FileText, LayoutDashboard, User as UserIcon, MessageSquare,
} from 'lucide-react';
import { ScorecardTab } from './ScorecardTab';
import { PrepSheetTab } from './candidate-detail/PrepSheetTab';
import { FraudDetectionTab } from './FraudDetectionTab';
import { CandidateSequencesPanel } from '@/components/outreach/CandidateSequencesPanel';
import {
  ActivityTab, NotesTab, ActionsTab, ScoringCard,
  CollapsibleSection,
} from './candidate-detail';
import { CVTab } from './candidate-detail/CVTab';
import { OverviewTab } from './candidate-detail/OverviewTab';
import { ProfileExperienceList } from '@/components/outreach/result-card/ProfileExperienceList';
import { ProfileEducationList } from '@/components/outreach/result-card/ProfileEducationList';
import { CardMessageThread } from '@/components/outreach/result-card/CardMessageThread';
import { useAgent } from '@/contexts/AgentContext';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

// Single-modal architecture : on réutilise ProfileDetailSheet (sourcing)
import { ProfileDetailSheet, ProfileDetailExtraTab } from '@/components/outreach/result-card/ProfileDetailSheet';
import { atsCandidateToProfile } from '@/lib/atsCandidateToProfile';

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

export const CandidateDetailModal: React.FC<CandidateDetailModalProps> = ({
  candidate, onClose, onStageChange, onTagsChange, onRefresh,
}) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const { openAgent } = useAgent();
  const { organizationId } = useOrganization();

  const fullProfile = useCandidateFullProfile(candidate.candidateId, candidate.linkedin);
  const { data: notionJobs } = useNotionJobs();
  const [profileSnapshot, setProfileSnapshot] = useState<any | null>(candidate.linkedinProfileData ?? null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [projectNotes, setProjectNotes] = useState<string | null>(null);

  // Mobile profile overlay : utile quand la modale rend le ProfileTab dans
  // un onglet (sur mobile l'écran est petit donc on l'ouvre full-screen).
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);

  // Fetch LinkedIn snapshot si pas déjà sur le candidat
  useEffect(() => {
    setProfileSnapshot(candidate.linkedinProfileData ?? null);
    if (candidate.linkedinProfileData) {
      setSnapshotLoading(false);
      return;
    }
    let isMounted = true;
    (async () => {
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
      } catch (err) {
        console.warn('[CandidateDetailModal] Snapshot LinkedIn indisponible:', err);
      } finally {
        if (isMounted) setSnapshotLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, [candidate.candidateId, candidate.linkedinProfileData]);

  const candidateWithProfileData: ATSCandidate = React.useMemo(() => ({
    ...candidate,
    linkedinProfileData: profileSnapshot ?? candidate.linkedinProfileData ?? null,
  }), [candidate, profileSnapshot]);

  // Profil enrichi pour ProfileTab / ScorecardTab / PrepSheetTab
  const enrichedProfile: EnrichedProfile | null = React.useMemo(() => {
    const raw = candidateWithProfileData.linkedinProfileData;
    if (!raw) return null;
    const workExperience = raw.work_experience || [];
    const currentJob = workExperience.find((exp: any) => !exp.end) || workExperience[0];
    let yearsOfExperience: number | undefined;
    const allStartYears = workExperience.map((e: any) => e.start?.year).filter(Boolean) as number[];
    if (allStartYears.length > 0) {
      yearsOfExperience = new Date().getFullYear() - Math.min(...allStartYears);
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

  // Load notes + reminders + project notes
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
            .select('notes')
            .eq('job_id', candidate.jobId)
            .maybeSingle();
          if (projectData) setProjectNotes(projectData.notes || null);
        }
      } finally { setLoading(false); }
    };
    fetchData();
  }, [candidate.candidateId, candidate.jobId]);

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
    const { error } = await supabase.from('candidate_notes').delete().eq('id', id);
    if (error) { toast.error('Erreur lors de la suppression'); return; }
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
    const { error } = await supabase.from('candidate_reminders').delete().eq('id', id);
    if (error) { toast.error('Erreur lors de la suppression'); return; }
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

  // ─── Adapter ATSCandidate → LinkedInProfile pour ProfileDetailSheet ──
  const profile = React.useMemo(() => atsCandidateToProfile(candidateWithProfileData), [candidateWithProfileData]);

  // ─── Build extraTabs (pipeline-specific) ──
  // Refonte 2026-05-06 (cleanup) : 8 onglets pertinents au lieu de 13 :
  //
  //   Aperçu (default)  ← hub candidat synthétique
  //   Profil            ← Expérience + Formation + Compétences combinés
  //   Évaluation        ← Scoring + Préparer + Scorecard + Anti-fraude + Historique
  //   CV                ← upload/preview PDF
  //   Séquences         ← inscriptions outreach
  //   Messages          ← LinkedIn DMs (CardMessageThread)
  //   Activité          ← timeline complète
  //   Notes             ← notes recruteur
  //   Actions           ← rappels + agent IA
  //
  // Supprimés : Posts (placeholder vide), Préparer (mergé dans Évaluation
  // comme section collapsible), tabs standards Exp/Form/Skills/Msg/Posts
  // (remplacés par Profil + Messages reformulés ici, hideStandardTabs=true).
  const extraTabs: ProfileDetailExtraTab[] = React.useMemo(() => [
    {
      key: 'overview',
      label: 'Aperçu',
      shortLabel: 'Aperçu',
      icon: LayoutDashboard,
      content: (
        <OverviewTab
          candidate={candidate}
          enrichedProfile={enrichedProfile}
          fullProfile={fullProfile}
          notes={notes}
          reminders={reminders}
          organizationId={organizationId}
        />
      ),
    },
    {
      key: 'profile',
      label: 'Profil',
      shortLabel: 'Profil',
      icon: UserIcon,
      content: (
        <div className="space-y-4">
          {/* Summary LinkedIn — utile en haut du tab Profil */}
          {(enrichedProfile?.summary || (candidateWithProfileData.linkedinProfileData as any)?.summary) && (
            <div className="rounded-xl border border-border bg-muted/10 p-3">
              <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-1.5">
                À propos
              </p>
              <p className="text-[12.5px] leading-relaxed text-foreground/85 whitespace-pre-line">
                {enrichedProfile?.summary || (candidateWithProfileData.linkedinProfileData as any)?.summary}
              </p>
            </div>
          )}

          {/* Expérience pro */}
          {(candidateWithProfileData.linkedinProfileData?.work_experience?.length || 0) > 0 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider font-bold text-foreground/70 mb-2 flex items-center gap-1.5">
                <UserIcon className="w-3 h-3" />
                Expérience
              </h3>
              <ProfileExperienceList
                experiences={candidateWithProfileData.linkedinProfileData.work_experience}
              />
            </div>
          )}

          {/* Formation */}
          {(candidateWithProfileData.linkedinProfileData?.education?.length || 0) > 0 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider font-bold text-foreground/70 mb-2">
                Formation
              </h3>
              <ProfileEducationList
                education={candidateWithProfileData.linkedinProfileData.education}
              />
            </div>
          )}

          {/* Compétences */}
          {(enrichedProfile?.skills?.length || 0) > 0 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider font-bold text-foreground/70 mb-2">
                Compétences ({enrichedProfile!.skills.length})
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {enrichedProfile!.skills.map((skill, i) => (
                  <span key={i} className="inline-flex items-center text-[11.5px] px-2 py-0.5 rounded-full bg-foreground/[0.06] text-foreground/85 border border-border">
                    {skill}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Langues */}
          {(enrichedProfile?.languages?.length || 0) > 0 && (
            <div>
              <h3 className="text-[11px] uppercase tracking-wider font-bold text-foreground/70 mb-2">
                Langues
              </h3>
              <div className="flex flex-wrap gap-1.5">
                {enrichedProfile!.languages.map((lang, i) => (
                  <span key={i} className="inline-flex items-center text-[11.5px] px-2 py-0.5 rounded-full bg-info/10 text-info border border-info/30">
                    {lang}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'evaluation',
      label: 'Évaluation',
      shortLabel: 'Eval',
      icon: Target,
      content: (
        <div className="space-y-4">
          {candidate.score != null && <ScoreSummary candidate={candidate} />}
          <ScorecardTab
            candidate={candidate}
            enrichedProfile={enrichedProfile}
            onOpenProfile={() => setMobileProfileOpen(true)}
          />
          {/* Préparer mergé dans Évaluation comme section collapsible */}
          <CollapsibleSection title="📞 Préparer le call" defaultOpen={false}>
            <PrepSheetTab
              candidateId={candidate.candidateId}
              jobId={candidate.jobId}
              candidateName={candidate.name}
            />
          </CollapsibleSection>
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
      ),
    },
    {
      key: 'cv',
      label: 'CV',
      shortLabel: 'CV',
      icon: FileText,
      content: (
        <CVTab
          candidateId={candidate.candidateId}
          organizationId={organizationId}
          candidateName={candidate.name}
        />
      ),
    },
    {
      key: 'sequences',
      label: 'Séquences',
      shortLabel: 'Séq.',
      icon: GitBranch,
      content: <CandidateSequencesPanel profileId={candidate.candidateId} hideTitle />,
      count: fullProfile.sequenceEnrollments?.length || 0,
    },
    {
      key: 'messages',
      label: 'Messages',
      shortLabel: 'Msg',
      icon: MessageSquare,
      content: (
        <CardMessageThread
          accountId={fullProfile.accountId || undefined}
          profileId={candidate.candidateId}
          profileName={candidate.name}
        />
      ),
    },
    {
      key: 'activity',
      label: 'Activité',
      shortLabel: 'Act.',
      icon: ActivityIcon,
      content: <ActivityTab loading={fullProfile.loading} timeline={fullProfile.timeline} />,
      count: fullProfile.timeline.length,
    },
    {
      key: 'notes',
      label: 'Notes',
      shortLabel: 'Notes',
      icon: StickyNote,
      content: (
        <NotesTab
          candidateId={candidate.candidateId}
          candidateName={candidate.name}
          jobId={candidate.jobId}
          notes={notes}
          loading={loading}
          onAddNote={handleAddNote}
          onDeleteNote={handleDeleteNote}
        />
      ),
      count: notes.length,
    },
    {
      key: 'actions',
      label: 'Actions',
      shortLabel: 'Act.',
      icon: Zap,
      content: (
        <ActionsTab
          reminders={reminders}
          onAddReminder={handleAddReminder}
          onDeleteReminder={handleDeleteReminder}
          onOpenAgent={openAgent}
          candidateLinkedin={candidate.linkedin}
        />
      ),
      count: activeRemindersCount,
    },
  ], [
    candidate, candidateWithProfileData, enrichedProfile, fullProfile, notes,
    reminders, loading, activeRemindersCount, openAgent, organizationId,
  ]);

  return (
    <ProfileDetailSheet
      profile={profile}
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      selectedJob={null}
      accountId={fullProfile.accountId || undefined}
      airtableMatch={fullProfile.airtableMatch}
      pipelineMeta={{
        stage: candidate.stage,
        stageOptions: ATS_STAGES.map(s => ({ key: s.key, label: s.label })),
        onStageChange: (newStage) => onStageChange(candidate.id, newStage),
        score: candidate.score,
        onScoreClick: () => {
          // Switch sur l'onglet Évaluation (handled par CardExpandedContent
          // via defaultValue, pas de programmatic switch ici — on pourrait
          // exposer un setActiveTab plus tard si besoin).
          toast.info("Voir l'onglet Évaluation");
        },
        tags: candidate.tags || [],
        onTagsChange: (tags) => onTagsChange?.(candidate.id, tags),
        onCreatePortalLink: handleCreatePortalLink,
      }}
      extraTabs={extraTabs}
      hideStandardTabs
    />
  );
};

// ═══════════════════════════════════════════════════════════════════
// Sub-components inline (gardés ici pour pas créer 2 fichiers de plus)
// ═══════════════════════════════════════════════════════════════════

const ScoreSummary = React.memo<{ candidate: ATSCandidate }>(({ candidate }) => (
  <div className="flex items-center gap-4 p-4 rounded-xl border border-border bg-foreground/[0.03]">
    <div className={cn(
      "h-14 w-14 flex items-center justify-center rounded-xl border-2 text-xl font-black shrink-0 tabular-nums",
      (candidate.score ?? 0) >= 70 ? 'border-success/40 bg-success/10 text-success' :
      (candidate.score ?? 0) >= 40 ? 'border-warning/40 bg-warning/10 text-warning' :
      'border-destructive/40 bg-destructive/5 text-destructive'
    )}>
      {candidate.score}
    </div>
    <div className="flex-1 min-w-0">
      <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
        Score global /100
      </span>
      {candidate.recommendation && (
        <span className={cn(
          "text-xs px-2 py-0.5 rounded-md border font-medium uppercase tracking-wider mt-1 inline-block",
          candidate.recommendation === 'shortlist' ? 'border-success/40 text-success bg-success/10' :
          candidate.recommendation === 'skip' ? 'border-destructive/30 text-destructive bg-destructive/5' :
          'border-warning/40 text-warning bg-warning/10'
        )}>
          {candidate.recommendation === 'shortlist' ? 'Recommandé' :
           candidate.recommendation === 'skip' ? 'Non recommandé' : 'À évaluer'}
        </span>
      )}
    </div>
  </div>
));
ScoreSummary.displayName = 'ScoreSummary';
