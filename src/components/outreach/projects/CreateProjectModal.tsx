import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSourcingProjects, CreateProjectInput } from '@/hooks/useSourcingProjects';
import { useJobs } from '@/components/outreach/JobSelector';
import { Job } from '@/types/jobs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Loader2, Briefcase, Search, Check, ChevronDown, X,
  Building2, MapPin, ExternalLink, Plus, Link2, Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

/* ─── Types ─── */
interface CreateProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectedJob?: Job;
  initialTab?: string;
  initialUrl?: string;
}

interface OpenRole {
  title: string;
  location: string;
  source: string;
  department?: string;
  url?: string;
}

interface CompanyResult {
  name: string;
  logoUrl: string | null;
  domain: string | null;
  industry: string | null;
  location: string | null;
  careersUrl: string | null;
  openRoles: OpenRole[];
  sourcesUsed: string[];
}

interface ScanSource { id: string; label: string; done: boolean; }
interface AgentBubble { id: number; text: string; }
type ImportPhase = 'idle' | 'scanning' | 'results';

interface BriefAnalysisResult {
  filters: Record<string, any>;
  analysis: {
    search_rationale: string | null;
    keyword_rationale: string | null;
    experience_rationale: string | null;
    role_keywords: string[];
    skills_to_search: string[];
    certifications: string[];
    domain_expertise: string[];
    location_hint: string | null;
    job_category: string;
    years_experience_min: number | null;
    years_experience_max: number | null;
  };
}

/* ─── Constants ─── */
const TABS = [
  { value: 'brief', label: 'Brief IA', emoji: '📋' },
  { value: 'import', label: 'Importer des postes', emoji: '📥' },
  { value: 'manual', label: 'Création manuelle', emoji: '✏️' },
] as const;

const SCAN_SOURCES: ScanSource[] = [
  { id: 'apollo', label: 'Base entreprises', done: false },
  { id: 'linkedin', label: 'LinkedIn', done: false },
  { id: 'web', label: 'Web', done: false },
  { id: 'wttj', label: 'WTTJ', done: false },
  { id: 'careers', label: 'Site carrière', done: false },
];

const AGENT_MESSAGES = [
  'Recherche en cours...',
  'Analyse des postes ouverts...',
  'Extraction des offres détectées...',
  'Extraction terminée !',
];

function detectSource(url: string): string | null {
  const lower = url.toLowerCase();
  if (lower.includes('welcometothejungle')) return 'WTTJ';
  if (lower.includes('lever.co') || lower.includes('greenhouse.io') || lower.includes('workable.com')) return 'ATS';
  if (looksLikeCareersUrl(lower)) return 'Careers page';
  return null;
}

function looksLikeCareersUrl(url: string): boolean {
  return /career|job|recrutement|emploi|talent|hiring|offre/i.test(url);
}

function isValidUrl(str: string): boolean {
  try { new URL(str); return true; } catch { return false; }
}

/* ─── Component ─── */
export const CreateProjectModal: React.FC<CreateProjectModalProps> = ({
  open,
  onOpenChange,
  preselectedJob,
  initialTab,
  initialUrl,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { createProject, isCreating } = useSourcingProjects();
  const { data: jobs = [], isLoading: jobsLoading } = useJobs();

  // ── Shared state ──
  const [activeTab, setActiveTab] = useState<string>(initialTab || 'brief');

  // ── Brief IA state ──
  const [briefText, setBriefText] = useState('');
  const [briefAnalyzing, setBriefAnalyzing] = useState(false);
  const [briefAnalysis, setBriefAnalysis] = useState<BriefAnalysisResult | null>(null);
  const [briefName, setBriefName] = useState('');
  const [briefClientName, setBriefClientName] = useState('');
  const [urlSuggestion, setUrlSuggestion] = useState<string | null>(null);

  // ── Manual state ──
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [linkToJob, setLinkToJob] = useState(!!preselectedJob);
  const [selectedJobId, setSelectedJobId] = useState<string>(preselectedJob?.id || '');
  const [jobSearchQuery, setJobSearchQuery] = useState('');
  const [jobPopoverOpen, setJobPopoverOpen] = useState(false);

  // ── Import state ──
  const [importPhase, setImportPhase] = useState<ImportPhase>('idle');
  const [inputMode, setInputMode] = useState<'name' | 'url'>('name');
  const [companyName, setCompanyName] = useState('');
  const [directUrl, setDirectUrl] = useState(initialUrl || '');
  const [sources, setSources] = useState<ScanSource[]>(SCAN_SOURCES);
  const [bubbles, setBubbles] = useState<AgentBubble[]>([]);
  const [importResult, setImportResult] = useState<CompanyResult | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const bubblesEndRef = useRef<HTMLDivElement>(null);

  const selectedJob = jobs.find(j => j.id === selectedJobId);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setActiveTab(initialTab || 'brief');
        setBriefText('');
        setBriefAnalyzing(false);
        setBriefAnalysis(null);
        setBriefName('');
        setBriefClientName('');
        setUrlSuggestion(null);
        setName('');
        setDescription('');
        setLinkToJob(false);
        setSelectedJobId('');
        setImportPhase('idle');
        setCompanyName('');
        setDirectUrl(initialUrl || '');
        setImportResult(null);
        setSelectedRoles(new Set());
      }, 300);
    }
  }, [open, initialTab, initialUrl]);

  // Auto-switch to import tab on initial URL
  useEffect(() => {
    if (open && initialUrl) {
      setActiveTab('import');
      setInputMode('url');
      setDirectUrl(initialUrl);
    }
  }, [open, initialUrl]);

  // Auto-scroll bubbles
  useEffect(() => {
    bubblesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles]);

  // ── Smart URL detection in brief field ──
  useEffect(() => {
    const lines = briefText.trim().split('\n');
    const urlLine = lines.find(l => isValidUrl(l.trim()));
    if (urlLine) {
      const url = urlLine.trim();
      const src = detectSource(url);
      if (src === 'WTTJ') {
        // Auto switch to import tab
        setActiveTab('import');
        setInputMode('url');
        setDirectUrl(url);
        setBriefText('');
        // Auto-start scan after a tick
        setTimeout(() => startScan(url), 100);
      } else if (src) {
        setUrlSuggestion(url);
      } else {
        setUrlSuggestion(null);
      }
    } else {
      setUrlSuggestion(null);
    }
  }, [briefText]);

  // ── Brief IA handlers ──
  const handleBriefAnalyze = async () => {
    if (!briefText.trim() || briefText.trim().length < 20) return;
    setBriefAnalyzing(true);
    setBriefAnalysis(null);

    try {
      const syntheticJob = {
        id: 'draft',
        title: briefText.trim().split('\n')[0].slice(0, 80),
        description: briefText.trim(),
        client: briefClientName ? { name: briefClientName } : null,
        location: null,
        skills: [],
        seniority: null,
      };

      const response = await invokeEdgeFunction<any>('generate-search-filters', {
        job: syntheticJob,
      });

      if (response.error) throw new Error(response.error.message || 'Erreur IA');
      if (!response.data?.success) throw new Error('Analyse échouée');

      // Use AI-generated title instead of raw first line
      const aiTitle = response.data.analysis?.suggested_title;
      if (aiTitle && !briefName) {
        setBriefName(aiTitle);
      } else if (!briefName) {
        // Fallback: build from role_keywords + location
        const roles = response.data.analysis?.role_keywords || [];
        const loc = response.data.analysis?.location_hint;
        const fallbackTitle = roles[0] 
          ? `${roles[0]}${loc ? ` — ${loc}` : ''}`
          : briefText.trim().split('\n')[0].slice(0, 50);
        setBriefName(fallbackTitle);
      }

      setBriefAnalysis({
        filters: response.data.filters,
        analysis: response.data.analysis,
      });

      toast.success('Analyse terminée — vérifiez et créez la mission');
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'analyse");
    } finally {
      setBriefAnalyzing(false);
    }
  };

  const handleBriefCreate = async () => {
    try {
      const projectInput: CreateProjectInput = {
        name: briefName || briefText.trim().split('\n')[0].slice(0, 80) || 'Mission depuis brief',
        description: briefText.trim(),
        client_name: briefClientName || undefined,
      };

      if (briefAnalysis) {
        projectInput.filters_snapshot = {
          ...briefAnalysis.filters,
          generated_at: new Date().toISOString(),
          brief_text: briefText.trim(),
        };
      }

      const project = await createProject(projectInput);
      onOpenChange(false);
      if (project?.id) {
        const tab = briefAnalysis ? 'sourcing' : 'brief';
        navigate(`/missions/${project.id}?tab=${tab}`);
      }
    } catch {
      // handled by hook
    }
  };

  const handleAcceptUrlSuggestion = () => {
    if (!urlSuggestion) return;
    setActiveTab('import');
    setInputMode('url');
    setDirectUrl(urlSuggestion);
    setBriefText('');
    setUrlSuggestion(null);
    setTimeout(() => startScan(urlSuggestion), 100);
  };

  // ── Manual handlers ──
  const filteredJobs = jobs.filter(job => {
    if (!jobSearchQuery) return true;
    const query = jobSearchQuery.toLowerCase();
    return job.title.toLowerCase().includes(query) || job.client?.name?.toLowerCase().includes(query);
  });

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await createProject({
        name: name || selectedJob?.title || 'Nouveau projet',
        description: description || undefined,
        job_id: linkToJob && selectedJobId ? selectedJobId : undefined,
        job_title: linkToJob && selectedJob ? selectedJob.title : undefined,
        client_name: linkToJob && selectedJob?.client?.name ? selectedJob.client.name : undefined,
      });
      onOpenChange(false);
    } catch {
      // handled by hook
    }
  };

  const handleJobChange = (jobId: string) => {
    setSelectedJobId(jobId);
    const job = jobs.find(j => j.id === jobId);
    if (job && !name) setName(job.title);
  };

  // ── Import handlers ──
  const startScan = useCallback(async (overrideUrl?: string) => {
    const nameVal = companyName.trim();
    const urlVal = (overrideUrl || directUrl).trim();
    const currentMode = overrideUrl ? 'url' : inputMode;
    if (currentMode === 'name' && !nameVal) return;
    if (currentMode === 'url' && !urlVal) return;

    const scanStartedAt = Date.now();
    const MIN_ANIM_TIME = 2500;

    setImportPhase('scanning');
    setSources(SCAN_SOURCES.map(s => ({ ...s, done: false })));
    setBubbles([]);
    setImportResult(null);
    setSelectedRoles(new Set());

    SCAN_SOURCES.forEach((_, i) => {
      setTimeout(() => {
        setSources(prev => prev.map((s, j) => (j <= i ? { ...s, done: true } : s)));
      }, 800 + i * 600);
    });

    AGENT_MESSAGES.forEach((msg, i) => {
      setTimeout(() => {
        setBubbles(prev => [...prev, { id: i, text: msg }]);
      }, 600 + i * 900);
    });

    try {
      const body: Record<string, unknown> = { mode: 'jobs_only', force_refresh: true };
      if (currentMode === 'url') {
        body.careers_url = urlVal;
        try { body.company_name = new URL(urlVal).hostname.replace('www.', '').split('.')[0]; } catch {}
      } else {
        body.company_name = nameVal;
        body.country = 'France';
      }

      const { data, error } = await invokeEdgeFunction<any>('enrich-company', body);

      const elapsed = Date.now() - scanStartedAt;
      const remaining = Math.max(0, MIN_ANIM_TIME - elapsed);

      setTimeout(() => {
        if (error || !data?.success) {
          toast.error("Impossible de scanner cette entreprise.");
          setImportPhase('idle');
          return;
        }

        const company = data.company || data;
        const roles: OpenRole[] = company.openRoles || [];
        const usedSources = [...new Set(roles.map((r: OpenRole) => r.source).filter(Boolean))];

        if (company.scrapingFailed && roles.length === 0) {
          toast.warning(company.scrapingMessage || "Impossible de scraper cette page.");
        }

        setImportResult({
          name: company.name || nameVal || 'Entreprise',
          logoUrl: company.logoUrl,
          domain: company.domain,
          industry: company.industry,
          location: company.location,
          careersUrl: company.careersUrl,
          openRoles: roles,
          sourcesUsed: usedSources,
        });
        setSelectedRoles(new Set(roles.map((_: OpenRole, i: number) => i)));
        setImportPhase('results');
      }, remaining);
    } catch (err) {
      console.error('[Import] Error:', err);
      toast.error("Erreur lors du scan.");
      setImportPhase('idle');
    }
  }, [companyName, directUrl, inputMode]);

  const toggleRole = (idx: number) => {
    setSelectedRoles(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (!importResult) return;
    setSelectedRoles(prev =>
      prev.size === importResult.openRoles.length
        ? new Set()
        : new Set(importResult.openRoles.map((_, i) => i))
    );
  };

  const groupedRoles = useMemo(() => {
    if (!importResult) return [];
    const map = new Map<string, { role: OpenRole; idx: number }[]>();
    importResult.openRoles.forEach((role, idx) => {
      const dept = role.department || 'Autre';
      if (!map.has(dept)) map.set(dept, []);
      map.get(dept)!.push({ role, idx });
    });
    return [...map.entries()]
      .sort(([a], [b]) => (a === 'Autre' ? 1 : b === 'Autre' ? -1 : a.localeCompare(b, 'fr')))
      .map(([department, roles]) => ({ department, roles }));
  }, [importResult]);

  const hasDepartments = useMemo(() => {
    return importResult?.openRoles.some(r => r.department && r.department !== 'Autre') ?? false;
  }, [importResult]);

  const handleImport = async () => {
    if (!importResult || selectedRoles.size === 0) return;
    setImporting(true);

    try {
      const rolesToImport = Array.from(selectedRoles)
        .filter(idx => idx < importResult.openRoles.length)
        .map(idx => importResult.openRoles[idx]);

      const createdIds: string[] = [];
      for (const role of rolesToImport) {
        const project = await createProject({
          name: role.title,
          job_title: role.title,
          client_name: importResult.name,
          description: [role.location, role.department].filter(Boolean).join(' · '),
          filters_snapshot: {},
        });
        if (project?.id) createdIds.push(project.id);
      }

      queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });

      toast.success(`${rolesToImport.length} mission${rolesToImport.length > 1 ? 's' : ''} créée${rolesToImport.length > 1 ? 's' : ''} à partir des postes de ${importResult.name}`);
      onOpenChange(false);

      // Post-import navigation
      if (createdIds.length === 1) {
        navigate(`/missions/${createdIds[0]}?tab=brief`);
      }
      // else: stay on /missions, list refreshes automatically
    } catch (err) {
      console.error('[Import] Import error:', err);
      toast.error("Erreur lors de l'import.");
    } finally {
      setImporting(false);
    }
  };

  const handleImportKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); startScan(); }
  };

  if (!open) return null;

  const progress = sources.filter(s => s.done).length / sources.length * 100;
  const detectedImportSource = directUrl ? detectSource(directUrl) : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background flex flex-col"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-border">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            Nouvelle mission
          </h2>
          <button
            onClick={() => onOpenChange(false)}
            className="h-8 w-8 flex items-center justify-center border border-border bg-background text-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Tabs ── */}
        <div className="flex border-b border-border">
          {TABS.map(tab => (
            <button
              key={tab.value}
              onClick={() => setActiveTab(tab.value)}
              className={cn(
                "flex-1 h-[42px] text-xs sm:text-xs font-medium uppercase tracking-wider transition-colors border-r border-border last:border-r-0",
                activeTab === tab.value
                  ? "bg-foreground text-background"
                  : "bg-background text-foreground hover:bg-muted"
              )}
            >
              <span className="hidden sm:inline mr-1">{tab.emoji}</span> {tab.label}
            </button>
          ))}
        </div>

        {/* ── Content ── */}
        <div className="flex-1 overflow-y-auto">
          <div className={cn(
            "mx-auto w-full px-4 sm:px-8 py-8 sm:py-12",
            activeTab === 'import' && importPhase === 'results' ? 'max-w-4xl' : 'max-w-2xl'
          )}>

            {/* ════ TAB: Brief IA ════ */}
            {activeTab === 'brief' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {!briefAnalysis ? (
                  <>
                    {/* ── Phase 1: Saisie du brief ── */}
                    <div className="text-center">
                      <div className="text-4xl mb-3">📋</div>
                      <h3 className="text-lg font-bold text-foreground uppercase tracking-wide mb-1">
                        Décrivez le poste
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Collez la fiche de poste ou décrivez le profil recherché — l'IA génère l'ICP et les filtres
                      </p>
                    </div>

                    <div className="space-y-3">
                      <Textarea
                        value={briefText}
                        onChange={(e) => setBriefText(e.target.value)}
                        placeholder={"Collez ici la fiche de poste, le brief client, ou une URL de page carrières...\n\nExemple :\nRecherche d'un Lead Developer React/Node.js à Paris, 5+ ans d'expérience, télétravail partiel, salaire 60-75K€..."}
                        rows={10}
                        className="border-border rounded-lg resize-none"
                        autoFocus
                      />
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">
                          {briefText.length > 0 ? `${briefText.length} caractères` : 'Min 20 caractères'}
                        </span>
                      </div>
                    </div>

                    {/* URL suggestion banner */}
                    {urlSuggestion && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="border border-border p-3 bg-muted flex items-center justify-between gap-3"
                      >
                        <p className="text-xs text-foreground">
                          🔗 URL de page carrières détectée. Voulez-vous importer les postes depuis cette page ?
                        </p>
                        <button
                          onClick={handleAcceptUrlSuggestion}
                          className="shrink-0 h-[28px] px-3 text-xs font-medium uppercase tracking-wider border border-border bg-foreground text-background"
                        >
                          Importer
                        </button>
                      </motion.div>
                    )}

                    <button
                      onClick={handleBriefAnalyze}
                      disabled={!briefText.trim() || briefText.trim().length < 20 || briefAnalyzing}
                      className="relative overflow-hidden w-full h-[42px] text-xs font-bold uppercase tracking-wider border border-border bg-foreground text-background disabled:opacity-40 disabled:cursor-not-allowed group"
                    >
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        {briefAnalyzing ? <Loader2 className="w-4 h-4 animate-spin" /> : '🤖'}
                        {briefAnalyzing ? 'Analyse en cours...' : 'Analyser avec l\'IA'}
                      </span>
                    </button>
                  </>
                ) : (
                  <>
                    {/* ── Phase 2: Résultats de l'analyse ── */}
                    <div className="text-center">
                      <div className="text-4xl mb-3">✅</div>
                      <h3 className="text-lg font-bold text-foreground uppercase tracking-wide mb-1">
                        Analyse terminée
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Vérifiez l'ICP et les filtres générés, puis créez la mission
                      </p>
                    </div>

                    {/* Nom + Client */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Nom de la mission</Label>
                        <Input
                          value={briefName}
                          onChange={(e) => setBriefName(e.target.value)}
                          className="border-border rounded-lg h-[34px] text-sm"
                          placeholder="Ex: Lead DevOps — Numspot"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Client (optionnel)</Label>
                        <Input
                          value={briefClientName}
                          onChange={(e) => setBriefClientName(e.target.value)}
                          className="border-border rounded-lg h-[34px] text-sm"
                          placeholder="Ex: Numspot"
                        />
                      </div>
                    </div>

                    {/* Stratégie */}
                    {briefAnalysis.analysis.search_rationale && (
                      <div className="border-l-4 border-accent p-4 bg-muted/20">
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">🎯 Stratégie</p>
                        <p className="text-sm text-foreground">{briefAnalysis.analysis.search_rationale}</p>
                      </div>
                    )}

                    {/* ICP tags */}
                    <div className="space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">👤 Profil idéal (ICP)</p>

                      {briefAnalysis.analysis.role_keywords.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-xs text-muted-foreground uppercase tracking-wider mr-1 self-center">Titres:</span>
                          {briefAnalysis.analysis.role_keywords.map((kw, i) => (
                            <span key={i} className="px-2 py-0.5 bg-foreground text-background text-xs font-medium uppercase tracking-wider">
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}

                      {briefAnalysis.filters.skills_keywords?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-xs text-muted-foreground uppercase tracking-wider mr-1 self-center">Skills:</span>
                          {briefAnalysis.filters.skills_keywords.map((skill: string, i: number) => (
                            <span key={i} className="px-2 py-0.5 border border-border text-foreground text-xs font-medium uppercase tracking-wider">
                              {skill}
                            </span>
                          ))}
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <span className="text-xs text-muted-foreground uppercase tracking-wider">Expérience:</span>
                        <span className="px-2 py-0.5 border border-border text-foreground text-xs font-medium">
                          {briefAnalysis.filters.years_of_experience_min ?? '?'} - {briefAnalysis.filters.years_of_experience_max ?? '?'} ans
                        </span>
                        {briefAnalysis.analysis.experience_rationale && (
                          <span className="text-xs text-muted-foreground italic">
                            ({briefAnalysis.analysis.experience_rationale})
                          </span>
                        )}
                      </div>

                      {briefAnalysis.filters.location_keywords?.length > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground uppercase tracking-wider">Zone:</span>
                          {briefAnalysis.filters.location_keywords.map((loc: string, i: number) => (
                            <span key={i} className="px-2 py-0.5 border border-border text-foreground text-xs font-medium">
                              {loc}
                            </span>
                          ))}
                        </div>
                      )}

                      {briefAnalysis.analysis.domain_expertise.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          <span className="text-xs text-muted-foreground uppercase tracking-wider mr-1 self-center">Domaines:</span>
                          {briefAnalysis.analysis.domain_expertise.map((d, i) => (
                            <span key={i} className="px-2 py-0.5 border border-border bg-muted text-muted-foreground text-xs font-medium uppercase tracking-wider">
                              {d}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Boolean */}
                    {briefAnalysis.filters.keywords && (
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-1">🔍 Boolean généré</p>
                        <code className="block text-xs text-foreground/80 bg-muted p-3 border border-border break-all">
                          {briefAnalysis.filters.keywords}
                        </code>
                        {briefAnalysis.analysis.keyword_rationale && (
                          <p className="text-xs text-muted-foreground mt-1 italic">
                            {briefAnalysis.analysis.keyword_rationale}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={handleBriefCreate}
                        disabled={isCreating}
                        className="relative overflow-hidden flex-1 h-[42px] text-xs font-bold uppercase tracking-wider border border-border bg-foreground text-background disabled:opacity-40 group"
                      >
                        <span className="relative z-10 flex items-center justify-center gap-2">
                          {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : '🚀'}
                          Créer la mission & lancer le sourcing
                        </span>
                      </button>
                      <button
                        onClick={() => { setBriefAnalysis(null); }}
                        className="relative overflow-hidden h-[42px] px-4 text-xs font-bold uppercase tracking-wider border border-border bg-background text-foreground group"
                      >
                        <span className="relative z-10">Modifier</span>
                      </button>
                    </div>
                  </>
                )}
              </motion.div>
            )}

            {/* ════ TAB: Import ════ */}
            {activeTab === 'import' && (
              <>
                {/* Phase: idle */}
                {importPhase === 'idle' && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="space-y-8"
                  >
                    <div className="text-center">
                      <div className="text-4xl mb-3">🏢</div>
                      <h3 className="text-lg font-bold text-foreground uppercase tracking-wide mb-1">
                        Scanner les postes ouverts
                      </h3>
                      <p className="text-sm text-muted-foreground">
                        Importez automatiquement les offres d'emploi d'une entreprise
                      </p>
                    </div>

                    <div className="flex gap-0">
                      <button
                        onClick={() => setInputMode('name')}
                        className={cn(
                          "flex-1 h-[34px] text-xs font-medium uppercase tracking-wider border border-border transition-colors",
                          inputMode === 'name' ? "bg-foreground text-background" : "bg-background text-foreground"
                        )}
                      >
                        <Building2 className="w-3.5 h-3.5 inline mr-1.5" /> Par nom
                      </button>
                      <button
                        onClick={() => setInputMode('url')}
                        className={cn(
                          "flex-1 h-[34px] text-xs font-medium uppercase tracking-wider border border-border border-l-0 transition-colors",
                          inputMode === 'url' ? "bg-foreground text-background" : "bg-background text-foreground"
                        )}
                      >
                        <Link2 className="w-3.5 h-3.5 inline mr-1.5" /> Par URL
                      </button>
                    </div>

                    {inputMode === 'name' ? (
                      <div className="space-y-3">
                        <label className="text-xs font-medium uppercase tracking-wider text-foreground">Nom de l'entreprise</label>
                        <Input
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          onKeyDown={handleImportKeyDown}
                          placeholder="Ex: Datadog, OVHcloud, Scaleway..."
                          className="border-border rounded-lg h-11"
                          autoFocus
                        />
                      </div>
                    ) : (
                      <div className="space-y-3">
                        <label className="text-xs font-medium uppercase tracking-wider text-foreground">URL page carrières ou WTTJ</label>
                        <Input
                          value={directUrl}
                          onChange={(e) => setDirectUrl(e.target.value)}
                          onKeyDown={handleImportKeyDown}
                          placeholder="Ex: https://www.welcometothejungle.com/fr/companies/datadog/jobs"
                          className="border-border rounded-lg h-11"
                          autoFocus
                        />
                        {detectedImportSource && directUrl.length > 10 && (
                          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Check className="w-3.5 h-3.5 text-foreground" />
                            Source détectée : <span className="font-semibold text-foreground">{detectedImportSource}</span>
                          </motion.div>
                        )}
                      </div>
                    )}

                    <button
                      onClick={() => startScan()}
                      disabled={inputMode === 'name' ? !companyName.trim() : !directUrl.trim()}
                      className="relative overflow-hidden w-full h-[42px] text-xs font-bold uppercase tracking-wider border border-border bg-foreground text-background disabled:opacity-40 disabled:cursor-not-allowed group"
                    >
                      <span className="relative z-10 flex items-center justify-center gap-2">🔍 Scanner</span>
                    </button>
                  </motion.div>
                )}

                {/* Phase: scanning */}
                {importPhase === 'scanning' && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">
                    <div className="space-y-4">
                      <Progress value={progress} className="h-2 rounded-lg bg-muted [&>div]:bg-foreground" />
                      <div className="flex flex-wrap gap-3">
                        {sources.map(src => (
                          <div key={src.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                            {src.done ? <Check className="w-3.5 h-3.5 text-foreground" /> : <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                            <span className={cn(src.done && 'text-foreground font-medium')}>{src.label}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="space-y-3 min-h-[120px]">
                      <AnimatePresence>
                        {bubbles.map(bubble => (
                          <motion.div key={bubble.id} initial={{ opacity: 0, x: -20, scale: 0.95 }} animate={{ opacity: 1, x: 0, scale: 1 }} className="flex items-start gap-2">
                            <div className="h-6 w-6 bg-foreground text-background flex items-center justify-center text-xs shrink-0 mt-0.5">🤖</div>
                            <div className="border border-border bg-muted px-3 py-2 text-sm text-foreground">{bubble.text}</div>
                          </motion.div>
                        ))}
                      </AnimatePresence>
                      <div ref={bubblesEndRef} />
                    </div>
                  </motion.div>
                )}

                {/* Phase: results */}
                {importPhase === 'results' && importResult && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    {importResult.openRoles.length === 0 ? (
                      <div className="border border-border p-8 text-center">
                        <div className="text-3xl mb-3">🤷</div>
                        <p className="text-sm text-muted-foreground mb-4">Aucun poste ouvert détecté pour cette entreprise.</p>
                        <button onClick={() => setImportPhase('idle')} className="relative overflow-hidden h-[34px] px-6 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground group">
                          <span className="relative z-10">← Nouvelle recherche</span>
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-col lg:flex-row gap-6">
                        {/* Left column: Company info */}
                        <div className="lg:w-[280px] shrink-0">
                          <div className="border border-border p-4 space-y-4">
                            <div className="flex items-center gap-3">
                              {importResult.logoUrl ? (
                                <img src={importResult.logoUrl} alt={importResult.name} className="w-12 h-12 object-contain border border-muted" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                              ) : (
                                <div className="w-12 h-12 bg-foreground text-background flex items-center justify-center text-xl font-bold shrink-0">{importResult.name.charAt(0)}</div>
                              )}
                              <div className="min-w-0">
                                <h3 className="font-bold text-foreground uppercase tracking-wide text-sm truncate">{importResult.name}</h3>
                                {importResult.industry && <p className="text-xs text-muted-foreground uppercase tracking-wider truncate">{importResult.industry}</p>}
                              </div>
                            </div>
                            <div className="space-y-2">
                              {importResult.location && <div className="flex items-center gap-2 text-xs text-muted-foreground"><MapPin className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{importResult.location}</span></div>}
                              {importResult.domain && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Globe className="w-3.5 h-3.5 shrink-0" /><span className="truncate">{importResult.domain}</span></div>}
                            </div>
                            <div className="border-t border-border pt-3">
                              <div className="text-3xl font-black text-foreground">{importResult.openRoles.length}</div>
                              <div className="text-xs uppercase tracking-wider text-muted-foreground">postes trouvés</div>
                            </div>
                            {importResult.sourcesUsed.length > 0 && (
                              <div className="border-t border-border pt-3">
                                <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Sources</div>
                                <div className="flex flex-wrap gap-1">
                                  {importResult.sourcesUsed.map(src => (
                                    <span key={src} className="text-xs uppercase tracking-wider font-medium border border-border px-2 py-0.5 text-foreground">{src}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {importResult.careersUrl && (
                              <div className="border-t border-border pt-3">
                                <a href={importResult.careersUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
                                  <ExternalLink className="w-3.5 h-3.5" /> Page carrières
                                </a>
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Right column: Roles list */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between border border-border border-b-0 px-4 py-2.5 bg-muted">
                            <button onClick={toggleAll} className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-foreground hover:opacity-70 transition-opacity">
                              <Checkbox checked={selectedRoles.size === importResult.openRoles.length} className="border-border data-[state=checked]:bg-foreground data-[state=checked]:text-background" onCheckedChange={toggleAll} />
                              Tout sélectionner
                            </button>
                            <span className="text-xs text-muted-foreground uppercase tracking-wider">{selectedRoles.size}/{importResult.openRoles.length}</span>
                          </div>
                          <div className="border border-border max-h-[400px] overflow-y-auto">
                            {hasDepartments ? (
                              groupedRoles.map((group, gi) => (
                                <div key={group.department}>
                                  <div className={cn("px-4 py-2 bg-secondary text-xs font-bold uppercase tracking-wider text-secondary-foreground flex items-center gap-2", gi > 0 && "border-t border-border")}>
                                    <Briefcase className="w-3 h-3" /> {group.department}
                                    <span className="text-muted-foreground font-normal ml-auto">{group.roles.length}</span>
                                  </div>
                                  {group.roles.map(({ role, idx }) => (
                                    <RoleRow key={idx} role={role} selected={selectedRoles.has(idx)} onToggle={() => toggleRole(idx)} showDepartment={false} />
                                  ))}
                                </div>
                              ))
                            ) : (
                              importResult.openRoles.map((role, idx) => (
                                <RoleRow key={idx} role={role} selected={selectedRoles.has(idx)} onToggle={() => toggleRole(idx)} showDepartment={true} />
                              ))
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </motion.div>
                )}
              </>
            )}

            {/* ════ TAB: Manual ════ */}
            {activeTab === 'manual' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <div className="text-center mb-8">
                  <div className="text-4xl mb-3">✏️</div>
                  <h3 className="text-lg font-bold text-foreground uppercase tracking-wide mb-1">
                    Création manuelle
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Créez une mission en remplissant les champs manuellement
                  </p>
                </div>

                <form onSubmit={handleManualSubmit} className="space-y-5 max-w-lg mx-auto">
                  {/* Link to job toggle */}
                  <div className="flex items-center justify-between p-4 bg-muted border border-border">
                    <div className="flex items-center gap-3">
                      <Briefcase className="w-5 h-5 text-foreground" />
                      <div>
                        <p className="font-medium text-foreground text-sm">Lier à un poste</p>
                        <p className="text-xs text-muted-foreground uppercase tracking-wider">
                          Associe à un poste Notion pour le scoring
                        </p>
                      </div>
                    </div>
                    <Switch checked={linkToJob} onCheckedChange={setLinkToJob} />
                  </div>

                  {linkToJob && (
                    <div className="space-y-2">
                      <Label>Poste associé</Label>
                      <Popover open={jobPopoverOpen} onOpenChange={setJobPopoverOpen}>
                        <PopoverTrigger asChild>
                          <Button variant="outline" role="combobox" className="w-full justify-between font-normal border-border rounded-lg">
                            {selectedJob ? (
                              <span className="truncate">{selectedJob.title}{selectedJob.client?.name ? ` @ ${selectedJob.client.name}` : ''}</span>
                            ) : (
                              <span className="text-muted-foreground">Sélectionner un poste...</span>
                            )}
                            <ChevronDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-0" align="start">
                          <div className="p-2 border-b">
                            <div className="relative">
                              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                              <Input placeholder="Rechercher..." value={jobSearchQuery} onChange={(e) => setJobSearchQuery(e.target.value)} className="pl-8 h-8 text-sm" />
                            </div>
                          </div>
                          <ScrollArea className="h-[250px]">
                            {jobsLoading ? (
                              <div className="p-4 text-center text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mx-auto" /></div>
                            ) : filteredJobs.length === 0 ? (
                              <div className="p-4 text-center text-muted-foreground text-sm">Aucun poste trouvé</div>
                            ) : (
                              <div className="p-1">
                                {filteredJobs.map((job) => (
                                  <button
                                    key={job.id}
                                    type="button"
                                    onClick={() => { handleJobChange(job.id); setJobPopoverOpen(false); }}
                                    className={cn("w-full text-left px-3 py-2 rounded-md text-sm flex items-center justify-between hover:bg-accent transition-colors", selectedJobId === job.id && "bg-accent")}
                                  >
                                    <div className="min-w-0">
                                      <span className="font-medium block truncate">{job.title}</span>
                                      {job.client?.name && <span className="text-xs text-muted-foreground">@ {job.client.name}</span>}
                                    </div>
                                    {selectedJobId === job.id && <Check className="w-4 h-4 shrink-0 ml-2" />}
                                  </button>
                                ))}
                              </div>
                            )}
                          </ScrollArea>
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}

                  <div className="space-y-2">
                    <Label htmlFor="name">Nom du projet</Label>
                    <Input id="name" value={name} onChange={(e) => setName(e.target.value)} placeholder={selectedJob?.title || "Ex: Développeurs Senior Paris"} className="border-border rounded-lg" />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description (optionnel)</Label>
                    <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Notes sur ce projet de sourcing..." rows={3} className="border-border rounded-lg" />
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button type="button" onClick={() => onOpenChange(false)} className="h-[38px] px-4 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground hover:bg-muted transition-colors">
                      Annuler
                    </button>
                    <button
                      type="submit"
                      disabled={isCreating || (linkToJob && !selectedJobId)}
                      className="relative overflow-hidden flex-1 h-[38px] text-xs font-bold uppercase tracking-wider border border-border bg-foreground text-background disabled:opacity-40 disabled:cursor-not-allowed group"
                    >
                      <span className="relative z-10 flex items-center justify-center gap-2">
                        {isCreating && <Loader2 className="w-4 h-4 animate-spin" />}
                        Créer le projet
                      </span>
                    </button>
                  </div>
                </form>
              </motion.div>
            )}
          </div>
        </div>

        {/* ── Footer for import results ── */}
        {activeTab === 'import' && importPhase === 'results' && importResult && importResult.openRoles.length > 0 && (
          <div className="border-t border-border px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button onClick={() => onOpenChange(false)} className="h-[34px] px-4 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground hover:bg-muted transition-colors">
                Annuler
              </button>
              <button onClick={() => setImportPhase('idle')} className="relative overflow-hidden h-[34px] px-4 text-xs font-medium uppercase tracking-wider border border-border bg-background text-foreground group">
                <span className="relative z-10">← Nouvelle recherche</span>
              </button>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs text-muted-foreground hidden sm:block">
                {selectedRoles.size} poste{selectedRoles.size > 1 ? 's' : ''} sélectionné{selectedRoles.size > 1 ? 's' : ''}
              </span>
              <button
                onClick={handleImport}
                disabled={selectedRoles.size === 0 || importing}
                className="relative overflow-hidden h-[38px] px-6 text-xs font-bold uppercase tracking-wider border border-border bg-foreground text-background disabled:opacity-40 disabled:cursor-not-allowed group"
              >
                <span className="relative z-10 flex items-center gap-2">
                  {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  Importer {selectedRoles.size} mission{selectedRoles.size > 1 ? 's' : ''}
                </span>
              </button>
            </div>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};

/* ─── RoleRow sub-component ─── */
const RoleRow = React.memo(({ role, selected, onToggle, showDepartment }: {
  role: OpenRole;
  selected: boolean;
  onToggle: () => void;
  showDepartment: boolean;
}) => (
  <button
    onClick={onToggle}
    className={cn(
      "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-t border-border first:border-t-0",
      selected ? "bg-muted" : "bg-background hover:bg-muted/50"
    )}
  >
    <Checkbox checked={selected} className="border-border data-[state=checked]:bg-foreground data-[state=checked]:text-background shrink-0" />
    <div className="flex-1 min-w-0">
      <div className="text-sm font-semibold text-foreground truncate">{role.title}</div>
      <div className="flex items-center gap-3 mt-0.5 flex-wrap">
        {role.location && <span className="flex items-center gap-1 text-xs text-muted-foreground"><MapPin className="w-3 h-3" /> {role.location}</span>}
        {showDepartment && role.department && (
          <span className="text-xs uppercase tracking-wider font-medium border border-border px-1.5 py-0 text-muted-foreground">{role.department}</span>
        )}
      </div>
    </div>
    <span className="text-xs uppercase tracking-wider text-muted-foreground border border-muted px-2 py-0.5 shrink-0">{role.source}</span>
    {role.url && (
      <a href={role.url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-muted-foreground hover:text-foreground shrink-0">
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    )}
  </button>
));
RoleRow.displayName = 'RoleRow';
