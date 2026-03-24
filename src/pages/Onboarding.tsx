import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { InvitationBanner } from '@/components/InvitationBanner';
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { SceneOrganization } from '@/components/onboarding/SceneOrganization';
import { SceneAudit } from '@/components/onboarding/SceneAudit';
import { SceneProfile } from '@/components/onboarding/SceneProfile';
import { SceneIntegrations } from '@/components/onboarding/SceneIntegrations';
import { SceneOrgType, type OrgTypeData } from '@/components/onboarding/SceneOrgType';
import { SceneTeam } from '@/components/onboarding/SceneTeam';
import { SceneLaunch } from '@/components/onboarding/SceneLaunch';

export interface OnboardingCompanyData {
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  careersUrl: string | null;
}

type OrgType = 'enterprise' | 'agency' | 'freelance';

type SceneKey = 'orgtype' | 'org' | 'audit' | 'profile' | 'integrations' | 'team' | 'launch';

const FLOWS: Record<OrgType, SceneKey[]> = {
  enterprise: ['orgtype', 'org', 'audit', 'profile', 'integrations', 'team', 'launch'],
  agency:     ['orgtype', 'org', 'audit', 'profile', 'integrations', 'team', 'launch'],
  freelance:  ['orgtype', 'profile', 'integrations', 'launch'],
};

// Before orgType is chosen, show the full flow length
const DEFAULT_FLOW: SceneKey[] = FLOWS.enterprise;

const Onboarding = () => {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [orgCreated, setOrgCreated] = useState(false);
  const [completedSet, setCompletedSet] = useState<Set<number>>(new Set());
  const [companyData, setCompanyData] = useState<OnboardingCompanyData | null>(null);
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const [orgExtraData, setOrgExtraData] = useState<Omit<OrgTypeData, 'orgType'> | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization, organizationId } = useOrganization();

  const flow = useMemo(() => orgType ? FLOWS[orgType] : DEFAULT_FLOW, [orgType]);
  const currentScene = flow[step] ?? 'orgtype';
  const stepCount = flow.length;
  const trackableSteps = stepCount - 1; // exclude launch

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

  const handleOrgTypeSelected = useCallback(async (type: OrgType) => {
    setOrgType(type);
    markCompleted(0);
    setDirection(1);

    if (type === 'freelance') {
      // Auto-create org for freelancer using their name
      try {
        const { data: { user } } = await supabase.auth.getUser();
        const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Mon espace';
        const slug = userName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
        const org = await createOrganization({
          name: userName,
          slug: `${slug}-${Date.now().toString(36)}`,
        });
        if (org?.id) {
          await supabase
            .from('organizations')
            .update({ org_type: 'freelance' } as any)
            .eq('id', org.id);
        }
        setOrgCreated(true);
      } catch (err) {
        console.error('[Onboarding] Auto-create org failed:', err);
      }
    }

    setStep(1);
  }, [markCompleted, createOrganization]);

  const handleOrgCreated = useCallback((data: OnboardingCompanyData) => {
    setOrgCreated(true);
    setCompanyData(data);
    // Find 'org' index in current flow and mark complete
    const orgIndex = flow.indexOf('org');
    if (orgIndex >= 0) markCompleted(orgIndex);

    // Update org_type in DB
    if (organizationId && orgType) {
      supabase
        .from('organizations')
        .update({ org_type: orgType } as any)
        .eq('id', organizationId);
    }

    goNext();
  }, [flow, goNext, markCompleted, organizationId, orgType]);

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

  // Scene numbering for display (1-indexed, exclude launch)
  const sceneNumber = step + 1;

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
            {currentScene === 'org' && (
              <SceneOrganization onComplete={handleOrgCreated} onBack={goBack} />
            )}
            {currentScene === 'audit' && (
              <SceneAudit
                companyData={companyData}
                onNext={() => completeAndNext(step)}
                onBack={goBack}
              />
            )}
            {currentScene === 'profile' && (
              <SceneProfile onNext={() => completeAndNext(step)} onBack={goBack} orgType={orgType} />
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
