import React, { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ATSCandidate } from '@/hooks/useATSData';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { Loader2, Sparkles, Star, Save, RotateCcw, ChevronDown, ChevronUp, Pencil, Check } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
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
}

interface EvaluationData {
  id?: string;
  criteria: Criterion[];
  ratings: Record<string, number>;
  comments: Record<string, string>;
  overallScore: number | null;
  savedAt?: string;
}

const CATEGORY_CONFIG: Record<string, { label: string; color: string }> = {
  technical: { label: 'Tech', color: 'border-blue-400 bg-blue-50 text-blue-700' },
  soft_skill: { label: 'Soft', color: 'border-amber-400 bg-amber-50 text-amber-700' },
  culture_fit: { label: 'Culture', color: 'border-purple-400 bg-purple-50 text-purple-700' },
  motivation: { label: 'Motiv.', color: 'border-emerald-400 bg-emerald-50 text-emerald-700' },
};

export const ScorecardTab: React.FC<ScorecardTabProps> = ({ candidate, enrichedProfile }) => {
  const [evaluation, setEvaluation] = useState<EvaluationData | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expandedCriteria, setExpandedCriteria] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false);

  // Load existing evaluation
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
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (data) {
          setEvaluation({
            id: data.id,
            criteria: (data.criteria as any) || [],
            ratings: (data.ratings as any) || {},
            comments: (data.comments as any) || {},
            overallScore: data.overall_score ? Number(data.overall_score) : null,
            savedAt: data.updated_at,
          });
          // If already saved, start collapsed
          setCollapsed(true);
        }
      } catch (err) {
        console.error('Error loading evaluation:', err);
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

      const jobContext: any = {
        title: candidate.jobTitle || 'Non spécifié',
      };

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
        } catch {
          // Non-blocking
        }
      }

      const { data, error } = await supabase.functions.invoke('generate-scorecard', {
        body: {
          candidateProfile,
          jobContext,
          scoringDetails: candidate.scoringDetails,
        },
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Failed to generate scorecard');

      const criteria = data.criteria as Criterion[];
      setEvaluation(prev => ({
        id: prev?.id,
        criteria,
        ratings: prev?.ratings || {},
        comments: prev?.comments || {},
        overallScore: null,
      }));
      setCollapsed(false);
      setEditing(true);

      toast.success(`${criteria.length} critères générés sur mesure`);
    } catch (err: any) {
      console.error('Error generating scorecard:', err);
      toast.error(err?.message || 'Erreur lors de la génération');
    } finally {
      setGenerating(false);
    }
  }, [candidate, enrichedProfile]);

  // Calculate weighted average
  const computeOverallScore = useCallback((ratings: Record<string, number>, criteria: Criterion[]): number | null => {
    const rated = criteria.filter(c => ratings[c.id] != null);
    if (rated.length === 0) return null;
    const totalWeight = rated.reduce((sum, c) => sum + c.weight, 0);
    const weightedSum = rated.reduce((sum, c) => sum + (ratings[c.id] || 0) * c.weight, 0);
    return Math.round((weightedSum / totalWeight) * 10) / 10;
  }, []);

  const handleRate = useCallback((criterionId: string, rating: number) => {
    setEvaluation(prev => {
      if (!prev) return prev;
      const newRatings = { ...prev.ratings, [criterionId]: rating };
      return {
        ...prev,
        ratings: newRatings,
        overallScore: computeOverallScore(newRatings, prev.criteria),
      };
    });
  }, [computeOverallScore]);

  const handleComment = useCallback((criterionId: string, comment: string) => {
    setEvaluation(prev => {
      if (!prev) return prev;
      return { ...prev, comments: { ...prev.comments, [criterionId]: comment } };
    });
  }, []);

  // Save to DB then collapse
  const handleSave = useCallback(async () => {
    if (!evaluation) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const now = new Date().toISOString();
      const payload = {
        candidate_id: candidate.candidateId,
        job_id: candidate.jobId,
        job_title: candidate.jobTitle,
        criteria: evaluation.criteria as any,
        ratings: evaluation.ratings as any,
        comments: evaluation.comments as any,
        overall_score: evaluation.overallScore,
        created_by: user.id,
        updated_at: now,
      };

      if (evaluation.id) {
        const { error } = await supabase
          .from('candidate_evaluations')
          .update(payload)
          .eq('id', evaluation.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase
          .from('candidate_evaluations')
          .insert(payload)
          .select('id')
          .single();
        if (error) throw error;
        setEvaluation(prev => prev ? { ...prev, id: data.id } : prev);
      }

      setEvaluation(prev => prev ? { ...prev, savedAt: now } : prev);
      setCollapsed(true);
      setEditing(false);
      toast.success('Évaluation sauvegardée');
    } catch (err: any) {
      console.error('Error saving:', err);
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  }, [evaluation, candidate]);

  const toggleExpand = (id: string) => {
    setExpandedCriteria(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleEditReopen = () => {
    setCollapsed(false);
    setEditing(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // No evaluation yet
  if (!evaluation || evaluation.criteria.length === 0) {
    return (
      <div className="text-center py-10">
        <div className="h-14 w-14 bg-foreground text-background flex items-center justify-center mx-auto mb-4">
          <Sparkles className="w-7 h-7" />
        </div>
        <h3 className="text-sm font-bold uppercase tracking-wider text-foreground mb-2">
          Scorecard d'évaluation
        </h3>
        <p className="text-[11px] text-muted-foreground max-w-sm mx-auto mb-6 leading-relaxed">
          L'IA va analyser le profil du candidat et les exigences du poste pour générer une grille d'évaluation sur mesure.
        </p>
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="relative overflow-hidden h-[38px] px-6 bg-foreground text-background border border-foreground text-xs font-medium uppercase tracking-wider group disabled:opacity-50"
        >
          {generating ? (
            <span className="flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Génération en cours...
            </span>
          ) : (
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5" />
              Générer la scorecard
            </span>
          )}
        </button>
      </div>
    );
  }

  const ratedCount = evaluation.criteria.filter(c => evaluation.ratings[c.id] != null).length;
  const totalCriteria = evaluation.criteria.length;

  // ─── Collapsed summary view ───
  if (collapsed) {
    return (
      <div className="space-y-3">
        <div
          className="border border-foreground/15 p-4 cursor-pointer hover:bg-foreground/[0.02] transition-colors"
          onClick={handleEditReopen}
        >
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              {evaluation.overallScore != null && (
                <div className={cn(
                  "h-12 w-12 flex items-center justify-center border-2 text-lg font-bold",
                  evaluation.overallScore >= 4 ? "border-emerald-400 bg-emerald-50 text-emerald-700" :
                  evaluation.overallScore >= 3 ? "border-amber-400 bg-amber-50 text-amber-700" :
                  "border-red-400 bg-red-50 text-red-700"
                )}>
                  {evaluation.overallScore}
                </div>
              )}
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">
                  Scorecard — {ratedCount}/{totalCriteria} critères
                </p>
                <p className="text-[10px] text-muted-foreground">
                  {candidate.jobTitle || 'Poste non spécifié'}
                  {evaluation.savedAt && (
                    <> · Sauvegardée le {new Date(evaluation.savedAt).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</>
                  )}
                </p>
              </div>
            </div>
            <button className="h-[30px] px-3 flex items-center gap-1.5 border border-foreground text-foreground text-[10px] font-medium uppercase tracking-wider hover:bg-foreground hover:text-background transition-colors">
              <Pencil className="w-3 h-3" />
              Modifier
            </button>
          </div>

          {/* Mini summary of ratings */}
          <div className="flex flex-wrap gap-1.5">
            {evaluation.criteria.map(c => {
              const r = evaluation.ratings[c.id];
              const catConfig = CATEGORY_CONFIG[c.category] || CATEGORY_CONFIG.technical;
              return (
                <div key={c.id} className="flex items-center gap-1 text-[10px] border border-foreground/10 px-2 py-1">
                  <span className={cn("w-1.5 h-1.5 rounded-full", 
                    r != null && r >= 4 ? "bg-emerald-400" :
                    r != null && r >= 3 ? "bg-amber-400" :
                    r != null ? "bg-red-400" : "bg-foreground/20"
                  )} />
                  <span className="text-muted-foreground truncate max-w-[120px]">{c.label}</span>
                  {r != null && <span className="font-bold text-foreground">{r}/5</span>}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  }

  // ─── Full editing view ───
  return (
    <div className="space-y-4 pr-1">
      {/* Header bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {evaluation.overallScore != null && (
            <div className={cn(
              "h-12 w-12 flex items-center justify-center border-2 text-lg font-bold",
              evaluation.overallScore >= 4 ? "border-emerald-400 bg-emerald-50 text-emerald-700" :
              evaluation.overallScore >= 3 ? "border-amber-400 bg-amber-50 text-amber-700" :
              "border-red-400 bg-red-50 text-red-700"
            )}>
              {evaluation.overallScore}
            </div>
          )}
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wider text-foreground">
              {ratedCount}/{totalCriteria} critères évalués
            </p>
            <p className="text-[10px] text-muted-foreground">
              {candidate.jobTitle || 'Poste non spécifié'}
            </p>
          </div>
        </div>
        <div className="flex gap-0">
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="relative overflow-hidden h-[30px] px-3 flex items-center gap-1.5 border border-foreground text-foreground text-[10px] font-medium uppercase tracking-wider group disabled:opacity-50"
          >
            {generating ? <Loader2 className="w-3 h-3 animate-spin relative z-10" /> : <RotateCcw className="w-3 h-3 relative z-10" />}
            <span className="relative z-10">Régénérer</span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="relative overflow-hidden h-[30px] px-3 flex items-center gap-1.5 border border-foreground -ml-px bg-foreground text-background text-[10px] font-medium uppercase tracking-wider group disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
            <span>Sauvegarder</span>
          </button>
        </div>
      </div>

      {/* Criteria list */}
      <div className="space-y-2">
        {evaluation.criteria.map(criterion => {
          const rating = evaluation.ratings[criterion.id];
          const comment = evaluation.comments[criterion.id] || '';
          const isExpanded = expandedCriteria.has(criterion.id);
          const catConfig = CATEGORY_CONFIG[criterion.category] || CATEGORY_CONFIG.technical;

          return (
            <div key={criterion.id} className="border border-foreground/15 bg-foreground/[0.02]">
              <div
                className="flex items-center gap-3 p-3 cursor-pointer hover:bg-foreground/[0.03] transition-colors"
                onClick={() => toggleExpand(criterion.id)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={cn("text-[9px] px-1.5 py-0.5 border font-bold uppercase tracking-wider", catConfig.color)}>
                      {catConfig.label}
                    </span>
                    {criterion.weight === 3 && (
                      <span className="text-[9px] px-1.5 py-0.5 border border-red-300 bg-red-50 text-red-700 font-bold uppercase tracking-wider">
                        Critique
                      </span>
                    )}
                    {criterion.weight === 1 && (
                      <span className="text-[9px] px-1.5 py-0.5 border border-foreground/20 text-muted-foreground font-medium uppercase tracking-wider">
                        Bonus
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-medium text-foreground leading-tight">{criterion.label}</p>
                </div>

                <div className="flex items-center gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onClick={() => handleRate(criterion.id, star)}
                      className="p-0.5 transition-colors"
                    >
                      <Star
                        className={cn(
                          "w-5 h-5 transition-colors",
                          rating != null && star <= rating
                            ? "fill-amber-400 text-amber-400"
                            : "text-foreground/15 hover:text-amber-300"
                        )}
                      />
                    </button>
                  ))}
                </div>

                {isExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />}
              </div>

              {isExpanded && (
                <div className="px-3 pb-3 space-y-2 border-t border-foreground/10">
                  <p className="text-[11px] text-muted-foreground leading-relaxed pt-2 italic">
                    💡 {criterion.description}
                  </p>
                  <Textarea
                    value={comment}
                    onChange={e => handleComment(criterion.id, e.target.value)}
                    placeholder="Notes d'entretien pour ce critère..."
                    className="text-xs min-h-[60px] rounded-none border-foreground/20 resize-none"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
