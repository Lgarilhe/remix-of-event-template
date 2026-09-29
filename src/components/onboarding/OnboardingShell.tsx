import React from 'react';
import { Check } from 'lucide-react';
import { KonektLogo } from '@/components/KonektLogo';
import { remainingSeconds, type SceneKey } from './onboardingMeta';
import { cn } from '@/lib/utils';

/** Une ligne de la fiche « Votre espace » : vide tant que la question n'a pas de réponse. */
export interface SummaryRow {
  key: string;
  label: string;
  value: string | null;
  /** Texte gris quand la réponse est « non précisée » ou « plus tard ». */
  muted?: boolean;
  /** Réponse qui vaut une coche (LinkedIn connecté). */
  ok?: boolean;
  /** La question posée à l'écran en ce moment. */
  active: boolean;
}

interface Props {
  flow: SceneKey[];
  stepIndex: number;
  summary: SummaryRow[];
  children: React.ReactNode;
}

/**
 * Coquille de l'onboarding : à gauche, la fiche de l'espace qui se remplit au
 * fil des réponses (ce que l'on configure, et où l'on en est) ; à droite, une
 * seule question. Sur téléphone, la fiche disparaît et la barre du haut suffit.
 * Fond uni, aucun décor (docs/design/01-direction.md, § 1).
 */
export const OnboardingShell: React.FC<Props> = ({ flow, stepIndex, summary, children }) => {
  const progress = Math.round(((stepIndex + 1) / flow.length) * 100);
  const isFinale = flow[stepIndex] === 'launch';
  const remainingMin = Math.max(1, Math.ceil(remainingSeconds(flow, stepIndex) / 60));

  return (
    <div className="flex min-h-screen flex-col bg-background lg:flex-row">
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

      <aside className="flex shrink-0 flex-col border-border px-4 py-5 sm:px-10 lg:sticky lg:top-0 lg:h-screen lg:w-96 lg:border-r lg:bg-card lg:px-10 lg:py-8">
        <div className="flex items-center justify-between gap-3">
          <KonektLogo theme="auto" size={24} className="shrink-0" />
          <p className="text-xs tabular-nums text-muted-foreground lg:hidden">
            Étape {stepIndex + 1} sur {flow.length}
          </p>
        </div>

        <div className="mt-auto hidden lg:block">
          <p className="eyebrow">Votre espace</p>
          <dl className="mt-4 divide-y divide-border border-y border-border">
            {summary.map((row) => (
              <div
                key={row.key}
                className={cn(
                  'relative flex items-baseline justify-between gap-4 py-3 pl-3 transition-colors duration-150',
                  row.active && 'before:absolute before:inset-y-2 before:left-0 before:w-0.5 before:rounded-full before:bg-brand',
                )}
              >
                <dt className={cn('text-sm', row.active ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                  {row.label}
                </dt>
                <dd
                  className={cn(
                    'flex min-w-0 items-center gap-1.5 text-right text-sm',
                    row.value && !row.muted ? 'text-foreground' : 'text-muted-foreground',
                  )}
                >
                  {row.ok && <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />}
                  <span className="truncate">{row.value ?? (row.active ? 'En cours' : 'À renseigner')}</span>
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs tabular-nums text-muted-foreground">
            {isFinale
              ? 'Configuration terminée'
              : `Étape ${stepIndex + 1} sur ${flow.length}, environ ${remainingMin} min. Votre progression est enregistrée.`}
          </p>
        </div>
      </aside>

      <main className="w-full flex-1">
        <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-8 sm:py-12 lg:px-12 lg:pt-32">{children}</div>
      </main>
    </div>
  );
};
