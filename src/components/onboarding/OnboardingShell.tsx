import React from 'react';
import { Check } from 'lucide-react';
import { KonektLogo } from '@/components/KonektLogo';
import type { ChapterDef, SceneKey } from './onboardingMeta';
import { remainingSeconds } from './onboardingMeta';
import { cn } from '@/lib/utils';

interface Props {
  flow: SceneKey[];
  stepIndex: number;
  chapters: ChapterDef[];
  completedScenes: Set<SceneKey>;
  orgName?: string;
  children: React.ReactNode;
}

/**
 * Coquille de l'onboarding : fond uni, en-tête minimal (logo, étape, temps
 * restant), fil des chapitres, une colonne de contenu. La progression est la
 * barre du haut, en accent (docs/design/01-direction.md, § 2).
 */
export const OnboardingShell: React.FC<Props> = ({ flow, stepIndex, chapters, completedScenes, orgName, children }) => {
  const progress = Math.round(((stepIndex + 1) / flow.length) * 100);
  const currentScene = flow[stepIndex];
  const isFinale = currentScene === 'launch';
  const remainingMin = Math.max(1, Math.ceil(remainingSeconds(flow, stepIndex) / 60));
  const currentChapterIdx = isFinale
    ? chapters.length
    : chapters.findIndex((c) => c.scenes.includes(currentScene));

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <div
        role="progressbar"
        aria-label="Progression de la configuration"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        className="fixed inset-x-0 top-0 z-sticky h-0.5 bg-border"
      >
        <div className="h-full bg-brand transition-[width] duration-200 ease-out" style={{ width: `${progress}%` }} />
      </div>

      <header className="flex items-center justify-between gap-3 px-4 py-5 sm:px-10">
        <div className="flex min-w-0 items-center gap-2.5">
          <KonektLogo theme="auto" size={24} className="shrink-0" />
          {orgName && (
            <span className="hidden truncate border-l border-border pl-2.5 text-xs text-muted-foreground sm:inline">
              {orgName}
            </span>
          )}
        </div>
        <p className="flex shrink-0 items-baseline gap-3 text-xs text-muted-foreground">
          <span className="tabular-nums text-foreground-secondary">
            Étape {stepIndex + 1} sur {flow.length}
          </span>
          {!isFinale && <span className="hidden sm:inline">Environ {remainingMin} min</span>}
        </p>
      </header>

      <nav aria-label="Chapitres" className="mx-auto w-full max-w-2xl px-4 pt-1 sm:px-8">
        <ol className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {chapters.map((chapter, i) => {
            // Coché seulement si ses scènes sont faites : un LinkedIn « connecté plus tard » reste à faire.
            const done = chapter.scenes.every((s) => completedScenes.has(s));
            const current = i === currentChapterIdx;
            return (
              <li
                key={chapter.id}
                aria-current={current ? 'step' : undefined}
                className={cn(
                  'flex items-center gap-1.5',
                  current
                    ? 'font-medium text-foreground underline decoration-brand decoration-2 underline-offset-4'
                    : done
                      ? 'text-foreground-secondary'
                      : 'text-muted-foreground',
                )}
              >
                {done && !current && <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />}
                {chapter.title}
                {done && !current && <span className="sr-only">(terminé)</span>}
              </li>
            );
          })}
        </ol>
      </nav>

      <main className="w-full flex-1">
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-8 sm:py-12">{children}</div>
      </main>
    </div>
  );
};
