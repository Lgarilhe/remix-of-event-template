import React, { useState, useCallback, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Link2, Check, Loader2, Building2, MapPin, Briefcase, ExternalLink, Plus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Checkbox } from '@/components/ui/checkbox';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/* ─── Types ─── */
interface ImportJobsModalProps {
  open: boolean;
  onClose: () => void;
  onImported?: (count: number) => void;
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
  openRoles: OpenRole[];
}

interface ScanSource {
  id: string;
  label: string;
  done: boolean;
}

interface AgentBubble {
  id: number;
  text: string;
}

type Phase = 'idle' | 'scanning' | 'results';

/* ─── Constants ─── */
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

function detectSource(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('welcometothejungle')) return 'WTTJ';
  if (lower.includes('lever.co') || lower.includes('greenhouse.io') || lower.includes('workable.com')) return 'ATS';
  return 'Careers page';
}

/* ─── Component ─── */
export const ImportJobsModal: React.FC<ImportJobsModalProps> = ({ open, onClose, onImported }) => {
  const [phase, setPhase] = useState<Phase>('idle');
  const [inputMode, setInputMode] = useState<'name' | 'url'>('name');
  const [companyName, setCompanyName] = useState('');
  const [directUrl, setDirectUrl] = useState('');
  const [sources, setSources] = useState<ScanSource[]>(SCAN_SOURCES);
  const [bubbles, setBubbles] = useState<AgentBubble[]>([]);
  const [result, setResult] = useState<CompanyResult | null>(null);
  const [selectedRoles, setSelectedRoles] = useState<Set<number>>(new Set());
  const [importing, setImporting] = useState(false);
  const bubblesEndRef = useRef<HTMLDivElement>(null);

  // Reset on close
  useEffect(() => {
    if (!open) {
      setTimeout(() => {
        setPhase('idle');
        setCompanyName('');
        setDirectUrl('');
        setResult(null);
        setSelectedRoles(new Set());
      }, 300);
    }
  }, [open]);

  // Auto-scroll bubbles
  useEffect(() => {
    bubblesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles]);

  const startScan = useCallback(async () => {
    const name = companyName.trim();
    const url = directUrl.trim();
    if (inputMode === 'name' && !name) return;
    if (inputMode === 'url' && !url) return;

    const scanStartedAt = Date.now();
    const MIN_ANIM_TIME = 2500;

    setPhase('scanning');
    setSources(SCAN_SOURCES.map(s => ({ ...s, done: false })));
    setBubbles([]);
    setResult(null);
    setSelectedRoles(new Set());

    // Animate sources
    SCAN_SOURCES.forEach((_, i) => {
      setTimeout(() => {
        setSources(prev => prev.map((s, j) => (j <= i ? { ...s, done: true } : s)));
      }, 800 + i * 600);
    });

    // Typewriter agent messages
    AGENT_MESSAGES.forEach((msg, i) => {
      setTimeout(() => {
        setBubbles(prev => [...prev, { id: i, text: msg }]);
      }, 600 + i * 900);
    });

    try {
      const body: Record<string, unknown> = {
        mode: 'jobs_only',
        force_refresh: true,
      };
      if (inputMode === 'url') {
        body.website_url = url;
        body.company_name = new URL(url).hostname.replace('www.', '').split('.')[0];
      } else {
        body.company_name = name;
        body.country = 'France';
      }

      const { data, error } = await invokeEdgeFunction<{
        company: {
          name: string;
          logoUrl: string | null;
          domain: string | null;
          openRoles: OpenRole[];
        };
      }>('enrich-company', body);

      const elapsed = Date.now() - scanStartedAt;
      const remaining = Math.max(0, MIN_ANIM_TIME - elapsed);

      setTimeout(() => {
        if (error || !data?.success) {
          toast.error("Impossible de scanner cette entreprise.");
          setPhase('idle');
          return;
        }

        const company = data.company;
        setResult({
          name: company.name || name || 'Entreprise',
          logoUrl: company.logoUrl,
          domain: company.domain,
          openRoles: company.openRoles || [],
        });
        // Select all by default
        setSelectedRoles(new Set((company.openRoles || []).map((_, i) => i)));
        setPhase('results');
      }, remaining);
    } catch (err) {
      console.error('[ImportJobsModal] Error:', err);
      toast.error("Erreur lors du scan.");
      setPhase('idle');
    }
  }, [companyName, directUrl, inputMode]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      startScan();
    }
  };

  const toggleRole = (idx: number) => {
    setSelectedRoles(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const toggleAll = () => {
    if (!result) return;
    if (selectedRoles.size === result.openRoles.length) {
      setSelectedRoles(new Set());
    } else {
      setSelectedRoles(new Set(result.openRoles.map((_, i) => i)));
    }
  };

  const handleImport = async () => {
    if (!result || selectedRoles.size === 0) return;
    setImporting(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const rolesToImport = Array.from(selectedRoles)
        .filter(idx => idx < result.openRoles.length)
        .map(idx => result.openRoles[idx]);

      const { error } = await supabase.from('sourcing_projects').insert(
        rolesToImport.map(role => ({
          name: role.title,
          description: `Importé depuis ${role.source}`,
          job_title: role.title,
          client_name: result.name,
          status: 'active' as const,
          created_by: user.id,
          filters_snapshot: {
            imported_from: role.source,
            imported_url: role.url || null,
            company_domain: result.domain,
            location: role.location,
            department: role.department,
          },
        }))
      );

      if (error) throw error;

      toast.success(`${rolesToImport.length} poste${rolesToImport.length > 1 ? 's' : ''} importé${rolesToImport.length > 1 ? 's' : ''} !`);
      onImported?.(rolesToImport.length);
      onClose();
    } catch (err) {
      console.error('[ImportJobsModal] Import error:', err);
      toast.error("Erreur lors de l'import.");
    } finally {
      setImporting(false);
    }
  };

  if (!open) return null;

  const progress = sources.filter(s => s.done).length / sources.length * 100;
  const detectedSource = directUrl ? detectSource(directUrl) : null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-background flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-8 py-4 border-b border-foreground">
          <h2 className="text-sm font-bold uppercase tracking-wider text-foreground">
            📥 Importer des postes
          </h2>
          <button
            onClick={onClose}
            className="h-8 w-8 flex items-center justify-center border border-foreground bg-background text-foreground hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="max-w-2xl mx-auto px-4 sm:px-8 py-8 sm:py-12">

            {/* ═══ Phase: idle ═══ */}
            {phase === 'idle' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
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

                {/* Mode selector */}
                <div className="flex gap-0">
                  <button
                    onClick={() => setInputMode('name')}
                    className={cn(
                      "flex-1 h-[34px] text-[10px] font-medium uppercase tracking-wider border border-foreground transition-colors",
                      inputMode === 'name'
                        ? "bg-foreground text-background"
                        : "bg-background text-foreground"
                    )}
                  >
                    <Building2 className="w-3.5 h-3.5 inline mr-1.5" />
                    Par nom
                  </button>
                  <button
                    onClick={() => setInputMode('url')}
                    className={cn(
                      "flex-1 h-[34px] text-[10px] font-medium uppercase tracking-wider border border-foreground border-l-0 transition-colors",
                      inputMode === 'url'
                        ? "bg-foreground text-background"
                        : "bg-background text-foreground"
                    )}
                  >
                    <Link2 className="w-3.5 h-3.5 inline mr-1.5" />
                    Par URL
                  </button>
                </div>

                {/* Input */}
                {inputMode === 'name' ? (
                  <div className="space-y-3">
                    <label className="text-xs font-medium uppercase tracking-wider text-foreground">
                      Nom de l'entreprise
                    </label>
                    <Input
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ex: Datadog, OVHcloud, Scaleway..."
                      className="border-foreground rounded-none h-11"
                      autoFocus
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <label className="text-xs font-medium uppercase tracking-wider text-foreground">
                      URL page carrières ou WTTJ
                    </label>
                    <Input
                      value={directUrl}
                      onChange={(e) => setDirectUrl(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder="Ex: https://www.welcometothejungle.com/fr/companies/datadog/jobs"
                      className="border-foreground rounded-none h-11"
                      autoFocus
                    />
                    {detectedSource && directUrl.length > 10 && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <Check className="w-3.5 h-3.5 text-green-600" />
                        Source détectée : <span className="font-semibold text-foreground">{detectedSource}</span>
                      </motion.div>
                    )}
                  </div>
                )}

                {/* Scan button */}
                <button
                  onClick={startScan}
                  disabled={inputMode === 'name' ? !companyName.trim() : !directUrl.trim()}
                  className="relative overflow-hidden w-full h-[42px] text-xs font-bold uppercase tracking-wider border border-foreground bg-foreground text-background disabled:opacity-40 disabled:cursor-not-allowed group"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    🔍 Scanner
                  </span>
                  <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                </button>
              </motion.div>
            )}

            {/* ═══ Phase: scanning ═══ */}
            {phase === 'scanning' && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-8"
              >
                {/* Progress */}
                <div className="space-y-4">
                  <Progress value={progress} className="h-2 rounded-none bg-muted [&>div]:bg-foreground" />
                  <div className="flex flex-wrap gap-3">
                    {sources.map(src => (
                      <div key={src.id} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        {src.done ? (
                          <Check className="w-3.5 h-3.5 text-green-600" />
                        ) : (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        )}
                        <span className={cn(src.done && 'text-foreground font-medium')}>{src.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Agent bubbles */}
                <div className="space-y-3 min-h-[120px]">
                  <AnimatePresence>
                    {bubbles.map(bubble => (
                      <motion.div
                        key={bubble.id}
                        initial={{ opacity: 0, x: -20, scale: 0.95 }}
                        animate={{ opacity: 1, x: 0, scale: 1 }}
                        className="flex items-start gap-2"
                      >
                        <div className="h-6 w-6 bg-foreground text-background flex items-center justify-center text-xs shrink-0 mt-0.5">
                          🤖
                        </div>
                        <div className="border border-foreground bg-muted px-3 py-2 text-sm text-foreground">
                          {bubble.text}
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                  <div ref={bubblesEndRef} />
                </div>
              </motion.div>
            )}

            {/* ═══ Phase: results ═══ */}
            {phase === 'results' && result && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-6"
              >
                {/* Company header */}
                <div className="flex items-center gap-3 border border-foreground p-4">
                  {result.logoUrl ? (
                    <img
                      src={result.logoUrl}
                      alt={result.name}
                      className="w-10 h-10 object-contain border border-muted"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  ) : (
                    <div className="w-10 h-10 bg-foreground text-background flex items-center justify-center text-lg font-bold">
                      {result.name.charAt(0)}
                    </div>
                  )}
                  <div>
                    <h3 className="font-bold text-foreground uppercase tracking-wide">{result.name}</h3>
                    {result.domain && (
                      <p className="text-xs text-muted-foreground">{result.domain}</p>
                    )}
                  </div>
                  <div className="ml-auto text-right">
                    <div className="text-2xl font-black text-foreground">{result.openRoles.length}</div>
                    <div className="text-[10px] uppercase tracking-wider text-muted-foreground">postes trouvés</div>
                  </div>
                </div>

                {result.openRoles.length === 0 ? (
                  <div className="border border-foreground p-8 text-center">
                    <div className="text-3xl mb-3">🤷</div>
                    <p className="text-sm text-muted-foreground mb-4">
                      Aucun poste ouvert détecté pour cette entreprise.
                    </p>
                    <button
                      onClick={() => setPhase('idle')}
                      className="relative overflow-hidden h-[34px] px-6 text-xs font-medium uppercase tracking-wider border border-foreground bg-background text-foreground group"
                    >
                      <span className="relative z-10">← Nouvelle recherche</span>
                      <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Select all */}
                    <div className="flex items-center justify-between">
                      <button
                        onClick={toggleAll}
                        className="text-xs font-medium text-muted-foreground hover:text-foreground uppercase tracking-wider transition-colors"
                      >
                        {selectedRoles.size === result.openRoles.length ? 'Tout désélectionner' : 'Tout sélectionner'}
                      </button>
                      <span className="text-xs text-muted-foreground">
                        {selectedRoles.size} sélectionné{selectedRoles.size > 1 ? 's' : ''}
                      </span>
                    </div>

                    {/* Roles list */}
                    <div className="space-y-0 border border-foreground divide-y divide-border">
                      {result.openRoles.map((role, idx) => (
                        <button
                          key={idx}
                          onClick={() => toggleRole(idx)}
                          className={cn(
                            "w-full flex items-center gap-3 px-4 py-3 text-left transition-colors",
                            selectedRoles.has(idx) ? "bg-muted" : "bg-background hover:bg-muted/50"
                          )}
                        >
                          <Checkbox
                            checked={selectedRoles.has(idx)}
                            className="border-foreground data-[state=checked]:bg-foreground data-[state=checked]:text-background"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-foreground truncate">{role.title}</div>
                            <div className="flex items-center gap-3 mt-0.5">
                              {role.location && (
                                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <MapPin className="w-3 h-3" /> {role.location}
                                </span>
                              )}
                              {role.department && (
                                <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <Briefcase className="w-3 h-3" /> {role.department}
                                </span>
                              )}
                            </div>
                          </div>
                          <span className="text-[10px] uppercase tracking-wider text-muted-foreground border border-muted px-2 py-0.5 shrink-0">
                            {role.source}
                          </span>
                          {role.url && (
                            <a
                              href={role.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="text-muted-foreground hover:text-foreground shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </motion.div>
            )}
          </div>
        </div>

        {/* Footer — results phase only */}
        {phase === 'results' && result && result.openRoles.length > 0 && (
          <div className="border-t border-foreground px-4 sm:px-8 py-4 flex items-center justify-between gap-3">
            <button
              onClick={() => setPhase('idle')}
              className="relative overflow-hidden h-[34px] px-4 text-xs font-medium uppercase tracking-wider border border-foreground bg-background text-foreground group"
            >
              <span className="relative z-10">← Nouvelle recherche</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            </button>
            <button
              onClick={handleImport}
              disabled={selectedRoles.size === 0 || importing}
              className="relative overflow-hidden h-[38px] px-6 text-xs font-bold uppercase tracking-wider border border-foreground bg-foreground text-background disabled:opacity-40 disabled:cursor-not-allowed group"
            >
              <span className="relative z-10 flex items-center gap-2">
                {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                Importer {selectedRoles.size} poste{selectedRoles.size > 1 ? 's' : ''}
              </span>
            </button>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
};
