// « Ajouter une étape » sous la dernière carte d'une branche : ouvre la
// palette à cet endroit.
import { useState } from 'react';
import { Plus } from 'lucide-react';
import type { SequenceStep } from '@/types/sequence';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { StepPosition } from '@/components/outreach/sequence/sequenceGraph';
import { AddStepPalette } from './AddStepPalette';

interface AddStepButtonProps {
  steps: SequenceStep[];
  position: StepPosition;
  /** Branche de l'emplacement, pour le nom accessible (« Ajouter une étape dans la branche Non connecté »). */
  branchLabel?: string | null;
  onAdd: (position: StepPosition, actionType: SequenceStep['actionType']) => void;
}

export function AddStepButton({ steps, position, branchLabel, onAdd }: AddStepButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex justify-center">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={branchLabel ? `Ajouter une étape dans la branche ${branchLabel}` : 'Ajouter une étape'}
            className="max-md:h-11"
          >
            <Plus aria-hidden="true" />
            Ajouter une étape
          </Button>
        </PopoverTrigger>
        <PopoverContent
          collisionPadding={8}
          className="max-h-[var(--radix-popover-content-available-height)] w-96 max-w-[calc(100vw-2rem)] overflow-y-auto p-2"
          aria-label="Ajouter une étape"
        >
          <AddStepPalette
            steps={steps}
            position={position}
            onPick={(type) => {
              setOpen(false);
              onAdd(position, type);
            }}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
