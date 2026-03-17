import { useState, useEffect, useCallback } from 'react';
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
import { OnboardingStepInvite } from '@/components/onboarding/OnboardingStepInvite';

const STEP_COUNT = 7;

const Onboarding = () => {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [orgCreated, setOrgCreated] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization, organizationId } = useOrganization();

  // If org already exists, skip org step
  useEffect(() => {
    if (organization && !orgCreated) {
      setOrgCreated(true);
      if (step === 1) {
        setStep(2);
      }
    }
  }, [organization, orgCreated, step]);

  const goNext = useCallback(() => {
    setDirection(1);
    if (step < STEP_COUNT - 1) {
      setStep((s) => s + 1);
    } else {
      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      navigate('/outreach', { replace: true });
    }
  }, [step, navigate, queryClient]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const handleOrgCreated = useCallback(() => {
    setOrgCreated(true);
    goNext();
  }, [goNext]);

  const handleFinish = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
    await queryClient.refetchQueries({ queryKey: ['active-organization'] });
    navigate('/outreach', { replace: true });
  }, [navigate, queryClient]);

  // Count completed steps for the score ring
  const completedSteps = step;

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
      <div className="w-full max-w-lg relative" style={{ minHeight: 420 }}>
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
            {step === 0 && <SceneWelcome onNext={goNext} />}
            {step === 1 && <SceneOrganization onComplete={handleOrgCreated} onBack={goBack} />}
            {step === 2 && <SceneAudit onNext={goNext} onBack={goBack} />}
            {step === 3 && <SceneProfile onNext={goNext} onBack={goBack} />}
            {step === 4 && <OnboardingStepLinkedIn onNext={goNext} onBack={goBack} />}
            {step === 5 && (
              <OnboardingStepInvite
                organizationId={organizationId}
                onFinish={goNext}
                onBack={goBack}
              />
            )}
            {step === 6 && (
              <div className="text-center py-16">
                <p className="text-muted-foreground">Étape 7 — bientôt disponible</p>
                <button onClick={handleFinish} className="mt-4 underline text-sm">Terminer →</button>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </OnboardingLayout>
  );
};

export default Onboarding;
