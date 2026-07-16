import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, Loader2, MapPin, Users, TrendingUp, Building2, Briefcase, Globe, Calendar, Linkedin, Sparkles, Target, DollarSign, Heart, Zap, Newspaper, ExternalLink, GitBranch, Signal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import searchIcon from '@/assets/icon-search-3d.webp';
import linkedinLogo from '@/assets/linkedin-logo.webp';

const WTTJ_LOGO = 'https://www.welcometothejungle.com/assets/images/logos/wttj.svg';
const WTTJ_FALLBACK = 'https://cdn.welcometothejungle.com/wttj-front/production/assets/images/logos/wttj.svg';

import type { OnboardingCompanyData } from '@/pages/Onboarding';

/* ─── Types ─── */
interface Props {
  onComplete: (companyData: OnboardingCompanyData) => void;
  onBack?: () => void;
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

interface StructuredInsight {
  key: 'difficulty' | 'salary' | 'attractivity' | 'timing';
  title: string;
  body: string;
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
  structuredInsights?: StructuredInsight[];
  decisionMakers: { name: string; role: string; linkedinUrl?: string | null }[];
  openRoles: { title: string; location: string; source: string; department?: string; url?: string }[];
  linkedinUrl: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  careersUrl?: string | null;
  foundedYear?: number | null;
  linkedinFollowers?: number | null;
  annualRevenue?: string | null;
  keywords?: string[];
  jobPostingsCount?: number | null;
  signals?: Array<{ type: string; label: string; color: string }>;
  departmentalHeadcount?: Record<string, number>;
  fundingEvents?: Array<{ date: string; type: string; amount?: number; investors?: string[] }>;
  newsArticles?: Array<{ title: string; url: string; published_at: string; source: string }>;
  suborganizations?: string[];
  numSuborganizations?: number;
  intentStrength?: number | null;
}

interface ApolloCandidate {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  size: string | null;
  logoUrl: string | null;
}

const SCAN_SOURCES: Source[] = [
  { id: 'apollo', label: 'Base entreprises', done: false },
  { id: 'linkedin', label: 'LinkedIn', done: false },
  { id: 'web', label: 'Web', done: false },
  { id: 'wttj', label: 'WTTJ', done: false },
  { id: 'careers', label: 'Site carrière', done: false },
];

const AGENT_MESSAGES = [
  "Je recherche des infos sur cette société...",
  "Enrichissement des données 🎯",
  "Scraping du site web en cours...",
  "Recherche des décideurs clés...",
  "Analyse des postes ouverts...",
  "Enrichissement terminé ! Voici ce que j'ai trouvé 👇",
];

/* ─── Component ─── */
export const SceneOrganization: React.FC<Props> = ({ onComplete, onBack }) => {
  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'disambiguate' | 'results'>('idle');
  const [sources, setSources] = useState<Source[]>(SCAN_SOURCES);
  const [bubbles, setBubbles] = useState<AgentBubble[]>([]);
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [disambiguationCandidates, setDisambiguationCandidates] = useState<ApolloCandidate[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'insights' | 'roles'>('overview');
  const [selectedRoles, setSelectedRoles] = useState<Set<number>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  // debounceRef removed — search is now explicit via button/Enter
  const bubblesEndRef = useRef<HTMLDivElement>(null);
  const { createOrganization } = useOrganization();

  // Auto-scroll bubbles
  useEffect(() => {
    bubblesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles]);

  const startScan = useCallback(async (name: string, selectedApolloId?: string) => {
    const scanStartedAt = Date.now();
    const MIN_ANIM_TIME = 2000; // Show scan for at least 2s

    const finishScan = (nextCompany: CompanyData) => {
      const elapsed = Date.now() - scanStartedAt;
      const remaining = Math.max(0, MIN_ANIM_TIME - elapsed);
      setTimeout(() => {
        setCompany(nextCompany);
        setPhase('results');
      }, remaining);
    };

    setPhase('scanning');
    setSources(SCAN_SOURCES.map((s) => ({ ...s, done: false })));
    setBubbles([]);
    setCompany(null);
    setDisambiguationCandidates([]);

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

    // Call the real enrichment API
    try {
      const { data, error } = await invokeEdgeFunction<{ company: CompanyData; disambiguate?: boolean; candidates?: ApolloCandidate[] }>('enrich-company', {
        company_name: name,
        country: 'France',
        force_refresh: true,
        ...(selectedApolloId ? { selected_apollo_id: selectedApolloId } : {}),
      });

      if (error || !data?.success) {
        console.error('[SceneOrganization] Enrichment failed:', error || data?.error);
        toast.error("Impossible d'enrichir cette société. Les données de base seront utilisées.");
        finishScan({
          name,
          domain: null, industry: null, size: null, location: null,
          funding: null, description: null, techStack: [], insights: [],
          decisionMakers: [], openRoles: [], linkedinUrl: null, websiteUrl: null, logoUrl: null,
          careersUrl: null,
        });
        return;
      }

      // Handle disambiguation
      if (data.disambiguate && data.candidates?.length) {
        setDisambiguationCandidates(data.candidates);
        setPhase('disambiguate');
        return;
      }

      const enriched = data.company;
      finishScan(enriched);
    } catch (err) {
      console.error('[SceneOrganization] Error:', err);
      toast.error("Erreur lors de l'enrichissement.");
      finishScan({
        name,
        domain: null, industry: null, size: null, location: null,
        funding: null, description: null, techStack: [], insights: [],
        decisionMakers: [], openRoles: [], linkedinUrl: null, websiteUrl: null, logoUrl: null,
        careersUrl: null,
      });
    }
  }, []);

  const selectCandidate = useCallback((apolloId: string) => {
    startScan(query.trim(), apolloId);
  }, [query, startScan]);

  const handleInputChange = (val: string) => {
    setQuery(val);
    // Reset to idle when clearing input
    if (val.trim().length < 2 && phase !== 'idle') {
      setPhase('idle');
    }
  };

  const handleSearch = () => {
    if (query.trim().length >= 2 && phase !== 'scanning') {
      startScan(query.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
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
      const org = await createOrganization({
        name: company.name,
        slug: generateSlug(company.name),
        website: company.websiteUrl || (company.domain ? `https://${company.domain}` : null),
        logoUrl: company.logoUrl || (company.domain ? `https://logo.clearbit.com/${company.domain}` : null),
      });

      // Create sourcing projects for selected roles
      if (selectedRoles.size > 0 && org?.id) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const uniqueRoles = dedupeRoles(company.openRoles);
          const projectsToCreate = Array.from(selectedRoles)
            .filter((idx) => idx < uniqueRoles.length)
            .map((idx) => {
              const role = uniqueRoles[idx];
              return {
                name: role.title,
                job_title: role.title,
                client_name: company.name,
                description: role.location ? `📍 ${role.location}` : null,
                organization_id: org.id,
                created_by: user.id,
                filters_snapshot: {},
                status: 'active',
              };
            });

          if (projectsToCreate.length > 0) {
            const { error: projError } = await supabase
              .from('sourcing_projects')
              .insert(projectsToCreate as any);
            if (projError) {
              console.error('[Onboarding] Failed to create projects:', projError);
              // Non-blocking: org is created, just log the error
            }
          }
        }
      }

      onComplete({
        name: company.name,
        domain: company.domain,
        linkedinUrl: company.linkedinUrl,
        careersUrl: company.careersUrl || null,
      });
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

  const uniqueRolesCount = company ? dedupeRoles(company.openRoles).length : 0;
  const hasInsightsData = company && (
    (company.departmentalHeadcount && Object.values(company.departmentalHeadcount).filter(v => v != null).length >= 3) ||
    (company.fundingEvents && company.fundingEvents.length > 0) ||
    (company.newsArticles && company.newsArticles.length > 0)
  );
  const tabs = [
    { key: 'overview' as const, label: 'Aperçu' },
    ...(hasInsightsData ? [{ key: 'insights' as const, label: 'Insights' }] : []),
    { key: 'roles' as const, label: `Postes ouverts (${uniqueRolesCount})` },
  ];

  return (
    <div className="w-full flex flex-col gap-4 sm:gap-5">
      {/* Header */}
      <div className="mb-2">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">Votre société, en un mot.</h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          Donnez-nous son nom — on récupère logo, description et postes ouverts, et votre espace se construit tout seul.
        </p>
      </div>

      {/* Search input */}
      <div className="flex gap-2">
        {onBack && (
          <Button variant="outline" size="icon" onClick={onBack} className="h-11 w-11 border border-border shrink-0" aria-label="Étape précédente">
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
          </Button>
        )}
        <div className="relative flex-1">
          <img src={searchIcon} alt="" aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Le nom de votre société..."
            autoFocus
            className="pl-11 pr-4 border border-border focus:border-border focus:shadow-sm transition-shadow text-sm h-11"
          />
        </div>
        <Button
          onClick={handleSearch}
          disabled={query.trim().length < 2 || phase === 'scanning'}
          className="h-11 px-5 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm shrink-0"
        >
          {phase === 'scanning' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Rechercher'}
        </Button>
      </div>

      {/* Scanning phase */}
      <AnimatePresence mode="wait">
        {phase === 'scanning' && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex flex-col sm:grid sm:grid-cols-[180px_1fr] gap-4 min-h-[200px]"
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
                    className={`w-6 h-6 flex items-center justify-center text-xs font-bold border transition-all duration-300 ${
                      s.done
                        ? 'border-transparent text-foreground'
                        : 'border-border text-muted-foreground'
                    }`}
                    style={s.done ? { background: 'hsl(var(--primary))' } : {}}
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
                  className="bg-muted/60 border border-border/5 px-3 py-2 text-xs text-foreground/80 rounded-sm"
                >
                  {b.text}
                </motion.div>
              ))}
              <div ref={bubblesEndRef} />
            </div>
          </motion.div>
        )}

        {/* Disambiguation phase */}
        {phase === 'disambiguate' && disambiguationCandidates.length > 0 && (
          <motion.div
            key="disambiguate"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-3"
          >
            <div className="text-center space-y-1">
              <p className="text-sm font-semibold text-foreground">Plusieurs entreprises trouvées pour "{query}"</p>
              <p className="text-xs text-muted-foreground">Sélectionnez la bonne pour un enrichissement précis.</p>
            </div>
            <div className="space-y-2">
              {disambiguationCandidates.map((c) => (
                <motion.button
                  key={c.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  onClick={() => selectCandidate(c.id)}
                  className="w-full text-left border border-border hover:border-border p-3 flex items-center gap-3 transition-all hover:shadow-sm"
                >
                  {c.logoUrl ? (
                    <img src={c.logoUrl} alt={c.name} className="w-8 h-8 object-contain rounded-sm shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : c.domain ? (
                    <img src={`https://logo.clearbit.com/${c.domain}`} alt={c.name} className="w-8 h-8 object-contain rounded-sm shrink-0" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="w-8 h-8 bg-muted flex items-center justify-center rounded-sm shrink-0">
                      <Building2 className="w-4 h-4 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{c.name}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
                      {c.domain && <span className="text-foreground/60">{c.domain}</span>}
                      {c.industry && <span>· {c.industry}</span>}
                      {c.location && <span>· {c.location}</span>}
                      {c.size && <span>· {c.size} emp.</span>}
                    </div>
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
                </motion.button>
              ))}
            </div>
            <button
              onClick={() => startScan(query.trim(), '__none__')}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 py-1"
            >
              Aucune ne correspond — continuer sans ces données
            </button>
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
              className="border border-border/80 p-3 sm:p-4 flex flex-col sm:flex-row items-start gap-3 sm:gap-4"
              style={{ boxShadow: '4px 4px 0px 0px hsl(var(--primary))' }}
            >
              <img
                src={company.logoUrl || (company.domain ? `https://logo.clearbit.com/${company.domain}` : `https://ui-avatars.com/api/?name=${encodeURIComponent(company.name)}&background=random&size=48`)}
                alt={company.name}
                onError={(e) => {
                  const img = e.target as HTMLImageElement;
                  const currentSrc = img.currentSrc || img.src;
                  if (company.domain && !currentSrc.includes('google.com/s2/favicons')) {
                    if (!currentSrc.includes('logo.clearbit.com')) {
                      img.src = `https://www.google.com/s2/favicons?domain=${company.domain}&sz=128`;
                      return;
                    }
                    img.src = `https://www.google.com/s2/favicons?domain=${company.domain}&sz=128`;
                    return;
                  }
                  if (!currentSrc.includes('ui-avatars')) {
                    img.src = `https://ui-avatars.com/api/?name=${encodeURIComponent(company.name)}&background=6366f1&color=fff&size=48`;
                  }
                }}
                referrerPolicy="no-referrer"
                className="w-12 h-12 border border-border bg-background object-contain"
                
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-semibold text-lg leading-tight">{company.name}</h3>
                  <span
                    className="text-xs uppercase tracking-wider font-bold px-2 py-0.5 rounded-md"
                    style={{ background: 'hsl(var(--success) / 0.15)', color: 'hsl(var(--success))' }}
                  >
                    Enrichi
                  </span>
                  {(company.suborganizations?.length || 0) > 0 && (
                    <span className="text-xs uppercase tracking-wider font-bold px-2 py-0.5 border border-border bg-muted flex items-center gap-1">
                      <GitBranch className="w-3 h-3" />
                      {company.suborganizations!.length} filiale{company.suborganizations!.length > 1 ? 's' : ''}
                    </span>
                  )}
                  {company.intentStrength != null && (
                    <span
                      className="text-xs uppercase tracking-wider font-bold px-2 py-0.5 border flex items-center gap-1"
                      style={{
                        borderColor: company.intentStrength > 50 ? 'hsl(142, 71%, 45%)' : 'hsl(32, 95%, 44%)',
                        backgroundColor: company.intentStrength > 50 ? 'hsl(142, 71%, 45%, 0.12)' : 'hsl(32, 95%, 44%, 0.12)',
                        color: company.intentStrength > 50 ? 'hsl(142, 71%, 45%)' : 'hsl(32, 95%, 44%)',
                      }}
                    >
                      <Signal className="w-3 h-3" />
                      {company.intentStrength > 50 ? "Signal d'achat détecté" : 'Signal faible'}
                    </span>
                  )}
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
            <div className="flex gap-0 border-b-2 border-border">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  onClick={() => setActiveTab(t.key)}
                  className={`px-4 py-2 text-xs font-semibold uppercase tracking-wider transition-colors border-b-2 -mb-[2px] ${
                    activeTab === t.key
                      ? 'border-border text-foreground'
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
                {activeTab === 'insights' && <TabInsights company={company} />}
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
            <div className="flex items-center justify-end pt-2">
              <Button
                onClick={handleContinue}
                disabled={isCreating}
                className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
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


function formatFollowers(n: number | null | undefined): string {
  if (!n) return '–';
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/* ─── Tab: Overview ─── */
const TabOverview: React.FC<{ company: CompanyData }> = ({ company }) => {
  const rolesCount = dedupeRoles(company.openRoles).length || company.jobPostingsCount || 0;

  // Icônes neutres, couleur unique — pas d'arc-en-ciel
  const INSIGHT_CONFIG: Record<string, { icon: typeof Target }> = {
    difficulty: { icon: Target },
    salary: { icon: DollarSign },
    attractivity: { icon: Heart },
    timing: { icon: Zap },
  };

  const structuredInsights = company.structuredInsights || [];

  return (
    <div className="space-y-4">

      {/* Structured AI Recruitment Insights */}
      {structuredInsights.length > 0 ? (
        <div className="space-y-2">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5" />
            Analyse recrutement
          </h4>
          <div className="space-y-2">
            {structuredInsights.map((insight, i) => {
              const config = INSIGHT_CONFIG[insight.key] || { icon: Sparkles };
              const Icon = config.icon;
              return (
                <motion.div
                  key={insight.key}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 }}
                  className="rounded-lg border border-border p-3 flex gap-2.5"
                >
                  <div className="w-6 h-6 flex items-center justify-center shrink-0 mt-0.5 rounded-md bg-foreground/[0.06]">
                    <Icon className="w-3.5 h-3.5 text-foreground/70" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-foreground uppercase tracking-wide leading-snug mb-0.5">
                      {insight.title}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {insight.body}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      ) : company.insights.length > 0 ? (
        /* Fallback: flat insights */
        <div className="rounded-lg border border-border border-l-2 border-l-emerald-500/50 p-4 space-y-3">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">
            <Sparkles className="w-3.5 h-3.5" />
            Analyse recrutement
          </h4>
          <div className="space-y-2.5">
            {company.insights.map((insight, i) => (
              <p key={i} className="text-sm text-foreground/80 leading-relaxed">{insight}</p>
            ))}
          </div>
        </div>
      ) : null}

      {/* Links */}
      {(company.websiteUrl || company.careersUrl) && (
        <div className="flex flex-wrap gap-2">
          {company.websiteUrl && (
            <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs border-border h-8">
                <Globe className="w-3.5 h-3.5" /> Site web
              </Button>
            </a>
          )}
          {company.careersUrl && (
            <a href={company.careersUrl} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="gap-1.5 text-xs border-border h-8">
                <Briefcase className="w-3.5 h-3.5" /> Page carrière
              </Button>
            </a>
          )}
        </div>
      )}
    </div>
  );
};

/* ─── Helper: format funding amount ─── */
function formatAmount(amount?: number): string {
  if (!amount) return '';
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B$`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(0)}M$`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K$`;
  return `${amount}$`;
}

/* ─── Helper: relative date ─── */
function relativeDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays < 1) return "Aujourd'hui";
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`;
    if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`;
    return `Il y a ${Math.floor(diffDays / 365)} an${Math.floor(diffDays / 365) > 1 ? 's' : ''}`;
  } catch {
    return dateStr;
  }
}

/* ─── Helper: format month ─── */
function formatMonthYear(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/* ─── Tab: Insights ─── */
const TabInsights: React.FC<{ company: CompanyData }> = ({ company }) => {
  // Headcount by department
  const headcountEntries = company.departmentalHeadcount
    ? Object.entries(company.departmentalHeadcount)
        .filter(([, v]) => v != null && v > 0)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6)
    : [];
  const maxHeadcount = headcountEntries.length > 0 ? headcountEntries[0][1] : 0;

  const fundingEvents = (company.fundingEvents || []).slice(0, 4);
  const newsArticles = (company.newsArticles || []).slice(0, 3);

  return (
    <div className="space-y-5">
      {/* Headcount by department */}
      {headcountEntries.length >= 3 && (
        <div className="space-y-2.5">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground">
            <Users className="w-3.5 h-3.5" />
            Répartition des équipes
          </h4>
          <div className="space-y-2 border border-border p-3" style={{ boxShadow: '0 1px 3px 0 rgba(0,0,0,0.1)' }}>
            {headcountEntries.map(([dept, count]) => (
              <div key={dept} className="space-y-0.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium capitalize">{dept.replace(/_/g, ' ')}</span>
                  <span className="font-bold tabular-nums">{count}</span>
                </div>
                <div className="h-2 bg-muted border border-border/5 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(count / maxHeadcount) * 100}%` }}
                    transition={{ duration: 0.6, delay: 0.1 }}
                    className="h-full"
                    style={{ backgroundColor: 'hsl(var(--primary))' }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Funding timeline */}
      {fundingEvents.length > 0 && (
        <div className="space-y-2.5">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground">
            <TrendingUp className="w-3.5 h-3.5" />
            Historique de levées
          </h4>
          <div className="border border-border p-3 space-y-0" style={{ boxShadow: '0 1px 3px 0 rgba(0,0,0,0.1)' }}>
            {fundingEvents.map((ev, i) => (
              <div key={i} className="flex gap-3 relative">
                {/* Vertical line */}
                {i < fundingEvents.length - 1 && (
                  <div className="absolute left-[7px] top-5 bottom-0 w-[2px] bg-foreground/10" />
                )}
                {/* Dot */}
                <div className="w-4 h-4 mt-0.5 shrink-0 border border-border bg-background z-10" style={{ borderRadius: 0 }} />
                <div className="pb-3 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {ev.type && (
                      <span className="text-xs font-bold uppercase tracking-wider px-1.5 py-0.5 border border-border bg-muted">
                        {ev.type}
                      </span>
                    )}
                    {ev.amount && (
                      <span className="text-xs font-bold text-foreground">{formatAmount(ev.amount)}</span>
                    )}
                  </div>
                  {ev.date && (
                    <p className="text-xs text-muted-foreground mt-0.5">{formatMonthYear(ev.date)}</p>
                  )}
                  {ev.investors && ev.investors.length > 0 && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {ev.investors.join(', ')}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* News */}
      {newsArticles.length > 0 && (
        <div className="space-y-2.5">
          <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-foreground">
            <Newspaper className="w-3.5 h-3.5" />
            Actualités
          </h4>
          <div className="space-y-1.5">
            {newsArticles.map((article, i) => (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-2 p-2 border border-border hover:border-border/25 transition-colors group"
              >
                <ExternalLink className="w-3 h-3 mt-0.5 shrink-0 text-muted-foreground group-hover:text-foreground transition-colors" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-foreground leading-snug line-clamp-2 group-hover:underline">
                    {article.title}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                    {article.source && <span>{article.source}</span>}
                    {article.published_at && <span>· {relativeDate(article.published_at)}</span>}
                  </div>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
/* ─── Dedupe helper ─── */
function dedupeRoles(roles: CompanyData['openRoles']) {
  const seen = new Map<string, number>();
  return roles.filter((role, i) => {
    const key = role.title.toLowerCase().replace(/[\s\-–—()\/,]+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.set(key, i);
    return true;
  });
}

/* ─── Source badge with logo ─── */
const SourceBadge: React.FC<{ source: string }> = ({ source }) => {
  const lower = source.toLowerCase();
  const isLinkedIn = lower.includes('linkedin');
  const isWTTJ = lower.includes('wttj') || lower.includes('welcome');

  return (
    <span className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 bg-muted text-muted-foreground font-mono shrink-0">
      {isLinkedIn && <img src={linkedinLogo} alt="LinkedIn" className="w-3 h-3 object-contain" />}
      {isWTTJ && <img src={WTTJ_LOGO} alt="WTTJ" className="w-3 h-3 object-contain" onError={(e) => { (e.target as HTMLImageElement).src = WTTJ_FALLBACK; }} />}
      {source}
    </span>
  );
};

/* ─── Tab: Open Roles ─── */
const TabRoles: React.FC<{
  roles: CompanyData['openRoles'];
  selected: Set<number>;
  onToggle: (idx: number) => void;
}> = ({ roles, selected, onToggle }) => {
  const uniqueRoles = dedupeRoles(roles);

  return (
    <div className="space-y-3">
      {uniqueRoles.length === 0 && (
        <p className="text-sm text-muted-foreground text-center py-4">
          Aucun poste ouvert détecté. Vous pourrez en créer manuellement plus tard.
        </p>
      )}
      {uniqueRoles.length < roles.length && (
        <p className="text-xs text-muted-foreground">
          {roles.length - uniqueRoles.length} doublon{roles.length - uniqueRoles.length > 1 ? 's' : ''} masqué{roles.length - uniqueRoles.length > 1 ? 's' : ''}
        </p>
      )}
      {uniqueRoles.map((role, i) => (
        <label
          key={i}
          className="flex items-center gap-3 p-3 border border-border hover:border-border/25 transition-colors cursor-pointer"
        >
          <Checkbox
            checked={selected.has(i)}
            onCheckedChange={() => onToggle(i)}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              {role.url ? (
                <a
                  href={role.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-sm font-medium truncate underline decoration-foreground/30 hover:decoration-foreground transition-colors"
                >
                  {role.title}
                </a>
              ) : (
                <span className="text-sm font-medium truncate">{role.title}</span>
              )}
              <SourceBadge source={role.source} />
            </div>
            {role.location && (
              <span className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                <MapPin className="w-3 h-3" />{role.location}
              </span>
            )}
          </div>
        </label>
      ))}
      {uniqueRoles.length > 0 && (
        <p className="text-xs text-muted-foreground italic pt-1">
          Les postes sélectionnés seront créés comme missions dans votre espace.
        </p>
      )}
    </div>
  );
};
