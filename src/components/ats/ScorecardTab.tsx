import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { CreditCostBadge } from '@/components/ai/CreditCostBadge';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { ATSCandidate } from '@/hooks/useATSData';
import { useOrganization } from '@/hooks/useOrganization';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { Loader2, Sparkles, Star, RotateCcw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Pencil, Check, Plus, Trash2, AlertTriangle, MessageSquare, Copy, Mic } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LiveCoachingPanel } from './LiveCoachingPanel';

interface ScorecardTabProps {
  candidate: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
  onOpenProfile?: () => void;
  autoStartCoaching?: boolean;
}

interface Criterion {
  id: string;
  label: string;
  description: string;
  category: 'technical' | 'soft_skill' | 'culture_fit' | 'motivation';
  weight: number;
  suggestedQuestions?: string[];
  ratingRubric?: Record<string, string>;
  redFlags?: string[];
}

type Recommendation = 'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no';
type InterviewStage = 'phone_screen' | 'technique' | 'culture_fit' | 'final';

const INTERVIEW_STAGES: { value: InterviewStage; label: string }[] = [
  { value: 'phone_screen', label: 'Phone Screen' },
  { value: 'technique', label: 'Technique' },
  { value: 'culture_fit', label: 'Culture Fit' },
  { value: 'final', label: 'Final' },
];

const RECOMMENDATION_OPTIONS: { value: Recommendation; label: string; color: string }[] = [
  { value: 'strong_yes', label: 'Strong Yes', color: 'border-success bg-success/10 text-success' },
  { value: 'yes', label: 'Yes', color: 'border-success/30 bg-success/5 text-success' },
  { value: 'maybe', label: 'Maybe', color: 'border-warning/40 bg-warning/10 text-warning' },
  { value: 'no', label: 'No', color: 'border-destructive/30 bg-destructive/5 text-destructive' },
  { value: 'strong_no', label: 'Strong No', color: 'border-destructive bg-destructive/10 text-destructive' },
];

interface EvaluationData {
  id?: string;
  criteria: Criterion[];
  ratings: Record<string, number>;
  comments: Record<string, string>;
  overallScore: number | null;
  savedAt?: string;
  jobTitle?: string;
  recommendation?: Recommendation;
  summary?: string;
  followUpNotes?: string;
  interviewStage?: InterviewStage;
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string; dotColor: string }> = {
  technical: { label: 'Tech', color: 'border-info/40 bg-info/10 text-info', dotColor: 'bg-info' },
  soft_skill: { label: 'Soft', color: 'border-warning/40 bg-warning/10 text-warning', dotColor: 'bg-warning' },
  culture_fit: { label: 'Culture', color: 'border-brand-purple/40 bg-brand-purple/10 text-brand-purple', dotColor: 'bg-brand-purple' },
  motivation: { label: 'Motiv.', color: 'border-success/40 bg-success/10 text-success', dotColor: 'bg-success' },
};

export const ScorecardTab: React.FC<ScorecardTabProps> = ({ candidate, enrichedProfile, onOpenProfile, autoStartCoaching }) => {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const [evaluations, setEvaluations] = useState<EvaluationData[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedCriteria, setExpandedCriteria] = useState<Set<string>>(new Set());
  const [selectedStage, setSelectedStage] = useState<InterviewStage | ''>('');
  const [showCoaching, setShowCoaching] = useState(false);
  const [currentCriterionIdx, setCurrentCriterionIdx] = useState(0);
  const [coachingAutoNav, setCoachingAutoNav] = useState(true);
  const lastAutoNavCriterionRef = React.useRef<string | null>(null);
  const autoSaveTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeEval = activeIndex !== null ? evaluations[activeIndex] : null;

  // Load all evaluations
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const { data } = await supabase
          .from('candidate_evaluations')
          .select('*')
          .eq('candidate_id', candidate.candidateId)
          .eq('created_by', user.id)
          .order('created_at', { ascending: false });

        if (data && data.length > 0) {
          setEvaluations(data.map(d => ({
            id: d.id,
            criteria: (d.criteria as any) || [],
            ratings: (d.ratings as any) || {},
            comments: (d.comments as any) || {},
            overallScore: d.overall_score ? Number(d.overall_score) : null,
            savedAt: d.updated_at,
            jobTitle: d.job_title || undefined,
            recommendation: (d as any).recommendation || undefined,
            summary: (d as any).summary || undefined,
            followUpNotes: (d as any).follow_up_notes || undefined,
            interviewStage: (d as any).interview_stage || undefined,
          })));
        }
      } catch (err) {
        console.error('Error loading evaluations:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [candidate.candidateId]);

  // Auto-start coaching when prop is set (fullscreen mode)
  useEffect(() => {
    if (autoStartCoaching && !loading && evaluations.length > 0 && activeIndex !== null) {
      setShowCoaching(true);
    }
  }, [autoStartCoaching, loading, evaluations.length, activeIndex]);




  // Generate criteria via AI
  const handleGenerate = useCallback(async () => {
    setGenerating(true);
    try {
      const candidateProfile = {
        name: candidate.name,
        headline: enrichedProfile?.headline || candidate.headline,
        summary: enrichedProfile?.summary,
        skills: enrichedProfile?.skills || [],
        experiences: enrichedProfile?.experiences || [],
        education: enrichedProfile?.education || [],
        yearsOfExperience: enrichedProfile?.yearsOfExperience,
      };

      const jobContext: any = { title: candidate.jobTitle || 'Non spécifié' };

      if (candidate.jobId) {
        const { data: project } = await supabase
          .from('sourcing_projects')
          .select('job_title, client_name, description, filters_snapshot, job_details')
          .eq('job_id', candidate.jobId)
          .limit(1)
          .maybeSingle();

        if (project) {
          const jd = (project as any).job_details || {};
          jobContext.title = jd.title || project.job_title || jobContext.title;
          jobContext.client = jd.client?.name || project.client_name;
          jobContext.description = jd.mission_description || jd.context || project.description;
          jobContext.seniority = jd.seniority;
          jobContext.xpMin = jd.experience_min;
          jobContext.xpMax = jd.experience_max;
          jobContext.mustHave = (jd.skills_must_have || []).join(', ');
          jobContext.shouldHave = (jd.skills_should_have || []).join(', ');
          jobContext.niceToHave = (jd.skills_nice_to_have || []).join(', ');
          // Pass manager's evaluation criteria to the AI
          if (jd.evaluation_criteria?.length > 0) {
            jobContext.managerCriteria = jd.evaluation_criteria;
            jobContext.evaluationWeights = jd.evaluation_weights;
          }
        }

        try {
          const { data: notionData } = await invokeEdgeFunction('fetch-notion-jobs', {
            jobId: candidate.jobId,
          });
          if ((notionData as any)?.job) {
            jobContext.description = (notionData as any).job.description || jobContext.description;
            jobContext.requirements = (notionData as any).job.criteria;
            jobContext.skills = (notionData as any).job.skills;
          }
        } catch { /* Non-blocking */ }
      }

      const stage = activeEval?.interviewStage || selectedStage || undefined;

      // Fetch process steps to enrich stage context
      if (candidate.jobId && stage) {
        try {
          const { data: projectForSteps } = await supabase
            .from('sourcing_projects')
            .select('id')
            .eq('job_id', candidate.jobId)
            .limit(1)
            .maybeSingle();
          if (projectForSteps) {
            const { data: processSteps } = await supabase
              .from('mission_process_steps')
              .select('name, description, objectives, evaluation_criteria, is_eliminatory')
              .eq('project_id', projectForSteps.id)
              .order('step_order', { ascending: true });
            if (processSteps?.length) {
              jobContext.processSteps = processSteps;
              // Find the current step by name match or index
              const currentStep = processSteps.find(s => s.name.toLowerCase().includes(stage.toLowerCase()));
              if (currentStep) {
                jobContext.currentStepObjectives = currentStep.objectives;
                jobContext.currentStepIsEliminatory = currentStep.is_eliminatory;
              }
            }
          }
        } catch { /* Non-blocking */ }
      }

      const { data, error } = await invokeWithCredits('generate-scorecard', 'generate_scorecard', {
        candidateProfile, jobContext, scoringDetails: candidate.scoringDetails, interviewStage: stage,
      }, { modelOverride: selectedModel ?? undefined });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to generate scorecard');

      const criteria = data.criteria as Criterion[];

      if (activeIndex !== null) {
        setEvaluations(prev => prev.map((ev, i) => i === activeIndex ? {
          ...ev, criteria, overallScore: null,
        } : ev));
      } else {
        const newEval: EvaluationData = {
          criteria,
          ratings: {},
          comments: {},
          overallScore: null,
          jobTitle: candidate.jobTitle || undefined,
          interviewStage: (selectedStage as InterviewStage) || undefined,
        };
        setEvaluations(prev => [newEval, ...prev]);
        setActiveIndex(0);
      }

      toast.success(`${criteria.length} critères générés sur mesure`);
    } catch (err: any) {
      console.error('Error generating scorecard:', err);
      toast.error(err?.message || 'Erreur lors de la génération');
    } finally {
      setGenerating(false);
    }
  }, [candidate, enrichedProfile, activeIndex, selectedStage, activeEval]);

  const computeOverallScore = useCallback((ratings: Record<string, number>, criteria: Criterion[]): number | null => {
    const rated = criteria.filter(c => ratings[c.id] != null);
    if (rated.length === 0) return null;
    const totalWeight = rated.reduce((sum, c) => sum + c.weight, 0);
    const weightedSum = rated.reduce((sum, c) => sum + (ratings[c.id] || 0) * c.weight, 0);
    return Math.round((weightedSum / totalWeight) * 10) / 10;
  }, []);

  const updateActiveEval = useCallback((updater: (ev: EvaluationData) => EvaluationData) => {
    if (activeIndex === null) return;
    setEvaluations(prev => prev.map((ev, i) => i === activeIndex ? updater(ev) : ev));
  }, [activeIndex]);

  const handleRate = useCallback((criterionId: string, rating: number) => {
    updateActiveEval(ev => {
      const newRatings = { ...ev.ratings, [criterionId]: rating };
      return { ...ev, ratings: newRatings, overallScore: computeOverallScore(newRatings, ev.criteria) };
    });
    // Debounced auto-save
    if (autoSaveTimeout.current) clearTimeout(autoSaveTimeout.current);
    autoSaveTimeout.current = setTimeout(async () => {
      if (activeIndex === null) return;
      setEvaluations(prev => {
        const ev = prev[activeIndex];
        if (!ev) return prev;
        const save = async () => {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const payload: any = {
            candidate_id: candidate.candidateId,
            job_id: candidate.jobId,
            job_title: candidate.jobTitle,
            criteria: ev.criteria as any,
            ratings: ev.ratings as any,
            comments: ev.comments as any,
            overall_score: ev.overallScore,
            created_by: user.id,
            updated_at: new Date().toISOString(),
            recommendation: ev.recommendation || null,
            summary: ev.summary || null,
            follow_up_notes: ev.followUpNotes || null,
            interview_stage: ev.interviewStage || null,
            organization_id: organizationId || null,
          };
          if (ev.id) {
            const { error: saveErr } = await supabase.from('candidate_evaluations').update(payload).eq('id', ev.id);
            if (saveErr) console.warn('Auto-save failed:', saveErr);
          }
        };
        save().catch(console.warn);
        return prev;
      });
    }, 3000);
  }, [updateActiveEval, computeOverallScore, activeIndex, candidate]);

  // Keyboard shortcuts: 1-5 to rate, arrows to navigate criteria
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (activeIndex === null || !activeEval) return;
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        const criterion = activeEval.criteria[currentCriterionIdx];
        if (criterion) handleRate(criterion.id, +e.key);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentCriterionIdx(i => Math.min(activeEval.criteria.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentCriterionIdx(i => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeIndex, activeEval, currentCriterionIdx, handleRate]);

  const handleComment = useCallback((criterionId: string, comment: string) => {
    updateActiveEval(ev => ({ ...ev, comments: { ...ev.comments, [criterionId]: comment } }));
  }, [updateActiveEval]);

  const handleSave = useCallback(async () => {
    if (activeIndex === null || !activeEval) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const now = new Date().toISOString();
      const payload: any = {
        candidate_id: candidate.candidateId,
        job_id: candidate.jobId,
        job_title: candidate.jobTitle,
        criteria: activeEval.criteria as any,
        ratings: activeEval.ratings as any,
        comments: activeEval.comments as any,
        overall_score: activeEval.overallScore,
        created_by: user.id,
        updated_at: now,
        recommendation: activeEval.recommendation || null,
        summary: activeEval.summary || null,
        follow_up_notes: activeEval.followUpNotes || null,
        interview_stage: activeEval.interviewStage || null,
        organization_id: organizationId || null,
      };

      if (activeEval.id) {
        const { error } = await supabase
          .from('candidate_evaluations')
          .update(payload)
          .eq('id', activeEval.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('candidate_evaluations')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        updateActiveEval(ev => ({ ...ev, id: data.id }));
      }

      updateActiveEval(ev => ({ ...ev, savedAt: now }));
      setActiveIndex(null);
      setExpandedCriteria(new Set());
      toast.success('Évaluation sauvegardée');
    } catch (err: any) {
      console.error('Error saving:', err);
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  }, [activeEval, activeIndex, candidate, updateActiveEval]);

  const handleDelete = useCallback(async (index: number) => {
    const ev = evaluations[index];
    if (!ev) return;
    if (ev.id) {
      const { error } = await supabase.from('candidate_evaluations').delete().eq('id', ev.id);
      if (error) { toast.error('Erreur lors de la suppression'); return; }
    }
    setEvaluations(prev => prev.filter((_, i) => i !== index));
    if (activeIndex === index) { setActiveIndex(null); setExpandedCriteria(new Set()); }
    else if (activeIndex !== null && activeIndex > index) setActiveIndex(activeIndex - 1);
    toast.success('Scorecard supprimée');
  }, [evaluations, activeIndex]);

  const handleNewScorecard = () => {
    const newEval: EvaluationData = {
      criteria: [],
      ratings: {},
      comments: {},
      overallScore: null,
      jobTitle: candidate.jobTitle || undefined,
    };
    setEvaluations(prev => [newEval, ...prev]);
    setActiveIndex(0);
    setExpandedCriteria(new Set());
    setSelectedStage('');
  };

  const toggleExpand = (id: string) => {
    setExpandedCriteria(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success('Copié !');
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ─── Active scorecard editing/generating ───
  if (activeIndex !== null && activeEval) {
    const ratedCount = activeEval.criteria.filter(c => activeEval.ratings[c.id] != null).length;
    const totalCriteria = activeEval.criteria.length;

    // Empty criteria = needs generation
    if (totalCriteria === 0) {
      return (
        <div className="space-y-4">
          <button onClick={() => { setActiveIndex(null); setEvaluations(prev => prev[0]?.criteria.length === 0 && !prev[0]?.id ? prev.slice(1) : prev); }}
            className="text-xs text-muted-foreground hover:text-foreground uppercase tracking-wider flex items-center gap-1">
            ← Retour
          </button>
          <div className="text-center py-10">
            <div className="h-14 w-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground mb-2">
              Nouvelle scorecard
            </h3>
            <p className="text-xs text-muted-foreground max-w-sm mx-auto mb-4 leading-relaxed">
              L'IA va analyser le profil et le poste pour générer une grille d'évaluation sur mesure.
            </p>

            {/* Interview stage selector */}
            <div className="max-w-xs mx-auto mb-6">
              <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">Type d'entretien (optionnel)</p>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {INTERVIEW_STAGES.map(s => (
                  <button key={s.value}
                    onClick={() => setSelectedStage(selectedStage === s.value ? '' : s.value)}
                    className={cn(
                      "px-3 py-1.5 text-xs font-medium uppercase tracking-wider border transition-colors",
                      selectedStage === s.value
                        ? "bg-foreground text-background border-border"
                        : "border-border text-muted-foreground hover:border-border"
                    )}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={generating}
              className="relative overflow-hidden h-[38px] px-6 bg-foreground text-background border border-border text-xs font-medium uppercase tracking-wider disabled:opacity-50"
            >
              {generating ? (
                <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Génération en cours...</span>
              ) : (
                <span className="flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> Générer la scorecard</span>
              )}
            </button>
            <div className="mt-3 flex justify-center">
              <ModelPicker actionId="generate_scorecard" value={selectedModel} onChange={setSelectedModel} compact />
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4 pr-1">
        <button onClick={() => setActiveIndex(null)}
          className="text-xs text-muted-foreground hover:text-foreground uppercase tracking-wider flex items-center gap-1">
          ← Retour aux scorecards
        </button>

        {/* Header bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            {activeEval.overallScore != null && (
              <div className={cn(
                "h-10 w-10 sm:h-12 sm:w-12 flex items-center justify-center border-2 text-base sm:text-lg font-bold",
                activeEval.overallScore >= 4 ? "border-success/40 bg-success/10 text-success" :
                activeEval.overallScore >= 3 ? "border-warning/40 bg-warning/10 text-warning" :
                "border-destructive/40 bg-destructive/10 text-destructive"
              )}>
                {activeEval.overallScore}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <p className="text-xs font-bold uppercase tracking-wider text-foreground">
                  {ratedCount}/{totalCriteria} critères évalués
                </p>
                {activeEval.interviewStage && (
                  <span className="text-xs px-1.5 py-0.5 border border-border bg-accent/50 text-muted-foreground font-medium uppercase tracking-wider">
                    {INTERVIEW_STAGES.find(s => s.value === activeEval.interviewStage)?.label || activeEval.interviewStage}
                  </span>
                )}
              </div>
              {/* Category breakdown bars */}
              {(() => {
                const cats = ['technical', 'soft_skill', 'culture_fit', 'motivation'] as const;
                const catConf = {
                  technical: { label: 'Tech', color: 'hsl(var(--status-info))' },
                  soft_skill: { label: 'Soft', color: 'hsl(var(--status-warning))' },
                  culture_fit: { label: 'Culture', color: 'hsl(var(--skalr-purple))' },
                  motivation: { label: 'Motiv.', color: 'hsl(var(--status-success))' },
                };
                return (
                  <div className="flex gap-4 mt-2">
                    {cats.map(cat => {
                      const catCriteria = activeEval.criteria.filter(c => c.category === cat && activeEval.ratings[c.id] != null);
                      if (catCriteria.length === 0) return null;
                      const avg = catCriteria.reduce((s, c) => s + activeEval.ratings[c.id], 0) / catCriteria.length;
                      const conf = catConf[cat];
                      return (
                        <div key={cat} className="flex flex-col gap-1 min-w-[50px]">
                          <div className="flex justify-between items-center">
                            <span className="text-[8px] font-bold uppercase tracking-wider" style={{ color: conf.color }}>{conf.label}</span>
                            <span className="text-[8px] tabular-nums text-muted-foreground">{avg.toFixed(1)}</span>
                          </div>
                          <div className="h-[3px] bg-foreground/10">
                            <div className="h-[3px] transition-all duration-500" style={{ width: `${(avg / 5) * 100}%`, background: conf.color }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
              <p className="text-xs text-muted-foreground">
                {activeEval.jobTitle || candidate.jobTitle || 'Poste non spécifié'}
              </p>
            </div>
          </div>
          <div className="flex gap-0 self-end sm:self-auto">
            <button onClick={async () => {
                // Auto-save before navigating to fullscreen coaching
                if (activeEval) {
                  try {
                    const { data: { user } } = await supabase.auth.getUser();
                    if (user) {
                      const now = new Date().toISOString();
                      const payload: any = {
                        candidate_id: candidate.candidateId,
                        job_id: candidate.jobId,
                        job_title: candidate.jobTitle,
                        criteria: activeEval.criteria as any,
                        ratings: activeEval.ratings as any,
                        comments: activeEval.comments as any,
                        overall_score: activeEval.overallScore,
                        created_by: user.id,
                        updated_at: now,
                        recommendation: activeEval.recommendation || null,
                        summary: activeEval.summary || null,
                        follow_up_notes: activeEval.followUpNotes || null,
                        interview_stage: activeEval.interviewStage || null,
                        organization_id: organizationId || null,
                      };
                      if (activeEval.id) {
                        const { error: updErr } = await supabase.from('candidate_evaluations').update(payload).eq('id', activeEval.id);
                        if (updErr) console.warn('Save before fullscreen failed:', updErr);
                      } else {
                        const { data, error: insErr } = await supabase.from('candidate_evaluations').insert(payload).select('id').single();
                        if (data && !insErr) updateActiveEval(ev => ({ ...ev, id: data.id }));
                      }
                    }
                  } catch (e) { console.warn('Auto-save before fullscreen failed:', e); }
                }
                navigate(`/ats/scorecard/${candidate.candidateId}?coaching=1`);
              }}
              className="relative overflow-hidden h-8 px-2 sm:px-3 flex items-center gap-1.5 border border-destructive text-destructive text-xs font-medium uppercase tracking-wider group -ml-px">
              <Mic className="w-3 h-3" />
              <span className="hidden sm:inline">Coaching Live</span>
            </button>
            <button onClick={handleGenerate} disabled={generating}
              className="relative overflow-hidden h-8 px-2 sm:px-3 flex items-center gap-1.5 border border-border text-foreground text-xs font-medium uppercase tracking-wider group disabled:opacity-50 -ml-px">
              {generating ? <Loader2 className="w-3 h-3 animate-spin relative z-10" /> : <RotateCcw className="w-3 h-3 relative z-10" />}
              <span className="relative z-10 hidden sm:inline">Régénérer</span>
            </button>
            <button onClick={handleSave} disabled={saving}
              className="relative overflow-hidden h-8 px-2 sm:px-3 flex items-center gap-1.5 border border-border -ml-px bg-foreground text-background text-xs font-medium uppercase tracking-wider disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              <span className="hidden sm:inline">Sauvegarder</span>
            </button>
          </div>
        </div>

        {/* Live Coaching Panel — now inline in the side context panel on desktop, stacked on mobile */}
        {showCoaching && activeEval && (
          <div className="lg:hidden">
          <LiveCoachingPanel
            candidateId={candidate.candidateId}
            candidateName={candidate.name}
            candidateHeadline={candidate.headline || ''}
            candidateProfileSummary={(() => {
              const p = candidate.linkedinProfileData as any;
              return p?.summary || p?.about || p?.headline || '';
            })()}
            jobId={candidate.jobId || ''}
            jobTitle={candidate.jobTitle || ''}
            jobContext={`Poste: ${candidate.jobTitle || 'N/A'}`}
            criteria={activeEval.criteria}
            scorecardId={activeEval.id}
            onCriteriaUpdate={(updates) => {
              if (!coachingAutoNav || !activeEval) return;
              const coveredIds = Object.entries(updates)
                .filter(([, u]) => u.covered)
                .map(([id]) => id);
              if (coveredIds.length === 0) return;
              const latestCovered = coveredIds[coveredIds.length - 1];
              if (latestCovered !== lastAutoNavCriterionRef.current) {
                lastAutoNavCriterionRef.current = latestCovered;
                const idx = activeEval.criteria.findIndex(c => c.id === latestCovered);
                if (idx !== -1) setCurrentCriterionIdx(idx);
              }
            }}
            onAutoScores={(scores) => {
              for (const [id, score] of Object.entries(scores)) {
                handleRate(id, score);
              }
            }}
            onReportGenerated={(report) => {
              updateActiveEval(ev => ({
                ...ev,
                summary: report.summary,
                recommendation: report.recommendation === 'GO' ? 'strong_yes' : report.recommendation === 'NO_GO' ? 'strong_no' : 'maybe',
                followUpNotes: report.open_questions?.join('\n• ') || '',
              }));
            }}
            onClose={() => setShowCoaching(false)}
            onOpenProfile={onOpenProfile}
          />
          </div>
        )}

        {/* Mobile category tabs (horizontal scroll) */}
        <div className="flex sm:hidden items-center gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
          {activeEval.criteria.map((c, idx) => {
            const r = activeEval.ratings[c.id];
            const isCurrent = idx === currentCriterionIdx;
            const catConfig = CATEGORY_CONFIG[c.category] || CATEGORY_CONFIG.technical;
            return (
              <button key={c.id} onClick={() => setCurrentCriterionIdx(idx)}
                className={cn(
                  "shrink-0 px-2 py-1 text-xs font-bold uppercase tracking-wider border transition-all whitespace-nowrap",
                  isCurrent
                    ? catConfig.color + " ring-1 ring-offset-1"
                    : r != null
                      ? "border-border text-muted-foreground"
                      : "border-border text-muted-foreground/50"
                )}>
                {idx + 1}. {catConfig.label}
              </button>
            );
          })}
        </div>

        {/* Side rail + Card + Context panel layout */}
        <div className="flex gap-3">
          {/* Criteria side rail */}
          <div className="hidden sm:flex flex-col gap-1 w-[140px] shrink-0 sticky top-24 self-start max-h-[calc(100vh-120px)] overflow-y-auto">
            {activeEval.criteria.map((c, idx) => {
              const r = activeEval.ratings[c.id];
              const isCurrent = idx === currentCriterionIdx;
              const catConfig = CATEGORY_CONFIG[c.category] || CATEGORY_CONFIG.technical;
              return (
                <button key={c.id} onClick={() => setCurrentCriterionIdx(idx)}
                  className={cn(
                    "text-left px-2 py-1.5 border-l-2 transition-all text-xs leading-tight truncate",
                    isCurrent
                      ? "border-border bg-foreground/[0.06] text-foreground font-bold"
                      : r != null
                        ? "border-border text-muted-foreground hover:bg-foreground/[0.03]"
                        : "border-transparent text-muted-foreground/60 hover:border-border hover:text-muted-foreground"
                  )}>
                  <div className="flex items-center gap-1.5">
                    <span className={cn("w-1.5 h-1.5 shrink-0", catConfig.dotColor,
                      r != null && r >= 4 ? "bg-success" :
                      r != null && r >= 3 ? "bg-warning" :
                      r != null ? "bg-destructive" : catConfig.dotColor
                    )} />
                    <span className="truncate">{c.label}</span>
                    {r != null && <span className="text-[8px] tabular-nums ml-auto shrink-0 font-bold">{r}</span>}
                  </div>
                </button>
              );
            })}
            {showCoaching && (
              <label className="flex items-center gap-1.5 px-2 py-2 mt-2 border-t border-border cursor-pointer">
                <input type="checkbox" checked={coachingAutoNav} onChange={e => setCoachingAutoNav(e.target.checked)}
                  className="w-3 h-3 accent-foreground" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">Auto-nav</span>
              </label>
            )}
          </div>




          {/* Card column */}
          <div className="flex-1 min-w-0">
        {/* Single criterion card */}
        {(() => {
          const criterion = activeEval.criteria[currentCriterionIdx];
          if (!criterion) return null;
          const rating = activeEval.ratings[criterion.id];
          const comment = activeEval.comments[criterion.id] || '';
          const catConfig = CATEGORY_CONFIG[criterion.category] || CATEGORY_CONFIG.technical;
          const isCritical = criterion.weight === 3;
          const questions = criterion.suggestedQuestions || [];
          const redFlags = criterion.redFlags || [];
          const totalC = activeEval.criteria.length;

          return (
            <div className="border border-border relative">
              {/* Card header */}
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-foreground/[0.03]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn("text-xs px-1.5 py-0.5 border font-bold uppercase tracking-wider shrink-0", catConfig.color)}>
                    {catConfig.label}
                  </span>
                  {isCritical && (
                    <span className="text-xs px-1.5 py-0.5 border-2 border-destructive bg-destructive/10 text-destructive font-bold uppercase tracking-wider shrink-0">Critique</span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground tabular-nums shrink-0 font-bold">
                  {currentCriterionIdx + 1}/{totalC}
                </span>
              </div>

              {/* Card body */}
              <div className="px-4 py-4 space-y-4">
                {/* Criterion title */}
                <h3 className="text-sm font-bold text-foreground leading-snug uppercase tracking-wide">{criterion.label}</h3>
                <p className="text-xs text-muted-foreground leading-relaxed">{criterion.description}</p>

                {/* Big rating buttons */}
                <div className="flex items-center justify-center gap-2 py-2">
                  {[1, 2, 3, 4, 5].map(score => (
                    <button key={score}
                      onClick={() => handleRate(criterion.id, score)}
                      className={cn(
                        "w-12 h-12 flex items-center justify-center text-lg font-bold border-2 transition-all duration-150",
                        rating === score
                          ? "border-border bg-foreground text-background scale-110"
                          : "border-border text-foreground/40 hover:border-border hover:text-foreground"
                      )}
                    >
                      {score}
                    </button>
                  ))}
                </div>

                {/* Show rubric for selected rating */}
                {rating && criterion.ratingRubric?.[String(rating)] && (
                  <div className="text-xs px-3 py-2 border-l-2 border-border bg-foreground/[0.04] text-muted-foreground">
                    {criterion.ratingRubric[String(rating)]}
                  </div>
                )}

                {/* Points to verify */}
                {questions.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-bold uppercase tracking-wider text-foreground">
                      À vérifier
                    </p>
                    <ul className="space-y-1">
                      {questions.slice(0, 3).map((q, qi) => (
                        <li key={qi} className="flex items-start gap-1.5 text-xs text-muted-foreground leading-snug">
                          <span className="w-1 h-1 bg-foreground/40 shrink-0 mt-1.5" />
                          <span>{q.replace(/^["«]|["»]$/g, '').replace(/\?$/, '')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Red flags */}
                {redFlags.length > 0 && (
                  <div className="flex items-start gap-2 px-2 py-1.5 border-2 border-destructive/30 bg-destructive/5">
                    <AlertTriangle className="w-3 h-3 text-destructive shrink-0 mt-0.5" />
                    <span className="text-xs text-destructive leading-snug font-medium">{redFlags[0]}</span>
                  </div>
                )}

                {/* Notes */}
                <Textarea value={comment} onChange={e => handleComment(criterion.id, e.target.value)}
                  placeholder="Notes rapides..." className="text-xs min-h-[50px] rounded-lg border border-border focus:border-border resize-none py-1.5 px-2" />
              </div>

              {/* Navigation arrows */}
              <div className="flex items-center justify-between px-4 py-3 border-t-2 border-border">
                <button
                  onClick={() => setCurrentCriterionIdx(Math.max(0, currentCriterionIdx - 1))}
                  disabled={currentCriterionIdx === 0}
                  className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-foreground disabled:opacity-20 hover:text-foreground/70"
                >
                  <ChevronLeft className="w-4 h-4" /> Préc
                </button>
                <button
                  onClick={() => {
                    if (currentCriterionIdx < totalC - 1) {
                      setCurrentCriterionIdx(currentCriterionIdx + 1);
                    }
                  }}
                  disabled={currentCriterionIdx === totalC - 1}
                  className="flex items-center gap-1 text-xs font-bold uppercase tracking-wider text-foreground disabled:opacity-20 hover:text-foreground/70"
                >
                  Suiv <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })()}
          </div>{/* end card column */}

          {/* Context panel — right side (desktop only) */}
          <div className="hidden lg:block w-[300px] shrink-0 sticky top-24 self-start max-h-[calc(100vh-120px)] overflow-y-auto space-y-3">
            {/* Live Coaching — desktop: inline in context panel */}
            {showCoaching && activeEval && (
              <LiveCoachingPanel
                candidateId={candidate.candidateId}
                candidateName={candidate.name}
                candidateHeadline={candidate.headline || ''}
                candidateProfileSummary={(() => { const p = candidate.linkedinProfileData as any; return p?.summary || p?.about || p?.headline || ''; })()}
                jobId={candidate.jobId || ''}
                jobTitle={candidate.jobTitle || ''}
                jobContext={`Poste: ${candidate.jobTitle || 'N/A'}`}
                criteria={activeEval.criteria}
                scorecardId={activeEval.id}
                onCriteriaUpdate={(updates) => {
                  if (!coachingAutoNav || !activeEval) return;
                  const coveredIds = Object.entries(updates).filter(([, u]) => u.covered).map(([id]) => id);
                  if (coveredIds.length === 0) return;
                  const latestCovered = coveredIds[coveredIds.length - 1];
                  if (latestCovered !== lastAutoNavCriterionRef.current) {
                    lastAutoNavCriterionRef.current = latestCovered;
                    const idx = activeEval.criteria.findIndex(c => c.id === latestCovered);
                    if (idx !== -1) setCurrentCriterionIdx(idx);
                  }
                }}
                onAutoScores={(scores) => { for (const [id, score] of Object.entries(scores)) handleRate(id, score); }}
                onReportGenerated={(report) => { updateActiveEval(ev => ({ ...ev, summary: report.summary, recommendation: report.recommendation === 'GO' ? 'strong_yes' : report.recommendation === 'NO_GO' ? 'strong_no' : 'maybe', followUpNotes: report.open_questions?.join('\n') || ev.followUpNotes })); }}
                onClose={() => setShowCoaching(false)}
                onOpenProfile={onOpenProfile}
              />
            )}
            {/* Current criterion context */}
            {(() => {
              const currentCriterion = activeEval.criteria[currentCriterionIdx];
              if (!currentCriterion) return null;
              const rating = activeEval.ratings[currentCriterion.id];

              return (
                <>
                  {/* Quick score overview */}
                  <div className="border border-border p-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Progression</p>
                    <div className="flex items-center gap-2 mb-2">
                      <div className="flex-1 h-1.5 bg-foreground/10">
                        <div className="h-full bg-foreground transition-all duration-300" style={{ width: `${(ratedCount / totalCriteria) * 100}%` }} />
                      </div>
                      <span className="text-xs font-bold text-foreground">{ratedCount}/{totalCriteria}</span>
                    </div>
                    {activeEval.overallScore != null && (
                      <p className="text-xs text-muted-foreground">Score actuel : <strong className="text-foreground">{activeEval.overallScore}/5</strong></p>
                    )}
                  </div>

                  {/* Suggested questions for current criterion */}
                  {currentCriterion.suggestedQuestions && currentCriterion.suggestedQuestions.length > 0 && (
                    <div className="border border-border p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">💡 Questions suggérées</p>
                      <div className="space-y-1.5">
                        {currentCriterion.suggestedQuestions.map((q: string, i: number) => (
                          <p key={i} className="text-xs text-foreground leading-relaxed">• {q}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Red flags for current criterion */}
                  {currentCriterion.redFlags && currentCriterion.redFlags.length > 0 && (
                    <div className="border border-destructive/20 bg-destructive/5 p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-destructive mb-2">⚠️ Red flags</p>
                      <div className="space-y-1">
                        {currentCriterion.redFlags.map((rf: string, i: number) => (
                          <p key={i} className="text-xs text-destructive">{rf}</p>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Rating rubric for current selection */}
                  {rating != null && currentCriterion.ratingRubric && (
                    <div className="border border-border p-3">
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">📊 Échelle</p>
                      <div className="space-y-1">
                        {Object.entries(currentCriterion.ratingRubric).map(([score, desc]) => (
                          <div key={score} className={cn(
                            "flex items-start gap-2 text-xs px-2 py-1",
                            String(rating) === score ? "bg-accent/50 font-medium text-foreground" : "text-muted-foreground"
                          )}>
                            <span className="font-bold shrink-0 w-3">{score}</span>
                            <span>{desc as string}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Criterion weight info */}
                  <div className="border border-border p-3 text-xs text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>Poids : {currentCriterion.weight === 3 ? '🔴 Critique' : currentCriterion.weight === 2 ? '🟡 Important' : '🟢 Bonus'}</span>
                      <span>{currentCriterionIdx + 1}/{totalCriteria}</span>
                    </div>
                  </div>
                </>
              );
            })()}
          </div>{/* end context panel */}
        </div>{/* end flex rail+card+context */}

        {/* ─── Verdict Section ─── */}
        <div className="border-t-2 border-border pt-4 mt-6 space-y-4">
          <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">Verdict final</h4>

          {/* Recommendation */}
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Recommandation</p>
            <div className="flex flex-wrap gap-1.5">
              {RECOMMENDATION_OPTIONS.map(opt => (
                <button key={opt.value}
                  onClick={() => updateActiveEval(ev => ({ ...ev, recommendation: ev.recommendation === opt.value ? undefined : opt.value }))}
                  className={cn(
                    "px-3 py-1.5 text-xs font-bold uppercase tracking-wider border transition-all",
                    activeEval.recommendation === opt.value
                      ? opt.color + " ring-1 ring-offset-1"
                      : "border-border text-muted-foreground hover:border-border"
                  )}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Résumé / Justification</p>
            <Textarea
              value={activeEval.summary || ''}
              onChange={e => updateActiveEval(ev => ({ ...ev, summary: e.target.value }))}
              placeholder="Résumé de l'entretien et justification de la recommandation..."
              className="text-xs min-h-[80px] rounded-lg border-border resize-none"
            />
          </div>

          {/* Follow-up notes */}
          <div className="space-y-1.5">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">Points de suivi (prochain round)</p>
            <Textarea
              value={activeEval.followUpNotes || ''}
              onChange={e => updateActiveEval(ev => ({ ...ev, followUpNotes: e.target.value }))}
              placeholder="Questions à creuser, points à vérifier lors du prochain entretien..."
              className="text-xs min-h-[60px] rounded-lg border-border resize-none"
            />
          </div>
        </div>
      </div>
    );
  }

  // ─── List view (all scorecards collapsed) ───
  return (
    <div className="space-y-3">
      {/* New scorecard button */}
      <button onClick={handleNewScorecard}
        className="w-full h-[38px] flex items-center justify-center gap-2 border border-dashed border-border text-foreground text-xs font-medium uppercase tracking-wider hover:border-border hover:bg-foreground/[0.03] transition-colors">
        <Plus className="w-3.5 h-3.5" />
        Nouvelle scorecard
        <CreditCostBadge actionId="generate_scorecard" />
      </button>
      <ModelPicker actionId="generate_scorecard" value={selectedModel} onChange={setSelectedModel} compact />

      {evaluations.length === 0 && (
        <div className="text-center py-8">
          <div className="h-14 w-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-7 h-7" />
          </div>
          <p className="text-xs text-muted-foreground max-w-sm mx-auto leading-relaxed">
            Aucune scorecard pour ce candidat. Cliquez sur le bouton ci-dessus pour en créer une.
          </p>
        </div>
      )}

      {evaluations.map((ev, index) => {
        const ratedCount = ev.criteria.filter(c => ev.ratings[c.id] != null).length;
        const totalCriteria = ev.criteria.length;
        const recOption = ev.recommendation ? RECOMMENDATION_OPTIONS.find(o => o.value === ev.recommendation) : null;

        return (
          <div key={ev.id || index} className="border border-border hover:border-border transition-colors">
            <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => { setActiveIndex(index); setExpandedCriteria(new Set()); }}>
              <div className="flex items-center gap-3">
                {ev.overallScore != null && (
                  <div className={cn(
                    "h-10 w-10 flex items-center justify-center border-2 text-base font-bold",
                    ev.overallScore >= 4 ? "border-success/40 bg-success/10 text-success" :
                    ev.overallScore >= 3 ? "border-warning/40 bg-warning/10 text-warning" :
                    "border-destructive/40 bg-destructive/10 text-destructive"
                  )}>
                    {ev.overallScore}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-bold uppercase tracking-wider text-foreground">
                      {totalCriteria > 0 ? `${ratedCount}/${totalCriteria} critères` : 'Brouillon'}
                    </p>
                    {ev.interviewStage && (
                      <span className="text-xs px-1.5 py-0.5 border border-border bg-accent/50 text-muted-foreground font-medium uppercase tracking-wider">
                        {INTERVIEW_STAGES.find(s => s.value === ev.interviewStage)?.label || ev.interviewStage}
                      </span>
                    )}
                    {recOption && (
                      <span className={cn("text-xs px-1.5 py-0.5 border font-bold uppercase tracking-wider", recOption.color)}>
                        {recOption.label}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ev.jobTitle || candidate.jobTitle || 'Poste non spécifié'}
                    {ev.savedAt && (
                      <> · {new Date(ev.savedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1">
                {/* Mini rating dots */}
                <div className="flex gap-1 mr-2">
                  {ev.criteria.slice(0, 6).map(c => {
                    const r = ev.ratings[c.id];
                    return (
                      <span key={c.id} className={cn("w-1.5 h-1.5 rounded-full",
                        r != null && r >= 4 ? "bg-success" :
                        r != null && r >= 3 ? "bg-warning" :
                        r != null ? "bg-destructive" : "bg-foreground/20"
                      )} />
                    );
                  })}
                </div>
                <button onClick={(e) => { e.stopPropagation(); setActiveIndex(index); setExpandedCriteria(new Set()); }}
                  className="h-[28px] px-2.5 flex items-center gap-1 border border-border text-foreground text-xs font-medium uppercase tracking-wider hover:bg-foreground hover:text-background transition-colors">
                  <Pencil className="w-3 h-3" /> Modifier
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(index); }}
                  className="h-[28px] px-2 flex items-center border border-destructive/30 text-destructive text-xs hover:bg-destructive/5 transition-colors">
                  <Trash2 className="w-3 h-3" />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
