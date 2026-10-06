/**
 * Calls : les appels dont le numéro ne correspond à aucun candidat.
 *
 * Une ligne par numéro inconnu, avec le recruteur de l'équipe qui l'a appelé ou
 * rappelé. « Rattacher » enregistre le numéro sur la fiche d'un candidat : tous
 * les appels de ce numéro, passés et à venir, y apparaissent.
 *
 * « Mes appels » (par défaut) : les miens, et ceux que personne n'a décrochés
 * (un candidat qui rappelle tombe là). « Équipe » : tous.
 * Les appels viennent de l'opérateur relié dans Réglages (table phone_calls).
 * Une lecture en échec s'affiche comme une erreur avec « Réessayer », jamais
 * comme une liste vide.
 */
import { useMemo, useState } from 'react';
import { SEOHead } from '@/components/SEOHead';
import { EmptyState, ErrorState, PageHeader, PageLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { AttachCallDialog } from '@/components/calls/AttachCallDialog';
import { UnattachedCallsList } from '@/components/calls/UnattachedCallsList';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useCallRecruiter } from '@/hooks/useCallRecruiter';
import { useUnattachedCalls } from '@/hooks/useUnattachedCalls';
import { isOwnCall } from '@/lib/callRecruiter';
import { keepCalls, type UnattachedCallGroup } from '@/lib/phoneCallGroups';
import type { PhoneCall } from '@/lib/phoneCalls';
import { plural } from '@/lib/plural';

type Scope = 'mine' | 'team';

const SCOPE_OPTIONS: SegmentedOption<Scope>[] = [
  { value: 'mine', label: 'Mes appels', title: "Vos appels, et ceux que personne n'a décrochés" },
  { value: 'team', label: 'Équipe', title: "Les appels de toute l'équipe" },
];

export default function CallsPage() {
  const { user } = useAuthReady();
  const resolveRecruiter = useCallRecruiter();
  const { groups, totalCalls, isLoading, isError, error, refetch, isRefetching } = useUnattachedCalls();
  const [scope, setScope] = useState<Scope>('mine');
  const [attaching, setAttaching] = useState<UnattachedCallGroup | null>(null);

  const userEmail = user?.email;
  const mine = useMemo(
    () => keepCalls(groups, (call: PhoneCall) => isOwnCall(userEmail, call.agentEmail) || (!call.agentEmail && !call.agentName)),
    [groups, userEmail],
  );
  const shown = scope === 'mine' ? mine : groups;
  const callCount = shown.reduce((sum, g) => sum + g.calls.length, 0);

  // Pas de zéro : sans appel à rattacher, l'état vide parle.
  const subtitle = isLoading || isError || shown.length === 0
    ? undefined
    : `${plural(shown.length, 'numéro inconnu', 'numéros inconnus')}, ${plural(callCount, 'appel')}.`;

  return (
    <PageLayout maxWidth="lg">
      <SEOHead title="Appels | Konekt" description="Les appels à rattacher à un candidat" />

      <PageHeader title="Appels" subtitle={subtitle} />

      {/* Toujours affiché : un collègue qui n'est pas membre de Konekt n'apparaît que dans « Équipe ». */}
      <div className="mb-8">
        <SegmentedControl aria-label="Périmètre des appels" value={scope} onValueChange={(next) => setScope(next)} options={SCOPE_OPTIONS} />
      </div>

      {isLoading ? (
        <div className="space-y-2" role="status" aria-label="Chargement des appels">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : isError ? (
        <ErrorState
          title="Impossible de charger les appels"
          description="Vérifiez votre connexion, puis réessayez. Vos appels ne sont pas perdus."
          detail={error}
          onRetry={() => { void refetch(); }}
          retrying={isRefetching}
        />
      ) : totalCalls === 0 ? (
        <EmptyState
          illustration="conversation"
          title="Aucun appel reçu pour l'instant"
          headingLevel={2}
          description="Les appels terminés de votre compte Aircall apparaissent ici dès qu'il est relié, dans Réglages."
        />
      ) : shown.length === 0 ? (
        <EmptyState
          illustration="valide"
          title="Rien à rattacher"
          headingLevel={2}
          description={scope === 'mine' ? 'Tous vos appels sont rattachés à un candidat.' : "Tous les appels de l'équipe sont rattachés à un candidat."}
          action={
            scope === 'mine' && groups.length > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setScope('team')} className="min-h-11 md:min-h-0">
                Voir l'équipe
              </Button>
            ) : undefined
          }
        />
      ) : (
        <UnattachedCallsList groups={shown} resolveRecruiter={resolveRecruiter} onAttach={setAttaching} />
      )}

      <AttachCallDialog group={attaching} onOpenChange={(open) => { if (!open) setAttaching(null); }} />
    </PageLayout>
  );
}
