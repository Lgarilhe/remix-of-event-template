// Refonte mission, lot 5f-2d : feuille latérale qui porte ContactFlow hors du Pipeline (profils
// de la recherche, fiches, messagerie).
//
// Mécanique calquée sur le panneau Prise de contact de la mission : titre qui reçoit le focus à
// l'ouverture, sous-titre, croix de 44 px sur téléphone, corps qui défile (le pied de ContactFlow
// est collé en bas de ce conteneur). La fermeture est refusée tant que l'inscription s'écrit
// (Échap, croix, clic à côté) : sans cela le flux se démonterait en pleine écriture et
// l'inscription finirait sur une feuille fermée. Après une inscription, la feuille informe
// l'appelant puis se ferme.
//
// Les candidats sont figés par l'appelant à l'ouverture : la liste ne change pas sous les mains de
// la personne. Cette feuille n'écrit rien d'elle-même : l'inscription et la règle Retenu passent par
// ContactFlow, donc par enrollCandidates.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import type { SequenceEnrollJob } from '@/components/outreach/SequenceEnrollButton';
import { ContactFlow } from './ContactFlow';
import type { FlowCandidate, FlowNotice } from './types';

export interface ContactFlowSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Défaut « Prise de contact ». */
  title?: string;
  /** Poste et client, ou « Hors mission » ; absent : une phrase pour les lecteurs d'écran. */
  subtitle?: string | null;
  /** Entre l'en-tête et le flux (choix de la mission de la messagerie). */
  above?: ReactNode;
  missionId: string | null;
  job: SequenceEnrollJob | null;
  /** Figés par l'appelant à l'ouverture. */
  candidates: readonly FlowCandidate[];
  overflow?: number;
  accountId?: string | null;
  notice?: FlowNotice | null;
  preferredSequenceId?: string | null;
  emptyHint?: string;
  /** La feuille se ferme après cet appel. */
  onEnrolled: (handledIds: readonly string[]) => void;
  /** « Retenir sans contacter » : la feuille reste ouverte, l'appelant relit ses statuts. */
  onChanged?: () => void;
  onOpenCandidate?: (rowId: string) => void;
}

export function ContactFlowSheet({
  open,
  onOpenChange,
  title = 'Prise de contact',
  subtitle = null,
  above,
  missionId,
  job,
  candidates,
  overflow,
  accountId,
  notice,
  preferredSequenceId,
  emptyHint,
  onEnrolled,
  onChanged,
  onOpenCandidate,
}: ContactFlowSheetProps): JSX.Element {
  const [busy, setBusy] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  // Fermée, la feuille ne retient plus rien (le flux est démonté, il ne le dira plus).
  useEffect(() => {
    if (!open) setBusy(false);
  }, [open]);

  // Jamais de fermeture pendant l'écriture.
  const guard = (next: boolean) => {
    if (!next && busy) return;
    onOpenChange(next);
  };

  // Le focus va au titre, pas au premier bouton : la personne entend d'abord où elle est.
  const focusTitle = (event: Event) => {
    event.preventDefault();
    titleRef.current?.focus({ preventScroll: true });
  };

  return (
    <Sheet open={open} onOpenChange={guard}>
      <SheetContent
        side="right"
        hideClose
        onOpenAutoFocus={focusTitle}
        className="flex w-full max-w-none flex-col gap-0 p-0 sm:max-w-md"
      >
        <div className="flex min-h-[52px] shrink-0 items-center gap-2 border-b border-border py-2 pl-5 pr-3">
          <div className="flex min-w-0 flex-1 flex-col">
            <SheetTitle ref={titleRef} tabIndex={-1} className="text-md font-semibold leading-tight text-foreground outline-none">
              {title}
            </SheetTitle>
            {subtitle ? (
              <SheetDescription title={subtitle} className="truncate text-xs">
                {subtitle}
              </SheetDescription>
            ) : (
              <SheetDescription className="sr-only">Choisissez une séquence, puis inscrivez les candidats.</SheetDescription>
            )}
          </div>
          <SheetClose asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Fermer le panneau"
              className="min-h-11 min-w-11 shrink-0 lg:min-h-0 lg:min-w-0"
              disabled={busy}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </SheetClose>
        </div>
        {above && <div className="shrink-0 border-b border-border px-4 py-3 sm:px-5">{above}</div>}
        {/* C'est ce conteneur qui défile : le pied de ContactFlow est collé en bas et a besoin d'un ancêtre qui défile. */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <SectionErrorBoundary fallbackTitle="Le panneau Contacter n'a pas pu s'afficher">
            <ContactFlow
              missionId={missionId}
              job={job}
              candidates={candidates}
              candidatesStatus="ready"
              overflow={overflow}
              accountId={accountId}
              notice={notice}
              preferredSequenceId={preferredSequenceId}
              emptyHint={emptyHint}
              leaveLabel={null}
              onLeave={() => guard(false)}
              onBusyChange={setBusy}
              onEnrolled={(handledIds) => {
                // L'appelant d'abord, puis la fermeture : sans passer par le garde, l'écriture est finie.
                onEnrolled(handledIds);
                onOpenChange(false);
              }}
              onChanged={onChanged}
              onOpenCandidate={onOpenCandidate}
            />
          </SectionErrorBoundary>
        </div>
      </SheetContent>
    </Sheet>
  );
}
