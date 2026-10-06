// Barre de vérification collante de l'éditeur (lot 5d-2) : ce qui bloque
// l'enregistrement, puis les recommandations. Une seule règle,
// validateSequence (sequenceGraph.ts), calculée par la page : la barre ne
// fait que l'afficher. « Voir » ouvre l'étape concernée (ou les Réglages pour
// un expéditeur).
import { AlertCircle, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { SequenceIssue, SequenceValidation } from '@/components/outreach/sequence/sequenceGraph';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { issueHasTarget, issueStepOrder } from '@/lib/sequenceEditor';
import { plural } from '@/lib/plural';

interface ValidationBarProps {
  validation: SequenceValidation;
  /** Mène au point : étape ouverte dans le panneau, ou onglet Réglages. */
  onShowIssue: (issue: SequenceIssue) => void;
}

export function ValidationBar({ validation, onShowIssue }: ValidationBarProps) {
  const { errors, warnings } = validation;
  const first = errors[0];
  return (
    <div
      role="region"
      aria-label="Vérification de la séquence"
      className="sticky bottom-0 z-sticky -mx-4 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border bg-background px-4 py-3 text-sm md:mx-0 md:px-1"
    >
      {/* Le message garde au moins 20 rem : dans une colonne étroite (téléphone, panneau d'étape ouvert), il prend
          seul la première ligne, sur deux lignes au plus, et « Voir » et les recommandations passent dessous. */}
      {first ? (
        <p className="flex min-w-0 flex-[1_1_20rem] items-start gap-2 text-danger max-md:basis-full">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 line-clamp-2">
            <span className="font-semibold">{plural(errors.length, 'point à corriger', 'points à corriger')} avant d’enregistrer</span>
            <span className="text-foreground"> : {first.message}</span>
          </span>
        </p>
      ) : (
        <p className="flex min-w-0 flex-[1_1_20rem] items-center gap-2 text-foreground max-md:basis-full">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
          Prête à recevoir des candidats
        </p>
      )}
      {first && issueHasTarget(first) && (
        <Button type="button" variant="outline" size="xs" onClick={() => onShowIssue(first)} className="max-md:h-11">
          Voir
          <span className="sr-only"> le premier point à corriger</span>
        </Button>
      )}
      {warnings.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button type="button" variant="ghost" size="xs" className="text-warning hover:text-warning max-md:h-11">
              <AlertTriangle aria-hidden="true" />
              {plural(warnings.length, 'recommandation', 'recommandations')}
            </Button>
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-[min(22rem,calc(100vw-2rem))] space-y-3 p-3">
            <p className="eyebrow">Recommandé</p>
            <ul className="space-y-2.5">
              {warnings.map((issue) => (
                <li key={`${issue.check}-${issue.message}`} className="space-y-1 text-xs text-foreground">
                  <p>{issue.message}</p>
                  {issueHasTarget(issue) && (
                    <Button type="button" variant="link" size="xs" onClick={() => onShowIssue(issue)} className="h-auto p-0 text-xs max-md:min-h-11">
                      {issue.area === 'senders' ? 'Ouvrir les réglages' : `Aller à l’étape ${(issueStepOrder(issue.message) ?? 0) + 1}`}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      )}
      <span className="hidden text-xs text-muted-foreground md:inline">Ctrl + S pour enregistrer</span>
    </div>
  );
}
