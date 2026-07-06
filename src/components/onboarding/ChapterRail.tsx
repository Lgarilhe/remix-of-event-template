import React from 'react';
import { motion } from 'framer-motion';
import { Check, Rocket } from 'lucide-react';
import type { ChapterDef, SceneKey } from './onboardingMeta';
import { STEP_META } from './onboardingMeta';

interface Props {
  chapters: ChapterDef[];
  currentScene: SceneKey;
  completedScenes: Set<SceneKey>;
}

/**
 * Rail latéral de navigation (lecture seule) : chapitres + étapes,
 * avec marqueur actif animé (layoutId) et checks qui apparaissent en pop.
 */
export const ChapterRail: React.FC<Props> = ({ chapters, currentScene, completedScenes }) => {
  const isLaunch = currentScene === 'launch';

  return (
    <nav aria-label="Progression de l'onboarding" className="flex flex-col gap-1">
      {chapters.map((chapter, chapterIdx) => {
        const Icon = chapter.icon;
        const isChapterDone = chapter.scenes.every((s) => completedScenes.has(s));
        const isChapterCurrent = !isLaunch && chapter.scenes.includes(currentScene);

        return (
          <motion.div
            key={chapter.id}
            initial={{ opacity: 0, x: -18 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + chapterIdx * 0.09, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="relative"
          >
            {/* Chapter header */}
            <div
              className={`flex items-center gap-2.5 px-2.5 py-2 border transition-colors duration-300 ${
                isChapterCurrent ? 'border-border bg-card/70 backdrop-blur-sm' : 'border-transparent'
              }`}
              style={isChapterCurrent ? { boxShadow: `0 0 24px hsl(var(${chapter.accent}) / 0.12)` } : undefined}
            >
              <div
                className={`w-7 h-7 flex items-center justify-center shrink-0 border transition-colors duration-300 ${
                  isChapterDone ? 'border-transparent' : isChapterCurrent ? 'border-border' : 'border-border/50'
                }`}
                style={{
                  background: isChapterDone
                    ? `hsl(var(${chapter.accent}) / 0.18)`
                    : isChapterCurrent
                    ? `hsl(var(${chapter.accent}) / 0.12)`
                    : 'transparent',
                  color: isChapterDone || isChapterCurrent ? `hsl(var(${chapter.accent}))` : 'hsl(var(--muted-foreground) / 0.5)',
                }}
              >
                {isChapterDone ? (
                  <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 20 }}>
                    <Check className="w-3.5 h-3.5" strokeWidth={3} />
                  </motion.span>
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <span
                  className="block text-3xs uppercase tracking-wider text-muted-foreground/60"
                  style={{ fontFamily: "'Space Mono', monospace" }}
                >
                  Chapitre {String(chapterIdx + 1).padStart(2, '0')}
                </span>
                <span
                  className={`block text-xs font-semibold truncate transition-colors duration-300 ${
                    isChapterCurrent || isChapterDone ? 'text-foreground' : 'text-muted-foreground/70'
                  }`}
                >
                  {chapter.title}
                </span>
              </div>
            </div>

            {/* Steps */}
            <div className="ml-[22px] border-l border-border/60 pl-4 py-1 flex flex-col gap-0.5">
              {chapter.scenes.map((scene) => {
                const done = completedScenes.has(scene);
                const current = scene === currentScene;
                const meta = scene !== 'launch' ? STEP_META[scene] : null;

                return (
                  <div key={scene} className="relative flex items-center gap-2 py-1">
                    {current && (
                      <motion.div
                        layoutId="rail-active-marker"
                        className="absolute -left-4 top-0 bottom-0 w-px"
                        style={{ background: `hsl(var(${chapter.accent}))`, boxShadow: `0 0 8px hsl(var(${chapter.accent}))` }}
                        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                      />
                    )}
                    <span className="relative flex items-center justify-center w-3 h-3 shrink-0">
                      {done ? (
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                          className="flex items-center justify-center w-3 h-3"
                          style={{ color: 'hsl(var(--skalr-green))' }}
                        >
                          <Check className="w-3 h-3" strokeWidth={3.5} />
                        </motion.span>
                      ) : current ? (
                        <>
                          <motion.span
                            className="absolute inset-0 rounded-full"
                            style={{ background: `hsl(var(${chapter.accent}) / 0.35)` }}
                            animate={{ scale: [1, 2, 1], opacity: [0.6, 0, 0.6] }}
                            transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
                          />
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: `hsl(var(${chapter.accent}))` }} />
                        </>
                      ) : (
                        <span className="w-1.5 h-1.5 rounded-full bg-foreground/15" />
                      )}
                    </span>
                    <span
                      className={`text-xs truncate transition-colors duration-300 ${
                        current ? 'text-foreground font-semibold' : done ? 'text-muted-foreground' : 'text-muted-foreground/50'
                      }`}
                      aria-current={current ? 'step' : undefined}
                    >
                      {meta?.railLabel ?? scene}
                    </span>
                  </div>
                );
              })}
            </div>
          </motion.div>
        );
      })}

      {/* Décollage */}
      <motion.div
        initial={{ opacity: 0, x: -18 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.15 + chapters.length * 0.09, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
        className={`flex items-center gap-2.5 px-2.5 py-2 border transition-colors duration-300 ${
          isLaunch ? 'border-border bg-card/70 backdrop-blur-sm' : 'border-transparent'
        }`}
        style={isLaunch ? { boxShadow: '0 0 24px hsl(var(--landing-accent-yellow) / 0.15)' } : undefined}
      >
        <div
          className="w-7 h-7 flex items-center justify-center shrink-0 border border-border/50"
          style={{
            background: isLaunch ? 'hsl(var(--landing-accent-yellow) / 0.15)' : 'transparent',
            color: isLaunch ? 'hsl(var(--landing-accent-yellow))' : 'hsl(var(--muted-foreground) / 0.5)',
          }}
        >
          <Rocket className="w-3.5 h-3.5" />
        </div>
        <span className={`text-xs font-semibold ${isLaunch ? 'text-foreground' : 'text-muted-foreground/70'}`}>
          Décollage
        </span>
      </motion.div>
    </nav>
  );
};
