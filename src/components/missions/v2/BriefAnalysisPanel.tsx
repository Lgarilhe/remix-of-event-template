/**
 * Panneau de droite du Brief IA : ce que l'assistant a retenu de la fiche.
 *
 * Quatre états, sans cadre autour de la liste (docs/design/06-simplicite.md) :
 *  - en attente : illustration « brief » et une phrase ;
 *  - analyse en cours : lignes de squelette, étoile de l'assistant qui scintille ;
 *  - erreur : ce qui s'est passé, et « Réessayer » (jamais un état vide) ;
 *  - résultat : une ligne par information, les compétences et intitulés en
 *    pastilles, ce que la fiche ne dit pas, et un rappel si la fiche a changé
 *    depuis l'analyse.
 *
 * Présentation seule : l'état et les appels vivent dans CreateMissionV2.
 */

import React from 'react';
import { AlertCircle, ListChecks } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';
import { Illustration } from '@/components/ui/illustration';
import { Skeleton } from '@/components/ui/skeleton';
import { SparkleIcon } from '@/components/ui/animated-icons';
import { cn } from '@/lib/utils';
import type { ExtractedField } from './briefAnalysis';

interface BriefAnalysisPanelProps {
  analyzing: boolean;
  hasAnalysis: boolean;
  error: string | null;
  /** La fiche ou le client ont changé depuis la dernière analyse. */
  stale: boolean;
  fields: ExtractedField[];
  /** Informations que la fiche ne donne pas. */
  missing: string[];
  /** Relance l'analyse ; absent quand la fiche est trop courte. */
  onRetry?: () => void;
  className?: string;
}

const SKELETON_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-1/3', 'w-5/6', 'w-1/2'];

export const BriefAnalysisPanel: React.FC<BriefAnalysisPanelProps> = ({
  analyzing, hasAnalysis, error, stale, fields, missing, onRetry, className,
}) => {
  const state = analyzing ? 'analyzing' : error ? 'error' : hasAnalysis ? 'result' : 'idle';

  return (
    <section
      aria-label="Ce que l'assistant a retenu"
      aria-live="polite"
      aria-busy={analyzing}
      className={cn('flex min-h-[280px] flex-col p-6', className)}
    >
      {state === 'idle' && (
        <div className="m-auto max-w-xs text-center">
          <Illustration name="brief" size="sm" tile={false} className="mx-auto mb-4" />
          <p className="text-sm font-medium">L'analyse apparaîtra ici</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Collez la fiche de poste, puis lancez l'analyse. L'assistant en retire le poste, les
            compétences, l'expérience et le lieu.
          </p>
        </div>
      )}

      {state !== 'idle' && (
        <div className="mb-3 flex items-center gap-2">
          <IconTile size="xs" tone={state === 'error' ? 'destructive' : 'brand'}>
            {state === 'analyzing' && <SparkleIcon className="size-3" />}
            {state === 'error' && <AlertCircle className="size-3" aria-hidden="true" />}
            {state === 'result' && <ListChecks className="size-3" aria-hidden="true" />}
          </IconTile>
          <h3 className="eyebrow">
            {state === 'analyzing' && 'Analyse en cours'}
            {state === 'error' && "L'analyse n'a pas abouti"}
            {state === 'result' && "Ce que l'assistant a retenu"}
          </h3>
        </div>
      )}

      {state === 'analyzing' && (
        <>
          <div aria-hidden="true" className="space-y-3">
            {SKELETON_WIDTHS.map((width, i) => (
              <div key={i} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-1">
                <Skeleton className="h-4 w-16" />
                <Skeleton className={cn('h-4', width)} />
              </div>
            ))}
          </div>
          <p className="sr-only">Analyse de la fiche en cours, quelques secondes.</p>
        </>
      )}

      {state === 'error' && (
        <div>
          <p className="text-sm text-foreground-secondary">{error}</p>
          {onRetry && (
            <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
              Réessayer
            </Button>
          )}
        </div>
      )}

      {state === 'result' && (
        <div className="konekt-fade-up">
          {stale && (
            <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-warning-muted px-3 py-2">
              <p className="text-xs text-warning">La fiche a changé depuis l'analyse.</p>
              {onRetry && (
                <Button variant="ghost" size="xs" onClick={onRetry}>
                  Relancer l'analyse
                </Button>
              )}
            </div>
          )}
          <dl className="divide-y divide-border">
            {fields.map((field) => (
              <div key={field.id} className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-3 py-2">
                <dt className="pt-0.5 text-xs text-muted-foreground">{field.label}</dt>
                <dd className="min-w-0">
                  {field.chips ? (
                    <ul className="flex flex-wrap gap-1.5">
                      {field.chips.map((chip) => (
                        <li key={chip}>
                          <Badge variant="muted">{chip}</Badge>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="break-words text-sm">{field.value}</p>
                  )}
                  {field.hint && <p className="mt-0.5 text-xs text-muted-foreground">{field.hint}</p>}
                </dd>
              </div>
            ))}
          </dl>

          <p className="mt-3 text-xs text-muted-foreground">
            {missing.length > 0 && `Non précisé dans la fiche : ${missing.join(', ')}. `}
            Tout reste modifiable dans le brief de la mission.
          </p>

        </div>
      )}
    </section>
  );
};
