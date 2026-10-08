import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, ChevronRight, Plus, Search } from 'lucide-react';
import { useSourcingAgentsHub } from '@/hooks/useSourcingAgentsHub';
import { AgentOrb } from '@/components/agent/AgentOrb';
import { SEOHead } from '@/components/SEOHead';
import { PageHeader, PageLayout, EmptyState, ErrorState } from '@/components/layout';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { sourcingAgentDate, sourcingAgentReason } from '@/types/sourcingAgent';
import type { SourcingAgentState } from '@/types/sourcingAgent';
import type { SourcingAgentHubItem, SourcingAgentHubMission } from '@/types/sourcingAgentsHub';

type Filter = 'all' | 'attention' | 'active' | 'paused';
const STATES: Record<SourcingAgentState, { label: string; tone: 'amber' | 'violet' | 'teal' | 'slate' }> = {
  draft: { label: 'À préparer', tone: 'amber' },
  calibrating: { label: 'Calibrage en cours', tone: 'violet' },
  active: { label: 'Activé', tone: 'teal' },
  paused: { label: 'En pause', tone: 'slate' },
  blocked: { label: 'Votre attention est requise', tone: 'amber' },
  awaiting_review: { label: 'Avis attendus', tone: 'violet' },
  stopped: { label: 'Arrêté', tone: 'slate' },
};
const isAttention = ({ agent, counts }: SourcingAgentHubItem) => counts.uncertain > 0 || counts.proposed > 0 || ['blocked', 'awaiting_review'].includes(agent.status);
const isActive = ({ agent }: SourcingAgentHubItem) => ['active', 'calibrating'].includes(agent.status);

function MissionPicker({ open, onOpenChange, missions, agents }: {
  open: boolean; onOpenChange: (open: boolean) => void; missions: SourcingAgentHubMission[]; agents: SourcingAgentHubItem[];
}) {
  const [search, setSearch] = useState('');
  const available = missions.filter((mission) => mission.status === 'active');
  const filtered = available.filter((mission) => `${mission.name} ${mission.client_name ?? ''}`.toLocaleLowerCase('fr').includes(search.trim().toLocaleLowerCase('fr')));
  return <Dialog open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setSearch(''); }}>
    <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto max-sm:[&>button:last-child]:min-h-11 max-sm:[&>button:last-child]:min-w-11">
      <DialogHeader><DialogTitle>Un agent pour quelle mission ?</DialogTitle><DialogDescription>Le brief de la mission servira de point de départ. Vous choisirez la source et validerez le calibrage avant toute recherche continue.</DialogDescription></DialogHeader>
      <Input aria-label="Rechercher une mission" placeholder="Rechercher une mission…" value={search} onChange={(event) => setSearch(event.target.value)} className="min-h-11" />
      {filtered.length > 0 ? <ul className="divide-y divide-border">{filtered.map((mission) => {
        const exists = agents.some(({ agent }) => agent.project_id === mission.id);
        return <li key={mission.id}><Link onClick={() => onOpenChange(false)} to={`/agents/sourcing/${mission.id}`} className="flex min-h-16 items-center gap-3 rounded-lg p-3 hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <AgentOrb size="md" tone={exists ? 'teal' : 'amber'} /><span className="min-w-0 flex-1"><span className="block text-sm font-medium break-words">{mission.name}</span><span className="block text-xs text-muted-foreground">{mission.client_name || 'Votre mission'} · {exists ? 'Ouvrir l’agent existant' : 'Préparer un agent'}</span></span><ChevronRight className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
        </Link></li>;
      })}</ul> : <EmptyState variant="compact" icon={Search} title={available.length ? 'Aucune mission ne correspond' : 'Une mission active pour commencer'} description={available.length ? 'Essayez un autre nom de mission.' : 'Les missions actives de votre espace apparaîtront ici.'} action={!available.length && <Button asChild variant="outline" className="min-h-11"><Link to="/missions" onClick={() => onOpenChange(false)}>Voir mes missions</Link></Button>} />}
    </DialogContent>
  </Dialog>;
}

function AgentCard({ item }: { item: SourcingAgentHubItem }) {
  const { agent, mission, counts } = item;
  const state = STATES[agent.status];
  const today = agent.daily_date === new Date().toISOString().slice(0, 10);
  const credits = today ? agent.credits_used : 0;
  const reason = sourcingAgentReason(agent.last_reason);
  const next = sourcingAgentDate(agent.next_run_at);
  const last = sourcingAgentDate(agent.last_run_at);
  return <article className="flex min-w-0 flex-col rounded-xl border border-border bg-card p-5">
    <div className="mb-5 flex items-center justify-between gap-3"><AgentOrb tone={state.tone} size="lg" animated={isActive(item)} /><Badge variant={isAttention(item) ? 'warning' : agent.status === 'active' ? 'info' : 'muted'} className="max-w-[70%] whitespace-normal">{state.label}</Badge></div>
    <p className="text-xs text-muted-foreground">Sourcing · {agent.source === 'pool' ? 'Candidats enregistrés' : agent.api === 'recruiter' ? 'LinkedIn Recruiter' : agent.api === 'sales_navigator' ? 'LinkedIn Sales Navigator' : 'LinkedIn'}</p>
    <h3 className="mt-1 break-words text-lg font-semibold">{mission?.name || 'Mission indisponible'}</h3>
    {mission?.client_name && <p className="mt-1 truncate text-sm text-muted-foreground">{mission.client_name}</p>}
    <dl className="my-5 grid grid-cols-3 gap-2 border-y border-border py-3">
      <div><dt className="text-xs text-muted-foreground">À relire</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{counts.proposed}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Évalués</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{counts.evaluated}</dd></div>
      <div><dt className="text-xs text-muted-foreground">Avis donnés</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{counts.reviewed}</dd></div>
    </dl>
    <div className="mb-5 flex-1 space-y-2 text-xs text-muted-foreground">
      {counts.uncertain > 0 ? <p className="font-medium text-foreground">{counts.uncertain} évaluation{counts.uncertain > 1 ? 's' : ''} interrompue{counts.uncertain > 1 ? 's' : ''} à résoudre</p> : reason ? <p>{reason}</p> : next && isActive(item) ? <p>Prochain passage : {next}</p> : <p>{agent.status === 'draft' ? 'Préparez la recherche, puis calibrez les premiers profils.' : 'Ouvrez l’agent pour consulter ses propositions.'}</p>}
      {last && <p>Dernier passage : {last}</p>}
      <p>{credits} crédits utilisés aujourd’hui{agent.credits_reserved > 0 ? ` · ${agent.credits_reserved} réservés` : ''} · cible {agent.settings.daily_credit_limit}/jour</p>
    </div>
    <Button asChild variant="outline" className="min-h-11 w-full justify-between"><Link to={`/agents/sourcing/${agent.project_id}`}><span>{isAttention(item) ? 'Examiner les propositions' : agent.status === 'draft' ? 'Continuer la préparation' : 'Ouvrir l’agent'}</span><ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Button>
  </article>;
}

export default function SourcingAgentsHub() {
  const query = useSourcingAgentsHub();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const agents = query.agents;
  const active = agents.filter(isActive).length;
  const attention = agents.filter(isAttention).length;
  const evaluated = agents.reduce((sum, item) => sum + item.counts.evaluated, 0);
  const filtered = agents.filter((item) => (filter === 'all' || filter === 'attention' && isAttention(item) || filter === 'active' && isActive(item) || filter === 'paused' && ['paused', 'stopped'].includes(item.agent.status))
    && `${item.mission?.name ?? ''} ${item.mission?.client_name ?? ''}`.toLocaleLowerCase('fr').includes(search.trim().toLocaleLowerCase('fr')));
  return <PageLayout maxWidth="lg">
    <SEOHead title="Agents | Konekt" description="Pilotez vos agents de sourcing et retrouvez leurs propositions." />
    <PageHeader title="Agents" subtitle="Vos recherches continues, leurs propositions et les décisions qui vous attendent." actions={<Button variant="primary" className="min-h-11" onClick={() => setPickerOpen(true)} disabled={query.isLoading || query.isError}><Plus aria-hidden="true" />Nouvel agent</Button>} />
    <section aria-labelledby="agents-intro" className="relative mb-7 overflow-hidden rounded-xl border border-border bg-card p-5 sm:p-8">
      <div className="flex flex-col-reverse gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative z-10 min-w-0 max-w-lg"><p className="mb-3 flex items-center gap-2 text-xs font-medium text-muted-foreground"><AgentOrb size="sm" tone="teal" />Le sourcing, avec votre regard</p><h2 id="agents-intro" className="text-2xl font-semibold tracking-tight sm:text-3xl">Une recherche qui continue.<br />Des décisions qui vous ressemblent.</h2><p className="mt-4 max-w-md text-sm leading-relaxed text-muted-foreground">Un agent par mission, guidé par votre brief, vos filtres et vos mémoires. Calibrez ses premiers profils, puis retrouvez ici ses propositions.</p>
          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">{['Vous choisissez les sources', 'Vous validez le calibrage', 'Vous gardez la main'].map((label) => <span key={label} className="flex items-center gap-1.5"><Check className="h-3.5 w-3.5" aria-hidden="true" />{label}</span>)}</div>
        </div>
        <div className="relative mx-auto flex h-40 w-64 shrink-0 items-center justify-center sm:h-52 sm:w-72" aria-hidden="true"><AgentOrb tone="violet" size="lg" className="absolute left-0 top-6" /><AgentOrb tone="amber" size="hero" animated className="relative z-10" /><AgentOrb tone="teal" size="lg" className="absolute bottom-3 right-0" /></div>
      </div>
    </section>
    {query.isError && <ErrorState variant="compact" className="mb-5 max-sm:[&_button]:min-h-11" title="Vos agents n’ont pas pu être actualisés." description={agents.length ? 'Le dernier état connu reste affiché. Ouvrez un agent pour vérifier son état actuel.' : 'Réessayez pour afficher la liste actuelle de votre espace.'} onRetry={() => void query.refetch()} retrying={query.isFetching} />}
    {query.isLoading ? <div aria-label="Chargement de vos agents" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[1, 2, 3].map((key) => <Skeleton key={key} className="h-72 rounded-xl" />)}</div> : query.isError && agents.length === 0 ? null : agents.length === 0 ? <section aria-labelledby="first-agent" className="flex flex-col items-center py-8 text-center"><AgentOrb tone="teal" size="lg" /><h2 id="first-agent" className="mt-4 text-lg font-semibold">Votre premier agent commence avec une mission</h2><p className="mt-2 max-w-lg text-sm text-muted-foreground">Choisissez une mission, préparez sa recherche et donnez votre avis sur cinq profils. La recherche continue démarre après votre validation.</p><Button className="mt-5 min-h-11" variant="primary" onClick={() => setPickerOpen(true)}><Plus aria-hidden="true" />Configurer mon premier agent</Button></section> : <>
      <dl className="mb-6 grid grid-cols-3 divide-x divide-border border-b border-border pb-5">
        {[['Agents activés', active], ['Agents à revoir', attention], ['Profils évalués', evaluated]].map(([label, value]) => <div key={label} className="px-3 first:pl-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{value}</dd></div>)}
      </dl>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div className="flex flex-wrap gap-1" role="group" aria-label="Filtrer les agents">{([['all', 'Tous'], ['attention', 'À revoir'], ['active', 'Activés'], ['paused', 'En pause / arrêtés']] as const).map(([value, label]) => <Button key={value} size="sm" variant={filter === value ? 'secondary' : 'ghost'} className="min-h-11" aria-pressed={filter === value} onClick={() => setFilter(value)}>{label}</Button>)}</div><Input className="min-h-11 w-full sm:w-60" aria-label="Rechercher un agent par mission" placeholder="Rechercher une mission…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      <p className="mb-4 text-xs text-muted-foreground">{filtered.length} agent{filtered.length > 1 ? 's' : ''} · Compteurs de profils selon les critères enregistrés de chaque agent.</p>
      {filtered.length ? <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{filtered.map((item) => <AgentCard key={item.agent.id} item={item} />)}</div> : <EmptyState icon={Search} title="Aucun agent dans cette vue" description="Changez le filtre ou le nom de mission recherché." action={<Button variant="outline" className="min-h-11" onClick={() => { setFilter('all'); setSearch(''); }}>Afficher tous les agents</Button>} />}
    </>}
    <MissionPicker open={pickerOpen} onOpenChange={setPickerOpen} missions={query.missions} agents={agents} />
  </PageLayout>;
}
