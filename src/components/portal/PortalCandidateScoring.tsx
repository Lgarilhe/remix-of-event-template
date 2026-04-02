import React, { useState } from 'react';
import { Star, Send, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface PortalCandidate {
  id: string;
  candidate_name: string | null;
  candidate_headline: string | null;
  pipeline_stage: string | null;
}

interface PortalCandidateScoringProps {
  candidate: PortalCandidate;
  projectId: string;
  clientName: string;
  canFillScorecard: boolean;
}

const CRITERIA = [
  { key: 'technical', label: 'Compétences techniques', description: 'Maîtrise des outils et technologies requises' },
  { key: 'experience', label: 'Expérience pertinente', description: 'Adéquation du parcours avec le poste' },
  { key: 'soft_skills', label: 'Soft skills', description: 'Communication, leadership, travail en équipe' },
  { key: 'culture_fit', label: 'Culture fit', description: 'Adéquation avec les valeurs et l\'environnement' },
  { key: 'motivation', label: 'Motivation', description: 'Intérêt pour le poste et le projet' },
];

export const PortalCandidateScoring: React.FC<PortalCandidateScoringProps> = ({
  candidate, projectId, clientName, canFillScorecard,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [comment, setComment] = useState('');
  const [recommendation, setRecommendation] = useState<string>('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  if (!canFillScorecard || submitted) {
    if (submitted) {
      return (
        <div className="flex items-center gap-1.5 px-3 py-2 bg-accent/50 border border-border">
          <Check className="w-3 h-3 text-foreground" />
          <span className="text-xs text-foreground font-medium">Évaluation envoyée</span>
        </div>
      );
    }
    return null;
  }

  const handleSubmit = async () => {
    if (Object.keys(ratings).length === 0) {
      toast.error('Donnez au moins une note');
      return;
    }
    setSubmitting(true);
    try {
      // Store as candidate_evaluation via anon access
      // Since the portal is public, we store the evaluation with the client name as author
      const ratedCount = Object.keys(ratings).length;
      const totalScore = Object.values(ratings).reduce((sum, r) => sum + r, 0);
      const overallScore = Math.round((totalScore / ratedCount) * 10) / 10;

      const { error } = await supabase
        .from('candidate_evaluations')
        .insert({
          candidate_id: candidate.id,
          job_id: projectId,
          criteria: CRITERIA.map(c => ({
            id: c.key,
            label: c.label,
            description: c.description,
            category: c.key,
            weight: 2,
          })),
          ratings,
          comments: comment ? { general: comment } : {},
          overall_score: overallScore,
          recommendation: recommendation || null,
          summary: `Évaluation par ${clientName} — Score: ${overallScore}/5`,
          ai_generated: false,
          created_by: '00000000-0000-0000-0000-000000000000', // Anonymous portal user
        });

      if (error) throw error;
      setSubmitted(true);
      toast.success('Merci pour votre évaluation !');
    } catch (err: any) {
      toast.error(err?.message || 'Erreur lors de l\'envoi');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="border border-border">
      {/* Toggle */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-2 hover:bg-muted/20 transition-colors"
      >
        <span className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
          <Star className="w-3 h-3" /> Évaluer ce candidat
        </span>
        {expanded ? <ChevronUp className="w-3 h-3 text-muted-foreground" /> : <ChevronDown className="w-3 h-3 text-muted-foreground" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-3">
          {/* Rating criteria */}
          {CRITERIA.map(criterion => (
            <div key={criterion.key} className="space-y-1">
              <p className="text-xs font-medium text-foreground">{criterion.label}</p>
              <p className="text-xs text-muted-foreground">{criterion.description}</p>
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map(n => (
                  <button
                    key={n}
                    onClick={() => setRatings(prev => ({ ...prev, [criterion.key]: n }))}
                    className={cn(
                      "w-8 h-8 text-xs font-bold border transition-colors",
                      ratings[criterion.key] === n
                        ? "bg-foreground text-background border-border"
                        : "border-border text-foreground hover:border-border"
                    )}
                  >
                    {n}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Recommendation */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Recommandation</p>
            <div className="flex flex-wrap gap-1">
              {[
                { key: 'strong_yes', label: '✅ Oui absolument' },
                { key: 'yes', label: '👍 Oui' },
                { key: 'maybe', label: '🤔 À revoir' },
                { key: 'no', label: '👎 Non' },
              ].map(opt => (
                <button
                  key={opt.key}
                  onClick={() => setRecommendation(opt.key)}
                  className={cn(
                    "px-2 py-1 text-xs font-bold uppercase tracking-wider border transition-colors",
                    recommendation === opt.key
                      ? "bg-foreground text-background border-border"
                      : "border-border text-foreground hover:border-border"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Comment */}
          <div className="space-y-1">
            <p className="text-xs font-medium text-foreground">Commentaire (optionnel)</p>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Vos impressions sur ce candidat..."
              className="w-full min-h-[60px] px-3 py-2 text-sm border border-border bg-background text-foreground resize-y focus:border-border focus:outline-none"
            />
          </div>

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={submitting || Object.keys(ratings).length === 0}
            className="relative overflow-hidden w-full h-[34px] bg-foreground text-background border border-border text-xs font-bold uppercase tracking-wider group disabled:opacity-50"
          >
            <span className="relative z-10 flex items-center justify-center gap-1.5">
              {submitting ? 'Envoi...' : <><Send className="w-3 h-3" /> Envoyer mon évaluation</>}
            </span>
          </button>
        </div>
      )}
    </div>
  );
};
