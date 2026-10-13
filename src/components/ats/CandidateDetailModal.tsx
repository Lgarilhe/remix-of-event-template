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

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ATSCandidate, ATS_STAGES } from '@/hooks/useATSData';
import { useCandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import {
  Target, Activity as ActivityIcon, StickyNote, Zap,
  GitBranch, FileText, LayoutDashboard, User as UserIcon, MessageSquare,
} from 'lucide-react';
import { CandidateSequencesPanel } from '@/components/outreach/CandidateSequencesPanel';
import { ActivityTab, NotesTab, ActionsTab } from './candidate-detail';
import { CVTab } from './candidate-detail/CVTab';
import { OverviewTab } from './candidate-detail/OverviewTab';
import { ProfileDetailedTab } from './candidate-detail/ProfileDetailedTab';
import { EvaluationTab } from './candidate-detail/EvaluationTab';
import { ManualContactsEditor } from './candidate-detail/ManualContactsEditor';
import { CardMessageThread } from '@/components/outreach/result-card/CardMessageThread';
import { useAgent } from '@/contexts/AgentContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useMyLinkedInAccountId } from '@/hooks/useMyLinkedInAccountId';
import { missionIdOfJob } from '@/hooks/useEnrollmentPreview';
import { getCandidateContacts, type CandidateContacts } from '@/lib/candidateContacts';
import { hasCandidateProfileDetails, normalizeCandidateProfile } from '@/lib/candidateProfile';
import { toast } from 'sonner';

// Single-modal architecture : on réutilise ProfileDetailSheet (sourcing)
import { ProfileDetailSheet, ProfileDetailExtraTab } from '@/components/outreach/result-card/ProfileDetailSheet';
import { atsCandidateToProfile } from '@/lib/atsCandidateToProfile';

interface CandidateDetailModalProps {
  candidate: ATSCandidate;
  onClose: () => void;
  onStageChange: (candidateId: string, newStage: string) => void;
  onTagsChange?: (candidateId: string, tags: string[]) => void;
  onRefresh: () => void;
  /** Tab à activer par défaut (deep-link depuis calendar / tasks / etc.) */
  initialTab?: string;
  /** Si true, auto-trigger la génération de scorecard à l'ouverture
   *  (utile pour le CTA "Préparer l'entretien" depuis le calendrier). */
  autoGenerateScorecard?: boolean;
  autoOpenScorecard?: boolean;
  autoStartCoaching?: boolean;
  /** Entretien vérifié par le parcours qui ouvre la fiche. */
  qualificationSessionId?: string | null;
  /** Un entretien sans mission peut exister avant l'ajout de la personne au pipeline. */
  pipelineAttached?: boolean;
  /** Étapes proposées dans le sélecteur de stage. Défaut : ATS_STAGES.
   *  Le pipeline mission passe ses colonnes (Sourcé/Contacté/steps/Embauché)
   *  pour que le changement d'étape reste cohérent avec son kanban. */
  stageOptions?: { key: string; label: string }[];
  /** La messagerie utilise uniquement le compte LinkedIn personnel connecté. */
  accountPolicy?: 'history' | 'personal';
  onCloseAutoFocus?: React.ComponentProps<typeof ProfileDetailSheet>['onCloseAutoFocus'];
  /** État de consultation du profil fourni par le parcours appelant. */
  profileStatus?: React.ReactNode;
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
  initialTab, autoGenerateScorecard, autoOpenScorecard, autoStartCoaching, qualificationSessionId, pipelineAttached = true, stageOptions,
  accountPolicy = 'history', onCloseAutoFocus, profileStatus,
}) => {
  const [notes, setNotes] = useState<Note[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [interactionReload, setInteractionReload] = useState(0);
  const { openAgent } = useAgent();
  const { organizationId } = useOrganization();
  const scopeKey = `${organizationId ?? ''}|${candidate.candidateId}`;
  const currentScope = useRef({ key: scopeKey });
  if (currentScope.current.key !== scopeKey) currentScope.current = { key: scopeKey };
  const scope = currentScope.current;
  const myLinkedInAccountId = useMyLinkedInAccountId();

  const fullProfile = useCandidateFullProfile(candidate.candidateId, candidate.linkedin, interactionReload);
  // Relire les contenus enregistrés sans remonter les onglets ni leurs saisies.
  const refreshInteractions = React.useCallback(() => setInteractionReload(value => value + 1), []);
  // Compte d'envoi du candidat (séquences, InMails), sinon le compte relié de la
  // personne : l'onglet Messages et le bouton Séquence existent aussi pour un
  // candidat contacté à la main.
  const accountId = accountPolicy === 'personal' ? myLinkedInAccountId || undefined
    : fullProfile.accountId || myLinkedInAccountId || undefined;
  const [profileSnapshot, setProfileSnapshot] = useState<any | null>(candidate.linkedinProfileData ?? null);
  const [snapshotLoading, setSnapshotLoading] = useState(!candidate.linkedinProfileData);

  // Mobile profile overlay : utile quand la modale rend le ProfileTab dans
  // un onglet (sur mobile l'écran est petit donc on l'ouvre full-screen).
  const [mobileProfileOpen, setMobileProfileOpen] = useState(false);

  // Manual contacts (email/phone saisis par l'user) — fetch on mount
  const [manualContacts, setManualContacts] = useState<CandidateContacts | null>(null);
  useLayoutEffect(() => {
    setNotes([]);
    setReminders([]);
    setManualContacts(null);
    setLoading(!!organizationId);
  }, [scopeKey, organizationId]);
  useLayoutEffect(() => {
    setProfileSnapshot(candidate.linkedinProfileData ?? null);
    setSnapshotLoading(!candidate.linkedinProfileData);
  }, [scopeKey, candidate.linkedinProfileData]);
  useEffect(() => {
    if (!organizationId) return;
    let cancelled = false;
    getCandidateContacts(candidate.candidateId, organizationId)
      .then(contacts => { if (!cancelled && currentScope.current === scope) setManualContacts(contacts); })
      .catch(err => console.warn('[CandidateDetailModal] manualContacts fetch failed:', err));
    return () => { cancelled = true; };
  }, [candidate.candidateId, organizationId, scopeKey, scope]);

  // Fetch LinkedIn snapshot si pas déjà sur le candidat
  useEffect(() => {
    if (!organizationId) return;
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
          .eq('organization_id', organizationId)
          .not('linkedin_profile_data', 'is', null)
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) throw error;
        if (isMounted && currentScope.current === scope && data?.linkedin_profile_data) {
          setProfileSnapshot(data.linkedin_profile_data);
        }
      } catch (err) {
        console.warn('[CandidateDetailModal] Snapshot LinkedIn indisponible:', err);
      } finally {
        if (isMounted && currentScope.current === scope) setSnapshotLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, [candidate.candidateId, candidate.linkedinProfileData, organizationId, scopeKey, scope]);

  const candidateWithProfileData: ATSCandidate = React.useMemo(() => ({
    ...candidate,
    linkedinProfileData: candidate.linkedinProfileData ?? profileSnapshot ?? null,
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

  // Load notes + reminders
  useEffect(() => {
    let cancelled = false;
    if (!organizationId) { setLoading(false); return; }
    const fetchData = async () => {
      setLoading(true);
      try {
        const [{ data: notesData }, { data: remindersData }] = await Promise.all([
          supabase.from('candidate_notes').select('*').eq('organization_id', organizationId).eq('candidate_id', candidate.candidateId).order('created_at', { ascending: false }),
          supabase.from('candidate_reminders').select('*').eq('organization_id', organizationId).eq('candidate_id', candidate.candidateId).order('due_at', { ascending: true }),
        ]);
        if (cancelled || currentScope.current !== scope) return;
        setNotes(notesData || []);
        setReminders(remindersData || []);
      } catch (err) {
        console.warn('[CandidateDetailModal] chargement des notes impossible :', err);
      } finally {
        if (!cancelled && currentScope.current === scope) setLoading(false);
      }
    };
    void fetchData();
    return () => { cancelled = true; };
  }, [candidate.candidateId, organizationId, scopeKey, scope, interactionReload]);

  const handleAddNote = async (content: string) => {
    if (!organizationId) { toast.error('Organisation introuvable. Rechargez la page.'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    if (currentScope.current !== scope) return;
    const { error: insertErr } = await supabase.from('candidate_notes').insert({
      candidate_id: candidate.candidateId,
      content, created_by: user.id, organization_id: organizationId,
    });
    if (currentScope.current !== scope) return;
    if (insertErr) { toast.error('Erreur lors de l\'ajout de la note'); return; }
    const { data } = await supabase.from('candidate_notes').select('*').eq('organization_id', organizationId).eq('candidate_id', candidate.candidateId).order('created_at', { ascending: false });
    if (currentScope.current !== scope) return;
    setNotes(data || []);
    toast.success('Note ajoutée');
    onRefresh();
  };

  const handleDeleteNote = async (id: string) => {
    if (!organizationId) return;
    const { error } = await supabase.from('candidate_notes').delete().eq('organization_id', organizationId).eq('candidate_id', candidate.candidateId).eq('id', id);
    if (currentScope.current !== scope) return;
    if (error) { toast.error('Erreur lors de la suppression'); return; }
    setNotes(prev => prev.filter(n => n.id !== id));
    toast.success('Note supprimée');
    onRefresh();
  };

  const handleAddReminder = async (title: string, date: string) => {
    if (!organizationId) { toast.error('Organisation introuvable. Rechargez la page.'); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');
    if (currentScope.current !== scope) return;
    const { error: insertErr } = await supabase.from('candidate_reminders').insert({
      candidate_id: candidate.candidateId, candidate_name: candidate.name,
      job_id: candidate.jobId,
      job_title: candidate.jobTitle, title,
      due_at: new Date(date).toISOString(), created_by: user.id,
      organization_id: organizationId,
    });
    if (currentScope.current !== scope) return;
    if (insertErr) { toast.error('Erreur lors de la création du rappel'); return; }
    const { data } = await supabase.from('candidate_reminders').select('*').eq('organization_id', organizationId).eq('candidate_id', candidate.candidateId).order('due_at', { ascending: true });
    if (currentScope.current !== scope) return;
    setReminders(data || []);
    toast.success('Rappel créé');
    onRefresh();
  };

  const handleDeleteReminder = async (id: string) => {
    if (!organizationId) return;
    const { error } = await supabase.from('candidate_reminders').delete().eq('organization_id', organizationId).eq('candidate_id', candidate.candidateId).eq('id', id);
    if (currentScope.current !== scope) return;
    if (error) { toast.error('Erreur lors de la suppression'); return; }
    setReminders(prev => prev.filter(r => r.id !== id));
    toast.success('Rappel supprimé');
    onRefresh();
  };

  const handleCreatePortalLink = async () => {
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) return;
      if (!organizationId) throw new Error('Organisation introuvable. Rechargez la page.');
      if (currentScope.current !== scope) return;
      const { data: tokenData, error: insertError } = await supabase
        .from('candidate_portal_tokens')
        .insert({
          candidate_id: candidate.candidateId,
          candidate_name: candidate.name,
          job_id: candidate.jobId,
          job_title: candidate.jobTitle,
          pipeline_stage: candidate.stage,
          created_by: user.id,
          organization_id: organizationId,
          recruiter_name: user.user_metadata?.full_name || user.email?.split('@')[0] || null,
          recruiter_email: user.email || null,
          stage_updated_at: new Date().toISOString(),
        })
        .select('token')
        .single();
      if (currentScope.current !== scope) return;
      if (insertError || !tokenData) throw insertError || new Error('Impossible de créer le token');
      const url = `${window.location.origin}/portal/${tokenData.token}`;
      await navigator.clipboard.writeText(url);
      if (currentScope.current !== scope) return;
      toast.success('Lien portail copié !');
    } catch (e: any) {
      toast.error('Erreur : ' + (e.message || 'impossible de créer le lien'));
    }
  };

  const activeRemindersCount = reminders.filter(r => !r.completed_at).length;

  // ─── Adapter ATSCandidate → LinkedInProfile pour ProfileDetailSheet ──
  const profile = React.useMemo(() => atsCandidateToProfile(candidateWithProfileData), [candidateWithProfileData]);
  const showProfileDetails = profileStatus == null || hasCandidateProfileDetails(
    normalizeCandidateProfile(candidateWithProfileData.linkedinProfileData, candidate.candidateId, candidate.name),
  );

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
        <>
          {profileStatus}
          {showProfileDetails && <ProfileDetailedTab
            linkedinProfileData={candidateWithProfileData.linkedinProfileData}
            enrichedProfile={enrichedProfile}
          />}
        </>
      ),
    },
    {
      key: 'evaluation',
      label: 'Évaluation',
      shortLabel: 'Eval',
      icon: Target,
      content: (
        <EvaluationTab
          candidate={candidate}
          candidateWithProfileData={candidateWithProfileData}
          enrichedProfile={enrichedProfile}
          fullProfile={fullProfile}
          onOpenMobileProfile={() => setMobileProfileOpen(true)}
          autoGenerate={autoGenerateScorecard}
          profileLoading={snapshotLoading}
          autoOpenFirst={autoOpenScorecard}
          autoStartCoaching={autoStartCoaching}
          qualificationSessionId={qualificationSessionId}
        />
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
      label: 'Interactions',
      shortLabel: 'Échanges',
      icon: MessageSquare,
      content: (
        <CardMessageThread
          profileId={candidate.candidateId}
          profileName={candidate.name}
          profileUrl={candidate.linkedin}
          profileAliases={[profile.provider_id, profile.member_urn, profile.recruiter_candidate_id].filter((id): id is string => !!id)}
          projectId={candidate.projectId || missionIdOfJob(candidate.jobId)}
          onMessageSent={refreshInteractions}
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
    reminders, loading, activeRemindersCount, openAgent, organizationId, accountId, refreshInteractions,
    autoGenerateScorecard, autoOpenScorecard, autoStartCoaching, qualificationSessionId, snapshotLoading, profileStatus, showProfileDetails,
  ]);

  return (
    <ProfileDetailSheet
      profile={profile}
      open
      onOpenChange={(open) => { if (!open) onClose(); }}
      onCloseAutoFocus={onCloseAutoFocus}
      selectedJob={null}
      accountId={accountId}
      onMessageSent={refreshInteractions}
      airtableMatch={fullProfile.airtableMatch}
      pipelineMeta={{
        stage: pipelineAttached ? candidate.stage : 'Hors pipeline',
        stageOptions: stageOptions ?? ATS_STAGES.map(s => ({ key: s.key, label: s.label })),
        onStageChange: pipelineAttached ? (newStage) => onStageChange(candidate.id, newStage) : undefined,
        score: candidate.score,
        // Pas de onScoreClick : la note de l'en-tête ouvre elle-même l'onglet Évaluation.
        tags: candidate.tags || [],
        onTagsChange: pipelineAttached ? (tags) => onTagsChange?.(candidate.id, tags) : undefined,
        onCreatePortalLink: pipelineAttached ? handleCreatePortalLink : undefined,
        // Manual contacts : email/phone saisis par le recruteur (en plus
        // de ce que LinkedIn / enrichissement fournissent automatiquement).
        manualEmail: manualContacts?.email || null,
        manualPhone: manualContacts?.phone || null,
        contactsEditor: organizationId ? (
          <ManualContactsEditor
            candidateId={candidate.candidateId}
            organizationId={organizationId}
            existingEmails={(profile.contact_info?.emails as string[] | undefined) || []}
            existingPhones={(profile.contact_info?.phones as string[] | undefined) || []}
            onContactsUpdated={contacts => { if (currentScope.current === scope) setManualContacts(contacts); }}
          />
        ) : undefined,
      }}
      extraTabs={extraTabs}
      hideStandardTabs
      initialTab={initialTab}
    />
  );
};
