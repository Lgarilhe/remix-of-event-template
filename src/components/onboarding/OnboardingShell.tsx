import React from 'react';
import { motion } from 'framer-motion';
import skalrLogo from '@/assets/skalr-logo-concept-3.webp';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { OnboardingBackdrop } from './OnboardingBackdrop';
import { ChapterRail } from './ChapterRail';
import { ChapterStepper } from './ChapterStepper';
import { StepExplainer } from './StepExplainer';
import type { ChapterDef, SceneKey } from './onboardingMeta';
import { STEP_META, chapterIndexOfScene, remainingSeconds } from './onboardingMeta';

interface Props {
  chapters: ChapterDef[];
  flow: SceneKey[];
  currentScene: SceneKey;
  stepIndex: number;
  completedScenes: Set<SceneKey>;
  scorePercent: number;
  orgName?: string;
  children: React.ReactNode;
}

const ScoreRing: React.FC<{ percent: number }> = ({ percent }) => {
  const circumference = 2 * Math.PI * 18;
  const strokeDashoffset = circumference - (percent / 100) * circumference;

  return (
    <div className="flex items-center gap-2 shrink-0" title="Score de configuration">
      <svg width="36" height="36" viewBox="0 0 40 40" className="rotate-[-90deg]">
        <defs>
          <linearGradient id="shell-score-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(var(--skalr-purple))" />
            <stop offset="50%" stopColor="hsl(var(--skalr-pink))" />
            <stop offset="100%" stopColor="hsl(var(--skalr-blue))" />
          </linearGradient>
        </defs>
        <circle cx="20" cy="20" r="18" fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth="2.5" />
        <motion.circle
          cx="20" cy="20" r="18" fill="none"
          stroke="url(#shell-score-gradient)" strokeWidth="2.5" strokeLinecap="round"
          strokeDasharray={circumference}
          initial={{ strokeDashoffset: circumference }}
          animate={{ strokeDashoffset }}
          transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1] }}
        />
      </svg>
      <span className="text-xs font-mono font-bold text-foreground/80 tabular-nums">
        <NumberTicker value={percent} className="tracking-normal" />%
      </span>
    </div>
  );
};

/**
 * Shell immersif de l'onboarding : fond texturé animé, header glass,
 * rail de chapitres (desktop), carte explicative (desktop xl / accordéon mobile).
 */
export const OnboardingShell: React.FC<Props> = ({
  chapters,
  flow,
  currentScene,
  stepIndex,
  completedScenes,
  scorePercent,
  orgName,
  children,
}) => {
  const isLaunch = currentScene === 'launch';
  const progress = ((stepIndex + 1) / flow.length) * 100;
  const chapterIdx = chapterIndexOfScene(currentScene, chapters);
  const chapter = chapterIdx >= 0 ? chapters[chapterIdx] : null;
  const meta = !isLaunch ? STEP_META[currentScene] : null;
  const stepInChapter = chapter ? chapter.scenes.indexOf(currentScene) + 1 : 0;
  const remainingMin = Math.max(1, Math.ceil(remainingSeconds(flow, stepIndex) / 60));

  return (
    <div className="min-h-screen flex flex-col relative overflow-x-clip bg-background">
      <OnboardingBackdrop />

      {/* Barre de progression globale */}
      <div className="fixed top-0 inset-x-0 h-1 z-50 bg-foreground/5">
        <motion.div
          className="h-full konekt-shine bg-emerald-500"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        />
      </div>

      {/* Header glass */}
      <header className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 sm:px-6 py-3 backdrop-blur-md bg-background/55 border-b border-border/40">
        <div className="flex items-center gap-2.5 min-w-0">
          <motion.img
            src={skalrLogo}
            alt="Konekt"
            className="h-6 sm:h-7 w-auto shrink-0"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          />
          {orgName && (
            <motion.span
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 }}
              className="text-xs text-muted-foreground truncate hidden sm:inline border-l border-border/60 pl-2.5"
            >
              {orgName}
            </motion.span>
          )}
        </div>

        <ScoreRing percent={scorePercent} />
      </header>

      {/* Corps */}
      <div className="flex-1 relative z-10 w-full max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-10 py-6 lg:py-10">
        <div
          className={
            isLaunch
              ? 'flex justify-center'
              : 'lg:grid lg:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)_280px] lg:gap-10 xl:gap-12'
          }
        >
          {/* Rail chapitres */}
          {!isLaunch && (
            <aside className="hidden lg:block">
              <div className="sticky top-24">
                <ChapterRail chapters={chapters} currentScene={currentScene} completedScenes={completedScenes} />
              </div>
            </aside>
          )}

          {/* Contenu principal */}
          <main className="flex flex-col items-center w-full min-w-0">
            {/* Stepper chapitres (compressé) */}
            <ChapterStepper chapters={chapters} currentScene={currentScene} completedScenes={completedScenes} />

            {/* Eyebrow d'étape */}
            {!isLaunch && chapter && meta && (
              <motion.div
                key={`eyebrow-${currentScene}`}
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                className="w-full max-w-lg mx-auto flex items-center justify-center gap-2 mb-5 flex-wrap"
              >
                <span className="inline-flex items-center gap-1.5 text-3xs font-mono uppercase tracking-wider font-medium px-2 py-1 rounded-md border border-border bg-card/60 backdrop-blur-sm text-foreground">
                  <span className="w-4 h-4 flex items-center justify-center rounded bg-emerald-500/15">
                    <chapter.icon className="w-2.5 h-2.5" />
                  </span>
                  Chapitre {String(chapterIdx + 1).padStart(2, '0')} — {chapter.title}
                </span>
                <span className="text-3xs font-mono uppercase tracking-wider text-muted-foreground">
                  Étape {stepInChapter}/{chapter.scenes.length} · ≈ {remainingMin} min restante{remainingMin > 1 ? 's' : ''}
                </span>
              </motion.div>
            )}

            {/* Explainer mobile/tablette */}
            {!isLaunch && chapter && meta && (
              <div className="w-full max-w-lg mx-auto mb-5 xl:hidden">
                <StepExplainer meta={meta} chapter={chapter} variant="inline" />
              </div>
            )}

            {/* Carte centrale */}
            <div className="relative w-full rounded-2xl border border-border bg-card/70 backdrop-blur-md shadow-xl overflow-hidden px-4 sm:px-8 py-8 sm:py-10">
              <span className="absolute top-4 right-4 sm:right-5 text-3xs font-mono uppercase tracking-wider text-muted-foreground/50">
                Étape {stepIndex + 1} / {flow.length}
              </span>
              {children}
            </div>
          </main>

          {/* Explainer desktop */}
          {!isLaunch && chapter && meta && (
            <aside className="hidden xl:block">
              <div className="sticky top-24">
                <StepExplainer key={currentScene} meta={meta} chapter={chapter} variant="panel" />
              </div>
            </aside>
          )}
        </div>
      </div>
    </div>
  );
};
