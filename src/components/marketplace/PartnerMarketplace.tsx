/**
 * PartnerMarketplace : vue d'un recruteur partenaire validé sur /marketplace.
 * Trois onglets : missions ouvertes (candidature), mes candidatures, missions
 * en cours (équipe d'une mission d'une autre organisation).
 */

import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Search, Target, MapPin, Percent, Clock, Users, Calendar, Loader2, Building2, ArrowRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  useOpenHuntMissions,
  useMyHuntApplications,
  usePartnerMissions,
  type OpenHuntMission,
  type MyHuntApplication,
} from '@/hooks/useMarketplace';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  CONTRACT_LABELS, REMOTE_LABELS, applicationStatusLabel, huntStatusLabel, formatDate,
} from './huntLabels';
import { ErrorBox } from './ErrorBox';

type TabKey = 'open' | 'applications' | 'missions';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'open', label: 'Missions ouvertes' },
  { key: 'applications', label: 'Mes candidatures' },
  { key: 'missions', label: 'Missions en cours' },
];

const Spinner: React.FC = () => (
  <div className="flex items-center justify-center py-20">
    <div className="w-5 h-5 border border-border border-t-foreground animate-spin" />
  </div>
);

const EmptyBox: React.FC<{ title: string; text: string }> = ({ title, text }) => (
  <div className="border border-dashed border-border p-12 text-center">
    <Target className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
    <h3 className="text-sm font-bold uppercase tracking-wider mb-2">{title}</h3>
    <p className="text-xs text-muted-foreground">{text}</p>
  </div>
);

const Tag: React.FC<{ children: React.ReactNode; muted?: boolean }> = ({ children, muted = true }) => (
  <span
    className={cn(
      'inline-flex items-center gap-0.5 px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-border',
      muted ? 'text-muted-foreground' : 'text-foreground',
    )}
  >
    {children}
  </span>
);

// Badge d'état d'une candidature (à la place du bouton Postuler)
const ApplicationBadge: React.FC<{ status: string }> = ({ status }) => {
  const tone =
    status === 'accepted' ? 'border-success/40 text-success'
    : status === 'pending' ? 'border-warning/40 text-warning'
    : 'border-border text-muted-foreground';
  return (
    <span className={cn('inline-flex items-center justify-center w-full h-9 border text-xs font-medium uppercase tracking-wider', tone)}>
      {status === 'pending'
        ? 'Candidature envoyée'
        : status === 'ended'
          ? 'Collaboration terminée'
          : `Candidature ${applicationStatusLabel(status).toLowerCase()}`}
    </span>
  );
};

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
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <div className="relative flex-1 min-w-[200px] max-w-[400px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Rechercher un poste, une entreprise..."
            className="w-full h-9 pl-9 pr-3 text-sm border border-border bg-background text-foreground focus:outline-none"
          />
        </div>
        <select
          value={filterContract}
          onChange={(e) => setFilterContract(e.target.value)}
          className="h-9 px-3 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground focus:outline-none"
        >
          <option value="">Tous les contrats</option>
          {Object.entries(CONTRACT_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={filterRemote}
          onChange={(e) => setFilterRemote(e.target.value)}
          className="h-9 px-3 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground focus:outline-none"
        >
          <option value="">Tous les modes</option>
          {Object.entries(REMOTE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <span className="text-xs text-muted-foreground uppercase tracking-wider ml-auto">
          {filtered.length} mission{filtered.length > 1 ? 's' : ''}
        </span>
      </div>

      {isLoading ? (
        <Spinner />
      ) : isError ? (
        <ErrorBox
          title="Impossible de charger les missions ouvertes."
          detail={errorText}
          onRetry={refetch}
        />
      ) : filtered.length === 0 ? (
        <EmptyBox
          title="Aucune mission disponible"
          text={missions.length === 0
            ? 'Aucune entreprise ne propose de mission pour le moment.'
            : 'Aucune mission ne correspond à vos filtres.'}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((mission) => {
            const jd = mission.job_details ?? {};
            const skills = jd.skills_must_have ?? [];
            const max = mission.hunt_max_recruiters ?? 3;
            const full = mission.accepted_count >= max;
            return (
              <div key={mission.id} className="border border-border bg-background hover:shadow-sm transition-all flex flex-col">
                <div className="p-4 space-y-3 flex-1">
                  <div>
                    <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">
                      {jd.title || mission.name}
                    </h3>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5 flex items-center gap-1">
                      <Building2 className="w-3 h-3" />
                      {mission.client_name || mission.organization_name || 'Entreprise'}
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {jd.contract_type && <Tag muted={false}>{CONTRACT_LABELS[jd.contract_type] ?? jd.contract_type}</Tag>}
                    {jd.location && <Tag><MapPin className="w-2.5 h-2.5" /> {jd.location}</Tag>}
                    {jd.remote_policy && <Tag>{REMOTE_LABELS[jd.remote_policy] ?? jd.remote_policy}</Tag>}
                    {jd.seniority && <Tag>{jd.seniority}</Tag>}
                  </div>

                  {skills.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {skills.slice(0, 5).map((skill, i) => (
                        <span key={i} className="px-1.5 py-0.5 text-xs font-medium bg-foreground text-background uppercase tracking-wider">
                          {skill}
                        </span>
                      ))}
                      {skills.length > 5 && (
                        <span className="text-xs text-muted-foreground self-center">+{skills.length - 5}</span>
                      )}
                    </div>
                  )}

                  <div className="pt-2 border-t border-border space-y-1 text-xs text-muted-foreground">
                    <p className="flex items-center gap-1 text-foreground font-medium">
                      <Percent className="w-3 h-3" />
                      {mission.hunt_bounty_percent ?? 0} % du salaire annuel
                    </p>
                    <p className="flex items-center gap-3 flex-wrap">
                      <span className="flex items-center gap-1">
                        <Users className="w-3 h-3" /> {mission.accepted_count}/{max} recruteurs
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatDistanceToNow(new Date(mission.created_at), { addSuffix: true, locale: fr })}
                      </span>
                    </p>
                    {mission.hunt_deadline && (
                      <p className="flex items-center gap-1 text-warning">
                        <Calendar className="w-3 h-3" /> Date limite : {formatDate(mission.hunt_deadline)}
                      </p>
                    )}
                  </div>
                </div>

                <div className="border-t border-border p-3">
                  {mission.my_application_status ? (
                    <ApplicationBadge status={mission.my_application_status} />
                  ) : (
                    <button
                      type="button"
                      onClick={() => { setTarget(mission); setMessage(''); }}
                      disabled={full}
                      className="w-full h-9 border border-border text-xs font-medium uppercase tracking-wider bg-foreground text-background disabled:bg-muted disabled:text-muted-foreground"
                    >
                      {full ? 'Places pourvues' : 'Postuler'}
                    </button>
                  )}
                </div>
              </div>
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
            <div>
              <label className="block text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5">
                Message (facultatif)
              </label>
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                maxLength={1000}
                placeholder="Pourquoi cette mission vous correspond, vos placements similaires, votre disponibilité."
              />
            </div>
            <p className="text-xs text-muted-foreground border border-border p-3">
              Rémunération : {target?.hunt_bounty_percent ?? 0} % du salaire annuel, facturée par vous à l'entreprise à l'embauche.
            </p>
          </div>
          <DialogFooter>
            <button
              type="button"
              onClick={() => setTarget(null)}
              disabled={isApplying}
              className="h-9 px-4 border border-border text-xs font-medium uppercase tracking-wider"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={isApplying}
              className="h-9 px-4 border border-border text-xs font-medium uppercase tracking-wider bg-foreground text-background inline-flex items-center gap-1.5 disabled:opacity-60"
            >
              {isApplying && <Loader2 className="w-3 h-3 animate-spin" />}
              Envoyer ma candidature
            </button>
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
  const navigate = useNavigate();
  const { applications, isLoading, isError, errorText, refetch, withdraw, isWithdrawing } = useMyHuntApplications(true);
  const [withdrawTarget, setWithdrawTarget] = useState<MyHuntApplication | null>(null);

  if (isLoading) return <Spinner />;
  if (isError) {
    return <ErrorBox title="Impossible de charger vos candidatures." detail={errorText} onRetry={refetch} />;
  }
  if (applications.length === 0) {
    return <EmptyBox title="Aucune candidature" text="Vos candidatures aux missions ouvertes apparaîtront ici." />;
  }

  return (
    <div className="border border-border divide-y divide-border">
      {applications.map((a) => (
        <div key={a.id} className="p-4 flex items-center gap-4 flex-wrap">
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-bold uppercase tracking-wider text-foreground">
              {a.job_title || a.mission_name}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {a.client_name || a.organization_name || 'Entreprise'}
              {a.hunt_bounty_percent ? ` · ${a.hunt_bounty_percent} % du salaire annuel` : ''}
              {' · '}envoyée le {formatDate(a.created_at)}
            </p>
            {a.message && (
              <p className="text-xs text-muted-foreground mt-1 italic line-clamp-2">« {a.message} »</p>
            )}
          </div>
          <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground">
            {applicationStatusLabel(a.status)}
          </span>
          {a.status === 'pending' && (
            <button
              type="button"
              onClick={() => setWithdrawTarget(a)}
              disabled={isWithdrawing}
              className="h-8 px-3 border border-border text-xs font-medium uppercase tracking-wider hover:bg-muted disabled:opacity-50"
            >
              Retirer
            </button>
          )}
          {a.status === 'accepted' && (
            <button
              type="button"
              onClick={() => navigate(`/missions/${a.project_id}`)}
              className="h-8 px-3 border border-border text-xs font-medium uppercase tracking-wider bg-foreground text-background inline-flex items-center gap-1"
            >
              Ouvrir la mission <ArrowRight className="w-3 h-3" />
            </button>
          )}
        </div>
      ))}

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
              Retirer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Onglet « Missions en cours »
// ---------------------------------------------------------------------------

const PartnerMissionsTab: React.FC = () => {
  const navigate = useNavigate();
  const { missions, isLoading, isError, errorText, refetch } = usePartnerMissions(true);

  if (isLoading) return <Spinner />;
  if (isError) {
    return <ErrorBox title="Impossible de charger vos missions en cours." detail={errorText} onRetry={refetch} />;
  }
  if (missions.length === 0) {
    return (
      <EmptyBox
        title="Aucune mission en cours"
        text="Les missions sur lesquelles une entreprise vous a accepté apparaîtront ici."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {missions.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => navigate(`/missions/${m.id}`)}
          className="text-left border border-border bg-background p-4 hover:shadow-sm transition-all"
        >
          <p className="text-sm font-bold uppercase tracking-wider text-foreground">{m.job_title || m.name}</p>
          <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5 flex items-center gap-1">
            <Building2 className="w-3 h-3" /> {m.client_name || m.organization_name || 'Entreprise'}
          </p>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
            <span className="uppercase tracking-wider">{huntStatusLabel(m.hunt_status)}</span>
            {m.hunt_bounty_percent ? <span>{m.hunt_bounty_percent} % du salaire annuel</span> : null}
          </div>
        </button>
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Conteneur à onglets
// ---------------------------------------------------------------------------

export const PartnerMarketplace: React.FC = () => {
  const [tab, setTab] = useState<TabKey>('open');

  return (
    <div>
      <div className="flex items-center gap-1 border-b border-border mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'h-10 px-4 text-xs font-medium uppercase tracking-wider border-b-2 -mb-px whitespace-nowrap transition-colors',
              tab === t.key
                ? 'border-foreground text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'open' && <OpenMissionsTab />}
      {tab === 'applications' && <MyApplicationsTab />}
      {tab === 'missions' && <PartnerMissionsTab />}
    </div>
  );
};

export default PartnerMarketplace;
