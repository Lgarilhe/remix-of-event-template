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
import { Loader2, Sparkles, Star, RotateCcw, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Pencil, Check, Plus, Trash2, AlertTriangle, MessageSquare, Copy, Mic, Maximize2 } from 'lucide-react';
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
  /** Si true, déclenche la génération AI à l'ouverture (utilisé par le
   *  CTA "Préparer l'entretien" du calendrier). Idempotent : ne déclenche
   *  qu'une fois et seulement si aucune scorecard n'existe déjà. */
  autoGenerate?: boolean;
  /** Si true et qu'au moins une scorecard existe en DB, on ouvre directement
   *  la plus récente en mode édition (au lieu de la list view).
   *  Utilisé par ScorecardFullPage : le user a cliqué "Plein écran" pour
   *  éditer, pas pour voir une liste. */
  autoOpenFirst?: boolean;
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

export const ScorecardTab: React.FC<ScorecardTabProps> = ({ candidate, enrichedProfile, onOpenProfile, autoStartCoaching, autoGenerate, autoOpenFirst }) => {
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
  // Toggle "Voir l'échelle complète" pour montrer les 5 niveaux du rubric
  // sous les boutons rating. Reset à chaque changement de critère.
  const [showFullRubric, setShowFullRubric] = useState(false);
  React.useEffect(() => { setShowFullRubric(false); }, [currentCriterionIdx]);
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

          // Mode plein écran ou auto-coaching : on ouvre la plus récente
          // automatiquement (l'user vient pour éditer, pas pour voir une liste).
          if (autoOpenFirst || autoStartCoaching) {
            setActiveIndex(0);
          }
        }
      } catch (err) {
        console.error('Error loading evaluations:', err);
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [candidate.candidateId, autoOpenFirst, autoStartCoaching]);

  // Auto-start coaching when prop is set (fullscreen mode)
  useEffect(() => {
    if (autoStartCoaching && !loading && evaluations.length > 0 && activeIndex !== null) {
      setShowCoaching(true);
    }
  }, [autoStartCoaching, loading, evaluations.length, activeIndex]);




  // Generate criteria via AI
  const handleGenerate = useCallback(async () => {
    // 🛡️ Validation pré-génération : si on n'a vraiment AUCUNE info sur le
    // candidat (ni nom, ni headline, ni job), inutile d'appeler l'IA, elle
    // renverra des critères génériques sans valeur. Préviens l'user.
    if (!candidate?.name && !candidate?.headline) {
      toast.error('Profil candidat trop incomplet pour générer une scorecard');
      return;
    }

    setGenerating(true);
    console.log('[ScorecardTab] Starting scorecard generation', {
      candidateId: candidate.candidateId,
      jobId: candidate.jobId,
      stage: activeEval?.interviewStage || selectedStage,
      hasEnrichedProfile: !!enrichedProfile,
    });

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

      // Note : selectedModel peut être null = utilisation du modèle par
      // défaut. On NE passe PAS "AUTO" ou autre placeholder à l'edge
      // function — c'est null/undefined qui dit à callClaudeCompat de
      // tomber sur Haiku par défaut.
      const { data, error } = await invokeWithCredits<{
        success?: boolean;
        criteria?: Criterion[];
        error?: string;
      }>('generate-scorecard', 'generate_scorecard', {
        candidateProfile, jobContext, scoringDetails: candidate.scoringDetails, interviewStage: stage,
      }, { modelOverride: selectedModel ?? undefined });

      if (error) {
        console.error('[ScorecardTab] Edge function error:', error);
        throw new Error(error.message || 'Erreur appel IA');
      }
      if (!data?.success) {
        console.error('[ScorecardTab] Edge function returned non-success:', data);
        throw new Error(data?.error || 'L\'IA n\'a pas pu générer la scorecard. Réessaie.');
      }
      if (!data.criteria || !Array.isArray(data.criteria) || data.criteria.length === 0) {
        console.error('[ScorecardTab] Empty/invalid criteria response:', data);
        throw new Error('L\'IA a renvoyé une réponse vide. Réessaie.');
      }

      const criteria = data.criteria as Criterion[];

      if (activeIndex !== null) {
        // Update d'une scorecard existante (regenerate) → on patch + autosave
        // peut s'occuper du persistage si ev.id existe (cas standard).
        setEvaluations(prev => prev.map((ev, i) => i === activeIndex ? {
          ...ev, criteria, overallScore: null,
        } : ev));
      } else {
        // Nouvelle scorecard → on persiste immédiatement en DB pour ne PAS
        // perdre les critères si l'user switch de tab et revient (la modal
        // unmount le ScorecardTab quand un autre tab est actif). Sans save
        // initial, l'auto-save ulterieur ne s'active que quand ev.id est
        // set, donc on doit le set ici dès la création.
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error('Pas authentifié');

        const newEvalBase: Omit<EvaluationData, 'id'> = {
          criteria,
          ratings: {},
          comments: {},
          overallScore: null,
          jobTitle: candidate.jobTitle || undefined,
          interviewStage: (selectedStage as InterviewStage) || undefined,
        };

        const insertPayload: any = {
          candidate_id: candidate.candidateId,
          job_id: candidate.jobId,
          job_title: candidate.jobTitle,
          criteria: criteria as any,
          ratings: {} as any,
          comments: {} as any,
          overall_score: null,
          created_by: user.id,
          interview_stage: newEvalBase.interviewStage || null,
          organization_id: organizationId || null,
        };

        const { data: inserted, error: insertErr } = await supabase
          .from('candidate_evaluations')
          .insert(insertPayload)
          .select('id, updated_at')
          .single();

        if (insertErr) {
          console.warn('[ScorecardTab] persist failed, fallback in-memory:', insertErr);
          // Fallback : on garde la scorecard en mémoire mais sans id.
          // L'user devra cliquer Sauvegarder manuellement (ou activer un
          // critère, l'auto-save ne marchera toujours pas sans id mais au
          // moins le state n'est pas perdu pendant la session active).
          setEvaluations(prev => [newEvalBase as EvaluationData, ...prev]);
        } else {
          const newEval: EvaluationData = {
            ...newEvalBase,
            id: inserted.id,
            savedAt: inserted.updated_at,
          };
          setEvaluations(prev => [newEval, ...prev]);
        }
        setActiveIndex(0);
      }

      toast.success(`${criteria.length} critères générés sur mesure`);
    } catch (err: any) {
      console.error('Error generating scorecard:', err);
      toast.error(err?.message || 'Erreur lors de la génération');
    } finally {
      setGenerating(false);
    }
  }, [candidate, enrichedProfile, activeIndex, selectedStage, activeEval, organizationId]);

  // Auto-generate scorecard si demandé via prop (CTA "Préparer l'entretien"
  // depuis le calendrier). Idempotent : ne déclenche qu'une fois et
  // seulement si AUCUNE scorecard n'existe déjà (sinon on ouvre celle qui
  // est là plutôt que d'en générer une de plus).
  const autoGenTriggered = React.useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoGenTriggered.current) return;
    if (loading || generating) return; // attend que le load des existing finisse

    autoGenTriggered.current = true;

    if (evaluations.length > 0) {
      // Une scorecard existe déjà → on l'ouvre, on ne re-génère pas
      setActiveIndex(0);
      return;
    }
    // Aucune scorecard existante → trigger gen
    void handleGenerate();
  }, [autoGenerate, loading, generating, evaluations.length, handleGenerate]);

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
        <div className="space-y-3">
          <button
            onClick={() => { setActiveIndex(null); setEvaluations(prev => prev[0]?.criteria.length === 0 && !prev[0]?.id ? prev.slice(1) : prev); }}
            className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-3.5 h-3.5" />
            Retour
          </button>

          {/* Empty state hero — gradient skalr discret + icon-tile cohérent V2 */}
          <div className="rounded-xl border border-border bg-gradient-to-br from-brand-purple/[0.04] via-brand-pink/[0.02] to-transparent p-6 sm:p-8">
            <div className="text-center max-w-md mx-auto">
              <div className="h-14 w-14 rounded-2xl bg-emerald-500/15 border border-border grid place-items-center mx-auto mb-4 shadow-sm">
                <Sparkles className="w-6 h-6 text-foreground" strokeWidth={2} />
              </div>
              <h3 className="font-display font-bold text-[18px] sm:text-[20px] tracking-tight text-foreground mb-1.5">
                Nouvelle scorecard
              </h3>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                L'IA va analyser le profil et le poste pour générer une grille d'évaluation sur mesure (6-8 critères avec questions et red flags).
              </p>

              {/* Interview stage selector — pills rounded-full color-coded selon stage */}
              <div className="mt-5">
                <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-2">
                  Type d'entretien <span className="opacity-60 normal-case font-normal">— optionnel</span>
                </p>
                <div className="flex flex-wrap gap-1.5 justify-center">
                  {INTERVIEW_STAGES.map(s => {
                    const isSelected = selectedStage === s.value;
                    return (
                      <button
                        key={s.value}
                        onClick={() => setSelectedStage(selectedStage === s.value ? '' : s.value)}
                        className={cn(
                          'inline-flex items-center h-8 px-3 rounded-full text-[12px] font-medium border transition-all',
                          isSelected
                            ? 'bg-foreground text-background border-foreground shadow-sm scale-[1.02]'
                            : 'bg-background border-border text-foreground/70 hover:bg-accent hover:text-foreground'
                        )}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Génération CTA — gros bouton primary skalr-shine */}
              <div className="mt-6 flex flex-col items-center gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className={cn(
                    'inline-flex items-center justify-center gap-2 h-10 px-6 rounded-full text-[13px] font-bold transition-all shadow-md',
                    generating
                      ? 'bg-foreground/40 text-background cursor-wait'
                      : 'bg-foreground text-background hover:bg-foreground/90 hover:shadow-lg active:scale-[0.98]'
                  )}
                >
                  {generating ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Génération en cours…
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" strokeWidth={2.5} />
                      Générer la scorecard
                    </>
                  )}
                </button>
                <div className="flex items-center gap-2">
                  <CreditCostBadge actionId="generate_scorecard" />
                  <ModelPicker actionId="generate_scorecard" value={selectedModel} onChange={setSelectedModel} compact />
                </div>
              </div>
            </div>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-3 sm:space-y-4 pr-1 max-w-full overflow-x-hidden">
        <button
          onClick={() => setActiveIndex(null)}
          className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Retour aux scorecards
        </button>

        {/* Header card — stack vertical jusqu'à xl (1280px) car contient
            beaucoup d'éléments (score + 4 cat bars + 4 boutons actions)
            qui ne tiennent pas en row sur viewport moyen. */}
        <div className="rounded-xl border border-border bg-card p-3 sm:p-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3 min-w-0">
            {activeEval.overallScore != null ? (
              <div className={cn(
                "h-12 w-12 sm:h-14 sm:w-14 flex items-center justify-center rounded-xl border-2 text-lg sm:text-xl font-display font-bold tabular-nums shrink-0",
                activeEval.overallScore >= 4 ? "border-success/40 bg-success/10 text-success" :
                activeEval.overallScore >= 3 ? "border-warning/40 bg-warning/10 text-warning" :
                "border-destructive/40 bg-destructive/10 text-destructive"
              )}>
                {activeEval.overallScore}
              </div>
            ) : (
              <div className="h-12 w-12 sm:h-14 sm:w-14 flex items-center justify-center rounded-xl bg-emerald-500/15 border border-dashed border-border shrink-0">
                <Sparkles className="w-5 h-5 text-foreground" />
              </div>
            )}
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="font-display font-bold text-[14px] tabular-nums text-foreground">
                  {ratedCount}/{totalCriteria} critères évalués
                </p>
                {activeEval.interviewStage && (
                  <span className="inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full bg-info/10 text-info border border-info/30">
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
                const visible = cats.map(cat => {
                  const catCriteria = activeEval.criteria.filter(c => c.category === cat && activeEval.ratings[c.id] != null);
                  if (catCriteria.length === 0) return null;
                  const avg = catCriteria.reduce((s, c) => s + activeEval.ratings[c.id], 0) / catCriteria.length;
                  return { cat, avg, conf: catConf[cat] };
                }).filter(Boolean) as { cat: string; avg: number; conf: { label: string; color: string } }[];
                if (visible.length === 0) return null;
                return (
                  <div className="flex gap-2 mt-2 flex-wrap">
                    {visible.map(({ cat, avg, conf }) => (
                      <div key={cat} className="flex flex-col gap-1 min-w-[44px]">
                        <div className="flex justify-between items-center gap-1">
                          <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: conf.color }}>{conf.label}</span>
                          <span className="text-[9px] tabular-nums text-muted-foreground font-semibold">{avg.toFixed(1)}</span>
                        </div>
                        <div className="h-1 bg-foreground/10 rounded-full overflow-hidden">
                          <div className="h-full transition-all duration-500 rounded-full" style={{ width: `${(avg / 5) * 100}%`, background: conf.color }} />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              <p className="text-[11.5px] text-muted-foreground mt-1.5 truncate">
                {activeEval.jobTitle || candidate.jobTitle || 'Poste non spécifié'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 self-end xl:self-auto shrink-0 flex-wrap">
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
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-medium border border-destructive/40 text-destructive bg-destructive/5 hover:bg-destructive/10 transition-colors">
              <Mic className="w-3.5 h-3.5" />
              <span className="hidden md:inline">Coaching Live</span>
            </button>
            {/* Plein écran : caché si on est déjà en mode plein écran
                (autoOpenFirst = true sur ScorecardFullPage) */}
            {!autoOpenFirst && (
              <button
                onClick={async () => {
                  // Auto-save avant de naviguer en plein écran (sans coaching)
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
                          await supabase.from('candidate_evaluations').update(payload).eq('id', activeEval.id);
                        } else {
                          const { data } = await supabase.from('candidate_evaluations').insert(payload).select('id').single();
                          if (data) updateActiveEval(ev => ({ ...ev, id: data.id }));
                        }
                      }
                    } catch (e) { console.warn('Auto-save before fullscreen failed:', e); }
                  }
                  navigate(`/ats/scorecard/${candidate.candidateId}`);
                }}
                className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-medium border border-border bg-background hover:bg-accent text-foreground transition-colors"
                title="Ouvrir la scorecard en plein écran avec sidebar candidat + poste"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Plein écran</span>
              </button>
            )}
            <button onClick={handleGenerate} disabled={generating}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-medium border border-border bg-background hover:bg-accent text-foreground disabled:opacity-50 transition-colors">
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RotateCcw className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">Régénérer</span>
            </button>
            <button onClick={handleSave} disabled={saving}
              className="inline-flex items-center gap-1.5 h-8 px-3 rounded-full text-[11.5px] font-bold bg-foreground text-background hover:bg-foreground/90 disabled:opacity-50 transition-colors shadow-sm">
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              <span className="hidden md:inline">Sauvegarder</span>
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

        {/* Tabs catégories (mobile + tablette : visible jusqu'à lg).
            Sur lg+ (1024px+), le rail latéral prend le relais. */}
        <div className="flex lg:hidden items-center gap-1.5 overflow-x-auto pb-2 -mx-1 px-1">
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

        {/* Side rail + Card layout */}
        <div className="flex gap-3 sm:gap-4 max-w-full">
          {/* Criteria side rail — pills compactes avec dot couleur catégorie.
              Visible uniquement en lg+ (1024px+) pour pas écraser le card
              sur viewports moyens où la rail prendrait trop de place.
              Sur sm-md, l'user utilise les tabs horizontales en haut. */}
          <div className="hidden lg:flex flex-col gap-1 w-[150px] shrink-0 sticky top-24 self-start max-h-[calc(100vh-120px)] overflow-y-auto pr-1">
            <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground/70 px-2 mb-1">
              Critères ({activeEval.criteria.length})
            </p>
            {activeEval.criteria.map((c, idx) => {
              const r = activeEval.ratings[c.id];
              const isCurrent = idx === currentCriterionIdx;
              const catConfig = CATEGORY_CONFIG[c.category] || CATEGORY_CONFIG.technical;
              const dotColor =
                r == null ? catConfig.dotColor :
                r >= 4 ? 'bg-success' :
                r >= 3 ? 'bg-warning' :
                'bg-destructive';
              return (
                <button
                  key={c.id}
                  onClick={() => setCurrentCriterionIdx(idx)}
                  className={cn(
                    'text-left px-2 py-1.5 rounded-lg transition-all text-[11.5px] leading-tight border',
                    isCurrent
                      ? 'border-foreground/20 bg-foreground/[0.06] text-foreground font-semibold shadow-sm'
                      : r != null
                        ? 'border-transparent text-foreground/85 hover:bg-foreground/[0.04]'
                        : 'border-transparent text-muted-foreground/70 hover:bg-foreground/[0.04] hover:text-foreground/85',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColor)} />
                    <span className="truncate flex-1">{c.label}</span>
                    {r != null && (
                      <span className={cn(
                        'text-[10px] tabular-nums font-bold shrink-0 px-1.5 py-0.5 rounded-full',
                        r >= 4 ? 'bg-success/15 text-success' :
                        r >= 3 ? 'bg-warning/15 text-warning' :
                        'bg-destructive/15 text-destructive',
                      )}>
                        {r}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
            {showCoaching && (
              <label className="flex items-center gap-2 px-2 py-2 mt-2 border-t border-border cursor-pointer">
                <input type="checkbox" checked={coachingAutoNav} onChange={e => setCoachingAutoNav(e.target.checked)}
                  className="w-3.5 h-3.5 accent-foreground rounded" />
                <span className="text-[11px] text-muted-foreground font-medium">Auto-nav</span>
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

          // Couleur tonale selon la note pour les boutons rating
          const ratingTone = (score: number) =>
            score >= 4 ? 'success' : score >= 3 ? 'warning' : 'destructive';

          return (
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Card header — badges catégorie + poids + compteur */}
              <div className="px-4 py-3 border-b border-border flex items-center justify-between bg-muted/15">
                <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
                  <span className={cn('inline-flex items-center text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full border', catConfig.color)}>
                    <span className={cn('inline-block w-1.5 h-1.5 rounded-full mr-1.5', catConfig.dotColor)} />
                    {catConfig.label}
                  </span>
                  {/* Weight badge — toujours visible, color-coded selon importance */}
                  {criterion.weight === 3 ? (
                    <span className="inline-flex items-center text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-destructive/15 text-destructive border border-destructive/40">
                      <AlertTriangle className="w-2.5 h-2.5 mr-1" />
                      Critique
                    </span>
                  ) : criterion.weight === 2 ? (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-warning/15 text-warning border border-warning/40">
                      <span className="w-1.5 h-1.5 rounded-full bg-warning" />
                      Important
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10.5px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-success/15 text-success border border-success/40">
                      <span className="w-1.5 h-1.5 rounded-full bg-success" />
                      Bonus
                    </span>
                  )}
                </div>
                <span className="text-[11px] tabular-nums shrink-0 font-bold text-muted-foreground">
                  {currentCriterionIdx + 1}/{totalC}
                </span>
              </div>

              {/* Card body */}
              <div className="px-4 sm:px-5 py-4 space-y-4">
                {/* Criterion title — font-display, plus gros + plus de présence */}
                <div>
                  <h3 className="font-display font-bold text-[18px] sm:text-[20px] tracking-tight text-foreground leading-tight">
                    {criterion.label}
                  </h3>
                  <p className="text-[13px] text-foreground/75 leading-relaxed mt-2">
                    {criterion.description}
                  </p>
                </div>

                {/* Rating buttons — style pill rounded-full, color-coded selon score */}
                <div className="space-y-2">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground text-center">
                    Évalue ce critère
                  </p>
                  <div className="flex items-center justify-center gap-2 sm:gap-3 py-1">
                    {[1, 2, 3, 4, 5].map(score => {
                      const isSelected = rating === score;
                      const tone = ratingTone(score);
                      return (
                        <button
                          key={score}
                          onClick={() => handleRate(criterion.id, score)}
                          className={cn(
                            'relative w-12 h-12 sm:w-14 sm:h-14 flex items-center justify-center text-lg sm:text-xl font-display font-bold rounded-2xl border-2 transition-all duration-200',
                            isSelected
                              ? tone === 'success' ? 'border-success bg-success text-success-foreground scale-110 shadow-lg shadow-success/30' :
                                tone === 'warning' ? 'border-warning bg-warning text-warning-foreground scale-110 shadow-lg shadow-warning/30' :
                                'border-destructive bg-destructive text-destructive-foreground scale-110 shadow-lg shadow-destructive/30'
                              : 'border-border bg-background text-foreground/40 hover:text-foreground hover:border-foreground/30 hover:scale-105',
                          )}
                          aria-label={`Noter ${score} sur 5`}
                        >
                          {score}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex justify-between max-w-md mx-auto px-1 text-[10px] uppercase tracking-wider text-muted-foreground/60 font-semibold">
                    <span>Très faible</span>
                    <span>Exceptionnel</span>
                  </div>
                </div>

                {/* Rubric pour la note sélectionnée — affichée seulement si
                    une note est choisie ET que l'échelle complète n'est pas
                    déployée (sinon on évite la duplication). */}
                {rating && !showFullRubric && criterion.ratingRubric?.[String(rating)] && (
                  <div className={cn(
                    'rounded-xl border px-3 py-2.5 flex items-start gap-2.5',
                    ratingTone(rating) === 'success' ? 'border-success/30 bg-success/5' :
                    ratingTone(rating) === 'warning' ? 'border-warning/30 bg-warning/5' :
                    'border-destructive/30 bg-destructive/5',
                  )}>
                    <div className={cn(
                      'h-6 w-6 rounded-lg grid place-items-center text-[11px] font-bold shrink-0 tabular-nums',
                      ratingTone(rating) === 'success' ? 'bg-success/15 text-success' :
                      ratingTone(rating) === 'warning' ? 'bg-warning/15 text-warning' :
                      'bg-destructive/15 text-destructive',
                    )}>
                      {rating}
                    </div>
                    <p className="text-[12.5px] leading-relaxed text-foreground/85 flex-1">
                      {criterion.ratingRubric[String(rating)]}
                    </p>
                  </div>
                )}

                {/* Toggle "Voir l'échelle complète" — utile pour comparer
                    les 5 niveaux avant de noter, ou comme aide-mémoire. */}
                {criterion.ratingRubric && Object.keys(criterion.ratingRubric).length > 0 && (
                  <div>
                    <button
                      type="button"
                      onClick={() => setShowFullRubric(v => !v)}
                      className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                    >
                      <ChevronDown className={cn('w-3 h-3 transition-transform', showFullRubric && 'rotate-180')} />
                      {showFullRubric ? "Masquer l'échelle complète" : "Voir l'échelle complète"}
                    </button>
                    {showFullRubric && (
                      <div className="mt-2 rounded-xl border border-border bg-muted/10 p-3 space-y-1">
                        {Object.entries(criterion.ratingRubric).sort(([a], [b]) => Number(a) - Number(b)).map(([score, desc]) => {
                          const isActive = String(rating) === score;
                          return (
                            <div
                              key={score}
                              className={cn(
                                'flex items-start gap-2.5 text-[11.5px] px-2 py-1.5 rounded-md leading-relaxed transition-colors',
                                isActive
                                  ? 'bg-foreground/[0.06] text-foreground font-medium'
                                  : 'text-muted-foreground/85',
                              )}
                            >
                              <span className={cn(
                                'inline-flex items-center justify-center w-5 h-5 rounded-md text-[10.5px] font-bold tabular-nums shrink-0',
                                isActive ? 'bg-foreground text-background' : 'bg-foreground/10 text-foreground/70',
                              )}>
                                {score}
                              </span>
                              <span>{desc as string}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {/* Questions à poser — section card */}
                {questions.length > 0 && (
                  <div className="rounded-xl border border-border bg-muted/15 px-3 py-3 space-y-2">
                    <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground inline-flex items-center gap-1.5">
                      <MessageSquare className="w-3 h-3" />
                      À vérifier pendant l'entretien
                    </p>
                    <ul className="space-y-1.5">
                      {questions.slice(0, 3).map((q, qi) => (
                        <li key={qi} className="flex items-start gap-2 text-[12.5px] text-foreground/85 leading-relaxed">
                          <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-foreground/10 text-foreground/70 text-[10px] font-bold shrink-0 mt-0.5 tabular-nums">
                            {qi + 1}
                          </span>
                          <span>{q.replace(/^["«]|["»]$/g, '').replace(/\?$/, '')}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Red flags */}
                {redFlags.length > 0 && (
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 flex items-start gap-2.5">
                    <div className="h-6 w-6 rounded-lg bg-destructive/15 text-destructive grid place-items-center shrink-0">
                      <AlertTriangle className="w-3.5 h-3.5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] uppercase tracking-wider font-bold text-destructive mb-0.5">
                        Red flag
                      </p>
                      <p className="text-[12.5px] leading-relaxed text-foreground/85">
                        {redFlags[0]}
                      </p>
                    </div>
                  </div>
                )}

                {/* Notes — input avec label */}
                <div className="space-y-1.5">
                  <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
                    Tes notes
                  </p>
                  <Textarea
                    value={comment}
                    onChange={e => handleComment(criterion.id, e.target.value)}
                    placeholder="Observations, exemples concrets, citation textuelle…"
                    className="text-[12.5px] min-h-[60px] rounded-lg border-border focus:border-foreground/30 resize-none"
                  />
                </div>
              </div>

              {/* Navigation arrows footer */}
              <div className="flex items-center justify-between px-4 py-2.5 border-t border-border bg-muted/10">
                <button
                  onClick={() => setCurrentCriterionIdx(Math.max(0, currentCriterionIdx - 1))}
                  disabled={currentCriterionIdx === 0}
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-foreground/70 hover:text-foreground disabled:opacity-30 disabled:hover:text-foreground/70 transition-colors px-2 py-1 rounded-md hover:bg-muted"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  Précédent
                </button>
                <span className="text-[10.5px] text-muted-foreground/70 tabular-nums">
                  {currentCriterionIdx + 1} / {totalC}
                </span>
                <button
                  onClick={() => {
                    if (currentCriterionIdx < totalC - 1) {
                      setCurrentCriterionIdx(currentCriterionIdx + 1);
                    }
                  }}
                  disabled={currentCriterionIdx === totalC - 1}
                  className="inline-flex items-center gap-1 text-[11.5px] font-medium text-foreground/70 hover:text-foreground disabled:opacity-30 disabled:hover:text-foreground/70 transition-colors px-2 py-1 rounded-md hover:bg-muted"
                >
                  Suivant
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          );
        })()}
          </div>{/* end card column */}

          {/* Live Coaching panel desktop — uniquement si activé.
              Le contexte de critère (questions/redflags/rubric/poids) est
              maintenant dans la card centrale, pas dupliqué ici. */}
          {showCoaching && activeEval && (
            <div className="hidden lg:block w-[300px] shrink-0 sticky top-24 self-start max-h-[calc(100vh-120px)] overflow-y-auto">
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
            </div>
          )}
        </div>{/* end flex rail+card */}

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
