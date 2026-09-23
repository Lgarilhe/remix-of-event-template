/**
 * Premiers pas (§7.3, D13), en tête du panneau À traiter, après la panne.
 *
 * - Masquée d'un clic (« Masquer », sans confirmation : rien de destructif).
 * - Finie : quand toutes les étapes sont cochées, FIRST_STEPS_DONE_KEY vaut '1' ;
 *   aux chargements suivants la section n'est pas rendue du tout, ni lignes
 *   grises ni lectures (la clé est lue avant tout rendu de chargement).
 * - Étape faite : coche verte, texte grisé, non cliquable. Étape à faire : lien.
 */
import { useEffect } from 'react';
import {
  Briefcase,
  CalendarPlus,
  CheckCircle2,
  Handshake,
  Link2,
  Search,
  UserPlus,
  type LucideIcon,
} from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useFirstSteps, useFirstStepsFlag } from '@/hooks/sidebar/useFirstSteps';
import {
  FIRST_STEPS_DONE_KEY,
  FIRST_STEPS_HIDDEN_KEY,
  type FirstStepId,
} from '@/lib/firstSteps';
import { SidebarSection } from '../SidebarSection';
import { SidebarRow } from '../SidebarRow';

const STEP_LABELS: Record<FirstStepId, string> = {
  create_mission: 'Créer une première mission',
  create_job: 'Créer un premier poste',
  link_linkedin: 'Relier votre compte LinkedIn',
  first_search: 'Lancer une première recherche',
  invite_team: 'Inviter votre équipe',
  invite_partner: 'Inviter un cabinet ou publier sur la marketplace',
  schedule_interview: 'Planifier un entretien',
};

const STEP_ICONS: Record<FirstStepId, LucideIcon> = {
  create_mission: Briefcase,
  create_job: Briefcase,
  link_linkedin: Link2,
  first_search: Search,
  invite_team: UserPlus,
  invite_partner: Handshake,
  schedule_interview: CalendarPlus,
};

interface TargetContext {
  canCreateJob: boolean;
  firstOwnMissionId: string | null;
}

/** Cible de chaque étape ; aucune ancre (#). */
function stepTarget(id: FirstStepId, ctx: TargetContext): string {
  switch (id) {
    case 'create_mission':
    case 'create_job':
      return ctx.canCreateJob ? '/missions?create=brief' : '/missions';
    case 'link_linkedin':
      return '/settings/account/connections';
    case 'first_search':
      return ctx.firstOwnMissionId ? `/missions/${ctx.firstOwnMissionId}?tab=sourcing` : '/sourcing';
    case 'invite_team':
      return '/settings/org/team';
    case 'invite_partner':
      // L'invitation par e-mail est dans Process ; la publication, dans Configuration (phase 1, jamais verrouillées).
      return ctx.firstOwnMissionId ? `/missions/${ctx.firstOwnMissionId}?tab=process` : '/missions';
    case 'schedule_interview':
      return '/calendar';
  }
}

const HIDE_BUTTON_CLASS =
  'inline-flex items-center justify-center rounded-md px-2 min-h-11 md:min-h-7 text-[12px] font-medium ' +
  'text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/60 ' +
  'outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring';

export function FirstStepsSection() {
  const { organizationId, orgType } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;

  const doneKey = organizationId && userId ? FIRST_STEPS_DONE_KEY(organizationId, userId) : null;
  const hiddenKey = organizationId && userId ? FIRST_STEPS_HIDDEN_KEY(organizationId, userId) : null;
  const [done, markDone] = useFirstStepsFlag(doneKey);
  const [hidden, hide] = useFirstStepsFlag(hiddenKey);

  // Avant tout rendu de chargement : finie ou masquée, rien n'est rendu ni lu.
  if (!doneKey || !orgType || done || hidden) return null;

  return <FirstStepsContent key={doneKey} onHide={hide} onAllDone={markDone} />;
}

interface FirstStepsContentProps {
  onHide: () => void;
  onAllDone: () => void;
}

function FirstStepsContent({ onHide, onAllDone }: FirstStepsContentProps) {
  const { status, stale, retry, steps, allDone, firstOwnMissionId, canCreateJob } = useFirstSteps({ enabled: true });

  const finished = status === 'ok' && allDone;
  useEffect(() => {
    if (finished) onAllDone();
  }, [finished, onAllDone]);

  if (finished) return null;

  const doneCount = steps.filter((s) => s.done).length;

  const headerAction = (
    <>
      {status === 'ok' && steps.length > 0 && (
        <span className="px-1 text-[11px] tabular-nums text-muted-foreground">
          {doneCount} sur {steps.length}
        </span>
      )}
      <button type="button" onClick={onHide} aria-label="Masquer les premiers pas" className={HIDE_BUTTON_CLASS}>
        Masquer
      </button>
    </>
  );

  return (
    <SidebarSection
      id="first-steps"
      title="Premiers pas"
      state={status}
      stale={stale}
      onRetry={retry}
      isEmpty={steps.length === 0}
      headerAction={headerAction}
      errorText="Impossible de vérifier vos premiers pas."
      loadingRows={2}
    >
      {steps.map((step) => {
        if (step.done) {
          return (
            <SidebarRow
              key={step.id}
              leading={<CheckCircle2 className="text-green-600 dark:text-green-500" />}
              title={STEP_LABELS[step.id]}
              muted
            />
          );
        }
        const Icon = STEP_ICONS[step.id];
        const sub = step.id === 'invite_partner' ? 'Inviter : Process. Publier : Configuration.' : null;
        return (
          <SidebarRow
            key={step.id}
            leading={<Icon />}
            title={STEP_LABELS[step.id]}
            sub={sub}
            to={stepTarget(step.id, { canCreateJob, firstOwnMissionId })}
          />
        );
      })}
    </SidebarSection>
  );
}
