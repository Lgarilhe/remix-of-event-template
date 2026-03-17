import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { useOrganization } from '@/hooks/useOrganization';
import { InvitationBanner } from '@/components/InvitationBanner';
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { SceneWelcome } from '@/components/onboarding/SceneWelcome';
import { SceneOrganization } from '@/components/onboarding/SceneOrganization';
import { SceneAudit } from '@/components/onboarding/SceneAudit';
import { SceneProfile } from '@/components/onboarding/SceneProfile';
import { SceneIntegrations } from '@/components/onboarding/SceneIntegrations';
import { SceneTeam } from '@/components/onboarding/SceneTeam';
import { SceneLaunch } from '@/components/onboarding/SceneLaunch';

// Step indices: 0=Welcome, 1=Org, 2=Audit, 3=Profile, 4=Integrations, 5=Team, 6=Launch
const STEP_COUNT = 7;
const TRACKABLE_STEPS = [0, 1, 2, 3, 4, 5] as const;

// Company data passed from SceneOrganization → SceneAudit via lifted state
export interface OnboardingCompanyData {
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  careersUrl: string | null;
}

const Onboarding = () => {
  const [step, setStep] = useState(0); // Always start at Welcome
  const [direction, setDirection] = useState(1);
  const [orgCreated, setOrgCreated] = useState(false);
  const [completedSet, setCompletedSet] = useState<Set<number>>(new Set());
  const [companyData, setCompanyData] = useState<OnboardingCompanyData | null>(null);
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

  // If org gets created/detected while on step 1, advance past it
  useEffect(() => {
    if (organization && !orgCreated) {
      setOrgCreated(true);
      markCompleted(1);
      if (step === 1) {
        setDirection(1);
        setStep(2);
      }
    }
  }, [organization, orgCreated, step, markCompleted]);

  const goNext = useCallback(() => {
    setDirection(1);
    setStep((s) => {
      if (s === null) return 0;
      // #7: Skip org step if already done
      let next = s + 1;
      if (next === 1 && orgCreated) next = 2;
      if (next >= STEP_COUNT) {
        queryClient.invalidateQueries({ queryKey: ['active-organization'] });
        navigate('/outreach', { replace: true });
        return s;
      }
      return next;
    });
  }, [navigate, queryClient, orgCreated]);

  const completeAndNext = useCallback((stepIndex: number) => {
    markCompleted(stepIndex);
    goNext();
  }, [markCompleted, goNext]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => {
      if (s === null || s <= 0) return 0;
      // #7/#8: Skip org step backwards if already done
      let prev = s - 1;
      if (prev === 1 && orgCreated) prev = 0;
      return prev;
    });
  }, [orgCreated]);

  const handleOrgCreated = useCallback((data: OnboardingCompanyData) => {
    setOrgCreated(true);
    setCompanyData(data);
    markCompleted(1);
    goNext();
  }, [goNext, markCompleted]);

  const handleFinish = useCallback(async () => {
    markCompleted(5);
    await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
    await queryClient.refetchQueries({ queryKey: ['active-organization'] });
    navigate('/outreach', { replace: true });
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

  // Don't render until initialized
  if (step === null) return null;

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
            {step === 1 && <SceneOrganization onComplete={handleOrgCreated} />}
            {step === 2 && <SceneAudit companyData={companyData} onNext={() => completeAndNext(2)} onBack={goBack} />}
            {step === 3 && <SceneProfile onNext={() => completeAndNext(3)} onBack={goBack} />}
            {step === 4 && <SceneIntegrations onNext={() => completeAndNext(4)} onBack={goBack} />}
            {step === 5 && (
              <SceneTeam
                organizationId={organizationId}
                onFinish={() => { markCompleted(5); goNext(); }}
                onBack={goBack}
              />
            )}
            {step === 6 && (
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
