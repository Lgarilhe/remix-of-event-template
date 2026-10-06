// Palette « Ajouter une étape » : deux onglets, « Actions LinkedIn » et
// « Conditions et attentes ». Une entrée impossible à cet endroit reste
// visible, grisée, avec sa raison (isStepAllowedAt, jugé sur le chemin,
// branches comprises). Les types fermés (e-mail, WhatsApp, branchement,
// attente de visite) n'y figurent jamais (ADD_STEP_PALETTE).
import { useState } from 'react';
import type { SequenceStep } from '@/types/sequence';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import {
  ADD_STEP_PALETTE,
  isStepAllowedAt,
  stepTypeLabel,
  type StepPosition,
} from '@/components/outreach/sequence/sequenceGraph';
import { cn } from '@/lib/utils';

type ActionType = SequenceStep['actionType'];

/** Ce que fait chaque entrée, quand elle est permise. */
const DESCRIPTIONS: Partial<Record<ActionType, string>> = {
  profile_visit: 'Le candidat voit votre visite.',
  connection_request: 'Avec ou sans note de 300 caractères.',
  message: 'Aux candidats déjà en relation.',
  inmail: 'Atteint un candidat hors réseau. Objet requis.',
  smart_message: 'Un message par candidat ; InMail hors réseau.',
  check_connection: 'Deux branches : Connecté, Non connecté.',
  wait_connection: 'Jusqu’à l’acceptation de l’invitation.',
  wait_reply: 'Une réponse arrête déjà la séquence : utile pour choisir une étape de repli à l’échéance.',
};

type PaletteTab = 'linkedin' | 'conditions';

interface AddStepPaletteProps {
  steps: SequenceStep[];
  position: StepPosition;
  onPick: (actionType: ActionType) => void;
  className?: string;
}

export function AddStepPalette({ steps, position, onPick, className }: AddStepPaletteProps) {
  const [tab, setTab] = useState<PaletteTab>('linkedin');
  const entries = (types: readonly ActionType[]) => (
    <ul className="space-y-0.5">
      {types.map((type) => {
        const allowance = isStepAllowedAt(steps, position, type);
        const label = stepTypeLabel(type);
        return (
          <li key={type}>
            <Button
              type="button"
              variant="ghost"
              aria-disabled={!allowance.allowed || undefined}
              aria-label={allowance.allowed ? label : `${label} : ${allowance.reason ?? 'impossible à cet endroit'}`}
              onClick={() => { if (allowance.allowed) onPick(type); }}
              className={cn(
                'h-auto w-full items-start justify-start gap-3 whitespace-normal px-2.5 py-2 text-left max-md:min-h-11',
                !allowance.allowed && 'cursor-not-allowed hover:bg-transparent',
              )}
            >
              {/* Entrée impossible : icône et titre estompés, la raison reste lisible (seule information utile). */}
              <span className={cn('mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-foreground-secondary', !allowance.allowed && 'opacity-50')}>
                <SequenceActionIcon type={type} className="h-4 w-4" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn('block text-sm font-medium text-foreground', !allowance.allowed && 'opacity-60')}>{label}</span>
                <span className="block text-xs font-normal text-muted-foreground">
                  {allowance.allowed ? DESCRIPTIONS[type] : allowance.reason}
                </span>
              </span>
            </Button>
          </li>
        );
      })}
    </ul>
  );
  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as PaletteTab)} className={cn('w-full', className)}>
      <TabsList className="grid w-full grid-cols-2 max-md:h-auto">
        <TabsTrigger value="linkedin" className="text-xs max-md:min-h-11">Actions LinkedIn</TabsTrigger>
        <TabsTrigger value="conditions" className="text-xs max-md:min-h-11">Conditions et attentes</TabsTrigger>
      </TabsList>
      {/* Deux listes dans la même case : la palette garde la hauteur de la plus longue et ne saute pas d'un côté du bouton à l'autre. */}
      <div className="mt-2 grid">
        <TabsContent forceMount value="linkedin" className="mt-0 [grid-area:1/1] data-[state=inactive]:invisible">{entries(ADD_STEP_PALETTE.linkedin)}</TabsContent>
        <TabsContent forceMount value="conditions" className="mt-0 [grid-area:1/1] data-[state=inactive]:invisible">{entries(ADD_STEP_PALETTE.conditions)}</TabsContent>
      </div>
    </Tabs>
  );
}
