import { lazy, Suspense } from 'react';
import { Loader2 } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import type { InboxCandidateSheetProps } from './InboxCandidateSheet';

const CandidateSheet = lazy(() => import('./InboxCandidateSheet').then(module => ({ default: module.InboxCandidateSheet })));

/** Les onglets métier de la fiche se chargent seulement à son ouverture. */
export function LazyInboxCandidateSheet(props: InboxCandidateSheetProps) {
  return <Suspense fallback={<Sheet open onOpenChange={open => { if (!open) props.onClose(); }}>
    <SheetContent className="!w-full !max-w-[100vw] min-w-0 bg-background sm:!w-[95vw] sm:!max-w-[720px]" onCloseAutoFocus={event => {
      // Le chargement terminé ouvre la vraie fiche ; une fermeture revient au fil.
      if (document.querySelector('[role="dialog"][data-state="open"]')) event.preventDefault();
      else props.onCloseAutoFocus?.(event);
    }}>
      <SheetHeader className="pr-10 text-left"><SheetTitle>Fiche candidat</SheetTitle><SheetDescription>Profil et suivi du candidat.</SheetDescription></SheetHeader>
      <p role="status" className="mt-6 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />Ouverture de la fiche…</p>
    </SheetContent>
  </Sheet>}><CandidateSheet {...props} /></Suspense>;
}
