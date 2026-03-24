import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { InvitationBanner } from '@/components/InvitationBanner';
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { SceneWelcome } from '@/components/onboarding/SceneWelcome';
import { SceneOrganization } from '@/components/onboarding/SceneOrganization';
import { SceneAudit } from '@/components/onboarding/SceneAudit';
import { SceneProfile } from '@/components/onboarding/SceneProfile';
import { SceneIntegrations } from '@/components/onboarding/SceneIntegrations';
import { SceneOrgType } from '@/components/onboarding/SceneOrgType';
import { SceneTeam } from '@/components/onboarding/SceneTeam';
import { SceneLaunch } from '@/components/onboarding/SceneLaunch';

// Step indices: 0=Welcome, 1=Org, 2=Audit, 3=Profile, 4=Integrations, 5=OrgType, 6=Team, 7=Launch
const STEP_COUNT = 8;
const TRACKABLE_STEPS = [0, 1, 2, 3, 4, 5, 6] as const;

// Company data passed from SceneOrganization → SceneAudit via lifted state
export interface OnboardingCompanyData {
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  careersUrl: string | null;
}

type OrgType = 'enterprise' | 'agency' | 'freelance';

const Onboarding = () => {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [orgCreated, setOrgCreated] = useState(false);
  const [completedSet, setCompletedSet] = useState<Set<number>>(new Set());
  const [companyData, setCompanyData] = useState<OnboardingCompanyData | null>(null);
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization, organizationId } = useOrganization();

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
      markCompleted(1);
    }
  }, [organization, orgCreated, markCompleted]);

  const goNext = useCallback(() => {
    setDirection(1);
    setStep((s) => Math.min((s ?? 0) + 1, STEP_COUNT - 1));
  }, []);

  const completeAndNext = useCallback((stepIndex: number) => {
    markCompleted(stepIndex);
    goNext();
  }, [markCompleted, goNext]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(0, (s ?? 0) - 1));
  }, []);

  // Special goBack for Team that skips OrgType when going back (since OrgType is already completed)
  const goBackFromTeam = useCallback(() => {
    setDirection(-1);
    setStep(5); // Go back to OrgType
  }, []);

  const handleOrgCreated = useCallback((data: OnboardingCompanyData) => {
    setOrgCreated(true);
    setCompanyData(data);
    markCompleted(1);
    goNext();
  }, [goNext, markCompleted]);

  const handleOrgTypeSelected = useCallback(async (type: OrgType) => {
    setOrgType(type);
    markCompleted(5);

    // Update org_type in the database
    if (organizationId) {
      await supabase
        .from('organizations')
        .update({ org_type: type } as any)
        .eq('id', organizationId);
    }

    if (type === 'freelance') {
      // Skip team step for freelancers
      markCompleted(6);
      setDirection(1);
      setStep(7); // Jump to Launch
    } else {
      goNext(); // Go to Team step
    }
  }, [organizationId, markCompleted, goNext]);

  const handleFinish = useCallback(async () => {
    markCompleted(6);
    await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
    await queryClient.refetchQueries({ queryKey: ['active-organization'] });
    navigate('/dashboard', { replace: true });
  }, [navigate, queryClient, markCompleted]);

  const completedSteps = completedSet.size;

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? '60%' : '-60%',
      opacity: 0,
      scale: 0.97,
    }),
    center: {
      x: 0,
      opacity: 1,
      scale: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? '-60%' : '60%',
      opacity: 0,
      scale: 0.97,
    }),
  };

  return (
    <OnboardingLayout
      currentStep={step}
      orgName={organization?.name}
      completedSteps={completedSteps}
    >
      {/* Invitation banner */}
      <div className="px-4 max-w-lg mx-auto w-full mb-4">
        <InvitationBanner />
      </div>

      {/* Step content */}
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
            {step === 0 && <SceneWelcome onNext={() => completeAndNext(0)} />}
            {step === 1 && <SceneOrganization onComplete={handleOrgCreated} onBack={goBack} />}
            {step === 2 && <SceneAudit companyData={companyData} onNext={() => completeAndNext(2)} onBack={goBack} />}
            {step === 3 && <SceneProfile onNext={() => completeAndNext(3)} onBack={goBack} />}
            {step === 4 && <SceneIntegrations onNext={() => completeAndNext(4)} onBack={goBack} />}
            {step === 5 && (
              <SceneOrgType
                onSelect={handleOrgTypeSelected}
                onBack={goBack}
              />
            )}
            {step === 6 && (
              <SceneTeam
                organizationId={organizationId}
                onFinish={() => { markCompleted(6); goNext(); }}
                onBack={goBackFromTeam}
              />
            )}
            {step === 7 && (
              <SceneLaunch
                completedSet={completedSet}
                totalSteps={TRACKABLE_STEPS.length}
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
