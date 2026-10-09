/**
 * ThreadNextStep — ligne « À faire » au-dessus du composeur.
 *
 * Elle n'apparaît que si la main est à vous : le candidat a écrit le dernier
 * message (« À répondre ») ou vous attendez sa réponse depuis trois jours
 * ouvrés (« À relancer »), mêmes états que les onglets de la liste
 * (src/lib/inboxThreadState.ts). Elle dit depuis quand, rappelle l'action que
 * l'analyse IA a déjà mise en cache pour un message du candidat (rien n'est
 * relancé ici), et propose deux gestes :
 * - rédiger la réponse ou la relance : la suite se relit dans le dialogue de
 *   « Proposer une suite », puis s'insère dans le composeur. Rien ne part sans
 *   votre envoi ;
 * - créer un rappel : une tâche « Relance » préremplie pour le prochain jour
 *   ouvré à 9 h.
 *
 * Sur téléphone, la ligne s'efface quand le champ de saisie a le focus : le
 * clavier prend la moitié de l'écran et la ligne laisserait moins d'un message
 * visible. Le parent pose `group/compose` sur la rangée qui réunit la ligne et
 * le composeur.
 */

import React, { Suspense, lazy, useState } from 'react';
import { CalendarClock, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { SuggestedAction } from '@/lib/inboxThreadState';
import { threadWaitingSentence } from '@/lib/inboxThreadSentence';
import { CtaReplyButton, type CtaReplyButtonProps } from './CtaReplyButton';

// La fenêtre de tâche ne se charge qu'à l'ouverture : elle reste hors du lot de la messagerie.
const CreateTaskModal = lazy(() =>
  import('@/components/tasks/CreateTaskModal').then((m) => ({ default: m.CreateTaskModal })),
);

/** Prochain jour ouvré à 9 h. */
function nextBusinessMorning(from: Date): Date {
  const d = new Date(from.getTime());
  do {
    d.setDate(d.getDate() + 1);
  } while (d.getDay() === 0 || d.getDay() === 6);
  d.setHours(9, 0, 0, 0);
  return d;
}

interface ThreadNextStepProps
  extends Pick<
    CtaReplyButtonProps,
    'chatHistory' | 'candidateName' | 'recruiterName' | 'jobTitle' | 'jobBrief' | 'calendlyLink' | 'tone' | 'onInsert'
  > {
  state: 'to_reply' | 'to_follow_up';
  /** Jours ouvrés depuis le dernier message. */
  days: number | null;
  /** Action déjà mise en cache par l'analyse IA, seulement pour « À répondre ». */
  suggestion: SuggestedAction | null;
}

/** Monté avec `key` = identifiant de la conversation : l'état repart de zéro quand on en change. */
export const ThreadNextStep: React.FC<ThreadNextStepProps> = ({
  state,
  days,
  suggestion,
  candidateName,
  jobTitle,
  ...ctaProps
}) => {
  const [taskOpen, setTaskOpen] = useState(false);
  const sentence = threadWaitingSentence(state, days);
  // Figée au montage : la fenêtre de tâche réécrit ses champs quand cette date change.
  const [dueAt] = useState(() => nextBusinessMorning(new Date()));
  const name = candidateName?.trim() || 'le candidat';

  return (
    <section
      aria-label="À faire pour cette conversation"
      className="border-t border-border bg-muted px-3 py-2 group-has-[textarea:focus]/compose:max-md:hidden md:px-5"
    >
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-60">
          <p className="text-sm text-foreground">{sentence}</p>
          {suggestion && (
            <p className="mt-0.5 flex items-start gap-1.5 text-xs text-muted-foreground">
              <Sparkles className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
              <span>
                <span className="font-medium text-foreground-secondary">Suggestion de l'IA Konekt : </span>
                {suggestion.label}
              </span>
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CtaReplyButton
            {...ctaProps}
            candidateName={candidateName}
            jobTitle={jobTitle}
            presetCta={state === 'to_reply' ? 'auto' : 'check_interest'}
            triggerLabel={state === 'to_reply' ? 'Rédiger une réponse' : 'Rédiger une relance'}
          />
          <Button type="button" variant="outline" size="sm" className="max-md:h-11" onClick={() => setTaskOpen(true)}>
            <CalendarClock aria-hidden="true" />
            Créer un rappel
          </Button>
        </div>
      </div>

      {taskOpen && (
        <Suspense fallback={null}>
          <CreateTaskModal
            open
            onOpenChange={setTaskOpen}
            prefillTitle={state === 'to_reply' ? `Répondre à ${name}` : `Relancer ${name}`}
            prefillDescription={`Conversation LinkedIn avec ${name}${jobTitle ? ` (${jobTitle})` : ''}. ${sentence ?? ''}`.trim()}
            prefillCategory="follow_up"
            prefillDueAt={dueAt}
          />
        </Suspense>
      )}
    </section>
  );
};
