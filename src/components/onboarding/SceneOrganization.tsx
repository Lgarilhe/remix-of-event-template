import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, Users, TrendingUp, Building2, Briefcase, Globe, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
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

interface CompanyCandidate {
  name: string;
  domain: string | null;
  description: string | null;
  logoUrl: string | null;
  location: string | null;
  source: string;
}

interface CompanyData {
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  funding: string | null;
  description: string | null;
  techStack: string[];
  insights: string[];
  decisionMakers: { name: string; role: string; linkedinUrl?: string | null }[];
  openRoles: { title: string; location: string; source: string }[];
  linkedinUrl: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
}

const SCAN_SOURCES: Source[] = [
  { id: 'apollo', label: 'Apollo', done: false },
  { id: 'linkedin', label: 'LinkedIn', done: false },
  { id: 'web', label: 'Web', done: false },
  { id: 'wttj', label: 'WTTJ', done: false },
  { id: 'careers', label: 'Site carrière', done: false },
];

const AGENT_MESSAGES = [
  "Je recherche des infos sur cette société...",
  "Enrichissement via Apollo 🎯",
  "Scraping du site web en cours...",
  "Recherche des décideurs clés...",
  "Analyse des postes ouverts...",
  "Enrichissement terminé ! Voici ce que j'ai trouvé 👇",
];

/* ─── Component ─── */
export const SceneOrganization: React.FC<Props> = ({ onComplete, onBack }) => {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<'idle' | 'searching' | 'choosing' | 'scanning' | 'results'>('idle');
  const [candidates, setCandidates] = useState<CompanyCandidate[]>([]);
  const [sources, setSources] = useState<Source[]>(SCAN_SOURCES);
  const [bubbles, setBubbles] = useState<AgentBubble[]>([]);
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'roles' | 'market'>('overview');
  const [selectedRoles, setSelectedRoles] = useState<Set<number>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const bubblesEndRef = useRef<HTMLDivElement>(null);
  const { createOrganization } = useOrganization();

  useEffect(() => {
    bubblesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles]);

  // Step 1: Search for candidate companies
  const handleSearch = useCallback(async () => {
    const name = query.trim();
    if (name.length < 2) return;
    setPhase('searching');
    setCandidates([]);

    try {
      const { data, error } = await invokeEdgeFunction<{ candidates: CompanyCandidate[] }>('enrich-company', {
        company_name: name,
        mode: 'search',
      });

      if (error || !data?.success || !data.candidates?.length) {
        // No candidates found — go straight to enrichment with just the name
        startEnrichment(name, null);
        return;
      }

      // If only 1 candidate, auto-select it
      if (data.candidates.length === 1) {
        const c = data.candidates[0];
        startEnrichment(c.name, c.domain);
        return;
      }

      setCandidates(data.candidates);
      setPhase('choosing');
    } catch {
      // Fallback: enrich with just the name
      startEnrichment(name, null);
    }
  }, [query]);

  // Step 2: Enrich the selected company
  const startEnrichment = useCallback(async (name: string, domain: string | null) => {
    setPhase('scanning');
    setSources(SCAN_SOURCES.map((s) => ({ ...s, done: false })));
    setBubbles([]);
    setCompany(null);

    // Animate sources
    SCAN_SOURCES.forEach((_, i) => {
      setTimeout(() => {
        setSources((prev) => prev.map((s, j) => (j <= i ? { ...s, done: true } : s)));
      }, 800 + i * 700);
    });

    AGENT_MESSAGES.forEach((msg, i) => {
      setTimeout(() => {
        setBubbles((prev) => [...prev, { id: i, text: msg }]);
      }, 600 + i * 800);
    });

    try {
      const body: Record<string, unknown> = { company_name: name };
      if (domain) body.domain = domain;

      const { data, error } = await invokeEdgeFunction<{ company: CompanyData }>('enrich-company', body);

      const enriched = (!error && data?.success && data.company) ? data.company : {
        name,
        domain, industry: null, size: null, location: null,
        funding: null, description: null, techStack: [], insights: [],
        decisionMakers: [], openRoles: [], linkedinUrl: null, websiteUrl: domain ? `https://${domain}` : null, logoUrl: null,
      };

      // Store for SceneAudit
      try {
        sessionStorage.setItem('onboarding_company', JSON.stringify({
          name: enriched.name,
          domain: enriched.domain,
          linkedinUrl: enriched.linkedinUrl,
        }));
      } catch {}

      const totalAnimTime = 600 + AGENT_MESSAGES.length * 800 + 400;
      setTimeout(() => {
        setCompany(enriched);
        setPhase('results');
      }, totalAnimTime);
    } catch (err) {
      console.error('[SceneOrganization] Error:', err);
      toast.error("Erreur lors de l'enrichissement.");
      const totalAnimTime = 600 + AGENT_MESSAGES.length * 800 + 400;
      setTimeout(() => {
        setCompany({
          name, domain, industry: null, size: null, location: null,
          funding: null, description: null, techStack: [], insights: [],
          decisionMakers: [], openRoles: [], linkedinUrl: null, websiteUrl: null, logoUrl: null,
        });
        setPhase('results');
      }, totalAnimTime);
    }
  }, []);

  const handleInputChange = (val: string) => {
    setQuery(val);
    if (val.trim().length < 2 && phase !== 'idle') {
      setPhase('idle');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  const selectCandidate = (c: CompanyCandidate) => {
    startEnrichment(c.name, c.domain);
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
      <div className="relative flex gap-2">
        <div className="relative flex-1">
          <img src={searchIcon} alt="" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Le nom de votre société..."
            autoFocus
            className="pl-11 pr-4 border-2 border-foreground/20 focus:border-foreground focus:shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] transition-shadow text-sm h-11"
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={query.trim().length < 2 || phase === 'searching' || phase === 'scanning'}
          className="h-11 px-5 border-2 border-foreground bg-foreground text-background hover:bg-foreground/90 text-sm shrink-0"
          style={{ boxShadow: '3px 3px 0px 0px hsl(var(--brutal-accent))' }}
        >
          {phase === 'searching' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rechercher'}
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {/* Choosing phase — user picks the right company */}
        {phase === 'choosing' && candidates.length > 0 && (
          <motion.div
            key="choosing"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-2"
          >
            <p className="text-sm text-muted-foreground">Plusieurs résultats trouvés. Sélectionnez votre société :</p>
            <div className="space-y-2">
              {candidates.map((c, i) => (
                <motion.button
                  key={i}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  onClick={() => selectCandidate(c)}
                  className="w-full flex items-center gap-3 p-3 border-2 border-foreground/15 hover:border-foreground/50 hover:shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] transition-all text-left group"
                >
                  <img
                    src={c.logoUrl || `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=random&size=40`}
                    alt={c.name}
                    className="w-10 h-10 border border-foreground/10 bg-background object-contain rounded-sm shrink-0"
                    onError={(e) => {
                      const img = e.target as HTMLImageElement;
                      if (c.domain && !img.src.includes('google.com/s2')) {
                        img.src = `https://www.google.com/s2/favicons?domain=${c.domain}&sz=64`;
                      } else {
                        img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(c.name)}&background=random&size=40`;
                      }
                    }}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold truncate">{c.name}</span>
                      {c.domain && (
                        <span className="text-[10px] text-muted-foreground font-mono truncate">{c.domain}</span>
                      )}
                    </div>
                    {c.description && (
                      <p className="text-xs text-muted-foreground truncate mt-0.5">{c.description}</p>
                    )}
                    {c.location && (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-1 mt-0.5">
                        <MapPin className="w-2.5 h-2.5" />{c.location}
                      </span>
                    )}
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground transition-colors shrink-0" />
                </motion.button>
              ))}
            </div>
            <button
              onClick={() => startEnrichment(query.trim(), null)}
              className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 mt-1"
            >
              Aucune ne correspond ? Continuer avec "{query.trim()}"
            </button>
          </motion.div>
        )}

        {/* Scanning phase */}
        {phase === 'scanning' && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-[180px_1fr] gap-4 min-h-[200px]"
          >
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
                src={company.logoUrl || (company.domain ? `https://logo.clearbit.com/${company.domain}` : `https://ui-avatars.com/api/?name=${encodeURIComponent(company.name)}&background=random&size=64`)}
                alt={company.name}
                className="w-14 h-14 border border-foreground/10 bg-background object-contain rounded-sm"
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  if (company.domain && !img.src.includes('google.com/s2')) {
                    img.src = `https://www.google.com/s2/favicons?domain=${company.domain}&sz=64`;
                  } else {
                    img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(company.name)}&background=random&size=64`;
                  }
                }}
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
                {company.industry && <p className="text-xs text-muted-foreground mt-0.5">{company.industry}</p>}
                <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
                  {company.size && <span className="flex items-center gap-1"><Users className="w-3 h-3" />{company.size}</span>}
                  {company.location && <span className="flex items-center gap-1"><MapPin className="w-3 h-3" />{company.location}</span>}
                  {company.funding && <span className="flex items-center gap-1"><TrendingUp className="w-3 h-3" />{company.funding}</span>}
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
    {company.description && (
      <p className="text-sm text-foreground/80">{company.description}</p>
    )}

    {company.insights.length > 0 && (
      <div className="border border-foreground/10 p-4 space-y-2">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Ce qu'on a trouvé</h4>
        {company.insights.map((insight, i) => (
          <p key={i} className="text-sm text-foreground/80">{insight}</p>
        ))}
      </div>
    )}

    {company.techStack.length > 0 && (
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
    )}

    {company.decisionMakers.length > 0 && (
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
    )}
  </div>
);

/* ─── Tab: Open Roles ─── */
const TabRoles: React.FC<{
  roles: CompanyData['openRoles'];
  selected: Set<number>;
  onToggle: (idx: number) => void;
}> = ({ roles, selected, onToggle }) => (
  <div className="space-y-3">
    {roles.length === 0 && (
      <p className="text-sm text-muted-foreground text-center py-4">
        Aucun poste ouvert détecté. Vous pourrez en créer manuellement plus tard.
      </p>
    )}
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
          {role.location && (
            <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
              <MapPin className="w-3 h-3" />{role.location}
            </span>
          )}
        </div>
      </label>
    ))}
    {roles.length > 0 && (
      <p className="text-xs text-muted-foreground italic pt-1">
        Les postes sélectionnés seront créés comme missions dans votre espace.
      </p>
    )}
  </div>
);
