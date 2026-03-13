import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { useOrganization } from '@/hooks/useOrganization';
import { InvitationBanner } from '@/components/InvitationBanner';
import { OnboardingStepOrg } from '@/components/onboarding/OnboardingStepOrg';
import { OnboardingStepProfile } from '@/components/onboarding/OnboardingStepProfile';
import { OnboardingStepLinkedIn } from '@/components/onboarding/OnboardingStepLinkedIn';
import { OnboardingStepInvite } from '@/components/onboarding/OnboardingStepInvite';
import { Building2, User, Linkedin, UserPlus } from 'lucide-react';

const STEPS = [
  { id: 'org', label: 'Organisation', icon: Building2 },
  { id: 'profile', label: 'Profil', icon: User },
  { id: 'linkedin', label: 'LinkedIn', icon: Linkedin },
  { id: 'invite', label: 'Équipe', icon: UserPlus },
] as const;

const Onboarding = () => {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [orgCreated, setOrgCreated] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { organization, organizationId } = useOrganization();

  // If org already exists (e.g. accepted invitation), skip to step 1
  useEffect(() => {
    if (organization && !orgCreated) {
      setOrgCreated(true);
      if (step === 0) {
        setStep(1);
      }
    }
  }, [organization, orgCreated, step]);

  const goNext = useCallback(() => {
    setDirection(1);
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      // Finish onboarding
      queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      navigate('/outreach', { replace: true });
    }
  }, [step, navigate, queryClient]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep(s => Math.max(0, s - 1));
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

  const progress = ((step + 1) / STEPS.length) * 100;

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? '100%' : '-100%',
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? '-100%' : '100%',
      opacity: 0,
    }),
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      {/* Top progress bar */}
      <div className="w-full h-1 bg-muted">
        <motion.div
          className="h-full bg-primary"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.4, ease: 'easeInOut' }}
        />
      </div>

      {/* Step indicators */}
      <div className="flex items-center justify-center gap-2 pt-8 pb-4 px-4">
        {STEPS.map((s, i) => {
          const Icon = s.icon;
          const isActive = i === step;
          const isDone = i < step;
          return (
            <div key={s.id} className="flex items-center gap-2">
              {i > 0 && (
                <div className={`w-8 h-px ${isDone ? 'bg-primary' : 'bg-border'} transition-colors duration-300`} />
              )}
              <motion.div
                className={`flex items-center justify-center w-9 h-9 rounded-full border-2 transition-colors duration-300 ${
                  isActive
                    ? 'border-primary bg-primary text-primary-foreground'
                    : isDone
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-background text-muted-foreground'
                }`}
                animate={isActive ? { scale: [1, 1.1, 1] } : {}}
                transition={{ duration: 0.3 }}
              >
                <Icon className="w-4 h-4" />
              </motion.div>
            </div>
          );
        })}
      </div>

      {/* Invitation banner */}
      <div className="px-4 max-w-lg mx-auto w-full">
        <InvitationBanner />
      </div>

      {/* Step content */}
      <div className="flex-1 flex items-center justify-center px-4 overflow-hidden">
        <div className="w-full max-w-lg relative" style={{ minHeight: 400 }}>
          <AnimatePresence mode="wait" custom={direction}>
            <motion.div
              key={step}
              custom={direction}
              variants={variants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
              className="w-full"
            >
              {step === 0 && (
                <OnboardingStepOrg onComplete={handleOrgCreated} />
              )}
              {step === 1 && (
                <OnboardingStepProfile onNext={goNext} onBack={goBack} />
              )}
              {step === 2 && (
                <OnboardingStepLinkedIn onNext={goNext} onBack={goBack} />
              )}
              {step === 3 && (
                <OnboardingStepInvite
                  organizationId={organizationId}
                  onFinish={handleFinish}
                  onBack={goBack}
                />
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      {/* Step counter */}
      <div className="text-center pb-6">
        <span className="text-xs text-muted-foreground">
          {step + 1} / {STEPS.length}
        </span>
      </div>
    </div>
  );
};

export default Onboarding;
