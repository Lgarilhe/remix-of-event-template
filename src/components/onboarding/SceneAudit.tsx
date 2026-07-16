import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Check, ChevronDown, ChevronUp, Globe, Briefcase, Star, MessageSquare, Linkedin, Share2, FileText, Cpu } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import analyticsIcon from '@/assets/icon-analytics-3d.webp';
import type { OnboardingCompanyData } from '@/pages/Onboarding';

interface Props {
  companyData: OnboardingCompanyData | null;
  onNext: () => void;
  onBack: () => void;
}

interface ScanSource {
  id: string;
  label: string;
  icon: React.ElementType;
  done: boolean;
}

interface Category {
  id: string;
  label: string;
  icon: React.ElementType;
  score: number;
  maxScore: number;
  color: string;
  summary: string;
  findings: string[];
}

interface AgentBubble {
  id: number;
  text: string;
}

const ICON_MAP: Record<string, React.ElementType> = {
  website: Globe,
  careers: Briefcase,
  wttj: Star,
  glassdoor: MessageSquare,
  linkedin: Linkedin,
  social: Share2,
  ads: FileText,
  ats: Cpu,
};

const SCAN_SOURCES: ScanSource[] = [
  { id: 'website', label: 'Site web', icon: Globe, done: false },
  { id: 'careers', label: 'Page carrière', icon: Briefcase, done: false },
  { id: 'wttj', label: 'Welcome to the Jungle', icon: Star, done: false },
  { id: 'glassdoor', label: 'Glassdoor', icon: MessageSquare, done: false },
  { id: 'linkedin', label: 'Page LinkedIn', icon: Linkedin, done: false },
  { id: 'social', label: 'Réseaux sociaux', icon: Share2, done: false },
  { id: 'ads', label: 'Qualité des annonces', icon: FileText, done: false },
];

const AGENT_MESSAGES = [
  "Analyse de votre site web en cours...",
  "Je cherche votre page carrière et vos offres...",
  "Scan de votre profil Welcome to the Jungle...",
  "Vérification de votre page Glassdoor...",
  "Analyse de votre page LinkedIn entreprise...",
  "Évaluation de votre présence sur les réseaux...",
  "Évaluation de la qualité de vos annonces...",
  "Analyse IA en cours... 🧠",
  "Calcul du score final... 🎯",
];

/* ─── Component ─── */
export const SceneAudit: React.FC<Props> = ({ companyData, onNext, onBack }) => {
  const [phase, setPhase] = useState<'scanning' | 'results' | 'error'>('scanning');
  const [sources, setSources] = useState<ScanSource[]>(SCAN_SOURCES.map(s => ({ ...s, done: false })));
  const [bubbles, setBubbles] = useState<AgentBubble[]>([]);
  const [expandedCat, setExpandedCat] = useState<string | null>(null);
  const [overallScore, setOverallScore] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [quickWins, setQuickWins] = useState<string[]>([]);
  const bubblesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bubblesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [bubbles]);

  // Auto-start scan with proper AbortController for StrictMode compatibility
  useEffect(() => {
    const abortController = new AbortController();
    const { signal } = abortController;

    // Reset state on each mount
    setPhase('scanning');
    setSources(SCAN_SOURCES.map(s => ({ ...s, done: false })));
    setBubbles([]);

    // Animate sources and messages
    const timers: ReturnType<typeof setTimeout>[] = [];

    SCAN_SOURCES.forEach((_, i) => {
      timers.push(setTimeout(() => {
        if (signal.aborted) return;
        setSources(prev => prev.map((s, j) => (j <= i ? { ...s, done: true } : s)));
      }, 600 + i * 550));
    });

    AGENT_MESSAGES.forEach((msg, i) => {
      timers.push(setTimeout(() => {
        if (signal.aborted) return;
        setBubbles(prev => [...prev, { id: i, text: msg }]);
      }, 500 + i * 600));
    });

    // Launch real API call in parallel with animation
    const MIN_ANIM_TIME = 2000;
    const MAX_WAIT_TIME = 60000;
    const startTime = Date.now();

    const runAudit = async () => {
      const companyName = companyData?.name || '';
      const domain = companyData?.domain || null;
      const linkedinUrl = companyData?.linkedinUrl || null;
      const careersUrl = companyData?.careersUrl || null;

      if (!companyName) return null;

      try {
        const { data, error } = await invokeEdgeFunction<{
          overall_score: number;
          categories: any[];
          quick_wins: string[];
          sources_scraped: any[];
        }>('audit-employer-brand', {
          company_name: companyName,
          domain,
          linkedin_url: linkedinUrl,
          careers_url: careersUrl,
        });

        if (signal.aborted) return null;

        if (error || !data?.success) {
          console.error('[SceneAudit] API error:', error || data?.error);
          return null;
        }

        const mappedCategories: Category[] = (data.categories || []).map((cat: any) => ({
          id: cat.id,
          label: cat.label,
          icon: ICON_MAP[cat.id] || Globe,
          score: cat.score,
          maxScore: cat.maxScore || 5,
          color: cat.color || 'hsl(var(--skalr-blue))',
          summary: cat.summary,
          findings: cat.findings || [],
        }));

        return {
          score: data.overall_score || 0,
          categories: mappedCategories,
          quickWins: data.quick_wins || [],
        };
      } catch (err) {
        console.error('[SceneAudit] Error:', err);
        return null;
      }
    };

    const auditPromise = runAudit();

    // Poll for completion
    const pollInterval = setInterval(() => {
      if (signal.aborted) {
        clearInterval(pollInterval);
        return;
      }
      const elapsed = Date.now() - startTime;
      if (elapsed > MAX_WAIT_TIME) {
        clearInterval(pollInterval);
        if (!signal.aborted) setPhase('error');
      }
    }, 500);

    // Wait for API result and minimum animation time
    auditPromise.then((apiResult) => {
      clearInterval(pollInterval);
      if (signal.aborted) return;
      const elapsed = Date.now() - startTime;
      const delay = Math.max(0, MIN_ANIM_TIME - elapsed);
      const t = setTimeout(() => {
        if (signal.aborted) return;
        if (apiResult) {
          setOverallScore(apiResult.score);
          setCategories(apiResult.categories);
          setQuickWins(apiResult.quickWins);
          setPhase('results');
        } else {
          setPhase('error');
        }
      }, delay);
      timers.push(t);
    }).catch((e) => { console.error('[SceneAudit] Audit failed:', e); if (!signal.aborted) setPhase('error'); });

    return () => {
      abortController.abort();
      clearInterval(pollInterval);
      timers.forEach(clearTimeout);
    };
  }, [companyData]);

  const circumference = 2 * Math.PI * 42;
  const scoreOffset = circumference - (overallScore / 100) * circumference;
  const improvementCount = categories.filter(c => c.score <= 3).length;

  return (
    <div className="w-full flex flex-col gap-4 sm:gap-5">
      {/* Header */}
      <div className="mb-2">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">Ce que les candidats voient de vous.</h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          Votre image employeur pèse directement sur vos taux de réponse. On analyse votre présence en ligne avant votre premier message.
        </p>
      </div>

      <AnimatePresence mode="wait">
        {/* ─── Scanning phase ─── */}
        {phase === 'scanning' && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex flex-col sm:grid sm:grid-cols-[200px_1fr] gap-4 min-h-[200px] sm:min-h-[280px]"
          >
            {/* Sources list */}
            <div className="space-y-1.5">
              {sources.map((s, i) => {
                const Icon = s.icon;
                return (
                  <motion.div
                    key={s.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.06 }}
                    className="flex items-center gap-2"
                  >
                    <div
                      className={`w-6 h-6 flex items-center justify-center text-xs font-bold border transition-all duration-300 ${
                        s.done ? 'border-transparent text-foreground' : 'border-border text-muted-foreground'
                      }`}
                      style={s.done ? { background: 'hsl(var(--primary))' } : {}}
                    >
                      {s.done ? <Check className="w-3 h-3" /> : String(i + 1).padStart(2, '0')}
                    </div>
                    <span className={`text-xs transition-colors ${s.done ? 'text-foreground font-medium' : 'text-muted-foreground'}`}>
                      {s.label}
                    </span>
                  </motion.div>
                );
              })}
            </div>

            {/* Agent bubbles */}
            <div className="flex flex-col gap-2 max-h-[300px] overflow-y-auto no-scrollbar pr-1">
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

        {/* ─── Error phase ─── */}
        {phase === 'error' && (
          <motion.div
            key="error"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-8 space-y-3"
          >
            <p className="text-sm text-muted-foreground">
              Impossible d'analyser votre marque employeur pour le moment. Vous pouvez passer cette étape et y revenir plus tard.
            </p>
            <div className="flex items-center justify-center gap-3 pt-2">
              <Button variant="outline" onClick={onBack} className="gap-2 border border-border text-sm">
                <ArrowLeft className="w-4 h-4" /> Retour
              </Button>
              <Button
                onClick={onNext}
                className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
              >
                <ArrowRight className="w-4 h-4" /> Passer
              </Button>
            </div>
          </motion.div>
        )}

        {/* ─── Results phase ─── */}
        {phase === 'results' && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="space-y-5"
          >
            {/* Score card */}
            <div
              className="border border-border/80 p-4 sm:p-5 flex flex-col sm:flex-row items-center gap-4 sm:gap-6"
              style={{ boxShadow: '4px 4px 0px 0px hsl(var(--primary))' }}
            >
              <img src={analyticsIcon} alt="" aria-hidden="true" className="w-10 h-10 sm:w-14 sm:h-14 shrink-0" />

              {/* Score ring */}
              <div className="relative w-20 h-20 sm:w-24 sm:h-24 shrink-0">
                <svg width="96" height="96" viewBox="0 0 96 96" className="rotate-[-90deg]">
                  <defs>
                    <linearGradient id="audit-score-grad" x1="0%" y1="0%" x2="100%" y2="100%">
                      <stop offset="0%" stopColor="hsl(var(--skalr-purple))" />
                      <stop offset="100%" stopColor="hsl(var(--skalr-pink))" />
                    </linearGradient>
                  </defs>
                  <circle cx="48" cy="48" r="42" fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth="5" />
                  <motion.circle
                    cx="48" cy="48" r="42" fill="none"
                    stroke="url(#audit-score-grad)"
                    strokeWidth="5" strokeLinecap="round"
                    strokeDasharray={circumference}
                    initial={{ strokeDashoffset: circumference }}
                    animate={{ strokeDashoffset: scoreOffset }}
                    transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
                  />
                </svg>
                <div className="absolute inset-0 flex flex-col items-center justify-center">
                  <motion.span
                    className="text-2xl font-bold"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.8 }}
                  >
                    {overallScore}
                  </motion.span>
                  <span className="text-xs text-muted-foreground">/100</span>
                </div>
              </div>

              <div className="flex-1 min-w-0 text-center sm:text-left">
                <div className="flex items-center gap-2 mb-1 justify-center sm:justify-start flex-wrap">
                  <h3 className="font-semibold text-base sm:text-lg">Score Marque Employeur</h3>
                  <span
                    className="text-xs uppercase tracking-wider font-bold px-2 py-0.5 rounded-md"
                    style={{
                      background: overallScore >= 70 ? 'hsl(var(--success) / 0.15)' : 'hsl(var(--warning) / 0.15)',
                      color: overallScore >= 70 ? 'hsl(var(--success))' : 'hsl(var(--warning))',
                    }}
                  >
                    {overallScore >= 70 ? 'Bon' : 'À améliorer'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">
                  {improvementCount} axes d'amélioration détectés sur {categories.length} catégories analysées.
                </p>
              </div>
            </div>

            {/* Categories */}
            <div className="space-y-2">
              {categories.map((cat) => {
                const Icon = cat.icon;
                const isExpanded = expandedCat === cat.id;
                const pct = (cat.score / cat.maxScore) * 100;
                return (
                  <div key={cat.id} className="border border-border overflow-hidden">
                    <button
                      onClick={() => setExpandedCat(isExpanded ? null : cat.id)}
                      className="w-full flex items-center gap-3 p-3 text-left hover:bg-muted/30 transition-colors"
                    >
                      <Icon className="w-4 h-4 shrink-0 text-muted-foreground" />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium truncate">{cat.label}</span>
                          <span className="text-xs font-bold ml-2 shrink-0" style={{ color: cat.color }}>
                            {cat.score}/{cat.maxScore}
                          </span>
                        </div>
                        <div className="w-full h-1.5 bg-accent/50 overflow-hidden">
                          <motion.div
                            className="h-full"
                            style={{ background: cat.color }}
                            initial={{ width: 0 }}
                            animate={{ width: `${pct}%` }}
                            transition={{ duration: 0.6, delay: 0.2 }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1 truncate">{cat.summary}</p>
                      </div>
                      {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
                    </button>
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.2 }}
                          className="overflow-hidden"
                        >
                          <div className="px-3 pb-3 pt-0 space-y-1.5 border-t border-border/5 mt-0 pt-2">
                            {cat.findings.map((f, i) => (
                              <div key={i} className="flex items-start gap-2 text-xs text-foreground/70">
                                <div className="w-1 h-1 mt-1.5 bg-foreground/30 shrink-0" />
                                {f}
                              </div>
                            ))}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            {/* Quick wins */}
            {quickWins.length > 0 && (
              <div className="border border-border p-4 space-y-3">
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Actions prioritaires</h4>
                  <span
                    className="text-xs uppercase tracking-wider font-bold px-2 py-0.5 rounded-md"
                    style={{ background: 'hsl(var(--warning) / 0.15)', color: 'hsl(var(--warning))' }}
                  >
                    Quick wins
                  </span>
                </div>
                {quickWins.map((action, i) => (
                  <div key={i} className="flex items-start gap-2.5 text-sm text-foreground/80">
                    <div className="w-2 h-2 mt-1.5 shrink-0 rounded-full bg-success" />
                    {action}
                  </div>
                ))}
              </div>
            )}

            {/* Skalr insight card */}
            <div
              className="border border-border p-4"
              style={{
                background: 'linear-gradient(135deg, hsl(var(--skalr-purple) / 0.04), hsl(var(--skalr-pink) / 0.04))',
              }}
            >
              <p className="text-xs text-foreground/70 leading-relaxed">
                <strong className="text-foreground">{improvementCount} axes d'amélioration identifiés.</strong>{' '}
                Konekt vous aide à travailler ces piliers en profondeur pour atteindre en moyenne{' '}
                <span className="font-semibold text-foreground">-30% de time-to-hire</span> et{' '}
                <span className="font-semibold text-foreground">×2 candidatures qualifiées</span>.
              </p>
            </div>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-1">
              <Button variant="outline" onClick={onBack} className="gap-2 border border-border text-sm">
                <ArrowLeft className="w-4 h-4" /> Retour
              </Button>
              <Button
                onClick={onNext}
                className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
              >
                <ArrowRight className="w-4 h-4" /> Continuer
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};
