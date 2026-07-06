import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useOrganization } from '@/hooks/useOrganization';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { supabase } from '@/integrations/supabase/client';
import { InvitationBanner } from '@/components/InvitationBanner';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { ChapterInterstitial } from '@/components/onboarding/ChapterInterstitial';
import { SceneOrganization } from '@/components/onboarding/SceneOrganization';
import { SceneAudit } from '@/components/onboarding/SceneAudit';
import { SceneProfile, type ProfileFormState } from '@/components/onboarding/SceneProfile';
import { SceneIntegrations } from '@/components/onboarding/SceneIntegrations';
import { SceneOrgType } from '@/components/onboarding/SceneOrgType';
import { SceneGoal, GOAL_OPTIONS } from '@/components/onboarding/SceneGoal';
import { SceneOrgDetails, type OrgDetailsData } from '@/components/onboarding/SceneOrgDetails';
import { SceneStack, STACK_OPTIONS } from '@/components/onboarding/SceneStack';
import { SceneDiscovery } from '@/components/onboarding/SceneDiscovery';
import { SceneSpecializations } from '@/components/onboarding/SceneSpecializations';
import { SceneAiTone } from '@/components/onboarding/SceneAiTone';
import { SceneQuotas } from '@/components/onboarding/SceneQuotas';
import { EMPTY_AI_CONTEXT } from '@/hooks/useAiContext';
import { SceneTeam } from '@/components/onboarding/SceneTeam';
import { SceneLaunch, type LaunchChecklistItem } from '@/components/onboarding/SceneLaunch';
import {
  FLOWS,
  DEFAULT_FLOW,
  chaptersForFlow,
  chapterIndexOfScene,
  type OrgType,
  type SceneKey,
} from '@/components/onboarding/onboardingMeta';
import {
  loadOnboardingProgress,
  saveOnboardingProgress,
  clearOnboardingProgress,
} from '@/components/onboarding/onboardingStorage';

export interface OnboardingCompanyData {
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  careersUrl: string | null;
}

const Onboarding = () => {
  const [restored] = useState(loadOnboardingProgress);

  const [orgType, setOrgType] = useState<OrgType | null>(restored?.orgType ?? null);
  const [step, setStep] = useState(() => {
    if (!restored?.orgType) return 0;
    const flow = FLOWS[restored.orgType];
    return Math.min(Math.max(restored.step, 0), flow.length - 1);
  });
  const [direction, setDirection] = useState(1);
  const [orgCreated, setOrgCreated] = useState(false);
  const [completedScenes, setCompletedScenes] = useState<Set<SceneKey>>(
    () => new Set(restored?.completed ?? [])
  );
  const [companyData, setCompanyData] = useState<OnboardingCompanyData | null>(null);
  const [orgDetailsData, setOrgDetailsData] = useState<OrgDetailsData | null>(restored?.orgDetails ?? null);
  const [goal, setGoal] = useState(restored?.goal ?? '');
  const [stack, setStack] = useState<string[]>(restored?.stack ?? []);
  const [discoverySource, setDiscoverySource] = useState(restored?.discoverySource ?? '');
  const [specializations, setSpecializations] = useState<string[]>(restored?.specializations ?? []);
  const [profileState, setProfileState] = useState<ProfileFormState | undefined>(
    restored?.profileBasics
      ? {
          displayName: restored.profileBasics.displayName,
          jobTitle: restored.profileBasics.jobTitle,
          linkedinUrl: restored.profileBasics.linkedinUrl,
          selectedSpecs: [],
          scanResult: null,
          experienceClassifications: [],
        }
      : undefined
  );
  const [teamInvitedCount, setTeamInvitedCount] = useState(0);

  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const { organization, organizationId, createOrganization } = useOrganization();
  const { accounts } = useLinkedInAccounts();

  const flow = useMemo(() => (orgType ? FLOWS[orgType] : DEFAULT_FLOW), [orgType]);
  const chapters = useMemo(() => chaptersForFlow(flow), [flow]);
  const currentScene = flow[step] ?? 'orgtype';
  const trackableSteps = flow.length - 1;
  const completedInFlow = useMemo(
    () => flow.filter((s) => s !== 'launch' && completedScenes.has(s)).length,
    [flow, completedScenes]
  );
  const scorePercent = Math.round((completedInFlow / Math.max(trackableSteps, 1)) * 100);

  const linkedInConnected = accounts.some(
    (a: any) => a.type !== 'WHATSAPP' && a.provider !== 'WHATSAPP'
  );

  // ─── Interstitiel de chapitre ───
  const [interstitialIdx, setInterstitialIdx] = useState<number | null>(null);
  const prevChapterRef = useRef(chapterIndexOfScene(currentScene, chapters));
  useEffect(() => {
    const idx = chapterIndexOfScene(currentScene, chapters);
    if (idx > 0 && idx !== prevChapterRef.current && direction > 0) {
      setInterstitialIdx(idx);
    }
    prevChapterRef.current = idx;
  }, [currentScene, chapters, direction]);

  // ─── Persistance de la progression ───
  useEffect(() => {
    saveOnboardingProgress({
      step,
      orgType,
      goal,
      stack,
      orgDetails: orgDetailsData,
      discoverySource,
      specializations,
      completed: Array.from(completedScenes),
      profileBasics: profileState
        ? {
            displayName: profileState.displayName,
            jobTitle: profileState.jobTitle,
            linkedinUrl: profileState.linkedinUrl,
          }
        : null,
    });
  }, [step, orgType, goal, stack, orgDetailsData, discoverySource, specializations, completedScenes, profileState]);

  useEffect(() => {
    if (organization && !orgCreated) {
      setOrgCreated(true);
    }
  }, [organization, orgCreated]);

  const markCompleted = useCallback((scene: SceneKey) => {
    setCompletedScenes((prev) => {
      if (prev.has(scene)) return prev;
      const next = new Set(prev);
      next.add(scene);
      return next;
    });
  }, []);

  const goNext = useCallback(() => {
    setDirection(1);
    setStep((s) => Math.min(s + 1, flow.length - 1));
  }, [flow.length]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const completeAndNext = useCallback(
    (scene: SceneKey) => {
      markCompleted(scene);
      goNext();
    },
    [markCompleted, goNext]
  );

  // ─── Contexte IA org (objectif + outils) — injecté à la création de l'org ───
  const buildOrgAiContext = useCallback(() => {
    const parts: string[] = [];
    if (goal) {
      const label = GOAL_OPTIONS.find((o) => o.value === goal)?.title ?? goal;
      parts.push(`Objectif principal de l'équipe : ${label}.`);
    }
    if (stack.length > 0 && !stack.includes('none')) {
      const labels = stack.map((v) => STACK_OPTIONS.find((o) => o.value === v)?.label ?? v);
      parts.push(`Outils déjà utilisés : ${labels.join(', ')}.`);
    }
    if (parts.length === 0) return null;
    return { ...EMPTY_AI_CONTEXT, free_text: parts.join(' ') };
  }, [goal, stack]);

  // ─── Handlers ───
  const handleOrgTypeSelected = useCallback(
    (type: OrgType) => {
      setOrgType(type);
      markCompleted('orgtype');
      setDirection(1);
      setStep(1);
    },
    [markCompleted]
  );

  const handleGoalSelected = useCallback(
    (value: string) => {
      setGoal(value);
      completeAndNext('goal');
    },
    [completeAndNext]
  );

  const handleStackSubmitted = useCallback(
    (values: string[]) => {
      setStack(values);
      completeAndNext('stack');
    },
    [completeAndNext]
  );

  const handleOrgDetailsSubmitted = useCallback(
    (data: OrgDetailsData) => {
      setOrgDetailsData(data);
      completeAndNext('orgdetails');
    },
    [completeAndNext]
  );

  const handleDiscoverySubmitted = useCallback(
    (source: string) => {
      setDiscoverySource(source);
      completeAndNext('discovery');
    },
    [completeAndNext]
  );

  const handleSpecializationsSubmitted = useCallback(
    async (specs: string[]) => {
      setSpecializations(specs);
      markCompleted('specializations');
      setDirection(1);

      if (orgType === 'freelance' && orgDetailsData) {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Mon espace';
          const slug = userName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
          const org = await createOrganization({
            name: userName,
            slug: `${slug}-${Date.now().toString(36)}`,
          });
          if (org?.id) {
            const aiCtx = buildOrgAiContext();
            await supabase
              .from('organizations')
              .update({
                org_type: 'freelance',
                team_size: orgDetailsData.teamSize,
                specializations: specs,
                discovery_source: discoverySource,
                freelance_mode: orgDetailsData.freelanceMode,
                annual_hires: orgDetailsData.annualHires ?? null,
                ...(aiCtx ? { ai_context: aiCtx } : {}),
              } as any)
              .eq('id', org.id);
          }
          setOrgCreated(true);
        } catch (err) {
          console.error('[Onboarding] Auto-create org failed:', err);
        }
      }

      setStep((s) => Math.min(s + 1, flow.length - 1));
    },
    [markCompleted, createOrganization, orgType, orgDetailsData, discoverySource, flow.length, buildOrgAiContext]
  );

  const handleOrgCreated = useCallback(
    (data: OnboardingCompanyData) => {
      setOrgCreated(true);
      setCompanyData(data);
      markCompleted('org');

      if (organizationId && orgType && orgDetailsData) {
        const aiCtx = buildOrgAiContext();
        supabase
          .from('organizations')
          .update({
            org_type: orgType,
            team_size: orgDetailsData.teamSize,
            specializations,
            discovery_source: discoverySource,
            freelance_mode: orgDetailsData.freelanceMode,
            annual_hires: orgDetailsData.annualHires ?? null,
            ...(aiCtx ? { ai_context: aiCtx } : {}),
          } as any)
          .eq('id', organizationId);
      }

      goNext();
    },
    [markCompleted, goNext, organizationId, orgType, orgDetailsData, specializations, discoverySource, buildOrgAiContext]
  );

  const handleIntegrationsNext = useCallback(
    (connectedCount: number) => {
      if (connectedCount > 0) markCompleted('integrations');
      goNext();
    },
    [markCompleted, goNext]
  );

  const handleTeamFinish = useCallback(
    (invitedCount: number) => {
      setTeamInvitedCount(invitedCount);
      if (invitedCount > 0) markCompleted('team');
      goNext();
    },
    [markCompleted, goNext]
  );

  const handleFinish = useCallback(async () => {
    clearOnboardingProgress();
    await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
    await queryClient.refetchQueries({ queryKey: ['active-organization'] });
    navigate('/dashboard', { replace: true });
  }, [navigate, queryClient]);

  // ─── Récap de lancement ───
  const launchItems = useMemo<LaunchChecklistItem[]>(() => {
    const items: LaunchChecklistItem[] = [
      { key: 'org', label: 'Espace de travail créé', done: orgCreated || !!organization },
      { key: 'activity', label: 'Activité & secteurs renseignés', done: completedScenes.has('specializations') },
    ];
    if (flow.includes('audit')) {
      items.push({ key: 'audit', label: 'Image employeur analysée', done: completedScenes.has('audit') });
    }
    items.push(
      { key: 'profile', label: 'Profil recruteur complété', done: completedScenes.has('profile'), settingsPath: '/settings?tab=account' },
      { key: 'aitone', label: 'IA personnalisée (ton & consignes)', done: completedScenes.has('aitone'), settingsPath: '/settings?tab=ai-context' },
      { key: 'linkedin', label: 'Compte LinkedIn connecté', done: linkedInConnected, settingsPath: '/settings?tab=account' },
      { key: 'quotas', label: 'Rythme de prospection réglé', done: completedScenes.has('quotas'), settingsPath: '/settings?tab=account' }
    );
    if (flow.includes('team')) {
      items.push({ key: 'team', label: 'Équipe invitée', done: completedScenes.has('team') || teamInvitedCount > 0, settingsPath: '/settings?tab=team' });
    }
    return items;
  }, [orgCreated, organization, completedScenes, flow, linkedInConnected, teamInvitedCount]);

  // ─── Transitions de scène ───
  const variants = reduceMotion
    ? {
        enter: () => ({ opacity: 0 }),
        center: { opacity: 1 },
        exit: () => ({ opacity: 0 }),
      }
    : {
        enter: (dir: number) => ({
          x: dir > 0 ? 90 : -90,
          opacity: 0,
          scale: 0.96,
          filter: 'blur(8px)',
        }),
        center: { x: 0, opacity: 1, scale: 1, filter: 'blur(0px)' },
        exit: (dir: number) => ({
          x: dir > 0 ? -90 : 90,
          opacity: 0,
          scale: 0.96,
          filter: 'blur(8px)',
        }),
      };

  return (
    <OnboardingShell
      chapters={chapters}
      flow={flow}
      currentScene={currentScene}
      stepIndex={step}
      completedScenes={completedScenes}
      scorePercent={scorePercent}
      orgName={organization?.name}
    >
      <div className="w-full max-w-lg mx-auto mb-4 empty:mb-0">
        <InvitationBanner />
      </div>

      <div className="w-full relative" style={{ minHeight: 340 }}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="w-full"
          >
            {currentScene === 'orgtype' && (
              <SceneOrgType onSelect={handleOrgTypeSelected} onBack={() => {}} />
            )}
            {currentScene === 'goal' && (
              <SceneGoal onSelect={handleGoalSelected} onBack={goBack} savedValue={goal} />
            )}
            {currentScene === 'orgdetails' && orgType && (
              <SceneOrgDetails orgType={orgType} onSubmit={handleOrgDetailsSubmitted} onBack={goBack} />
            )}
            {currentScene === 'stack' && (
              <SceneStack onSubmit={handleStackSubmitted} onBack={goBack} savedStack={stack} />
            )}
            {currentScene === 'discovery' && (
              <SceneDiscovery
                onSubmit={handleDiscoverySubmitted}
                onSkip={goNext}
                onBack={goBack}
                savedValue={discoverySource}
              />
            )}
            {currentScene === 'specializations' && (
              <SceneSpecializations
                onSubmit={handleSpecializationsSubmitted}
                onBack={goBack}
                savedSpecializations={specializations}
              />
            )}
            {currentScene === 'org' && (
              <SceneOrganization onComplete={handleOrgCreated} onBack={goBack} />
            )}
            {currentScene === 'audit' && (
              <SceneAudit
                companyData={companyData}
                onNext={() => completeAndNext('audit')}
                onBack={goBack}
              />
            )}
            {currentScene === 'profile' && (
              <SceneProfile
                onNext={() => completeAndNext('profile')}
                onBack={goBack}
                orgType={orgType}
                savedState={profileState}
                onStateChange={setProfileState}
              />
            )}
            {currentScene === 'aitone' && (
              <SceneAiTone
                onNext={() => completeAndNext('aitone')}
                onSkip={goNext}
                onBack={goBack}
              />
            )}
            {currentScene === 'integrations' && (
              <SceneIntegrations onNext={handleIntegrationsNext} onBack={goBack} />
            )}
            {currentScene === 'quotas' && (
              <SceneQuotas
                onNext={() => completeAndNext('quotas')}
                onSkip={goNext}
                onBack={goBack}
              />
            )}
            {currentScene === 'team' && (
              <SceneTeam
                organizationId={organizationId}
                onFinish={handleTeamFinish}
                onBack={goBack}
              />
            )}
            {currentScene === 'launch' && (
              <SceneLaunch
                items={launchItems}
                scorePercent={scorePercent}
                orgName={organization?.name}
                onFinish={handleFinish}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Interstitiel de chapitre */}
      <AnimatePresence>
        {interstitialIdx !== null && chapters[interstitialIdx] && (
          <ChapterInterstitial
            chapter={chapters[interstitialIdx]}
            chapterIndex={interstitialIdx}
            totalChapters={chapters.length}
            onDismiss={() => setInterstitialIdx(null)}
          />
        )}
      </AnimatePresence>
    </OnboardingShell>
  );
};

export default Onboarding;
