import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { InvitationBanner } from '@/components/InvitationBanner';
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { SceneOrganization } from '@/components/onboarding/SceneOrganization';
import { SceneAudit } from '@/components/onboarding/SceneAudit';
import { SceneProfile, type ProfileFormState } from '@/components/onboarding/SceneProfile';
import { SceneIntegrations } from '@/components/onboarding/SceneIntegrations';
import { SceneOrgType } from '@/components/onboarding/SceneOrgType';
import { SceneOrgDetails, type OrgDetailsData } from '@/components/onboarding/SceneOrgDetails';
import { SceneDiscovery } from '@/components/onboarding/SceneDiscovery';
import { SceneSpecializations } from '@/components/onboarding/SceneSpecializations';
import { SceneTeam } from '@/components/onboarding/SceneTeam';
import { SceneLaunch } from '@/components/onboarding/SceneLaunch';

export interface OnboardingCompanyData {
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  careersUrl: string | null;
}

type OrgType = 'enterprise' | 'agency' | 'freelance';

type SceneKey = 'orgtype' | 'orgdetails' | 'discovery' | 'specializations' | 'org' | 'audit' | 'profile' | 'integrations' | 'team' | 'launch';

const FLOWS: Record<OrgType, SceneKey[]> = {
  enterprise: ['orgtype', 'orgdetails', 'discovery', 'specializations', 'org', 'audit', 'profile', 'integrations', 'team', 'launch'],
  agency:     ['orgtype', 'orgdetails', 'discovery', 'specializations', 'org', 'audit', 'profile', 'integrations', 'team', 'launch'],
  freelance:  ['orgtype', 'orgdetails', 'discovery', 'specializations', 'profile', 'integrations', 'launch'],
};

const DEFAULT_FLOW: SceneKey[] = FLOWS.enterprise;

const Onboarding = () => {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [orgCreated, setOrgCreated] = useState(false);
  // Org créée PENDANT cette session d'onboarding (≠ organizationId du hook,
  // qui peut être null juste après création ou pointer sur l'org d'un inviteur).
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  const [completedSet, setCompletedSet] = useState<Set<number>>(new Set());
  const [companyData, setCompanyData] = useState<OnboardingCompanyData | null>(null);
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const [orgDetailsData, setOrgDetailsData] = useState<OrgDetailsData | null>(null);
  const [discoverySource, setDiscoverySource] = useState('');
  const [specializations, setSpecializations] = useState<string[]>([]);
  const [profileState, setProfileState] = useState<ProfileFormState | undefined>(undefined);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization, organizationId } = useOrganization();

  const flow = useMemo(() => orgType ? FLOWS[orgType] : DEFAULT_FLOW, [orgType]);
  const currentScene = flow[step] ?? 'orgtype';
  const stepCount = flow.length;
  const trackableSteps = stepCount - 1;

  const markCompleted = useCallback((stepIndex: number) => {
    setCompletedSet((prev) => {
      if (prev.has(stepIndex)) return prev;
      const next = new Set(prev);
      next.add(stepIndex);
      return next;
    });
  }, []);

  useEffect(() => {
    if (organization && !orgCreated) {
      setOrgCreated(true);
    }
  }, [organization, orgCreated]);

  const goNext = useCallback(() => {
    setDirection(1);
    setStep((s) => Math.min(s + 1, stepCount - 1));
  }, [stepCount]);

  const completeAndNext = useCallback((stepIndex: number) => {
    markCompleted(stepIndex);
    goNext();
  }, [markCompleted, goNext]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const { createOrganization } = useOrganization();

  // Step 1: pick org type
  const handleOrgTypeSelected = useCallback((type: OrgType) => {
    setOrgType(type);
    markCompleted(0);
    setDirection(1);
    setStep(1); // go to orgdetails
  }, [markCompleted]);

  // Step 2: details submitted (no longer handles discovery)
  const handleOrgDetailsSubmitted = useCallback((data: OrgDetailsData) => {
    setOrgDetailsData(data);
    markCompleted(1);
    setDirection(1);
    setStep(2); // go to discovery
  }, [markCompleted]);

  // Step 3: discovery source submitted
  const handleDiscoverySubmitted = useCallback(async (source: string) => {
    setDiscoverySource(source);
    const discoveryIndex = flow.indexOf('discovery');
    if (discoveryIndex >= 0) markCompleted(discoveryIndex);
    setDirection(1);
    setStep((discoveryIndex >= 0 ? discoveryIndex : 2) + 1);
  }, [flow, markCompleted]);

  const handleSpecializationsSubmitted = useCallback(async (specs: string[]) => {
    setSpecializations(specs);
    const specIndex = flow.indexOf('specializations');
    if (specIndex >= 0) markCompleted(specIndex);
    setDirection(1);

    // Garde anti-doublon : un retour arrière puis re-soumission ne doit pas
    // recréer une org (le slug horodaté rendait chaque re-passage unique →
    // doublons garantis en DB).
    if (orgType === 'freelance' && orgDetailsData && !orgCreated) {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Mon espace';
        const slug = userName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
        const org = await createOrganization({
          name: userName,
          slug: `${slug}-${Date.now().toString(36)}`,
        });
        if (org?.id) {
          setCreatedOrgId(org.id);
          const { error } = await supabase
            .from('organizations')
            .update({
              org_type: 'freelance',
              team_size: orgDetailsData.teamSize,
              specializations: specs,
              discovery_source: discoverySource,
              freelance_mode: orgDetailsData.freelanceMode,
            } as any)
            .eq('id', org.id);
          if (error) console.error('[Onboarding] Failed to persist org details:', error);
        }
        setOrgCreated(true);
      } catch (err) {
        console.error('[Onboarding] Auto-create org failed:', err);
        // Ne pas avancer : sans org, la fin du flow boucle sur /onboarding
        // (OrganizationGuard) sans explication. L'utilisateur peut réessayer.
        toast.error("Impossible de créer votre espace. Vérifiez votre connexion puis réessayez.");
        return;
      }
    }

    setStep((specIndex >= 0 ? specIndex : 3) + 1);
  }, [flow, markCompleted, createOrganization, orgType, orgDetailsData, discoverySource, orgCreated]);

  const handleOrgCreated = useCallback(async (data: OnboardingCompanyData, newOrgId: string | null) => {
    setOrgCreated(true);
    setCompanyData(data);
    if (newOrgId) setCreatedOrgId(newOrgId);
    const orgIndex = flow.indexOf('org');
    if (orgIndex >= 0) markCompleted(orgIndex);

    // newOrgId vient directement de SceneOrganization : organizationId (hook)
    // est encore null à ce moment (React Query pas refetché après création).
    const targetOrgId = newOrgId || organizationId;
    if (targetOrgId && orgType && orgDetailsData) {
      // ⚠️ awaité : un builder supabase-js est lazy et n'émet la requête
      // qu'au .then() — sans await, org_type n'était JAMAIS persisté.
      const { error } = await supabase
        .from('organizations')
        .update({
          org_type: orgType,
          team_size: orgDetailsData.teamSize,
          specializations,
          discovery_source: discoverySource,
          freelance_mode: orgDetailsData.freelanceMode,
        } as any)
        .eq('id', targetOrgId);
      if (error) console.error('[Onboarding] Failed to persist org details:', error);
    }

    goNext();
  }, [flow, goNext, markCompleted, organizationId, orgType, orgDetailsData, specializations, discoverySource]);

  const handleFinish = useCallback(async () => {
    const teamIndex = flow.indexOf('team');
    if (teamIndex >= 0) markCompleted(teamIndex);
    await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
    await queryClient.refetchQueries({ queryKey: ['active-organization'] });
    navigate('/dashboard', { replace: true });
  }, [navigate, queryClient, markCompleted, flow]);

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? '60%' : '-60%',
      opacity: 0,
      scale: 0.97,
    }),
    center: { x: 0, opacity: 1, scale: 1 },
    exit: (dir: number) => ({
      x: dir > 0 ? '-60%' : '60%',
      opacity: 0,
      scale: 0.97,
    }),
  };

  return (
    <OnboardingLayout
      currentStep={step}
      totalSteps={stepCount}
      orgName={organization?.name}
      completedSteps={completedSet.size}
      trackableSteps={trackableSteps}
    >
      <div className="px-4 max-w-lg mx-auto w-full mb-4">
        <InvitationBanner />
      </div>

      <div className="w-full max-w-lg relative px-1" style={{ minHeight: 340 }}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            className="w-full"
          >
            {currentScene === 'orgtype' && (
              <SceneOrgType onSelect={handleOrgTypeSelected} onBack={() => {}} />
            )}
            {currentScene === 'orgdetails' && orgType && (
              <SceneOrgDetails orgType={orgType} onSubmit={handleOrgDetailsSubmitted} onBack={goBack} />
            )}
            {currentScene === 'discovery' && (
              <SceneDiscovery onSubmit={handleDiscoverySubmitted} onBack={goBack} savedValue={discoverySource} />
            )}
            {currentScene === 'specializations' && (
              <SceneSpecializations
                onSubmit={handleSpecializationsSubmitted}
                onBack={goBack}
                savedSpecializations={specializations}
              />
            )}
            {currentScene === 'org' && (
              <SceneOrganization onComplete={handleOrgCreated} onBack={goBack} createdOrgId={createdOrgId} />
            )}
            {currentScene === 'audit' && (
              <SceneAudit
                companyData={companyData}
                onNext={() => completeAndNext(step)}
                onBack={goBack}
              />
            )}
            {currentScene === 'profile' && (
              <SceneProfile
                onNext={() => completeAndNext(step)}
                onBack={goBack}
                orgType={orgType}
                savedState={profileState}
                onStateChange={setProfileState}
              />
            )}
            {currentScene === 'integrations' && (
              <SceneIntegrations onNext={() => completeAndNext(step)} onBack={goBack} />
            )}
            {currentScene === 'team' && (
              <SceneTeam
                organizationId={organizationId}
                onFinish={() => { markCompleted(step); goNext(); }}
                onBack={goBack}
              />
            )}
            {currentScene === 'launch' && (
              <SceneLaunch
                completedSet={completedSet}
                totalSteps={trackableSteps}
                onFinish={handleFinish}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </OnboardingLayout>
  );
};

export default Onboarding;
