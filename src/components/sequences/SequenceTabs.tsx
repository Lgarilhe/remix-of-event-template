// Onglets de la page d'une séquence (lot 5c-2), lus et écrits dans ?onglet=.
// « Statistiques » et « Journal » n'apparaissent qu'après la première
// inscription ; le compteur de « Candidats » ne s'écrit pas à zéro. Un point
// rouge sur « Journal » signale un envoi en échec ; sur « Étapes » ou
// « Réglages », un point bloquant de l'éditeur (lot 5d-2). Sur téléphone, la rangée
// défile et ramène l'onglet actif dans la vue (lien « 1 candidat en échec »,
// « Diagnostic des envois », adresse ?onglet=reglages).
import { useEffect, useRef } from 'react';
import { TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { SEQUENCE_TABS, visibleSequenceTabs } from './sequenceTabsModel';

const TAB_TRIGGER_CLASS = cn(
  'relative h-full shrink-0 bg-transparent px-3 text-muted-foreground max-md:min-h-11',
  'after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0',
  'data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:ring-0 data-[state=active]:after:opacity-100',
  // La rangée défile (overflow-x-auto) : l'anneau de focus est tracé à l'intérieur, sinon elle le rogne.
  'focus-visible:ring-inset focus-visible:ring-offset-0',
);

interface SequenceTabsProps {
  /** Onglet affiché : ramené dans la vue de la rangée quand elle défile. */
  active: string;
  hasEnrollments: boolean;
  /** Inscrits de la séquence ; null si le compteur est illisible ou en lecture. */
  candidateCount: number | null;
  journalAlert: boolean;
  /** Point bloquant dans les étapes (validateSequence). */
  stepsAlert?: boolean;
  /** Point bloquant dans les expéditeurs (validateSequence). */
  settingsAlert?: boolean;
  /** Onglets montrés (création : Étapes et Réglages) ; par défaut, selon les inscriptions. */
  only?: readonly string[];
}

function AlertDot({ text }: { text: string }) {
  return (
    <>
      <span className="ml-1.5 h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />
      <span className="sr-only"> ({text})</span>
    </>
  );
}

export function SequenceTabs({ active, hasEnrollments, candidateCount, journalAlert, stepsAlert = false, settingsAlert = false, only }: SequenceTabsProps) {
  const visible = only ?? visibleSequenceTabs(hasEnrollments);
  const listRef = useRef<HTMLDivElement>(null);
  // Défilement horizontal de la seule rangée : jamais de saut vertical de la page.
  useEffect(() => {
    const list = listRef.current;
    const trigger = list?.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
    if (!list || !trigger) return;
    const listBox = list.getBoundingClientRect();
    const box = trigger.getBoundingClientRect();
    const margin = 16;
    if (box.left < listBox.left) list.scrollLeft -= listBox.left - box.left + margin;
    else if (box.right > listBox.right) list.scrollLeft += box.right - listBox.right + margin;
  }, [active, hasEnrollments]);
  return (
    <div className="border-b border-border">
      {/* Pleine largeur : la rangée défile au lieu de déborder sur téléphone. */}
      <TabsList ref={listRef} className="-mb-px flex h-11 w-full justify-start gap-1 overflow-x-auto bg-transparent p-0 scrollbar-hide">
        {SEQUENCE_TABS.filter((t) => visible.includes(t.value)).map(({ value, label }) => (
          <TabsTrigger key={value} value={value} className={TAB_TRIGGER_CLASS}>
            {label}
            {value === 'candidats' && candidateCount !== null && candidateCount > 0 && (
              <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{candidateCount}</span>
            )}
            {value === 'journal' && journalAlert && <AlertDot text="envois en échec" />}
            {value === 'etapes' && stepsAlert && <AlertDot text="point à corriger" />}
            {value === 'reglages' && settingsAlert && <AlertDot text="point à corriger" />}
          </TabsTrigger>
        ))}
      </TabsList>
    </div>
  );
}
