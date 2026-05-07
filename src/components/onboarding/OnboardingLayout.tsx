import React from 'react';
import { motion } from 'framer-motion';
import skalrLogo from '@/assets/skalr-logo-concept-3.webp';

interface OnboardingLayoutProps {
  currentStep: number;
  totalSteps: number;
  orgName?: string;
  completedSteps: number;
  trackableSteps: number;
  children: React.ReactNode;
}

export const OnboardingLayout: React.FC<OnboardingLayoutProps> = ({
  currentStep,
  totalSteps,
  orgName,
  completedSteps,
  trackableSteps,
  children,
}) => {
  const progress = ((currentStep + 1) / totalSteps) * 100;
  const scorePercent = Math.round((completedSteps / Math.max(trackableSteps, 1)) * 100);
  const circumference = 2 * Math.PI * 18;
  const strokeDashoffset = circumference - (scorePercent / 100) * circumference;

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      <div className="absolute inset-0 landing-sky-gradient opacity-50" />

      <div
        className="absolute -top-32 -right-32 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, hsl(var(--skalr-purple) / 0.04) 0%, transparent 70%)' }}
      />
      <div
        className="absolute -bottom-32 -left-32 w-[500px] h-[500px] rounded-full pointer-events-none"
        style={{ background: 'radial-gradient(circle, hsl(var(--skalr-blue) / 0.035) 0%, transparent 70%)' }}
      />

      {/* Progress bar */}
      <div className="w-full h-1 relative z-10">
        <motion.div
          className="h-full"
          style={{ background: 'linear-gradient(90deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)), hsl(var(--skalr-blue)))' }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.5, ease: 'easeInOut' }}
        />
      </div>

      {/* Top bar */}
      <div className="sticky top-0 z-20 flex items-center justify-between px-3 sm:px-6 py-3 backdrop-blur-sm bg-background/60">
        <div className="flex items-center gap-2 shrink-0">
          <img src={skalrLogo} alt="Konekt" className="h-6 sm:h-7 w-auto" />
          {orgName && (
            <span className="text-xs text-muted-foreground truncate max-w-[80px] sm:max-w-[140px] hidden sm:inline">{orgName}</span>
          )}
        </div>

        {/* Step dots */}
        <div className="flex items-center gap-1 sm:gap-1.5">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <motion.div
              key={i}
              className={`h-1.5 rounded-[1px] transition-all duration-300 ${
                i === currentStep ? 'w-4 sm:w-6' : 'w-2 sm:w-3'
              }`}
              style={{
                background:
                  i === currentStep
                    ? 'hsl(var(--skalr-pink))'
                    : i < currentStep
                    ? 'hsl(var(--skalr-purple) / 0.5)'
                    : 'hsl(var(--foreground) / 0.12)',
              }}
              animate={i === currentStep ? { scaleY: [1, 1.4, 1] } : {}}
              transition={{ duration: 0.4 }}
            />
          ))}
        </div>

        {/* Score ring */}
        <div className="flex items-center gap-1.5 shrink-0">
          <svg width="32" height="32" viewBox="0 0 40 40" className="rotate-[-90deg] sm:w-10 sm:h-10">
            <defs>
              <linearGradient id="score-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="hsl(var(--skalr-purple))" />
                <stop offset="100%" stopColor="hsl(var(--skalr-pink))" />
              </linearGradient>
            </defs>
            <circle cx="20" cy="20" r="18" fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth="2.5" />
            <motion.circle
              cx="20" cy="20" r="18" fill="none"
              stroke="url(#score-gradient)" strokeWidth="2.5" strokeLinecap="round"
              strokeDasharray={circumference}
              initial={{ strokeDashoffset: circumference }}
              animate={{ strokeDashoffset }}
              transition={{ duration: 0.6, ease: 'easeOut' }}
            />
          </svg>
          <span className="text-xs sm:text-xs font-bold text-foreground/70" style={{ fontFamily: "'Space Mono', monospace" }}>
            {scorePercent}%
          </span>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col items-center justify-center px-3 sm:px-4 relative z-10 overflow-x-hidden">
        {children}
      </div>

      {/* Step counter */}
      <div className="text-center pb-6 relative z-10">
        <span className="text-xs text-muted-foreground tracking-wider" style={{ fontFamily: "'Space Mono', monospace" }}>
          {String(currentStep + 1).padStart(2, '0')} / {String(totalSteps).padStart(2, '0')}
        </span>
      </div>
    </div>
  );
};
