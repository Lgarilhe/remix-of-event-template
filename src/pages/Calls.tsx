/**
 * Calls : le centre des appels.
 *
 *   - Vue d'ensemble : chiffres clés, appels par jour, par recruteur, meilleurs
 *     créneaux, appels manqués à rappeler (src/components/calls/CallsOverview.tsx) ;
 *   - Tous les appels : la liste, ses filtres, le détail d'un appel ;
 *   - À rattacher : les numéros inconnus, avec « Rattacher » (lot A2).
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { AttachCallDialog } from '@/components/calls/AttachCallDialog';
import { CallDetailSheet } from '@/components/calls/CallDetailSheet';
import { CallsOverview } from '@/components/calls/CallsOverview';
import { CallsTable } from '@/components/calls/CallsTable';
import { UnattachedCallsList } from '@/components/calls/UnattachedCallsList';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useCallRecruiter } from '@/hooks/useCallRecruiter';
import { useCallsHub } from '@/hooks/useCallsHub';
import { useUnattachedCalls } from '@/hooks/useUnattachedCalls';
import { isOwnCall } from '@/lib/callRecruiter';
import { callTitle, groupUnattachedCalls, keepCalls, type UnattachedCallGroup } from '@/lib/phoneCallGroups';
import { statsByRecruiter } from '@/lib/phoneCallStats';
import type { PhoneCall } from '@/lib/phoneCalls';
import { plural } from '@/lib/plural';

type Tab = 'overview' | 'all' | 'unattached';
type Scope = 'mine' | 'team';

const SCOPE_OPTIONS: SegmentedOption<Scope>[] = [
  { value: 'mine', label: 'Mes appels', title: "Vos appels, et ceux que personne n'a décrochés" },
  { value: 'team', label: 'Équipe', title: "Les appels de toute l'équipe" },
];

const PERIODS = [7, 30, 90] as const;

export default function CallsPage() {
  const { user } = useAuthReady();
  const resolveRecruiter = useCallRecruiter();
  const [tab, setTab] = useState<Tab>('overview');
  const [scope, setScope] = useState<Scope>('mine');
  const [days, setDays] = useState<number>(30);
  const [attaching, setAttaching] = useState<UnattachedCallGroup | null>(null);
  const [openCall, setOpenCall] = useState<PhoneCall | null>(null);

  const hub = useCallsHub(days);
  const unattached = useUnattachedCalls();

  const userEmail = user?.email;
  // Mes appels : les miens, et ceux que personne n'a décrochés.
  const belongsToMe = useMemo(
    () => (call: PhoneCall) => isOwnCall(userEmail, call.agentEmail) || (!call.agentEmail && !call.agentName),
    [userEmail],
  );

  const scopedCalls = useMemo(
    () => (scope === 'mine' ? hub.calls.filter(belongsToMe) : hub.calls),
    [hub.calls, scope, belongsToMe],
  );
  const mineGroups = useMemo(() => keepCalls(unattached.groups, belongsToMe), [unattached.groups, belongsToMe]);
  const unattachedShown = scope === 'mine' ? mineGroups : unattached.groups;
  const unattachedCallCount = unattachedShown.reduce((sum, g) => sum + g.calls.length, 0);

  // Les recruteurs proposés au filtre de la liste : ceux qui ont des appels dans le périmètre.
  const recruiterOptions = useMemo(
    () => statsByRecruiter(scopedCalls, resolveRecruiter).map((r) => ({ key: r.key, name: r.name })),
    [scopedCalls, resolveRecruiter],
  );

  const tabOptions: SegmentedOption<Tab>[] = [
    { value: 'overview', label: "Vue d'ensemble" },
    { value: 'all', label: 'Tous les appels' },
    { value: 'unattached', label: unattachedShown.length > 0 ? `À rattacher (${unattachedShown.length})` : 'À rattacher' },
  ];

  // Pas de zéro : sans appel, l'état vide parle.
  const subtitle = tab === 'unattached'
    ? (unattached.isLoading || unattached.isError || unattachedShown.length === 0
      ? undefined
      : `${plural(unattachedShown.length, 'numéro inconnu', 'numéros inconnus')}, ${plural(unattachedCallCount, 'appel')}.`)
    : (hub.isLoading || hub.isError || scopedCalls.length === 0
      ? undefined
      : `${plural(scopedCalls.length, 'appel')} sur les ${days} derniers jours.`);

  const groupFor = (call: PhoneCall): UnattachedCallGroup | null =>
    call.numberE164
      ? groupUnattachedCalls(hub.calls.filter((c) => c.numberE164 === call.numberE164), new Set())[0] ?? null
      : null;

  const loading = (label: string) => (
    <div className="space-y-2" role="status" aria-label={label}>
      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 rounded-lg" />)}
    </div>
  );

  const hubView = () => {
    if (hub.isLoading) return loading('Chargement des appels');
    if (hub.isError) {
      return (
        <ErrorState
          title="Impossible de charger les appels"
          description="Vérifiez votre connexion, puis réessayez. Vos appels ne sont pas perdus."
          detail={hub.error}
          onRetry={() => { void hub.refetch(); }}
          retrying={hub.isRefetching}
        />
      );
    }
    if (hub.calls.length === 0) {
      return (
        <EmptyState
          illustration="conversation"
          title="Aucun appel reçu pour l'instant"
          headingLevel={2}
          description="Les appels terminés de votre compte Aircall apparaissent ici dès qu'il est relié, dans Réglages."
        />
      );
    }
    return tab === 'overview' ? (
      <CallsOverview calls={scopedCalls} attached={hub.attached} days={days} resolveRecruiter={resolveRecruiter} />
    ) : (
      <CallsTable
        calls={scopedCalls}
        attached={hub.attached}
        resolveRecruiter={resolveRecruiter}
        recruiterOptions={scope === 'team' ? recruiterOptions : []}
        onOpen={setOpenCall}
      />
    );
  };

  const unattachedView = () => {
    if (unattached.isLoading) return loading('Chargement des appels');
    if (unattached.isError) {
      return (
        <ErrorState
          title="Impossible de charger les appels"
          description="Vérifiez votre connexion, puis réessayez. Vos appels ne sont pas perdus."
          detail={unattached.error}
          onRetry={() => { void unattached.refetch(); }}
          retrying={unattached.isRefetching}
        />
      );
    }
    if (unattached.totalCalls === 0) {
      return (
        <EmptyState
          illustration="conversation"
          title="Aucun appel reçu pour l'instant"
          headingLevel={2}
          description="Les appels terminés de votre compte Aircall apparaissent ici dès qu'il est relié, dans Réglages."
        />
      );
    }
    if (unattachedShown.length === 0) {
      return (
        <EmptyState
          illustration="valide"
          title="Rien à rattacher"
          headingLevel={2}
          description={scope === 'mine' ? 'Tous vos appels sont rattachés à un candidat.' : "Tous les appels de l'équipe sont rattachés à un candidat."}
          action={
            scope === 'mine' && unattached.groups.length > 0 ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setScope('team')} className="min-h-11 md:min-h-0">
                Voir l'équipe
              </Button>
            ) : undefined
          }
        />
      );
    }
    return <UnattachedCallsList groups={unattachedShown} resolveRecruiter={resolveRecruiter} onAttach={setAttaching} />;
  };

  const openKnown = openCall?.numberE164 ? hub.attached.get(openCall.numberE164) : undefined;

  return (
    <PageLayout maxWidth="lg">
      <SEOHead title="Appels | Konekt" description="Les appels de l'équipe, leurs statistiques et les numéros à rattacher" />

      <PageHeader title="Appels" subtitle={subtitle} />

      <div className="mb-8 flex flex-wrap items-center justify-between gap-3">
        <SegmentedControl aria-label="Affichage des appels" value={tab} onValueChange={(next) => setTab(next)} options={tabOptions} />
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl aria-label="Périmètre des appels" value={scope} onValueChange={(next) => setScope(next)} options={SCOPE_OPTIONS} />
          {tab !== 'unattached' && (
            <Select value={String(days)} onValueChange={(v) => setDays(Number(v))}>
              <SelectTrigger aria-label="Période" className="h-8 w-auto min-w-[10rem] gap-2 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PERIODS.map((d) => (
                  <SelectItem key={d} value={String(d)}>{d} derniers jours</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {tab === 'unattached' ? unattachedView() : hubView()}

      <CallDetailSheet
        call={openCall}
        attached={openKnown}
        recruiter={openCall ? resolveRecruiter(openCall.agentEmail, openCall.agentName) : null}
        title={openCall ? callTitle(openCall, openKnown) : ''}
        onOpenChange={(open) => { if (!open) setOpenCall(null); }}
        onAttach={openCall && !openKnown && groupFor(openCall) ? () => {
          const group = groupFor(openCall);
          setOpenCall(null);
          if (group) setAttaching(group);
        } : undefined}
      />
      <AttachCallDialog group={attaching} onOpenChange={(open) => { if (!open) setAttaching(null); }} />
    </PageLayout>
  );
}
