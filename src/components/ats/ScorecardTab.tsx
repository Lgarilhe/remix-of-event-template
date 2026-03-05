import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ATSCandidate } from '@/hooks/useATSData';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { Loader2, Sparkles, Star, RotateCcw, ChevronDown, ChevronUp, Pencil, Check, Plus, Trash2, AlertTriangle, MessageSquare, Copy } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ScorecardTabProps {
  candidate: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
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
  { value: 'strong_yes', label: 'Strong Yes', color: 'border-emerald-500 bg-emerald-50 text-emerald-700' },
  { value: 'yes', label: 'Yes', color: 'border-emerald-300 bg-emerald-50/50 text-emerald-600' },
  { value: 'maybe', label: 'Maybe', color: 'border-amber-400 bg-amber-50 text-amber-700' },
  { value: 'no', label: 'No', color: 'border-red-300 bg-red-50/50 text-red-600' },
  { value: 'strong_no', label: 'Strong No', color: 'border-red-500 bg-red-50 text-red-700' },
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

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  technical: { label: 'Tech', color: 'border-blue-400 bg-blue-50 text-blue-700' },
  soft_skill: { label: 'Soft', color: 'border-amber-400 bg-amber-50 text-amber-700' },
  culture_fit: { label: 'Culture', color: 'border-purple-400 bg-purple-50 text-purple-700' },
  motivation: { label: 'Motiv.', color: 'border-emerald-400 bg-emerald-50 text-emerald-700' },
};

export const ScorecardTab: React.FC<ScorecardTabProps> = ({ candidate, enrichedProfile }) => {
  const [evaluations, setEvaluations] = useState<EvaluationData[]>([]);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedCriteria, setExpandedCriteria] = useState<Set<string>>(new Set());
  const [selectedStage, setSelectedStage] = useState<InterviewStage | ''>('');

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
          .select('job_title, client_name, description, filters_snapshot')
          .eq('job_id', candidate.jobId)
          .limit(1)
          .maybeSingle();

        if (project) {
          jobContext.title = project.job_title || jobContext.title;
          jobContext.client = project.client_name;
          jobContext.description = project.description;
        }

        try {
          const { data: notionData } = await supabase.functions.invoke('fetch-notion-jobs', {
            body: { jobId: candidate.jobId },
          });
          if (notionData?.job) {
            jobContext.description = notionData.job.description || jobContext.description;
            jobContext.requirements = notionData.job.criteria;
            jobContext.skills = notionData.job.skills;
          }
        } catch { /* Non-blocking */ }
      }

      const stage = activeEval?.interviewStage || selectedStage || undefined;

      const { data, error } = await supabase.functions.invoke('generate-scorecard', {
        body: { candidateProfile, jobContext, scoringDetails: candidate.scoringDetails, interviewStage: stage },
      });

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
  }, [updateActiveEval, computeOverallScore]);

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
            className="text-[10px] text-muted-foreground hover:text-foreground uppercase tracking-wider flex items-center gap-1">
            ← Retour
          </button>
          <div className="text-center py-10">
            <div className="h-14 w-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
              <Sparkles className="w-7 h-7" />
            </div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-foreground mb-2">
              Nouvelle scorecard
            </h3>
            <p className="text-[11px] text-muted-foreground max-w-sm mx-auto mb-4 leading-relaxed">
              L'IA va analyser le profil et le poste pour générer une grille d'évaluation sur mesure.
            </p>

            {/* Interview stage selector */}
            <div className="max-w-xs mx-auto mb-6">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">Type d'entretien (optionnel)</p>
              <div className="flex flex-wrap gap-1.5 justify-center">
                {INTERVIEW_STAGES.map(s => (
                  <button key={s.value}
                    onClick={() => setSelectedStage(selectedStage === s.value ? '' : s.value)}
                    className={cn(
                      "px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider border transition-colors",
                      selectedStage === s.value
                        ? "bg-foreground text-background border-foreground"
                        : "border-foreground/20 text-muted-foreground hover:border-foreground/40"
                    )}>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              onClick={handleGenerate}
              disabled={generating}
              className="relative overflow-hidden h-[38px] px-6 bg-foreground text-background border border-foreground text-xs font-medium uppercase tracking-wider disabled:opacity-50"
            >
              {generating ? (
                <span className="flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Génération en cours...</span>
              ) : (
                <span className="flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /> Générer la scorecard</span>
              )}
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="space-y-4 pr-1">
        <button onClick={() => setActiveIndex(null)}
          className="text-[10px] text-muted-foreground hover:text-foreground uppercase tracking-wider flex items-center gap-1">
          ← Retour aux scorecards
        </button>

        {/* Header bar */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {activeEval.overallScore != null && (
              <div className={cn(
                "h-12 w-12 flex items-center justify-center border-2 text-lg font-bold",
                activeEval.overallScore >= 4 ? "border-emerald-400 bg-emerald-50 text-emerald-700" :
                activeEval.overallScore >= 3 ? "border-amber-400 bg-amber-50 text-amber-700" :
                "border-red-400 bg-red-50 text-red-700"
              )}>
                {activeEval.overallScore}
              </div>
            )}
            <div>
              <div className="flex items-center gap-2">
                <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                  {ratedCount}/{totalCriteria} critères évalués
                </p>
                {activeEval.interviewStage && (
                  <span className="text-[9px] px-1.5 py-0.5 border border-foreground/20 bg-foreground/5 text-muted-foreground font-medium uppercase tracking-wider">
                    {INTERVIEW_STAGES.find(s => s.value === activeEval.interviewStage)?.label || activeEval.interviewStage}
                  </span>
                )}
              </div>
              <p className="text-[10px] text-muted-foreground">
                {activeEval.jobTitle || candidate.jobTitle || 'Poste non spécifié'}
              </p>
            </div>
          </div>
          <div className="flex gap-0">
            <button onClick={handleGenerate} disabled={generating}
              className="relative overflow-hidden h-[30px] px-3 flex items-center gap-1.5 border border-foreground text-foreground text-[10px] font-medium uppercase tracking-wider group disabled:opacity-50">
              {generating ? <Loader2 className="w-3 h-3 animate-spin relative z-10" /> : <RotateCcw className="w-3 h-3 relative z-10" />}
              <span className="relative z-10">Régénérer</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            </button>
            <button onClick={handleSave} disabled={saving}
              className="relative overflow-hidden h-[30px] px-3 flex items-center gap-1.5 border border-foreground -ml-px bg-foreground text-background text-[10px] font-medium uppercase tracking-wider disabled:opacity-50">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
              <span>Sauvegarder</span>
            </button>
          </div>
        </div>

        {/* Criteria list */}
        <div className="space-y-2">
          {activeEval.criteria.map(criterion => {
            const rating = activeEval.ratings[criterion.id];
            const comment = activeEval.comments[criterion.id] || '';
            const isExpanded = expandedCriteria.has(criterion.id);
            const catConfig = CATEGORY_CONFIG[criterion.category] || CATEGORY_CONFIG.technical;
            const hasRedFlags = criterion.redFlags && criterion.redFlags.length > 0;

            return (
              <div key={criterion.id} className="border border-foreground/15 bg-foreground/[0.02]">
                <div className="flex items-center gap-3 p-3 cursor-pointer hover:bg-foreground/[0.03] transition-colors"
                  onClick={() => toggleExpand(criterion.id)}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className={cn("text-[9px] px-1.5 py-0.5 border font-bold uppercase tracking-wider", catConfig.color)}>
                        {catConfig.label}
                      </span>
                      {criterion.weight === 3 && (
                        <span className="text-[9px] px-1.5 py-0.5 border border-red-300 bg-red-50 text-red-700 font-bold uppercase tracking-wider">Critique</span>
                      )}
                      {criterion.weight === 1 && (
                        <span className="text-[9px] px-1.5 py-0.5 border border-foreground/20 text-muted-foreground font-medium uppercase tracking-wider">Bonus</span>
                      )}
                      {hasRedFlags && (
                        <span className="text-[9px] px-1.5 py-0.5 border border-orange-300 bg-orange-50 text-orange-600 font-bold uppercase tracking-wider flex items-center gap-0.5">
                          <AlertTriangle className="w-2.5 h-2.5" /> Red flags
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-medium text-foreground leading-tight">{criterion.label}</p>
                  </div>
                  <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                    {[1, 2, 3, 4, 5].map(star => (
                      <button key={star} onClick={() => handleRate(criterion.id, star)} className="p-0.5 transition-colors">
                        <Star className={cn("w-5 h-5 transition-colors",
                          rating != null && star <= rating ? "fill-amber-400 text-amber-400" : "text-foreground/15 hover:text-amber-300"
                        )} />
                      </button>
                    ))}
                  </div>
                  {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
                </div>
                {isExpanded && (
                  <div className="px-3 pb-3 space-y-3 border-t border-foreground/10">
                    <p className="text-[11px] text-muted-foreground leading-relaxed pt-2 italic">💡 {criterion.description}</p>

                    {/* Rating Rubric */}
                    {criterion.ratingRubric && Object.keys(criterion.ratingRubric).length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/70">Rubrique de notation</p>
                        <div className="grid gap-0.5">
                          {[1, 2, 3, 4, 5].map(level => {
                            const desc = criterion.ratingRubric?.[String(level)];
                            if (!desc) return null;
                            const isCurrentRating = rating === level;
                            return (
                              <div key={level} className={cn(
                                "flex items-start gap-2 px-2 py-1 text-[10px] transition-colors",
                                isCurrentRating ? "bg-amber-50 border-l-2 border-amber-400" : "border-l-2 border-transparent"
                              )}>
                                <span className={cn(
                                  "font-bold shrink-0 w-4 text-center",
                                  isCurrentRating ? "text-amber-600" : "text-muted-foreground"
                                )}>{level}</span>
                                <span className={cn(
                                  "leading-relaxed",
                                  isCurrentRating ? "text-amber-700 font-medium" : "text-muted-foreground"
                                )}>{desc}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Suggested Questions */}
                    {criterion.suggestedQuestions && criterion.suggestedQuestions.length > 0 && (
                      <div className="space-y-1.5">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-foreground/70 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" /> Questions suggérées
                        </p>
                        <div className="space-y-1">
                          {criterion.suggestedQuestions.map((q, qi) => (
                            <div key={qi} className="group flex items-start gap-2 px-2 py-1.5 border border-foreground/10 bg-foreground/[0.02] hover:bg-foreground/[0.04] transition-colors">
                              <span className="text-[11px] text-foreground leading-relaxed flex-1">"{q}"</span>
                              <button onClick={() => copyToClipboard(q)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 text-muted-foreground hover:text-foreground shrink-0">
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Red Flags */}
                    {criterion.redFlags && criterion.redFlags.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-orange-600 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Signaux d'alerte
                        </p>
                        <div className="space-y-1">
                          {criterion.redFlags.map((rf, ri) => (
                            <div key={ri} className="flex items-start gap-2 px-2 py-1 border border-orange-200 bg-orange-50/50">
                              <span className="text-orange-500 shrink-0 mt-0.5">⚠</span>
                              <span className="text-[10px] text-orange-700 leading-relaxed">{rf}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <Textarea value={comment} onChange={e => handleComment(criterion.id, e.target.value)}
                      placeholder="Notes d'entretien pour ce critère..." className="text-xs min-h-[60px] rounded-none border-foreground/20 resize-none" />
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ─── Verdict Section ─── */}
        <div className="border-t-2 border-foreground/20 pt-4 mt-6 space-y-4">
          <h4 className="text-[11px] font-bold uppercase tracking-wider text-foreground">Verdict final</h4>

          {/* Recommendation */}
          <div className="space-y-2">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Recommandation</p>
            <div className="flex flex-wrap gap-1.5">
              {RECOMMENDATION_OPTIONS.map(opt => (
                <button key={opt.value}
                  onClick={() => updateActiveEval(ev => ({ ...ev, recommendation: ev.recommendation === opt.value ? undefined : opt.value }))}
                  className={cn(
                    "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider border transition-all",
                    activeEval.recommendation === opt.value
                      ? opt.color + " ring-1 ring-offset-1"
                      : "border-foreground/15 text-muted-foreground hover:border-foreground/30"
                  )}>
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Summary */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Résumé / Justification</p>
            <Textarea
              value={activeEval.summary || ''}
              onChange={e => updateActiveEval(ev => ({ ...ev, summary: e.target.value }))}
              placeholder="Résumé de l'entretien et justification de la recommandation..."
              className="text-xs min-h-[80px] rounded-none border-foreground/20 resize-none"
            />
          </div>

          {/* Follow-up notes */}
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Points de suivi (prochain round)</p>
            <Textarea
              value={activeEval.followUpNotes || ''}
              onChange={e => updateActiveEval(ev => ({ ...ev, followUpNotes: e.target.value }))}
              placeholder="Questions à creuser, points à vérifier lors du prochain entretien..."
              className="text-xs min-h-[60px] rounded-none border-foreground/20 resize-none"
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
        className="w-full h-[38px] flex items-center justify-center gap-2 border border-dashed border-foreground/30 text-foreground text-[11px] font-medium uppercase tracking-wider hover:border-foreground hover:bg-foreground/[0.03] transition-colors">
        <Plus className="w-3.5 h-3.5" />
        Nouvelle scorecard
      </button>

      {evaluations.length === 0 && (
        <div className="text-center py-8">
          <div className="h-14 w-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
            <Sparkles className="w-7 h-7" />
          </div>
          <p className="text-[11px] text-muted-foreground max-w-sm mx-auto leading-relaxed">
            Aucune scorecard pour ce candidat. Cliquez sur le bouton ci-dessus pour en créer une.
          </p>
        </div>
      )}

      {evaluations.map((ev, index) => {
        const ratedCount = ev.criteria.filter(c => ev.ratings[c.id] != null).length;
        const totalCriteria = ev.criteria.length;
        const recOption = ev.recommendation ? RECOMMENDATION_OPTIONS.find(o => o.value === ev.recommendation) : null;

        return (
          <div key={ev.id || index} className="border border-foreground/15 hover:border-foreground/30 transition-colors">
            <div className="flex items-center justify-between p-4 cursor-pointer" onClick={() => { setActiveIndex(index); setExpandedCriteria(new Set()); }}>
              <div className="flex items-center gap-3">
                {ev.overallScore != null && (
                  <div className={cn(
                    "h-10 w-10 flex items-center justify-center border-2 text-base font-bold",
                    ev.overallScore >= 4 ? "border-emerald-400 bg-emerald-50 text-emerald-700" :
                    ev.overallScore >= 3 ? "border-amber-400 bg-amber-50 text-amber-700" :
                    "border-red-400 bg-red-50 text-red-700"
                  )}>
                    {ev.overallScore}
                  </div>
                )}
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                      {totalCriteria > 0 ? `${ratedCount}/${totalCriteria} critères` : 'Brouillon'}
                    </p>
                    {ev.interviewStage && (
                      <span className="text-[9px] px-1.5 py-0.5 border border-foreground/20 bg-foreground/5 text-muted-foreground font-medium uppercase tracking-wider">
                        {INTERVIEW_STAGES.find(s => s.value === ev.interviewStage)?.label || ev.interviewStage}
                      </span>
                    )}
                    {recOption && (
                      <span className={cn("text-[9px] px-1.5 py-0.5 border font-bold uppercase tracking-wider", recOption.color)}>
                        {recOption.label}
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] text-muted-foreground">
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
                        r != null && r >= 4 ? "bg-emerald-400" :
                        r != null && r >= 3 ? "bg-amber-400" :
                        r != null ? "bg-red-400" : "bg-foreground/20"
                      )} />
                    );
                  })}
                </div>
                <button onClick={(e) => { e.stopPropagation(); setActiveIndex(index); setExpandedCriteria(new Set()); }}
                  className="h-[28px] px-2.5 flex items-center gap-1 border border-foreground text-foreground text-[10px] font-medium uppercase tracking-wider hover:bg-foreground hover:text-background transition-colors">
                  <Pencil className="w-3 h-3" /> Modifier
                </button>
                <button onClick={(e) => { e.stopPropagation(); handleDelete(index); }}
                  className="h-[28px] px-2 flex items-center border border-red-300 text-red-500 text-[10px] hover:bg-red-50 transition-colors">
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
