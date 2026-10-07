// « Nouvelle séquence » (lot 5d-2), derrière l'interrupteur konekt.sequences-v2 :
// remplace l'ancien choix de départ (SequenceTemplateSelector). Trois départs :
// « Partir d'un modèle » (TemplatesGallery), « Copier une séquence », « Partir
// de zéro ». Chacun ouvre l'éditeur unique sur /sequences/nouvelle (?mission=,
// &depart=) : rien n'est écrit avant « Enregistrer ».
// Lot 5e : depuis une mission, « Rédiger avec l'IA à partir du poste »
// (« Recommandé ») vient en premier (AIDraftChoice, /sequences/nouvelle?depart=ia).
import { useEffect, useState, type ElementType } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Copy, FilePlus2, LayoutTemplate } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import { STEP_TYPE_LABELS } from '@/components/outreach/sequence/sequenceGraph';
import { sequenceActionLabel } from '@/lib/sequenceCatalog';
import { newSequencePath, type NewSequenceStart } from '@/lib/sequencesBeta';
import { TemplatesGallery } from './TemplatesGallery';
import { AIDraftChoice } from './ai/AIDraftDoor';

/** Séquence proposée à la copie. */
export interface CopyableSequence {
  id: string;
  name: string;
  steps?: ReadonlyArray<{ action_type: string }>;
}

interface NewSequenceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Mission de la nouvelle séquence (panneau de mission) ; null depuis l'écran Séquences. */
  missionId: string | null;
  /** « Directeur financier · Groupe Hélios », sous le titre. */
  missionLabel?: string | null;
  existingSequences: readonly CopyableSequence[];
  /** Écran ouvert d'abord : le choix de départ, ou la galerie des modèles. */
  initialStep?: 'choice' | 'templates';
}

type Step = 'choice' | 'templates' | 'copy';

const stepName = (type: string) => STEP_TYPE_LABELS[type] ?? sequenceActionLabel(type);
const stepCount = (n: number) => `${n} étape${n > 1 ? 's' : ''}`;

function Choice({ icon: Icon, title, description, onClick }: { icon: ElementType; title: string; description: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" onClick={onClick} className="h-auto w-full justify-start gap-4 whitespace-normal rounded-xl border border-border p-4 text-left font-normal hover:border-foreground">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </Button>
  );
}

export function NewSequenceDialog({ open, onOpenChange, missionId, missionLabel, existingSequences, initialStep = 'choice' }: NewSequenceDialogProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(initialStep);
  useEffect(() => {
    if (open) setStep(initialStep);
  }, [open, initialStep]);

  const go = (start: NewSequenceStart) => {
    onOpenChange(false);
    navigate(newSequencePath(start, missionId));
  };

  const title = step === 'choice' ? 'Nouvelle séquence' : step === 'templates' ? 'Choisir un modèle' : 'Copier une séquence';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-1rem)] max-w-2xl flex-col overflow-hidden sm:w-full">
        <DialogHeader className="text-left">
          <div className="flex items-center gap-2 pr-8">
            {step !== 'choice' && (
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => setStep('choice')} aria-label="Retour au choix de départ" className="-ml-2 max-md:h-11 max-md:w-11">
                <ArrowLeft aria-hidden="true" />
              </Button>
            )}
            <DialogTitle>{title}</DialogTitle>
          </div>
          <DialogDescription>
            {step === 'choice'
              ? (missionLabel ? `Pour la mission ${missionLabel}. Rien n’est enregistré avant « Enregistrer ».` : 'Rien n’est enregistré avant « Enregistrer ».')
              : step === 'templates' ? 'Le modèle s’ouvre dans l’éditeur, à adapter.' : 'Une copie à adapter, enregistrée quand vous le décidez.'}
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 overflow-y-auto px-1 py-1">
          {step === 'choice' && (
            <div className="grid grid-cols-1 gap-3">
              {missionId && <AIDraftChoice missionId={missionId} onGo={() => onOpenChange(false)} />}
              <Choice icon={LayoutTemplate} title="Partir d’un modèle" description="Un déroulé prêt à l’emploi, à adapter." onClick={() => setStep('templates')} />
              <Choice icon={Copy} title="Copier une séquence" description="Une séquence existante comme point de départ." onClick={() => setStep('copy')} />
              <Choice icon={FilePlus2} title="Partir de zéro" description="Un fil vide ; vous ajoutez les étapes une à une." onClick={() => go({ kind: 'zero' })} />
            </div>
          )}

          {step === 'templates' && <TemplatesGallery onUse={(_sequence, key) => go({ kind: 'modele', key })} />}

          {step === 'copy' && (
            existingSequences.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Aucune séquence à copier pour l’instant.</p>
            ) : (
              <ul className="space-y-2">
                {existingSequences.map((seq) => {
                  const types = (seq.steps ?? []).map((s) => s.action_type);
                  return (
                    <li key={seq.id}>
                      <Button
                        type="button"
                        variant="ghost"
                        onClick={() => go({ kind: 'copie', id: seq.id })}
                        className="h-auto w-full flex-col items-start gap-2 whitespace-normal rounded-xl border border-border p-4 text-left font-normal hover:border-foreground"
                      >
                        <span className="text-sm font-semibold text-foreground">{seq.name}</span>
                        <span className="flex items-center gap-1" aria-label={`${stepCount(types.length)} : ${types.slice(0, 6).map(stepName).join(', ')}`}>
                          {types.slice(0, 6).map((type, i) => (
                            <span key={i} className="grid h-5 w-5 place-items-center rounded-sm bg-muted text-foreground" aria-hidden="true">
                              <SequenceActionIcon type={type} className="h-3 w-3" />
                            </span>
                          ))}
                          <span className="ml-1 text-xs text-muted-foreground">{stepCount(types.length)}</span>
                        </span>
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
