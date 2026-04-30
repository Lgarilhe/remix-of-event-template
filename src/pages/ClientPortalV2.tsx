/**
 * ClientPortalV2 — Portail client refondu avec design v2.
 *
 * Le hiring manager arrive ici via un lien /client/{token} partagé par
 * le recruteur Konekt. Il voit les candidats sourcés pour son recrutement,
 * peut les évaluer (scorecard), commenter, et suivre le pipeline.
 *
 * Architecture :
 *   - Header brandé (logo recruteur + nom + nav)
 *   - Onboarding overlay au first visit (localStorage flag)
 *   - 3 tabs principaux :
 *     1. Vue d'ensemble : KPIs + funnel + top candidats
 *     2. Pipeline : kanban par stage (read-only pour le client)
 *     3. Tous les candidats : liste filtrable + recherche
 *   - Sheet de détail candidat (slide-in droite) avec scorecard + actions
 *
 * Design :
 *   - Layout 1280px max
 *   - DA v2 : Outfit display, Pills colorées, gradient Skalr pour WOW
 *   - Mobile-friendly (sheet plein écran sur mobile)
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { PortalCandidateScoring } from '@/components/portal/PortalCandidateScoring';
import { Pill } from '@/components/missions/v2/Pill';
import {
  Users, Clock, Search, Briefcase, TrendingUp, Star, Filter,
  Sparkles, X, ChevronRight, Award, MessageSquare, Eye, ArrowRight,
  CheckCircle, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

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

// ─── Stage config ─────────────────────────────────────────────────

const STAGE_CONFIG: Record<string, {
  label: string;
  emoji: string;
  variant: 'muted' | 'info' | 'warning' | 'success';
  order: number;
}> = {
  sourced:     { label: 'Nouveau',     emoji: '🆕', variant: 'muted',   order: 1 },
  presented:   { label: 'Présenté',    emoji: '👋', variant: 'info',    order: 2 },
  to_evaluate: { label: 'À évaluer',   emoji: '🔍', variant: 'warning', order: 3 },
  interview:   { label: 'Entretien',   emoji: '🎯', variant: 'info',    order: 4 },
  offer:       { label: 'Offre',       emoji: '📨', variant: 'warning', order: 5 },
  hired:       { label: 'Embauché',    emoji: '✅', variant: 'success', order: 6 },
  rejected:    { label: 'Refusé',      emoji: '❌', variant: 'muted',   order: 7 },
};

function getStageInfo(stage: string | null) {
  if (!stage) return STAGE_CONFIG.sourced;
  const normalized = stage.toLowerCase().replace(/\s+/g, '_');
  return STAGE_CONFIG[normalized] || { label: stage, emoji: '📋', variant: 'muted' as const, order: 99 };
}

// ─── Main ──────────────────────────────────────────────────────────

type Tab = 'overview' | 'pipeline' | 'candidates';

export default function ClientPortalV2() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<ClientPortalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [selectedCandidate, setSelectedCandidate] = useState<{ candidate: PortalCandidate; project: PortalProject } | null>(null);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<string | 'all'>('all');
  const [projectFilter, setProjectFilter] = useState<string | 'all'>('all');

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }

    (async () => {
      try {
        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
        const res = await fetch(
          `${supabaseUrl}/functions/v1/client-portal-data?token=${encodeURIComponent(token)}`,
          { headers: { 'Authorization': `Bearer ${anonKey}`, 'apikey': anonKey } },
        );
        if (!res.ok) { setNotFound(true); setLoading(false); return; }
        const portalData: ClientPortalData = await res.json();
        if (!portalData.client_name) { setNotFound(true); setLoading(false); return; }
        setData(portalData);

        // Onboarding au first visit (localStorage flag par token)
        const seenKey = `konekt:portal:onboarding:${token}`;
        if (typeof localStorage !== 'undefined' && !localStorage.getItem(seenKey)) {
          setShowOnboarding(true);
        }
      } catch {
        setNotFound(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [token]);

  const handleCloseOnboarding = () => {
    setShowOnboarding(false);
    if (token && typeof localStorage !== 'undefined') {
      localStorage.setItem(`konekt:portal:onboarding:${token}`, '1');
    }
  };

  // Aggregated stats
  const stats = useMemo(() => {
    if (!data) return null;
    const all: PortalCandidate[] = [];
    data.projects.forEach(p => all.push(...p.candidates));
    const total = all.length;
    const newCount = all.filter(c => {
      const stage = getStageInfo(c.pipeline_stage);
      return stage.order <= 2;
    }).length;
    const toEvaluate = all.filter(c => getStageInfo(c.pipeline_stage).order === 3).length;
    const inProcess = all.filter(c => {
      const stage = getStageInfo(c.pipeline_stage);
      return stage.order >= 4 && stage.order <= 5;
    }).length;
    const hired = all.filter(c => getStageInfo(c.pipeline_stage).order === 6).length;
    const avgScore = all.filter(c => c.score != null).length > 0
      ? Math.round(all.filter(c => c.score != null).reduce((s, c) => s + (c.score || 0), 0) / all.filter(c => c.score != null).length)
      : null;
    return { total, newCount, toEvaluate, inProcess, hired, avgScore };
  }, [data]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          <p className="text-xs text-muted-foreground">Chargement du portail…</p>
        </div>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <SEOHead title="Portail client | Konekt" description="Accès client" />
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">🔒</div>
          <h1 className="font-display text-[24px] font-bold mb-2">Lien invalide ou expiré</h1>
          <p className="text-[14px] text-muted-foreground">
            Ce lien d'accès n'est plus valide. Contactez votre recruteur pour obtenir un nouveau lien.
          </p>
        </div>
      </div>
    );
  }

  // Tous les candidats à plat (avec leur projet)
  const allCandidates: { candidate: PortalCandidate; project: PortalProject }[] = [];
  data.projects.forEach(project => {
    project.candidates.forEach(candidate => {
      allCandidates.push({ candidate, project });
    });
  });

  // Filtered candidates pour le tab "Tous les candidats"
  const filteredCandidates = allCandidates.filter(({ candidate, project }) => {
    if (projectFilter !== 'all' && project.id !== projectFilter) return false;
    if (stageFilter !== 'all') {
      const stage = getStageInfo(candidate.pipeline_stage);
      const filterStage = STAGE_CONFIG[stageFilter];
      if (filterStage && stage.order !== filterStage.order) return false;
    }
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const name = (candidate.candidate_name || '').toLowerCase();
      const headline = (candidate.candidate_headline || '').toLowerCase();
      const projectName = project.name.toLowerCase();
      if (!name.includes(q) && !headline.includes(q) && !projectName.includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title={`Portail — ${data.client_name} | ${data.org_name || 'Konekt'}`}
        description="Suivez vos missions de recrutement"
      />

      {/* Onboarding overlay */}
      {showOnboarding && <OnboardingOverlay clientName={data.client_name} orgName={data.org_name} onClose={handleCloseOnboarding} />}

      {/* Header brandé */}
      <PortalHeader data={data} stats={stats} />

      {/* Nav tabs */}
      <nav className="border-b border-border bg-background sticky top-0 z-20">
        <div className="max-w-[1280px] mx-auto px-4 sm:px-6 flex items-center gap-1 overflow-x-auto scrollbar-hide">
          <TabButton active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} icon={<TrendingUp className="w-3.5 h-3.5" />}>
            Vue d'ensemble
          </TabButton>
          <TabButton active={activeTab === 'pipeline'} onClick={() => setActiveTab('pipeline')} icon={<Briefcase className="w-3.5 h-3.5" />}>
            Pipeline
          </TabButton>
          <TabButton active={activeTab === 'candidates'} onClick={() => setActiveTab('candidates')} icon={<Users className="w-3.5 h-3.5" />}>
            Tous les candidats
            {stats && <span className="ml-1.5 text-[10px] tabular-nums opacity-60">({stats.total})</span>}
          </TabButton>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-[1280px] mx-auto px-4 sm:px-6 py-6 pb-12">
        {activeTab === 'overview' && (
          <OverviewTab data={data} stats={stats} onSelectCandidate={setSelectedCandidate} onJumpTo={(t) => setActiveTab(t)} />
        )}
        {activeTab === 'pipeline' && (
          <PipelineTab data={data} onSelectCandidate={setSelectedCandidate} />
        )}
        {activeTab === 'candidates' && (
          <CandidatesTab
            data={data}
            candidates={filteredCandidates}
            searchQuery={searchQuery}
            setSearchQuery={setSearchQuery}
            stageFilter={stageFilter}
            setStageFilter={setStageFilter}
            projectFilter={projectFilter}
            setProjectFilter={setProjectFilter}
            onSelectCandidate={setSelectedCandidate}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-6 text-center bg-background">
        <p className="text-[11px] text-muted-foreground">
          Portail propulsé par <span className="font-display font-bold">Konekt</span>
        </p>
      </footer>

      {/* Detail sheet */}
      {selectedCandidate && (
        <CandidateSheet
          item={selectedCandidate}
          permissions={data.permissions}
          clientName={data.client_name}
          portalToken={token!}
          onClose={() => setSelectedCandidate(null)}
        />
      )}
    </div>
  );
}

// ─── Header ────────────────────────────────────────────────────────

const PortalHeader: React.FC<{ data: ClientPortalData; stats: any }> = ({ data, stats }) => (
  <header className="border-b border-border bg-background">
    {/* Accent gradient bar */}
    <div className="h-1 konekt-skalr-bg" />

    <div className="max-w-[1280px] mx-auto px-4 sm:px-6 py-4 flex items-center justify-between gap-4 flex-wrap">
      <div className="flex items-center gap-3 min-w-0">
        {data.org_logo ? (
          <img src={data.org_logo} alt={data.org_name || ''} className="h-10 w-10 object-contain rounded-md" />
        ) : (
          <div className="h-10 w-10 rounded-md konekt-skalr-bg konekt-shine grid place-items-center">
            <Sparkles className="w-5 h-5 text-white" strokeWidth={2.5} />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Portail recrutement · {data.org_name || 'Konekt'}
          </p>
          <h1 className="font-display text-[18px] sm:text-[22px] font-bold leading-tight">
            Bienvenue, <span className="font-editorial italic font-normal">{data.client_name}</span>
          </h1>
        </div>
      </div>
      {stats && stats.total > 0 && (
        <div className="flex items-center gap-3 text-[12px] text-muted-foreground flex-shrink-0">
          <span className="inline-flex items-center gap-1.5">
            <Briefcase className="w-3.5 h-3.5" />
            {data.projects.length} mission{data.projects.length > 1 ? 's' : ''}
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" />
            {stats.total} candidat{stats.total > 1 ? 's' : ''}
          </span>
        </div>
      )}
    </div>
  </header>
);

const TabButton: React.FC<{ active: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }> = ({
  active, onClick, icon, children,
}) => (
  <button
    type="button"
    onClick={onClick}
    className={cn(
      'px-4 py-3 inline-flex items-center gap-2 text-[13px] font-medium border-b-2 transition-colors flex-shrink-0',
      active
        ? 'border-foreground text-foreground'
        : 'border-transparent text-muted-foreground hover:text-foreground',
    )}
  >
    {icon}
    {children}
  </button>
);

// ─── Onboarding overlay (first visit) ─────────────────────────────

const OnboardingOverlay: React.FC<{
  clientName: string;
  orgName: string | null;
  onClose: () => void;
}> = ({ clientName, orgName, onClose }) => (
  <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 konekt-fade-up">
    <div className="bg-card border border-border rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden">
      <div className="h-1 konekt-skalr-bg" />
      <div className="p-6 sm:p-8">
        <div className="h-14 w-14 rounded-2xl konekt-skalr-bg konekt-shine grid place-items-center mb-5">
          <Sparkles className="w-7 h-7 text-white" strokeWidth={2.5} />
        </div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
          Bienvenue sur ton portail
        </p>
        <h2 className="font-display text-[28px] font-bold leading-tight mb-3">
          Bonjour <span className="font-editorial italic font-normal">{clientName}</span>
        </h2>
        <p className="text-[14px] text-muted-foreground leading-relaxed mb-5">
          {orgName ? <strong className="text-foreground">{orgName}</strong> : 'Ton recruteur'} a préparé un espace dédié pour suivre les candidatures de ton recrutement. Voici ce que tu peux faire ici :
        </p>

        <div className="space-y-3 mb-6">
          <FeatureRow
            emoji="📊"
            title="Suivre l'avancement"
            desc="Vois en temps réel où en sont les candidatures, étape par étape."
          />
          <FeatureRow
            emoji="🎯"
            title="Évaluer les candidats"
            desc="Donne ton feedback via la scorecard pour chaque profil présenté."
          />
          <FeatureRow
            emoji="💬"
            title="Commenter & échanger"
            desc="Laisse des commentaires que ton recruteur reçoit instantanément."
          />
          <FeatureRow
            emoji="🔒"
            title="Confidentiel & sécurisé"
            desc="Ce lien est privé. Toi seul peux y accéder."
          />
        </div>

        <button
          type="button"
          onClick={onClose}
          className="w-full h-11 rounded-full inline-flex items-center justify-center gap-2 text-[14px] font-semibold text-white konekt-skalr-bg konekt-shine transition-transform active:scale-[0.97]"
        >
          C'est parti
          <ArrowRight className="w-4 h-4" strokeWidth={2.5} />
        </button>
      </div>
    </div>
  </div>
);

const FeatureRow: React.FC<{ emoji: string; title: string; desc: string }> = ({ emoji, title, desc }) => (
  <div className="flex items-start gap-3">
    <span className="text-2xl flex-shrink-0">{emoji}</span>
    <div className="min-w-0">
      <p className="text-[14px] font-semibold leading-tight">{title}</p>
      <p className="text-[12px] text-muted-foreground leading-snug mt-0.5">{desc}</p>
    </div>
  </div>
);

// ─── Tab : Vue d'ensemble ─────────────────────────────────────────

const OverviewTab: React.FC<{
  data: ClientPortalData;
  stats: any;
  onSelectCandidate: (item: { candidate: PortalCandidate; project: PortalProject }) => void;
  onJumpTo: (tab: Tab) => void;
}> = ({ data, stats, onSelectCandidate, onJumpTo }) => {
  // Top candidats : score >= 70 ou stage avancé
  const topCandidates = useMemo(() => {
    const all: { candidate: PortalCandidate; project: PortalProject }[] = [];
    data.projects.forEach(project => {
      project.candidates.forEach(candidate => {
        all.push({ candidate, project });
      });
    });
    return all
      .filter(({ candidate }) => (candidate.score || 0) >= 70)
      .sort((a, b) => (b.candidate.score || 0) - (a.candidate.score || 0))
      .slice(0, 5);
  }, [data]);

  // Recent activity (last 5 updated)
  const recentActivity = useMemo(() => {
    const all: { candidate: PortalCandidate; project: PortalProject }[] = [];
    data.projects.forEach(project => {
      project.candidates.forEach(candidate => {
        all.push({ candidate, project });
      });
    });
    return all
      .sort((a, b) => new Date(b.candidate.updated_at).getTime() - new Date(a.candidate.updated_at).getTime())
      .slice(0, 5);
  }, [data]);

  if (!stats || stats.total === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center">
        <Users className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
        <h3 className="font-display text-[16px] font-bold mb-2">Aucun candidat pour le moment</h3>
        <p className="text-[13px] text-muted-foreground max-w-md mx-auto">
          Ton recruteur n'a pas encore présenté de candidat. Tu seras notifié dès qu'il en partagera.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* KPI strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="Total candidats" value={stats.total} icon={<Users className="w-4 h-4" />} />
        <KpiCard
          label="À évaluer"
          value={stats.toEvaluate}
          icon={<Eye className="w-4 h-4" />}
          highlight={stats.toEvaluate > 0 ? 'warning' : undefined}
        />
        <KpiCard label="En process" value={stats.inProcess} icon={<TrendingUp className="w-4 h-4" />} />
        <KpiCard
          label="Embauchés"
          value={stats.hired}
          icon={<Award className="w-4 h-4" />}
          highlight={stats.hired > 0 ? 'success' : undefined}
        />
      </div>

      {/* Funnel */}
      <div className="bg-card border border-border rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              Funnel de recrutement
            </p>
            <p className="text-[11px] text-muted-foreground/70 mt-0.5">
              Répartition des candidats par étape
            </p>
          </div>
          {stats.avgScore !== null && (
            <Pill variant="ai" icon={Star}>
              Score moyen {stats.avgScore}/100
            </Pill>
          )}
        </div>

        <FunnelChart data={data} />
      </div>

      {/* Top candidats + Activité récente */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              ⭐ Top candidats
            </p>
            <button
              type="button"
              onClick={() => onJumpTo('candidates')}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Voir tous <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          {topCandidates.length === 0 ? (
            <p className="text-[12px] text-muted-foreground italic py-4 text-center">
              Aucun candidat avec score ≥ 70 pour le moment.
            </p>
          ) : (
            <div className="space-y-2">
              {topCandidates.map(({ candidate, project }) => (
                <CandidateRow
                  key={candidate.id}
                  candidate={candidate}
                  project={project}
                  permissions={data.permissions}
                  onClick={() => onSelectCandidate({ candidate, project })}
                  compact
                />
              ))}
            </div>
          )}
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              📈 Activité récente
            </p>
            <button
              type="button"
              onClick={() => onJumpTo('pipeline')}
              className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
            >
              Pipeline <ChevronRight className="w-3 h-3" />
            </button>
          </div>
          <div className="space-y-2">
            {recentActivity.map(({ candidate, project }) => (
              <CandidateRow
                key={candidate.id}
                candidate={candidate}
                project={project}
                permissions={data.permissions}
                onClick={() => onSelectCandidate({ candidate, project })}
                compact
                showTime
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

const KpiCard: React.FC<{
  label: string;
  value: number;
  icon?: React.ReactNode;
  highlight?: 'warning' | 'success';
}> = ({ label, value, icon, highlight }) => {
  const color =
    highlight === 'warning' ? 'hsl(var(--status-warning))'
    : highlight === 'success' ? 'hsl(var(--status-success))'
    : undefined;

  return (
    <div className="bg-card border border-border rounded-xl p-4">
      <div className="flex items-center gap-1.5 text-muted-foreground mb-2">
        {icon}
        <p className="text-[10px] uppercase tracking-wider font-semibold">{label}</p>
      </div>
      <p
        className="font-display text-[28px] font-bold tabular-nums leading-none"
        style={color && value > 0 ? { color } : undefined}
      >
        {value}
      </p>
    </div>
  );
};

// Funnel chart simple (barres horizontales)
const FunnelChart: React.FC<{ data: ClientPortalData }> = ({ data }) => {
  const stages = ['sourced', 'presented', 'to_evaluate', 'interview', 'offer', 'hired'];
  const counts = stages.map(stageKey => {
    let count = 0;
    data.projects.forEach(project => {
      project.candidates.forEach(c => {
        const stage = getStageInfo(c.pipeline_stage);
        if (stage.order === STAGE_CONFIG[stageKey]?.order) count++;
      });
    });
    return { key: stageKey, ...STAGE_CONFIG[stageKey], count };
  });

  const max = Math.max(...counts.map(c => c.count), 1);

  return (
    <div className="space-y-2">
      {counts.map(s => {
        const pct = (s.count / max) * 100;
        const variantColor = {
          muted: 'hsl(var(--muted-foreground))',
          info: 'hsl(var(--status-info))',
          warning: 'hsl(var(--status-warning))',
          success: 'hsl(var(--status-success))',
        }[s.variant];
        return (
          <div key={s.key} className="flex items-center gap-3">
            <div className="w-32 text-[12px] inline-flex items-center gap-1.5 flex-shrink-0">
              <span>{s.emoji}</span>
              <span className={cn(s.count === 0 && 'text-muted-foreground')}>{s.label}</span>
            </div>
            <div className="flex-1 h-7 bg-muted/40 rounded-md overflow-hidden relative">
              {s.count > 0 && (
                <div
                  className="h-full rounded-md flex items-center px-3 transition-all"
                  style={{
                    width: `${Math.max(pct, 6)}%`,
                    background: variantColor + '33',
                    borderLeft: `3px solid ${variantColor}`,
                  }}
                >
                  <span className="font-display text-[13px] font-bold tabular-nums" style={{ color: variantColor }}>
                    {s.count}
                  </span>
                </div>
              )}
              {s.count === 0 && (
                <div className="h-full grid place-items-center text-[11px] text-muted-foreground/50">—</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ─── Tab : Pipeline ────────────────────────────────────────────────

const PipelineTab: React.FC<{
  data: ClientPortalData;
  onSelectCandidate: (item: { candidate: PortalCandidate; project: PortalProject }) => void;
}> = ({ data, onSelectCandidate }) => {
  if (data.projects.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-12 text-center">
        <Briefcase className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
        <p className="text-[13px] text-muted-foreground">Aucune mission active.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {data.projects.map(project => (
        <ProjectPipeline
          key={project.id}
          project={project}
          permissions={data.permissions}
          onSelectCandidate={(c) => onSelectCandidate({ candidate: c, project })}
        />
      ))}
    </div>
  );
};

const ProjectPipeline: React.FC<{
  project: PortalProject;
  permissions: ClientPortalData['permissions'];
  onSelectCandidate: (c: PortalCandidate) => void;
}> = ({ project, permissions, onSelectCandidate }) => {
  const stages = ['sourced', 'presented', 'to_evaluate', 'interview', 'offer', 'hired'];

  const candidatesByStage: Record<string, PortalCandidate[]> = {};
  stages.forEach(s => candidatesByStage[s] = []);
  project.candidates.forEach(c => {
    const stage = getStageInfo(c.pipeline_stage);
    const matchingStage = stages.find(s => STAGE_CONFIG[s].order === stage.order);
    if (matchingStage) candidatesByStage[matchingStage].push(c);
    else candidatesByStage.sourced.push(c);
  });

  return (
    <div className="bg-card border border-border rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-border flex items-center gap-2 flex-wrap">
        <Briefcase className="w-4 h-4 text-muted-foreground" />
        <h2 className="font-display text-[15px] font-bold">{project.name}</h2>
        <span className="text-[11px] text-muted-foreground">
          · {project.candidates.length} candidat{project.candidates.length > 1 ? 's' : ''}
        </span>
      </div>
      <div className="overflow-x-auto">
        <div className="flex gap-3 p-4 min-w-max">
          {stages.map(stageKey => {
            const cfg = STAGE_CONFIG[stageKey];
            const candidates = candidatesByStage[stageKey] || [];
            return (
              <div key={stageKey} className="w-[260px] flex flex-col bg-background/40 rounded-lg border border-border flex-shrink-0">
                <div className="px-3 py-2.5 border-b border-border flex items-center gap-2">
                  <span>{cfg.emoji}</span>
                  <p className="text-[12px] font-semibold flex-1">{cfg.label}</p>
                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded font-mono tabular-nums">
                    {candidates.length}
                  </span>
                </div>
                <div className="flex-1 p-2 space-y-2 max-h-[400px] overflow-y-auto">
                  {candidates.length === 0 ? (
                    <div className="py-6 text-center text-[10.5px] text-muted-foreground/50 italic">—</div>
                  ) : (
                    candidates.map(c => (
                      <PipelineCard
                        key={c.id}
                        candidate={c}
                        permissions={permissions}
                        onClick={() => onSelectCandidate(c)}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

const PipelineCard: React.FC<{
  candidate: PortalCandidate;
  permissions: ClientPortalData['permissions'];
  onClick: () => void;
}> = ({ candidate, permissions, onClick }) => {
  const displayName = permissions.can_see_names
    ? (candidate.candidate_name || 'Candidat')
    : `Candidat #${candidate.id.slice(0, 6)}`;
  const initial = permissions.can_see_names
    ? (candidate.candidate_name?.[0] || '?').toUpperCase()
    : '#';

  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full text-left bg-card border border-border rounded-md p-2.5 hover:border-foreground/30 hover:shadow-sm transition-all group"
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className="w-7 h-7 rounded-full bg-foreground/10 grid place-items-center text-[10px] font-semibold flex-shrink-0">
          {initial}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[12px] font-semibold truncate">{displayName}</p>
          {candidate.candidate_headline && permissions.can_see_names && (
            <p className="text-[10px] text-muted-foreground truncate">{candidate.candidate_headline}</p>
          )}
        </div>
        {candidate.score != null && (
          <ScoreBadge score={candidate.score} compact />
        )}
      </div>
      <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
        <Clock className="w-2.5 h-2.5" />
        {formatDistanceToNow(new Date(candidate.updated_at), { addSuffix: true, locale: fr })}
      </p>
    </button>
  );
};

// ─── Tab : Tous les candidats ──────────────────────────────────────

const CandidatesTab: React.FC<{
  data: ClientPortalData;
  candidates: { candidate: PortalCandidate; project: PortalProject }[];
  searchQuery: string;
  setSearchQuery: (v: string) => void;
  stageFilter: string | 'all';
  setStageFilter: (v: string | 'all') => void;
  projectFilter: string | 'all';
  setProjectFilter: (v: string | 'all') => void;
  onSelectCandidate: (item: { candidate: PortalCandidate; project: PortalProject }) => void;
}> = ({ data, candidates, searchQuery, setSearchQuery, stageFilter, setStageFilter, projectFilter, setProjectFilter, onSelectCandidate }) => (
  <div>
    {/* Filters */}
    <div className="flex items-center gap-2 mb-4 flex-wrap">
      <div className="relative flex-1 min-w-[200px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Rechercher un candidat, une mission…"
          className="w-full h-9 pl-9 pr-3 rounded-md border border-border bg-card text-[13px] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
        />
      </div>

      <select
        value={stageFilter}
        onChange={(e) => setStageFilter(e.target.value)}
        className="h-9 px-3 rounded-md border border-border bg-card text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
      >
        <option value="all">Toutes étapes</option>
        {Object.entries(STAGE_CONFIG)
          .sort(([, a], [, b]) => a.order - b.order)
          .map(([key, cfg]) => (
            <option key={key} value={key}>{cfg.emoji} {cfg.label}</option>
          ))}
      </select>

      {data.projects.length > 1 && (
        <select
          value={projectFilter}
          onChange={(e) => setProjectFilter(e.target.value)}
          className="h-9 px-3 rounded-md border border-border bg-card text-[12.5px] focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
        >
          <option value="all">Toutes missions</option>
          {data.projects.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      )}
    </div>

    {/* Results */}
    {candidates.length === 0 ? (
      <div className="rounded-xl border border-dashed border-border p-12 text-center">
        <Search className="w-8 h-8 text-muted-foreground/40 mx-auto mb-3" />
        <h3 className="font-display text-[14px] font-bold mb-1">Aucun candidat trouvé</h3>
        <p className="text-[12px] text-muted-foreground">
          Essaie d'autres mots-clés ou enlève les filtres.
        </p>
      </div>
    ) : (
      <div className="bg-card border border-border rounded-xl overflow-hidden">
        <div className="divide-y divide-border">
          {candidates.map(({ candidate, project }) => (
            <CandidateRow
              key={candidate.id}
              candidate={candidate}
              project={project}
              permissions={data.permissions}
              onClick={() => onSelectCandidate({ candidate, project })}
              showProject
              showTime
            />
          ))}
        </div>
      </div>
    )}
  </div>
);

// ─── Candidate Row (utilisée dans Top + Activity + List) ──────────

const CandidateRow: React.FC<{
  candidate: PortalCandidate;
  project: PortalProject;
  permissions: ClientPortalData['permissions'];
  onClick: () => void;
  compact?: boolean;
  showTime?: boolean;
  showProject?: boolean;
}> = ({ candidate, project, permissions, onClick, compact, showTime, showProject }) => {
  const displayName = permissions.can_see_names
    ? (candidate.candidate_name || 'Candidat')
    : `Candidat #${candidate.id.slice(0, 6)}`;
  const initial = permissions.can_see_names
    ? (candidate.candidate_name?.[0] || '?').toUpperCase()
    : '#';
  const stage = getStageInfo(candidate.pipeline_stage);

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full text-left flex items-center gap-3 hover:bg-muted/40 transition-colors',
        compact ? 'px-2.5 py-2 rounded-md' : 'px-4 py-3',
      )}
    >
      <div className={cn(
        'rounded-full bg-foreground/10 grid place-items-center font-semibold flex-shrink-0',
        compact ? 'w-7 h-7 text-[10px]' : 'w-9 h-9 text-[12px]',
      )}>
        {initial}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className={cn('font-medium truncate', compact ? 'text-[12.5px]' : 'text-[13px]')}>
            {displayName}
          </p>
          {showProject && (
            <span className="text-[10px] text-muted-foreground truncate">· {project.name}</span>
          )}
        </div>
        {candidate.candidate_headline && permissions.can_see_names && (
          <p className={cn('text-muted-foreground truncate', compact ? 'text-[10.5px]' : 'text-[11.5px]')}>
            {candidate.candidate_headline}
          </p>
        )}
      </div>

      <Pill variant={stage.variant}>
        {stage.emoji} {stage.label}
      </Pill>

      {candidate.score != null && <ScoreBadge score={candidate.score} compact={compact} />}

      {showTime && (
        <span className="text-[10.5px] text-muted-foreground inline-flex items-center gap-1 flex-shrink-0 hidden sm:inline-flex">
          <Clock className="w-3 h-3" />
          {formatDistanceToNow(new Date(candidate.updated_at), { addSuffix: true, locale: fr })}
        </span>
      )}
    </button>
  );
};

const ScoreBadge: React.FC<{ score: number; compact?: boolean }> = ({ score, compact }) => {
  const config = score >= 80
    ? { bg: 'hsl(var(--status-success-muted))', color: 'hsl(var(--status-success))' }
    : score >= 60
      ? { bg: 'hsl(var(--status-info-muted))', color: 'hsl(var(--status-info))' }
      : { bg: 'hsl(var(--muted))', color: 'hsl(var(--muted-foreground))' };
  return (
    <div
      className={cn(
        'rounded-md grid place-items-center font-display font-bold tabular-nums flex-shrink-0',
        compact ? 'w-9 h-9 text-[12px]' : 'w-10 h-10 text-[13px]',
      )}
      style={config}
    >
      {score}
    </div>
  );
};

// ─── Detail Sheet (slide-in droite) ───────────────────────────────

const CandidateSheet: React.FC<{
  item: { candidate: PortalCandidate; project: PortalProject };
  permissions: ClientPortalData['permissions'];
  clientName: string;
  portalToken: string;
  onClose: () => void;
}> = ({ item, permissions, clientName, portalToken, onClose }) => {
  const { candidate, project } = item;
  const displayName = permissions.can_see_names
    ? (candidate.candidate_name || 'Candidat')
    : `Candidat #${candidate.id.slice(0, 6)}`;
  const initial = permissions.can_see_names
    ? (candidate.candidate_name?.[0] || '?').toUpperCase()
    : '#';
  const stage = getStageInfo(candidate.pipeline_stage);

  // ESC to close
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-30 bg-black/50 backdrop-blur-sm konekt-fade-up"
        onClick={onClose}
      />
      {/* Sheet */}
      <div className="fixed right-0 top-0 bottom-0 z-40 w-full sm:max-w-lg bg-background border-l border-border shadow-2xl flex flex-col konekt-fade-up overflow-hidden">
        <div className="h-1 konekt-skalr-bg flex-shrink-0" />

        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="h-12 w-12 rounded-full bg-foreground/10 grid place-items-center text-[14px] font-bold flex-shrink-0">
              {initial}
            </div>
            <div className="min-w-0">
              <h2 className="font-display text-[18px] font-bold leading-tight truncate">{displayName}</h2>
              {candidate.candidate_headline && permissions.can_see_names && (
                <p className="text-[12px] text-muted-foreground truncate">{candidate.candidate_headline}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Meta */}
          <div className="flex items-center gap-2 flex-wrap">
            <Pill variant={stage.variant}>
              {stage.emoji} {stage.label}
            </Pill>
            {candidate.score != null && (
              <Pill variant="ai" icon={Star}>
                Score {candidate.score}/100
              </Pill>
            )}
            <Pill variant="muted">
              <Briefcase className="w-2.5 h-2.5" /> {project.name}
            </Pill>
          </div>

          {/* Timeline */}
          <div className="bg-card border border-border rounded-lg p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
              Activité
            </p>
            <div className="space-y-2 text-[12px]">
              <div className="flex items-center gap-2 text-muted-foreground">
                <CheckCircle className="w-3 h-3" style={{ color: 'hsl(var(--status-success))' }} />
                Présenté <span className="text-muted-foreground/70">·</span>{' '}
                {formatDistanceToNow(new Date(candidate.created_at), { addSuffix: true, locale: fr })}
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <Clock className="w-3 h-3" />
                Mise à jour <span className="text-muted-foreground/70">·</span>{' '}
                {formatDistanceToNow(new Date(candidate.updated_at), { addSuffix: true, locale: fr })}
              </div>
            </div>
          </div>

          {/* Scorecard (if can_fill) */}
          {permissions.can_fill_scorecard && (
            <div className="bg-card border border-border rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-border">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  Évaluation
                </p>
                <p className="text-[12px] text-foreground mt-0.5">
                  Donne ton feedback — il sera transmis à ton recruteur
                </p>
              </div>
              <div className="p-4">
                <PortalCandidateScoring
                  candidate={candidate}
                  projectId={project.id}
                  clientName={clientName}
                  canFillScorecard={permissions.can_fill_scorecard}
                  portalToken={portalToken}
                />
              </div>
            </div>
          )}

          {!permissions.can_fill_scorecard && permissions.can_comment && (
            <div className="bg-card border border-border rounded-lg p-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2 inline-flex items-center gap-1.5">
                <MessageSquare className="w-3 h-3" />
                Commentaire
              </p>
              <p className="text-[11.5px] text-muted-foreground italic">
                La fonction commentaires arrive bientôt.
              </p>
            </div>
          )}
        </div>
      </div>
    </>
  );
};
