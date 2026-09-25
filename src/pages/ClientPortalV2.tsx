/**
 * ClientPortalV2 : portail du client (/client/:token).
 *
 * Le client (le responsable du recrutement) arrive par un lien partagé par son
 * recruteur. Il voit les candidats de ses missions, suit leur avancement et
 * peut les évaluer.
 *
 *   - En-tête : logo ou initiales de l'organisation, nom du client.
 *   - Accueil au premier passage (dialogue, mémorisé par lien).
 *   - Trois onglets : vue d'ensemble (indicateurs, répartition, meilleurs
 *     profils, activité), pipeline (colonnes par étape, lecture seule), tous
 *     les candidats (recherche et filtres).
 *   - Fiche candidat en panneau latéral, avec l'évaluation.
 *
 * Les étapes affichées viennent de src/components/portal/clientStages.ts :
 * jamais une clé technique ni un identifiant.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Award, Briefcase, ClipboardCheck, Clock, Eye, Lock, Search, Star, TrendingUp, UserPlus, Users,
  type LucideIcon,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';
import { SEOHead } from '@/components/SEOHead';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ScoreBadge } from '@/components/ui/score-badge';
import { EmptyState, Section, StatGrid, StatTile } from '@/components/layout';
import { PublicDeadEnd } from '@/components/public/PublicDeadEnd';
import { PoweredByKonekt } from '@/components/public/PublicFooter';
import { PortalCandidateScoring } from '@/components/portal/PortalCandidateScoring';
import {
  CLIENT_FUNNEL,
  CLIENT_STAGES,
  resolveClientStage,
  type ClientStage,
  type ClientStageKey,
} from '@/components/portal/clientStages';
import { cn } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────

interface PortalCandidate {
  id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  pipeline_stage: string | null;
  score: number | null;
  updated_at: string;
  created_at: string;
  project_id: string;
}

interface PortalProject {
  id: string;
  name: string;
  status: string;
  candidates: PortalCandidate[];
}

interface ClientPortalData {
  client_name: string;
  org_name: string | null;
  org_logo: string | null;
  projects: PortalProject[];
  permissions: {
    can_comment: boolean;
    can_see_names: boolean;
    can_fill_scorecard: boolean;
  };
}

type Permissions = ClientPortalData['permissions'];
type CandidateItem = { candidate: PortalCandidate; project: PortalProject };
type Tab = 'overview' | 'pipeline' | 'candidates';
type LoadState = 'loading' | 'ready' | 'invalid' | 'expired' | 'error';

interface PortalStats {
  total: number;
  toEvaluate: number;
  inProcess: number;
  hired: number;
  avgScore: number | null;
}

// ─── Aides ─────────────────────────────────────────────────────────

const relative = (iso: string) => formatDistanceToNow(new Date(iso), { addSuffix: true, locale: fr });

const initialsOf = (name: string | null | undefined) =>
  (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('');

const displayNameOf = (candidate: PortalCandidate, permissions: Permissions) =>
  permissions.can_see_names ? candidate.candidate_name || 'Candidat' : `Candidat n° ${candidate.id.slice(0, 6)}`;

/** Évaluations envoyées depuis ce navigateur, par lien (le serveur ne les renvoie pas encore). */
const evaluatedStorageKey = (token: string) => `konekt:portal:evaluated:${token}`;

function readEvaluated(token: string | undefined): Record<string, string> {
  if (!token) return {};
  try {
    const raw = JSON.parse(localStorage.getItem(evaluatedStorageKey(token)) || '{}');
    return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
  } catch {
    return {};
  }
}

// ─── Page ──────────────────────────────────────────────────────────

export default function ClientPortalV2() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ClientPortalData | null>(null);
  const [status, setStatus] = useState<LoadState>('loading');
  const [retrying, setRetrying] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [selected, setSelected] = useState<CandidateItem | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<ClientStageKey | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<string | 'all'>('all');
  const [evaluated, setEvaluated] = useState<Record<string, string>>(() => readEvaluated(token));

  const fetchPortal = useCallback(async () => {
    if (!token) {
      setStatus('invalid');
      return;
    }
    try {
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const res = await fetch(
        `${supabaseUrl}/functions/v1/client-portal-data?token=${encodeURIComponent(token)}`,
        { headers: { 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey } },
      );
      // 403 : lien expiré ; 404 et 400 : lien inconnu ; le reste est une panne.
      if (res.status === 403) { setStatus('expired'); return; }
      if (res.status === 404 || res.status === 400) { setStatus('invalid'); return; }
      if (!res.ok) { setStatus('error'); return; }
      const portalData: ClientPortalData = await res.json();
      if (!portalData?.client_name) { setStatus('invalid'); return; }
      setData(portalData);
      setStatus('ready');

      // Accueil au premier passage (mémorisé par lien)
      const seenKey = `konekt:portal:onboarding:${token}`;
      try {
        if (!localStorage.getItem(seenKey)) setShowOnboarding(true);
      } catch {
        // stockage indisponible : pas d'accueil plutôt qu'un accueil à chaque visite
      }
    } catch {
      setStatus('error');
    }
  }, [token]);

  useEffect(() => {
    void fetchPortal();
  }, [fetchPortal]);

  const retry = () => {
    setRetrying(true);
    void fetchPortal().finally(() => setRetrying(false));
  };

  const handleCloseOnboarding = () => {
    setShowOnboarding(false);
    if (!token) return;
    try {
      localStorage.setItem(`konekt:portal:onboarding:${token}`, '1');
    } catch {
      // stockage indisponible : l'accueil reviendra à la prochaine visite
    }
  };

  const markEvaluated = (candidateId: string, iso: string) => {
    setEvaluated((prev) => {
      const next = { ...prev, [candidateId]: iso };
      if (token) {
        try {
          localStorage.setItem(evaluatedStorageKey(token), JSON.stringify(next));
        } catch {
          // stockage indisponible : l'envoi reste affiché pour cette visite
        }
      }
      return next;
    });
  };

  // Tous les candidats à plat, avec leur mission
  const allCandidates = useMemo<CandidateItem[]>(
    () => (data ? data.projects.flatMap((project) => project.candidates.map((candidate) => ({ candidate, project }))) : []),
    [data],
  );

  const stats = useMemo<PortalStats | null>(() => {
    if (!data) return null;
    const count = (key: ClientStageKey) =>
      allCandidates.filter(({ candidate }) => resolveClientStage(candidate.pipeline_stage).key === key).length;
    const scored = allCandidates.filter(({ candidate }) => candidate.score != null);
    return {
      total: allCandidates.length,
      toEvaluate: count('to_evaluate'),
      inProcess: count('interview') + count('offer'),
      hired: count('hired'),
      avgScore: scored.length > 0
        ? Math.round(scored.reduce((sum, { candidate }) => sum + (candidate.score || 0), 0) / scored.length)
        : null,
    };
  }, [data, allCandidates]);

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <Spinner size="lg" label="Chargement du portail" />
          <p className="text-sm text-muted-foreground" aria-hidden="true">Chargement du portail…</p>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <PublicDeadEnd
        kind="network"
        title="Impossible d'afficher le portail"
        description="La connexion au service a échoué. Vérifiez votre connexion internet, puis réessayez."
        onRetry={retry}
        retrying={retrying}
        seo={{ title: 'Portail client', description: 'Accès client' }}
      />
    );
  }

  if (status === 'expired') {
    return (
      <PublicDeadEnd
        kind="link"
        title="Ce lien d'accès a expiré"
        description="Demandez un nouveau lien à votre recruteur pour retrouver le portail."
        seo={{ title: 'Portail client', description: 'Accès client' }}
      />
    );
  }

  if (status === 'invalid' || !data) {
    return (
      <PublicDeadEnd
        kind="link"
        title="Ce lien d'accès n'est pas valide"
        description="Il a peut-être été désactivé. Demandez un nouveau lien à votre recruteur."
        seo={{ title: 'Portail client', description: 'Accès client' }}
      />
    );
  }

  // Candidats filtrés de l'onglet « Tous les candidats »
  const filteredCandidates = allCandidates.filter(({ candidate, project }) => {
    if (projectFilter !== 'all' && project.id !== projectFilter) return false;
    if (stageFilter !== 'all' && resolveClientStage(candidate.pipeline_stage).key !== stageFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = (candidate.candidate_name || '').toLowerCase();
      const headline = (candidate.candidate_headline || '').toLowerCase();
      const projectName = project.name.toLowerCase();
      if (!name.includes(q) && !headline.includes(q) && !projectName.includes(q)) return false;
    }
    return true;
  });

  const resetFilters = () => {
    setSearchQuery('');
    setStageFilter('all');
    setProjectFilter('all');
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <SEOHead
        title={`Portail recrutement, ${data.client_name}`}
        description="Suivez vos missions de recrutement"
      />

      <OnboardingDialog
        open={showOnboarding}
        clientName={data.client_name}
        orgName={data.org_name}
        canEvaluate={data.permissions.can_fill_scorecard}
        onClose={handleCloseOnboarding}
      />

      <PortalHeader data={data} stats={stats} />

      <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as Tab)} className="flex flex-1 flex-col">
        <div className="sticky top-0 z-sticky border-b border-border bg-background">
          <div className="mx-auto max-w-7xl overflow-x-auto px-4 py-2 sm:px-6">
            <TabsList aria-label="Sections du portail" className="max-md:h-12">
              {/* Sur téléphone : sans icône et libellé court, pour que les trois onglets tiennent. */}
              <TabsTrigger value="overview" className="gap-1.5">
                <TrendingUp className="h-3.5 w-3.5 max-sm:hidden" aria-hidden="true" />
                Vue d'ensemble
              </TabsTrigger>
              <TabsTrigger value="pipeline" className="gap-1.5">
                <Briefcase className="h-3.5 w-3.5 max-sm:hidden" aria-hidden="true" />
                Pipeline
              </TabsTrigger>
              <TabsTrigger value="candidates" className="gap-1.5">
                <Users className="h-3.5 w-3.5 max-sm:hidden" aria-hidden="true" />
                <span className="sm:hidden">Candidats</span>
                <span className="max-sm:hidden">Tous les candidats</span>
                {stats && <span className="tabular-nums text-muted-foreground">({stats.total})</span>}
              </TabsTrigger>
            </TabsList>
          </div>
        </div>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6 sm:px-6">
          <TabsContent value="overview" className="mt-0">
            <OverviewTab
              data={data}
              stats={stats}
              allCandidates={allCandidates}
              onSelectCandidate={setSelected}
              onJumpTo={setActiveTab}
            />
          </TabsContent>
          <TabsContent value="pipeline" className="mt-0">
            <PipelineTab data={data} onSelectCandidate={setSelected} onShowAll={() => setActiveTab('candidates')} />
          </TabsContent>
          <TabsContent value="candidates" className="mt-0">
            <CandidatesTab
              data={data}
              candidates={filteredCandidates}
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              stageFilter={stageFilter}
              setStageFilter={setStageFilter}
              projectFilter={projectFilter}
              setProjectFilter={setProjectFilter}
              onReset={resetFilters}
              onSelectCandidate={setSelected}
            />
          </TabsContent>
        </main>
      </Tabs>

      <footer className="border-t border-border py-6">
        <PoweredByKonekt />
      </footer>

      <CandidateSheet
        item={selected}
        permissions={data.permissions}
        clientName={data.client_name}
        portalToken={token!}
        evaluatedAt={selected ? evaluated[selected.candidate.id] ?? null : null}
        onEvaluated={markEvaluated}
        onClose={() => setSelected(null)}
      />
    </div>
  );
}

// ─── En-tête ───────────────────────────────────────────────────────

const PortalHeader: React.FC<{ data: ClientPortalData; stats: PortalStats | null }> = ({ data, stats }) => (
  <header className="border-b border-border bg-background">
    <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-3">
        {data.org_logo ? (
          <img src={data.org_logo} alt="" className="h-10 w-10 shrink-0 rounded-lg object-contain" />
        ) : (
          <span
            className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-sm font-semibold text-foreground-secondary"
            aria-hidden="true"
          >
            {initialsOf(data.org_name) || 'K'}
          </span>
        )}
        <div className="min-w-0">
          <p className="eyebrow truncate">Portail recrutement · {data.org_name || 'Konekt'}</p>
          <h1 className="truncate text-lg font-semibold tracking-tight text-foreground sm:text-xl">
            Bienvenue, {data.client_name}
          </h1>
        </div>
      </div>
      {stats && stats.total > 0 && (
        <p className="flex shrink-0 items-center gap-3 text-sm text-muted-foreground">
          <span className="inline-flex items-center gap-1.5">
            <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
            {data.projects.length} mission{data.projects.length > 1 ? 's' : ''}
          </span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            {stats.total} candidat{stats.total > 1 ? 's' : ''}
          </span>
        </p>
      )}
    </div>
  </header>
);

// ─── Accueil (premier passage) ─────────────────────────────────────

const OnboardingDialog: React.FC<{
  open: boolean;
  clientName: string;
  orgName: string | null;
  canEvaluate: boolean;
  onClose: () => void;
}> = ({ open, clientName, orgName, canEvaluate, onClose }) => (
  <Dialog open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogContent className="max-w-md">
      <DialogHeader>
        <p className="eyebrow">Portail recrutement</p>
        <DialogTitle className="text-xl">Bonjour {clientName}</DialogTitle>
        <DialogDescription>
          {orgName ? `${orgName} a préparé` : 'Votre recruteur a préparé'} cet espace pour suivre les candidatures de votre recrutement.
        </DialogDescription>
      </DialogHeader>
      <ul className="space-y-3">
        <FeatureRow icon={TrendingUp} title="Suivre l'avancement" desc="Voyez où en est chaque candidature, étape par étape." />
        {canEvaluate && (
          <FeatureRow
            icon={ClipboardCheck}
            title="Évaluer les candidats"
            desc="Donnez votre avis sur chaque profil présenté : il est transmis à votre recruteur."
          />
        )}
        <FeatureRow icon={Lock} title="Un accès personnel" desc="Ce lien vous est personnel : ne le transférez pas." />
      </ul>
      <DialogFooter>
        <Button variant="primary" onClick={onClose} className="max-md:h-11">
          Accéder au portail
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
);

const FeatureRow: React.FC<{ icon: LucideIcon; title: string; desc: string }> = ({ icon: Icon, title, desc }) => (
  <li className="flex items-start gap-3">
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-muted text-foreground-secondary" aria-hidden="true">
      <Icon className="h-4 w-4" />
    </span>
    <div className="min-w-0">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-0.5 text-sm text-muted-foreground">{desc}</p>
    </div>
  </li>
);

// ─── Onglet : vue d'ensemble ───────────────────────────────────────

const OverviewTab: React.FC<{
  data: ClientPortalData;
  stats: PortalStats | null;
  allCandidates: CandidateItem[];
  onSelectCandidate: (item: CandidateItem) => void;
  onJumpTo: (tab: Tab) => void;
}> = ({ data, stats, allCandidates, onSelectCandidate, onJumpTo }) => {
  // Meilleurs profils : score d'au moins 70
  const topCandidates = useMemo(
    () => allCandidates
      .filter(({ candidate }) => (candidate.score || 0) >= 70)
      .sort((a, b) => (b.candidate.score || 0) - (a.candidate.score || 0))
      .slice(0, 5),
    [allCandidates],
  );

  // Activité récente : les cinq dernières mises à jour
  const recentActivity = useMemo(
    () => [...allCandidates]
      .sort((a, b) => new Date(b.candidate.updated_at).getTime() - new Date(a.candidate.updated_at).getTime())
      .slice(0, 5),
    [allCandidates],
  );

  if (!stats || stats.total === 0) {
    return (
      <EmptyState
        icon={Users}
        title="Aucun candidat pour le moment"
        description="Les candidats apparaîtront ici dès que votre recruteur les partagera."
      />
    );
  }

  return (
    <div className="space-y-6">
      <StatGrid cols={{ base: 2, sm: 4 }}>
        <StatTile label="Candidats" value={stats.total} icon={Users} />
        <StatTile label="À évaluer" value={stats.toEvaluate} icon={Eye} variant="warning" accent={stats.toEvaluate > 0} />
        <StatTile label="Entretiens et offres" value={stats.inProcess} icon={TrendingUp} />
        <StatTile label="Embauchés" value={stats.hired} icon={Award} variant="success" accent={stats.hired > 0} />
      </StatGrid>

      <Section
        title="Répartition par étape"
        headingLevel={2}
        action={
          stats.avgScore !== null && (
            <Badge variant="outline">
              <Star className="h-3 w-3" aria-hidden="true" />
              Score moyen {stats.avgScore}/100
            </Badge>
          )
        }
      >
        <FunnelRows candidates={allCandidates} />
      </Section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Section
          title="Meilleurs profils"
          headingLevel={2}
          action={
            <Button variant="ghost" size="xs" onClick={() => onJumpTo('candidates')} className="max-md:h-11">
              Voir tous les candidats
            </Button>
          }
        >
          {topCandidates.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              Aucun candidat avec un score d'au moins 70 pour le moment.
            </p>
          ) : (
            <CandidateList items={topCandidates} permissions={data.permissions} onSelect={onSelectCandidate} compact />
          )}
        </Section>

        <Section
          title="Activité récente"
          headingLevel={2}
          action={
            <Button variant="ghost" size="xs" onClick={() => onJumpTo('pipeline')} className="max-md:h-11">
              Voir le pipeline
            </Button>
          }
        >
          <CandidateList items={recentActivity} permissions={data.permissions} onSelect={onSelectCandidate} compact showTime />
        </Section>
      </div>
    </div>
  );
};

/** Répartition des candidats par étape du parcours ; les non-retenus sont comptés à part. */
const FunnelRows: React.FC<{ candidates: CandidateItem[] }> = ({ candidates }) => {
  const stages = candidates.map(({ candidate }) => resolveClientStage(candidate.pipeline_stage));
  const counts = CLIENT_FUNNEL.map((key) => ({
    key,
    label: CLIENT_STAGES[key].label,
    count: stages.filter((stage) => stage.key === key).length,
  }));
  const inFunnel = counts.reduce((sum, stage) => sum + stage.count, 0);
  const outside = candidates.length - inFunnel;

  return (
    <div className="p-4">
      <ul className="space-y-2.5">
        {counts.map((stage) => {
          const pct = inFunnel > 0 ? Math.round((stage.count / inFunnel) * 100) : 0;
          return (
            <li key={stage.key} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-3 text-sm">
              <span className={cn(stage.count === 0 ? 'text-muted-foreground' : 'text-foreground')}>{stage.label}</span>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div className="h-full rounded-full bg-brand" style={{ width: `${pct}%` }} />
              </div>
              <span className="text-xs tabular-nums text-foreground">
                {stage.count} <span className="text-muted-foreground">({pct} %)</span>
              </span>
            </li>
          );
        })}
      </ul>
      {outside > 0 && (
        <p className="mt-4 text-xs text-muted-foreground">
          {outside} candidat{outside > 1 ? 's' : ''} hors parcours (non retenu{outside > 1 ? 's' : ''} ou étape non précisée).
        </p>
      )}
    </div>
  );
};

// ─── Onglet : pipeline ─────────────────────────────────────────────

const PipelineTab: React.FC<{
  data: ClientPortalData;
  onSelectCandidate: (item: CandidateItem) => void;
  onShowAll: () => void;
}> = ({ data, onSelectCandidate, onShowAll }) => {
  if (data.projects.length === 0) {
    return (
      <EmptyState
        icon={Briefcase}
        title="Aucune mission partagée"
        description="Les missions que votre recruteur partage avec vous apparaîtront ici."
      />
    );
  }

  return (
    <div className="space-y-6">
      {data.projects.map((project) => (
        <ProjectPipeline
          key={project.id}
          project={project}
          permissions={data.permissions}
          onSelectCandidate={(candidate) => onSelectCandidate({ candidate, project })}
          onShowAll={onShowAll}
        />
      ))}
    </div>
  );
};

const ProjectPipeline: React.FC<{
  project: PortalProject;
  permissions: Permissions;
  onSelectCandidate: (candidate: PortalCandidate) => void;
  onShowAll: () => void;
}> = ({ project, permissions, onSelectCandidate, onShowAll }) => {
  const byStage: Record<ClientStageKey, PortalCandidate[]> = {
    sourced: [], presented: [], to_evaluate: [], interview: [], offer: [], hired: [], rejected: [],
  };
  let outside = 0;
  project.candidates.forEach((candidate) => {
    const stage = resolveClientStage(candidate.pipeline_stage);
    if (stage.key && stage.key !== 'rejected') byStage[stage.key].push(candidate);
    else outside += 1;
  });
  const count = project.candidates.length;

  return (
    <Section
      title={project.name}
      subtitle={`${count} candidat${count > 1 ? 's' : ''}`}
      icon={Briefcase}
      headingLevel={2}
    >
      <div className="thin-scrollbar overflow-x-auto">
        <div className="flex min-w-max gap-3 p-4">
          {CLIENT_FUNNEL.map((key) => {
            const candidates = byStage[key];
            const label = CLIENT_STAGES[key].label;
            return (
              <section
                key={key}
                aria-label={`${label}, ${candidates.length} candidat${candidates.length > 1 ? 's' : ''}`}
                className="flex w-64 shrink-0 flex-col rounded-lg border border-border bg-background"
              >
                <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
                  <h3 className="flex-1 text-xs font-semibold text-foreground">{label}</h3>
                  <span className="rounded-md bg-muted px-1.5 py-0.5 text-2xs tabular-nums text-muted-foreground">
                    {candidates.length}
                  </span>
                </div>
                <div className="thin-scrollbar max-h-[25rem] flex-1 space-y-2 overflow-y-auto p-2">
                  {candidates.length === 0 ? (
                    <p className="py-6 text-center text-xs text-muted-foreground">Aucun candidat</p>
                  ) : (
                    candidates.map((candidate) => (
                      <PipelineCard
                        key={candidate.id}
                        candidate={candidate}
                        permissions={permissions}
                        onClick={() => onSelectCandidate(candidate)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
      {outside > 0 && (
        <p className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {outside} candidat{outside > 1 ? 's' : ''} hors de ces étapes (non retenu{outside > 1 ? 's' : ''} ou étape non précisée).{' '}
          <Button variant="link" size="xs" className="h-auto px-0 text-xs" onClick={onShowAll}>
            Voir tous les candidats
          </Button>
        </p>
      )}
    </Section>
  );
};

const PipelineCard: React.FC<{
  candidate: PortalCandidate;
  permissions: Permissions;
  onClick: () => void;
}> = ({ candidate, permissions, onClick }) => {
  const displayName = displayNameOf(candidate, permissions);
  return (
    <Button
      variant="outline"
      onClick={onClick}
      className="h-auto w-full flex-col items-stretch gap-1.5 whitespace-normal bg-card p-2.5 text-left font-normal active:scale-100"
    >
      <span className="flex items-center gap-2">
        <Initials name={permissions.can_see_names ? candidate.candidate_name : null} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold text-foreground">{displayName}</span>
          {candidate.candidate_headline && permissions.can_see_names && (
            <span className="block truncate text-2xs text-muted-foreground">{candidate.candidate_headline}</span>
          )}
        </span>
        <ScoreBadge score={candidate.score} className="shrink-0" />
      </span>
      <span className="inline-flex items-center gap-1 text-2xs text-muted-foreground">
        <Clock className="!size-3" aria-hidden="true" />
        Mis à jour {relative(candidate.updated_at)}
      </span>
    </Button>
  );
};

// ─── Onglet : tous les candidats ───────────────────────────────────

const STAGE_OPTIONS = Object.values(CLIENT_STAGES).sort((a, b) => a.order - b.order);

const CandidatesTab: React.FC<{
  data: ClientPortalData;
  candidates: CandidateItem[];
  searchQuery: string;
  setSearchQuery: (value: string) => void;
  stageFilter: ClientStageKey | 'all';
  setStageFilter: (value: ClientStageKey | 'all') => void;
  projectFilter: string | 'all';
  setProjectFilter: (value: string | 'all') => void;
  onReset: () => void;
  onSelectCandidate: (item: CandidateItem) => void;
}> = ({ data, candidates, searchQuery, setSearchQuery, stageFilter, setStageFilter, projectFilter, setProjectFilter, onReset, onSelectCandidate }) => (
  <div>
    <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
      <div className="relative flex-1 sm:min-w-[16rem]">
        <Label htmlFor="portail-recherche" className="sr-only">
          Rechercher un candidat ou une mission
        </Label>
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          id="portail-recherche"
          type="search"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher un candidat, une mission…"
          className="pl-9 max-md:h-11"
        />
      </div>

      <Select value={stageFilter} onValueChange={(value) => setStageFilter(value as ClientStageKey | 'all')}>
        <SelectTrigger aria-label="Filtrer par étape" className="sm:w-48 max-md:h-11">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Toutes les étapes</SelectItem>
          {STAGE_OPTIONS.map((stage) => (
            <SelectItem key={stage.key} value={stage.key as string}>
              {stage.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {data.projects.length > 1 && (
        <Select value={projectFilter} onValueChange={setProjectFilter}>
          <SelectTrigger aria-label="Filtrer par mission" className="sm:w-56 max-md:h-11">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Toutes les missions</SelectItem>
            {data.projects.map((project) => (
              <SelectItem key={project.id} value={project.id}>
                {project.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
    </div>

    {candidates.length === 0 ? (
      <EmptyState
        icon={Search}
        title="Aucun candidat trouvé"
        description="Essayez d'autres mots-clés ou retirez des filtres."
        action={
          <Button variant="outline" onClick={onReset} className="max-md:h-11">
            Effacer les filtres
          </Button>
        }
      />
    ) : (
      <div className="rounded-xl border border-border bg-card">
        <CandidateList items={candidates} permissions={data.permissions} onSelect={onSelectCandidate} showProject showTime />
      </div>
    )}
  </div>
);

// ─── Liste et ligne de candidat ────────────────────────────────────

const CandidateList: React.FC<{
  items: CandidateItem[];
  permissions: Permissions;
  onSelect: (item: CandidateItem) => void;
  compact?: boolean;
  showTime?: boolean;
  showProject?: boolean;
}> = ({ items, permissions, onSelect, compact, showTime, showProject }) => (
  <ul className="divide-y divide-border p-1.5">
    {items.map((item) => (
      <li key={item.candidate.id} className="py-0.5">
        <CandidateRow
          item={item}
          permissions={permissions}
          onClick={() => onSelect(item)}
          compact={compact}
          showTime={showTime}
          showProject={showProject}
        />
      </li>
    ))}
  </ul>
);

const CandidateRow: React.FC<{
  item: CandidateItem;
  permissions: Permissions;
  onClick: () => void;
  compact?: boolean;
  showTime?: boolean;
  showProject?: boolean;
}> = ({ item, permissions, onClick, compact, showTime, showProject }) => {
  const { candidate, project } = item;
  const displayName = displayNameOf(candidate, permissions);
  const stage = resolveClientStage(candidate.pipeline_stage);

  return (
    <Button
      variant="ghost"
      onClick={onClick}
      className={cn(
        'h-auto min-h-11 w-full justify-start gap-3 whitespace-normal rounded-md text-left font-normal active:scale-100',
        compact ? 'px-2.5 py-2' : 'px-3 py-2.5',
      )}
    >
      <Initials name={permissions.can_see_names ? candidate.candidate_name : null} size={compact ? 'sm' : 'md'} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-medium text-foreground">{displayName}</span>
          {showProject && <span className="hidden truncate text-xs text-muted-foreground sm:inline">· {project.name}</span>}
        </span>
        {candidate.candidate_headline && permissions.can_see_names && (
          <span className="block truncate text-xs text-muted-foreground">{candidate.candidate_headline}</span>
        )}
      </span>
      <StageBadge stage={stage} />
      <ScoreBadge score={candidate.score} className="shrink-0" />
      {showTime && (
        <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:inline-flex">
          <Clock className="!size-3" aria-hidden="true" />
          {relative(candidate.updated_at)}
        </span>
      )}
    </Button>
  );
};

const StageBadge: React.FC<{ stage: ClientStage }> = ({ stage }) => (
  <Badge variant={stage.tone} className="shrink-0 whitespace-nowrap">
    {stage.label}
  </Badge>
);

/** Score d'adéquation sur 100 : le chiffre porte l'information, la teinte la souligne. */
const Initials: React.FC<{ name: string | null; size: 'sm' | 'md' | 'lg' }> = ({ name, size }) => (
  <span
    className={cn(
      'grid shrink-0 place-items-center rounded-full bg-muted font-semibold text-foreground-secondary',
      size === 'sm' && 'h-7 w-7 text-3xs',
      size === 'md' && 'h-9 w-9 text-xs',
      size === 'lg' && 'h-12 w-12 text-sm',
    )}
    aria-hidden="true"
  >
    {initialsOf(name) || '#'}
  </span>
);

// ─── Fiche candidat (panneau latéral) ──────────────────────────────

const CandidateSheet: React.FC<{
  item: CandidateItem | null;
  permissions: Permissions;
  clientName: string;
  portalToken: string;
  evaluatedAt: string | null;
  onEvaluated: (candidateId: string, iso: string) => void;
  onClose: () => void;
}> = ({ item, permissions, clientName, portalToken, evaluatedAt, onEvaluated, onClose }) => {
  const candidate = item?.candidate;
  const project = item?.project;

  return (
    <Sheet open={!!item} onOpenChange={(open) => { if (!open) onClose(); }}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-lg">
        {candidate && project && (
          <>
            <SheetHeader className="space-y-0 border-b border-border px-5 py-4 pr-14 text-left">
              <div className="flex items-center gap-3">
                <Initials name={permissions.can_see_names ? candidate.candidate_name : null} size="lg" />
                <div className="min-w-0">
                  <SheetTitle className="truncate text-lg">{displayNameOf(candidate, permissions)}</SheetTitle>
                  {candidate.candidate_headline && permissions.can_see_names ? (
                    <SheetDescription className="truncate">{candidate.candidate_headline}</SheetDescription>
                  ) : (
                    <SheetDescription className="sr-only">Fiche du candidat</SheetDescription>
                  )}
                </div>
              </div>
            </SheetHeader>

            <div className="flex-1 space-y-5 overflow-y-auto p-5">
              <div className="flex flex-wrap items-center gap-2">
                <StageBadge stage={resolveClientStage(candidate.pipeline_stage)} />
                {candidate.score != null && (
                  <Badge variant="outline">
                    <Star className="h-3 w-3" aria-hidden="true" />
                    Score d'adéquation {candidate.score}/100
                  </Badge>
                )}
                <Badge variant="outline">
                  <Briefcase className="h-3 w-3" aria-hidden="true" />
                  {project.name}
                </Badge>
              </div>

              <section aria-labelledby="fiche-activite" className="rounded-lg border border-border bg-card p-4">
                <h3 id="fiche-activite" className="text-xs font-semibold text-muted-foreground">
                  Activité
                </h3>
                <ul className="mt-2 space-y-1.5 text-sm text-foreground-secondary">
                  <li className="flex items-center gap-2">
                    <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    Ajouté à la mission {relative(candidate.created_at)}
                  </li>
                  <li className="flex items-center gap-2">
                    <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                    Mis à jour {relative(candidate.updated_at)}
                  </li>
                </ul>
              </section>

              {permissions.can_fill_scorecard && (
                <section aria-labelledby="fiche-evaluation" className="rounded-lg border border-border bg-card">
                  <div className="border-b border-border px-4 py-3">
                    <h3 id="fiche-evaluation" className="text-sm font-semibold text-foreground">
                      Évaluation
                    </h3>
                    <p className="mt-0.5 text-xs text-muted-foreground">Donnez votre avis : il sera transmis à votre recruteur.</p>
                  </div>
                  <div className="p-4">
                    <PortalCandidateScoring
                      key={candidate.id}
                      candidate={candidate}
                      projectId={project.id}
                      clientName={clientName}
                      canFillScorecard={permissions.can_fill_scorecard}
                      portalToken={portalToken}
                      submittedAt={evaluatedAt}
                      onSubmitted={(iso) => onEvaluated(candidate.id, iso)}
                    />
                  </div>
                </section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
};
