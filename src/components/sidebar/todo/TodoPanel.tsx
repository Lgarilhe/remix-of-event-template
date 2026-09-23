/**
 * Panneau À traiter (§4), sections dans un ordre fixe : panne LinkedIn,
 * Premiers pas, Entretiens aujourd'hui, Comptes rendus à faire, Réponses de
 * candidats (toujours présente), À valider, Pour vous, Activité (repliée,
 * toujours présente). Une section vide ne s'affiche pas, sauf Réponses et
 * Activité.
 *
 * « Rien à traiter pour le moment. » (sous Réponses) seulement si la panne et
 * les sections 2 à 6 sont toutes chargées et vides, et les Premiers pas
 * absents (masqués ou finis). Une source en chargement, hors ligne ou en
 * erreur l'empêche toujours (D9).
 */
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useFirstStepsFlag } from '@/hooks/sidebar/useFirstSteps';
import { useLinkedInOutage } from '@/hooks/sidebar/useLinkedInOutage';
import { useTodoInterviews } from '@/hooks/sidebar/useTodoInterviews';
import { useSidebarNotifications } from '@/hooks/sidebar/useSidebarNotifications';
import { useAgentSignals } from '@/hooks/sidebar/useAgentSignals';
import { FIRST_STEPS_DONE_KEY, FIRST_STEPS_HIDDEN_KEY } from '@/lib/firstSteps';
import { LinkedInOutageSection } from './LinkedInOutageSection';
import { FirstStepsSection } from './FirstStepsSection';
import { InterviewsSections } from './InterviewsSections';
import { RepliesSection } from './RepliesSection';
import { ApprovalsSection } from './ApprovalsSection';
import { ForYouSection } from './ForYouSection';
import { ActivitySection } from './ActivitySection';

export function TodoPanel() {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const [firstStepsDone] = useFirstStepsFlag(organizationId && userId ? FIRST_STEPS_DONE_KEY(organizationId, userId) : null);
  const [firstStepsHidden] = useFirstStepsFlag(organizationId && userId ? FIRST_STEPS_HIDDEN_KEY(organizationId, userId) : null);

  const linkedin = useLinkedInOutage();
  const interviews = useTodoInterviews();
  const { replies, forYou } = useSidebarNotifications();
  const signals = useAgentSignals();

  // Premiers pas : absents seulement s'ils sont masqués ou finis (tous cochés
  // écrit la clé « finis »). Sinon ils sont affichés ou en chargement.
  const firstStepsAbsent = firstStepsDone || firstStepsHidden;

  const nothingToDo =
    firstStepsAbsent &&
    linkedin.status === 'ok' && !linkedin.outage &&
    interviews.status === 'ok' && interviews.today.length === 0 && interviews.debriefs.length === 0 &&
    replies.status === 'ok' && !!replies.data && replies.data.candidates.length === 0 && replies.data.others === 0 &&
    signals.status === 'ok' && signals.actions.length === 0 && signals.plans.length === 0 &&
    forYou.status === 'ok' && !!forYou.data && forYou.data.actions.length === 0;

  return (
    <div className="flex flex-col gap-1">
      <LinkedInOutageSection />
      <FirstStepsSection />
      <InterviewsSections />
      <RepliesSection />
      {nothingToDo && (
        <p className="px-3 py-2 text-[12px] text-muted-foreground">Rien à traiter pour le moment.</p>
      )}
      <ApprovalsSection variant="todo" />
      <ForYouSection />
      <ActivitySection />
    </div>
  );
}
