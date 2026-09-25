/**
 * PartnerMarketplace : vue d'un recruteur partenaire validé sur /marketplace.
 * Trois onglets : missions ouvertes (candidature), mes candidatures, missions
 * en cours (équipe d'une mission d'une autre organisation).
 */

import React, { useId, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight, Building2, Calendar, FileText, Handshake, MapPin, Percent, Search, Target, Users,
} from 'lucide-react';
import {
  useOpenHuntMissions,
  useMyHuntApplications,
  usePartnerMissions,
  type OpenHuntMission,
  type MyHuntApplication,
} from '@/hooks/useMarketplace';
import { EmptyState } from '@/components/layout/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  CONTRACT_LABELS, REMOTE_LABELS, applicationStatusLabel, applicationStatusVariant, huntStatusLabel,
  huntStatusVariant, formatDate,
} from './huntLabels';
import { ErrorBox } from './ErrorBox';
import { CardsSkeleton, RowsSkeleton } from './MarketplaceSkeleton';

type TabKey = 'open' | 'applications' | 'missions';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'open', label: 'Missions ouvertes' },
  { key: 'applications', label: 'Mes candidatures' },
  { key: 'missions', label: 'Missions en cours' },
];

const ALL = 'all';

const bountyText = (percent: number | null) =>
  percent != null ? `${percent} % du salaire annuel` : "Rémunération à confirmer avec l'entreprise";

// État d'une candidature, à la place du bouton « Postuler »
const ApplicationBadge: React.FC<{ status: string }> = ({ status }) => (
  <div className="flex h-8 items-center justify-center">
    <Badge variant={applicationStatusVariant(status)}>
      {status === 'pending'
        ? 'Candidature envoyée'
        : status === 'ended'
          ? 'Collaboration terminée'
          : `Candidature ${applicationStatusLabel(status).toLowerCase()}`}
    </Badge>
  </div>
);

// ---------------------------------------------------------------------------
// Onglet « Missions ouvertes »
// ---------------------------------------------------------------------------

const OpenMissionsTab: React.FC = () => {
  const { missions, isLoading, isError, errorText, refetch, apply, isApplying } = useOpenHuntMissions(true);
  const [search, setSearch] = useState('');
  const [filterContract, setFilterContract] = useState('');
  const [filterRemote, setFilterRemote] = useState('');
  const [target, setTarget] = useState<OpenHuntMission | null>(null);
  const [message, setMessage] = useState('');
  const searchId = useId();
  const contractId = useId();
  const remoteId = useId();
  const messageId = useId();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return missions.filter((m) => {
      const jd = m.job_details ?? {};
      const matchesSearch = !q
        || m.name.toLowerCase().includes(q)
        || (m.client_name ?? '').toLowerCase().includes(q)
        || (m.organization_name ?? '').toLowerCase().includes(q)
        || (jd.title ?? '').toLowerCase().includes(q)
        || (jd.location ?? '').toLowerCase().includes(q);
      const matchesContract = !filterContract || jd.contract_type === filterContract;
      const matchesRemote = !filterRemote || jd.remote_policy === filterRemote;
      return matchesSearch && matchesContract && matchesRemote;
    });
  }, [missions, search, filterContract, filterRemote]);

  const hasFilters = !!(search.trim() || filterContract || filterRemote);
  const resetFilters = () => {
    setSearch('');
    setFilterContract('');
    setFilterRemote('');
  };

  const handleApply = async () => {
    if (!target) return;
    try {
      await apply(target.id, message);
      setTarget(null);
      setMessage('');
    } catch {
      // Erreur déjà affichée par le hook
    }
  };

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative min-w-52 max-w-sm flex-1">
          <Label htmlFor={searchId} className="sr-only">Rechercher une mission</Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={searchId}
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Poste, entreprise ou ville"
            className="h-11 pl-9 md:h-9"
          />
        </div>
        <Label htmlFor={contractId} className="sr-only">Type de contrat</Label>
        <Select value={filterContract || ALL} onValueChange={(v) => setFilterContract(v === ALL ? '' : v)}>
          <SelectTrigger id={contractId} className="h-11 w-auto min-w-40 md:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les contrats</SelectItem>
            {Object.entries(CONTRACT_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor={remoteId} className="sr-only">Mode de travail</Label>
        <Select value={filterRemote || ALL} onValueChange={(v) => setFilterRemote(v === ALL ? '' : v)}>
          <SelectTrigger id={remoteId} className="h-11 w-auto min-w-40 md:h-9">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>Tous les modes</SelectItem>
            {Object.entries(REMOTE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!isLoading && !isError && (
          <p className="text-sm text-muted-foreground sm:ml-auto" aria-live="polite">
            {filtered.length} mission{filtered.length > 1 ? 's' : ''}
          </p>
        )}
      </div>

      {isLoading ? (
        <CardsSkeleton />
      ) : isError ? (
        <ErrorBox
          title="Impossible de charger les missions ouvertes."
          detail={errorText}
          onRetry={refetch}
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Target}
          title={missions.length === 0 ? 'Aucune mission ouverte' : 'Aucune mission pour ces filtres'}
          description={missions.length === 0
            ? 'Aucune entreprise ne propose de mission pour le moment. Les nouvelles missions apparaîtront ici.'
            : 'Élargissez la recherche ou retirez un filtre.'}
          action={hasFilters && missions.length > 0 ? (
            <Button variant="outline" size="sm" onClick={resetFilters} className="min-h-11 md:min-h-0">Effacer les filtres</Button>
          ) : undefined}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((mission) => {
            const jd = mission.job_details ?? {};
            const skills = jd.skills_must_have ?? [];
            const max = mission.hunt_max_recruiters ?? 3;
            const full = mission.accepted_count >= max;
            return (
              <Card key={mission.id} className="flex flex-col shadow-none transition-colors duration-150 hover:border-border-strong">
                <div className="flex-1 space-y-3 p-4">
                  <div>
                    <h3 className="text-md font-semibold text-foreground">{jd.title || mission.name}</h3>
                    <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      {mission.client_name || mission.organization_name || 'Entreprise'}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {jd.contract_type && <Badge variant="outline">{CONTRACT_LABELS[jd.contract_type] ?? jd.contract_type}</Badge>}
                    {jd.location && (
                      <Badge variant="outline">
                        <MapPin className="h-3 w-3" aria-hidden="true" />
                        {jd.location}
                      </Badge>
                    )}
                    {jd.remote_policy && <Badge variant="outline">{REMOTE_LABELS[jd.remote_policy] ?? jd.remote_policy}</Badge>}
                    {jd.seniority && <Badge variant="outline">{jd.seniority}</Badge>}
                  </div>

                  {skills.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      <span className="sr-only">Compétences : </span>
                      {skills.slice(0, 5).join(' · ')}
                      {skills.length > 5 ? ` · +${skills.length - 5}` : ''}
                    </p>
                  )}

                  <div className="space-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1.5 font-medium text-foreground">
                      <Percent className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {bountyText(mission.hunt_bounty_percent)}
                    </p>
                    <p className="flex items-center gap-1.5">
                      <Users className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {mission.accepted_count}/{max} recruteurs
                    </p>
                    {mission.hunt_deadline && (
                      <p className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3 shrink-0" aria-hidden="true" />
                        Date limite : {formatDate(mission.hunt_deadline)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="border-t border-border p-3">
                  {mission.my_application_status ? (
                    <ApplicationBadge status={mission.my_application_status} />
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => { setTarget(mission); setMessage(''); }}
                      disabled={full}
                      className="w-full min-h-11 md:min-h-0"
                    >
                      {full ? 'Places pourvues' : 'Postuler'}
                    </Button>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={!!target} onOpenChange={(open) => { if (!open && !isApplying) setTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Postuler à cette mission</DialogTitle>
            <DialogDescription>
              {target ? (target.job_details?.title || target.name) : ''}
              {target?.client_name ? ` chez ${target.client_name}` : ''}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor={messageId}>Message (facultatif)</Label>
              <Textarea
                id={messageId}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Pourquoi cette mission vous correspond, vos placements similaires, votre disponibilité."
              />
            </div>
            <p className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">
              {target?.hunt_bounty_percent != null
                ? `Rémunération : ${target.hunt_bounty_percent} % du salaire annuel, facturée par vous à l'entreprise à l'embauche.`
                : "L'entreprise n'a pas encore fixé la rémunération. Demandez-la dans votre message."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setTarget(null)} disabled={isApplying} className="min-h-11 md:min-h-0">
              Annuler
            </Button>
            <Button variant="primary" onClick={handleApply} loading={isApplying} className="min-h-11 md:min-h-0">
              Envoyer ma candidature
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Onglet « Mes candidatures »
// ---------------------------------------------------------------------------

const MyApplicationsTab: React.FC = () => {
  const { applications, isLoading, isError, errorText, refetch, withdraw, isWithdrawing } = useMyHuntApplications(true);
  const [withdrawTarget, setWithdrawTarget] = useState<MyHuntApplication | null>(null);

  if (isLoading) return <RowsSkeleton label="Chargement de vos candidatures" />;
  if (isError) {
    return <ErrorBox title="Impossible de charger vos candidatures." detail={errorText} onRetry={refetch} />;
  }
  if (applications.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="Aucune candidature"
        description="Postulez depuis l'onglet « Missions ouvertes » : vos candidatures et leur réponse apparaîtront ici."
      />
    );
  }

  return (
    <>
      <ul className="divide-y divide-border rounded-xl border border-border bg-card">
        {applications.map((a) => (
          <li key={a.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
            <div className="min-w-52 flex-1">
              <p className="text-md font-semibold text-foreground">{a.job_title || a.mission_name}</p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {a.client_name || a.organization_name || 'Entreprise'}
                {a.hunt_bounty_percent != null ? ` · ${a.hunt_bounty_percent} % du salaire annuel` : ''}
                {' · '}envoyée le {formatDate(a.created_at)}
                {a.hunt_status && a.hunt_status !== 'published' && a.hunt_status !== 'in_progress'
                  ? ` · ${huntStatusLabel(a.hunt_status)}`
                  : ''}
              </p>
              {a.message && (
                <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">« {a.message} »</p>
              )}
            </div>
            <Badge variant={applicationStatusVariant(a.status)}>{applicationStatusLabel(a.status)}</Badge>
            {a.status === 'pending' && (
              <Button variant="outline" size="sm" onClick={() => setWithdrawTarget(a)} disabled={isWithdrawing} className="min-h-11 md:min-h-0">
                Retirer la candidature
              </Button>
            )}
            {a.status === 'accepted' && (
              <Button asChild variant="outline" size="sm" className="min-h-11 md:min-h-0">
                <Link to={`/missions/${a.project_id}`}>
                  Ouvrir la mission
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            )}
          </li>
        ))}
      </ul>

      <AlertDialog open={!!withdrawTarget} onOpenChange={(open) => !open && setWithdrawTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retirer cette candidature ?</AlertDialogTitle>
            <AlertDialogDescription>
              Votre candidature à « {withdrawTarget?.job_title || withdrawTarget?.mission_name} » sera retirée.
              Vous ne pourrez pas postuler de nouveau à cette mission.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const id = withdrawTarget?.id;
                setWithdrawTarget(null);
                if (id) withdraw(id).catch(() => undefined);
              }}
            >
              Retirer la candidature
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

// ---------------------------------------------------------------------------
// Onglet « Missions en cours »
// ---------------------------------------------------------------------------

const PartnerMissionsTab: React.FC = () => {
  const { missions, isLoading, isError, errorText, refetch } = usePartnerMissions(true);

  if (isLoading) return <CardsSkeleton count={2} />;
  if (isError) {
    return <ErrorBox title="Impossible de charger vos missions en cours." detail={errorText} onRetry={refetch} />;
  }
  if (missions.length === 0) {
    return (
      <EmptyState
        icon={Handshake}
        title="Aucune mission en cours"
        description="Les missions sur lesquelles une entreprise vous a accepté apparaîtront ici."
      />
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
      {missions.map((m) => (
        <li key={m.id}>
          <Link
            to={`/missions/${m.id}`}
            className="block h-full rounded-xl border border-border bg-card p-4 ring-offset-background transition-colors duration-150 hover:border-border-strong hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            <p className="text-md font-semibold text-foreground">{m.job_title || m.name}</p>
            <p className="mt-0.5 flex items-center gap-1 text-sm text-muted-foreground">
              <Building2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              {m.client_name || m.organization_name || 'Entreprise'}
            </p>
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted-foreground">
              <Badge variant={huntStatusVariant(m.hunt_status)}>{huntStatusLabel(m.hunt_status)}</Badge>
              {m.hunt_bounty_percent != null ? <span>{m.hunt_bounty_percent} % du salaire annuel</span> : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
};

// ---------------------------------------------------------------------------
// Conteneur à onglets
// ---------------------------------------------------------------------------

export const PartnerMarketplace: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('open');

  return (
    <Tabs value={tab} onValueChange={(v) => setTab(v as TabKey)}>
      {/* Téléphone : trois colonnes égales, libellés sur deux lignes au besoin. */}
      <TabsList className="mb-6 grid h-auto w-full grid-cols-3 sm:inline-flex sm:w-auto">
        {TABS.map((t) => (
          <TabsTrigger
            key={t.key}
            value={t.key}
            className="h-auto min-h-11 whitespace-normal px-2 py-1 text-center leading-tight sm:h-8 sm:min-h-0 sm:whitespace-nowrap sm:px-3"
          >
            {t.label}
          </TabsTrigger>
        ))}
      </TabsList>
      <TabsContent value="open" className="mt-0">
        <OpenMissionsTab />
      </TabsContent>
      <TabsContent value="applications" className="mt-0">
        <MyApplicationsTab />
      </TabsContent>
      <TabsContent value="missions" className="mt-0">
        <PartnerMissionsTab />
      </TabsContent>
    </Tabs>
  );
};

export default PartnerMarketplace;
