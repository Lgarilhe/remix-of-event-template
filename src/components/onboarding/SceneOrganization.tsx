import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, Users, TrendingUp, Building2, Briefcase, Globe, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';
import searchIcon from '@/assets/icon-search-3d.png';

/* ─── Types ─── */
interface Props {
  onComplete: () => void;
  onBack: () => void;
}

interface Source {
  id: string;
  label: string;
  done: boolean;
}

interface AgentBubble {
  id: number;
  text: string;
}

interface CompanyData {
  name: string;
  domain: string;
  industry: string;
  size: string;
  location: string;
  funding: string;
  description: string;
  techStack: string[];
  insights: string[];
  decisionMakers: { name: string; role: string }[];
  openRoles: { title: string; location: string; source: string }[];
  market: {
    totalFrance: number;
    idf: number;
    remote: number;
    activelyLooking: number;
    competitors: { name: string; domain: string }[];
    seniority: { junior: number; mid: number; senior: number; staff: number };
  };
}

/* ─── Fake data ─── */
const FAKE_COMPANY: CompanyData = {
  name: 'Numspot',
  domain: 'numspot.com',
  industry: 'Cloud souverain · SaaS',
  size: '50-200',
  location: 'Paris, France',
  funding: 'Série A · 25M€',
  description: 'Cloud souverain français dédié aux organisations publiques et entreprises sensibles.',
  techStack: ['Kubernetes', 'Go', 'Terraform', 'OpenStack', 'Python', 'React', 'PostgreSQL'],
  insights: [
    '🔥 Marché du cloud souverain en forte croissance (+34% YoY)',
    '⚡ Profils DevOps/SRE très demandés — délai moyen de recrutement : 67 jours',
    '📈 L\'entreprise a doublé ses effectifs en 12 mois',
    '🎯 Concurrence directe avec OVHcloud, Scaleway et Outscale',
  ],
  decisionMakers: [
    { name: 'Alain Issarni', role: 'CEO' },
    { name: 'Sophie Viger', role: 'VP Engineering' },
    { name: 'Marc Dufour', role: 'DRH' },
  ],
  openRoles: [
    { title: 'Lead DevOps Engineer', location: 'Paris', source: 'LinkedIn' },
    { title: 'Product Manager Cloud', location: 'Paris', source: 'WTTJ' },
    { title: 'Ingénieur SRE', location: 'Remote', source: 'LinkedIn' },
    { title: 'Développeur Go Senior', location: 'Paris', source: 'Site carrière' },
    { title: 'Data Engineer', location: 'Lyon', source: 'WTTJ' },
  ],
  market: {
    totalFrance: 12400,
    idf: 7800,
    remote: 3200,
    activelyLooking: 1850,
    competitors: [
      { name: 'OVHcloud', domain: 'ovhcloud.com' },
      { name: 'Scaleway', domain: 'scaleway.com' },
      { name: 'Outscale', domain: 'outscale.com' },
      { name: 'Clever Cloud', domain: 'clever-cloud.com' },
    ],
    seniority: { junior: 15, mid: 40, senior: 32, staff: 13 },
  },
};

const SCAN_SOURCES: Source[] = [
  { id: 'apollo', label: 'Apollo', done: false },
  { id: 'linkedin', label: 'LinkedIn', done: false },
  { id: 'web', label: 'Web', done: false },
  { id: 'wttj', label: 'WTTJ', done: false },
  { id: 'careers', label: 'Site carrière', done: false },
];

const AGENT_MESSAGES = [
  "Je recherche des infos sur cette société...",
  "J'ai trouvé le domaine et les données Apollo 🎯",
  "Analyse du profil LinkedIn entreprise...",
  "Scan des offres d'emploi en cours...",
  "Récupération des données marché...",
  "Enrichissement terminé ! Voici ce que j'ai trouvé 👇",
];

/* ─── Component ─── */
export const SceneOrganization: React.FC<Props> = ({ onComplete, onBack }) => {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'results'>('idle');
  const [sources, setSources] = useState<Source[]>(SCAN_SOURCES);
  const [bubbles, setBubbles] = useState<AgentBubble[]>([]);
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'market'>('overview');
  const [selectedRoles, setSelectedRoles] = useState<Set<number>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const bubblesEndRef = useRef<HTMLDivElement>(null);
  const { createOrganization } = useOrganization();

  // Auto-scroll bubbles
  useEffect(() => {
    bubblesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles]);

  const startScan = useCallback((name: string) => {
    setPhase('scanning');
    setSources(SCAN_SOURCES.map((s) => ({ ...s, done: false })));
    setBubbles([]);
    setCompany(null);

    // Animate sources completing one by one
    SCAN_SOURCES.forEach((_, i) => {
      setTimeout(() => {
        setSources((prev) => prev.map((s, j) => (j <= i ? { ...s, done: true } : s)));
      }, 800 + i * 700);
    });

    // Typewriter agent messages
    AGENT_MESSAGES.forEach((msg, i) => {
      setTimeout(() => {
        setBubbles((prev) => [...prev, { id: i, text: msg }]);
      }, 600 + i * 800);
    });

    // Show results
    setTimeout(() => {
      setCompany({ ...FAKE_COMPANY, name });
      setPhase('results');
    }, 600 + AGENT_MESSAGES.length * 800 + 400);
  }, []);

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (val.trim().length >= 3) {
      debounceRef.current = setTimeout(() => startScan(val.trim()), 600);
    } else {
      setPhase('idle');
    }
  };

  const toggleRole = (idx: number) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const generateSlug = (value: string) =>
    value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const handleContinue = async () => {
    if (!company) return;
    setIsCreating(true);
    try {
      await createOrganization({ name: company.name, slug: generateSlug(company.name) });
      onComplete();
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('duplicate key') || msg.includes('organizations_slug_key')) {
        toast.error('Cette organisation existe déjà.');
      } else {
        toast.error(msg || 'Erreur lors de la création');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const tabs = [
    { key: 'overview' as const, label: 'Aperçu' },
    { key: 'roles' as const, label: `Postes ouverts (${company?.openRoles.length ?? 0})` },
    { key: 'market' as const, label: 'Marché' },
  ];

  return (
    <div className="w-full max-w-2xl mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span className="skalr-gradient-text text-[11px] uppercase tracking-[0.2em] font-semibold" style={{ fontFamily: "'Space Mono', monospace" }}>
          01 — Votre société
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">Parlez-nous de vous</h2>
        <p className="text-muted-foreground text-sm">Entrez le nom de votre société, on récupère tout automatiquement.</p>
      </div>

      {/* Search input */}
      <div className="relative">
        <img src={searchIcon} alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => handleInputChange(e.target.value)}
          placeholder="Le nom de votre société..."
          autoFocus
          className="pl-11 pr-10 border-2 border-foreground/20 focus:border-foreground focus:shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] transition-shadow text-sm h-11"
        />
        {phase === 'scanning' && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin" style={{ color: 'hsl(var(--skalr-pink))' }} />
        )}
      </div>

      {/* Scanning phase */}
      <AnimatePresence mode="wait">
        {phase === 'scanning' && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-[180px_1fr] gap-4 min-h-[200px]"
          >
            {/* Sources */}
            <div className="space-y-2">
              {sources.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="flex items-center gap-2"
                >
                  <div
                    className={`w-6 h-6 flex items-center justify-center text-[10px] font-bold border transition-all duration-300 ${
                      s.done
                        ? 'border-transparent text-foreground'
                        : 'border-foreground/20 text-muted-foreground'
                    }`}
                    style={s.done ? { background: 'hsl(var(--brutal-accent))' } : {}}
                  >
                    {s.done ? <Check className="w-3 h-3" /> : String(i + 1).padStart(2, '0')}
                  </div>
                  <span className={`text-xs transition-colors ${s.done ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                    {s.label}
                  </span>
                </motion.div>
              ))}
            </div>

            {/* Agent bubbles */}
            <div className="flex flex-col gap-2 max-h-[220px] overflow-y-auto no-scrollbar pr-1">
              {bubbles.map((b) => (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, y: 8, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className="bg-muted/60 border border-foreground/5 px-3 py-2 text-xs text-foreground/80 rounded-sm"
                >
                  {b.text}
                </motion.div>
              ))}
              <div ref={bubblesEndRef} />
            </div>
          </motion.div>
        )}

        {/* Results phase */}
        {phase === 'results' && company && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-4"
          >
            {/* Company card */}
            <div
              className="border-2 border-foreground/80 p-4 flex items-start gap-4"
              style={{ boxShadow: '4px 4px 0px 0px hsl(var(--brutal-accent))' }}
            >
              <img
                src={`https://logo.clearbit.com/${company.domain}`}
                alt={company.name}
                className="w-12 h-12 border border-foreground/10 bg-background object-contain"
                onError={(e) => { (e.target as HTMLImageElement).src = `https://ui-avatars.com/api/?name=${company.name}&background=random&size=48`; }}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-lg leading-tight">{company.name}</h3>
                  <span
                    className="text-[9px] uppercase tracking-wider font-bold px-2 py-0.5 border border-foreground"
                    style={{ background: 'hsl(var(--landing-accent-yellow))' }}
                  >
                    Enrichi
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">{company.industry}</p>
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1"><Users className="w-3 h-3" />{company.size}</span>
                  <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{company.location}</span>
                  <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />{company.funding}</span>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-0 border-b-2 border-foreground/10">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 -mb-[2px] ${
                    activeTab === t.key
                      ? 'border-foreground text-foreground'
                      : 'border-transparent text-muted-foreground hover:text-foreground/70'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <AnimatePresence mode="wait">
              <motion.div
                key={activeTab}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
              >
                {activeTab === 'overview' && <TabOverview company={company} />}
                {activeTab === 'roles' && (
                  <TabRoles
                    roles={company.openRoles}
                    selected={selectedRoles}
                    onToggle={toggleRole}
                  />
                )}
                {activeTab === 'market' && <TabMarket market={company.market} />}
              </motion.div>
            </AnimatePresence>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-2">
              <Button variant="outline" onClick={onBack} className="gap-2 border-2 border-foreground/20 text-sm">
                <ArrowLeft className="w-4 h-4" /> Retour
              </Button>
              <Button
                onClick={handleContinue}
                disabled={isCreating}
                className="gap-2 border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
                style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
              >
                {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                {isCreating ? 'Création...' : 'Continuer'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

/* ─── Tab: Overview ─── */
const TabOverview: React.FC<{ company: CompanyData }> = ({ company }) => (
  <div className="space-y-4">
    {/* Insights */}
    <div className="border border-foreground/10 p-4 space-y-2">
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ce qu'on a trouvé</h4>
      {company.insights.map((insight, i) => (
        <p key={i} className="text-sm text-foreground/80">{insight}</p>
      ))}
    </div>

    {/* Tech stack */}
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Stack technique</h4>
      <div className="flex flex-wrap gap-1.5">
        {company.techStack.map((tech) => (
          <span key={tech} className="text-[11px] px-2 py-0.5 border border-foreground/15 bg-muted/50 font-medium">
            {tech}
          </span>
        ))}
      </div>
    </div>

    {/* Decision makers */}
    <div>
      <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Décideurs clés</h4>
      <div className="space-y-2">
        {company.decisionMakers.map((dm) => (
          <div key={dm.name} className="flex items-center gap-3">
            <img
              src={`https://ui-avatars.com/api/?name=${encodeURIComponent(dm.name)}&background=random&size=32&font-size=0.4`}
              alt={dm.name}
              className="w-8 h-8 border border-foreground/10"
            />
            <div>
              <span className="text-sm font-medium">{dm.name}</span>
              <span className="text-xs text-muted-foreground ml-2">{dm.role}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  </div>
);

/* ─── Tab: Open Roles ─── */
const TabRoles: React.FC<{
  roles: CompanyData['openRoles'];
  selected: Set<number>;
  onToggle: (idx: number) => void;
}> = ({ roles, selected, onToggle }) => (
  <div className="space-y-3">
    {roles.map((role, i) => (
      <label
        key={i}
        className="flex items-center gap-3 p-3 border border-foreground/10 hover:border-foreground/25 transition-colors cursor-pointer"
      >
        <Checkbox
          checked={selected.has(i)}
          onCheckedChange={() => onToggle(i)}
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{role.title}</span>
            <span className="text-[10px] px-1.5 py-0.5 bg-muted text-muted-foreground font-mono">{role.source}</span>
          </div>
          <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
            <MapPin className="w-3 h-3" />{role.location}
          </span>
        </div>
      </label>
    ))}
    <p className="text-xs text-muted-foreground italic pt-1">
      Les postes sélectionnés seront créés comme missions dans votre espace.
    </p>
  </div>
);

/* ─── Tab: Market ─── */
const TabMarket: React.FC<{ market: CompanyData['market'] }> = ({ market }) => {
  const kpis = [
    { label: 'Total France', value: market.totalFrance.toLocaleString('fr-FR'), color: 'hsl(var(--skalr-purple))' },
    { label: 'Île-de-France', value: market.idf.toLocaleString('fr-FR'), color: 'hsl(var(--skalr-blue))' },
    { label: 'Remote', value: market.remote.toLocaleString('fr-FR'), color: 'hsl(var(--skalr-cyan))' },
    { label: 'En recherche active', value: market.activelyLooking.toLocaleString('fr-FR'), color: 'hsl(var(--skalr-green))' },
  ];

  const seniorityTotal = market.seniority.junior + market.seniority.mid + market.seniority.senior + market.seniority.staff;
  const senioritySegments = [
    { label: 'Junior', pct: market.seniority.junior, color: 'hsl(var(--skalr-cyan))' },
    { label: 'Mid', pct: market.seniority.mid, color: 'hsl(var(--skalr-blue))' },
    { label: 'Senior', pct: market.seniority.senior, color: 'hsl(var(--skalr-purple))' },
    { label: 'Staff+', pct: market.seniority.staff, color: 'hsl(var(--skalr-pink))' },
  ];

  return (
    <div className="space-y-5">
      {/* KPIs */}
      <div className="grid grid-cols-2 gap-3">
        {kpis.map((k) => (
          <div key={k.label} className="border border-foreground/10 p-3 text-center">
            <div className="text-2xl font-bold" style={{ color: k.color }}>{k.value}</div>
            <div className="text-[11px] text-muted-foreground uppercase tracking-wider mt-1">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Competitors */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">
          Entreprises qui recrutent les mêmes profils
        </h4>
        <div className="flex flex-wrap gap-3">
          {market.competitors.map((c) => (
            <div key={c.name} className="flex items-center gap-2 border border-foreground/10 px-3 py-2">
              <img
                src={`https://logo.clearbit.com/${c.domain}`}
                alt={c.name}
                className="w-5 h-5 object-contain"
                onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
              />
              <span className="text-sm font-medium">{c.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Seniority bar */}
      <div>
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Répartition séniorité</h4>
        <div className="flex h-3 w-full overflow-hidden border border-foreground/10">
          {senioritySegments.map((seg) => (
            <div
              key={seg.label}
              style={{ width: `${seg.pct}%`, background: seg.color }}
              className="h-full transition-all"
            />
          ))}
        </div>
        <div className="flex justify-between mt-1.5">
          {senioritySegments.map((seg) => (
            <span key={seg.label} className="text-[10px] text-muted-foreground">
              {seg.label} {seg.pct}%
            </span>
          ))}
        </div>
      </div>
    </div>
  );
};
