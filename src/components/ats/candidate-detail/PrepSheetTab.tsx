import React from 'react';
import { useCandidateContext } from '@/hooks/useCandidateContext';
import { Loader2, AlertTriangle, CheckCircle2, HelpCircle, TrendingUp, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PrepSheetTabProps {
  candidateId: string;
  jobId: string | null;
  candidateName: string;
}

export const PrepSheetTab: React.FC<PrepSheetTabProps> = ({ candidateId, jobId, candidateName }) => {
  const { data: ctx, isLoading } = useCandidateContext(candidateId, jobId || undefined);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin text-foreground" />
          <p className="text-xs uppercase tracking-wider text-muted-foreground">Préparation du brief d'appel...</p>
        </div>
      </div>
    );
  }

  if (!ctx) {
    return <p className="text-xs text-muted-foreground py-6 text-center">Aucune donnée disponible.</p>;
  }

  const hasCallHistory = ctx.callTranscripts.length > 0;
  const hasPreviousEvals = ctx.previousEvaluations.length > 0;
  const matchingSkills = ctx.scoringDetails?.matching_skills || [];
  const missingSkills = ctx.scoringDetails?.missing_skills || [];

  // Generate talking points
  const talkingPoints: Array<{ icon: typeof CheckCircle2; label: string; detail: string; type: 'strength' | 'risk' | 'question' }> = [];

  // Strengths from scoring
  matchingSkills.slice(0, 3).forEach(skill => {
    talkingPoints.push({ icon: CheckCircle2, label: skill, detail: 'Compétence confirmée par le profil', type: 'strength' });
  });

  // Risks from missing skills
  missingSkills.slice(0, 3).forEach(skill => {
    talkingPoints.push({ icon: AlertTriangle, label: skill, detail: 'À vérifier — non identifié sur le profil', type: 'risk' });
  });

  // Questions from experience gaps
  if (ctx.linkedinProfile?.positions?.length) {
    const currentRole = ctx.linkedinProfile.positions[0];
    if (currentRole) {
      talkingPoints.push({
        icon: HelpCircle,
        label: `Rôle actuel : ${currentRole.title} chez ${currentRole.company}`,
        detail: 'Explorer les motivations de départ et les attentes',
        type: 'question',
      });
    }
  }

  // Salary/expectations if job has salary info
  if (ctx.jobTitle) {
    talkingPoints.push({
      icon: HelpCircle,
      label: 'Prétentions salariales',
      detail: 'Vérifier l\'adéquation avec la fourchette du poste',
      type: 'question',
    });
  }

  // Availability
  talkingPoints.push({
    icon: HelpCircle,
    label: 'Disponibilité',
    detail: 'Date de démarrage, préavis, contraintes',
    type: 'question',
  });

  return (
    <div className="space-y-5 py-2">
      {/* Header summary */}
      <div className="border border-foreground/20 p-4">
        <div className="flex items-center gap-2 mb-3">
          <MessageSquare className="w-4 h-4 text-foreground" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Brief de préparation</h3>
        </div>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="border border-foreground/10 p-2">
            <p className="text-lg font-bold text-foreground">{ctx.score ?? '—'}</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Score IA</p>
          </div>
          <div className="border border-foreground/10 p-2">
            <p className="text-lg font-bold text-foreground">{matchingSkills.length}</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Skills matchés</p>
          </div>
          <div className="border border-foreground/10 p-2">
            <p className="text-lg font-bold text-foreground">{missingSkills.length}</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">À vérifier</p>
          </div>
        </div>
      </div>

      {/* Talking points */}
      <div>
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">Points à aborder</h3>
        <div className="space-y-2">
          {talkingPoints.map((point, i) => (
            <div key={i} className={cn(
              "flex items-start gap-3 px-3 py-2.5 border",
              point.type === 'strength' ? "border-foreground/10 bg-foreground/5" :
              point.type === 'risk' ? "border-red-200 bg-red-50/50" :
              "border-foreground/10"
            )}>
              <point.icon className={cn(
                "w-3.5 h-3.5 shrink-0 mt-0.5",
                point.type === 'strength' ? "text-foreground" :
                point.type === 'risk' ? "text-red-500" :
                "text-muted-foreground"
              )} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground">{point.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{point.detail}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Previous context */}
      {hasCallHistory && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Appels précédents</h3>
          {ctx.callTranscripts.slice(0, 2).map((call, i) => (
            <div key={i} className="border border-foreground/10 p-3 mb-2">
              {call.report?.summary && (
                <p className="text-xs text-foreground">{call.report.summary}</p>
              )}
              {call.report?.recommendation && (
                <p className="text-xs text-muted-foreground mt-1">Recommandation : {call.report.recommendation}</p>
              )}
              {!call.report?.summary && (
                <p className="text-xs text-muted-foreground italic">Transcript disponible ({Math.round(call.duration_seconds / 60)} min)</p>
              )}
            </div>
          ))}
        </div>
      )}

      {hasPreviousEvals && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Évaluations précédentes</h3>
          {ctx.previousEvaluations.slice(0, 3).map((ev, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-2 border border-foreground/10 mb-1">
              <span className={cn(
                "px-1.5 py-0.5 text-xs font-bold",
                (ev.overall_score || 0) >= 4 ? "bg-foreground text-background" :
                (ev.overall_score || 0) >= 3 ? "bg-foreground/60 text-background" :
                "bg-foreground/30 text-foreground"
              )}>
                {ev.overall_score ?? '—'}/5
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-foreground truncate">{ev.job_title || 'Évaluation'}</p>
                <p className="text-xs text-muted-foreground">{ev.interview_stage || ''} · {ev.recommendation || ''}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recruiter notes */}
      {ctx.notes.length > 0 && (
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Notes des collègues</h3>
          {ctx.notes.slice(0, 3).map((note, i) => (
            <div key={i} className="border-l-2 border-foreground/20 pl-3 mb-2">
              <p className="text-xs text-foreground/80">{note.length > 200 ? note.slice(0, 200) + '...' : note}</p>
            </div>
          ))}
        </div>
      )}

      {/* No context available */}
      {!hasCallHistory && !hasPreviousEvals && ctx.notes.length === 0 && matchingSkills.length === 0 && (
        <div className="text-center py-4">
          <p className="text-xs text-muted-foreground">Pas encore de contexte historique. Le brief s'enrichira après vos premiers échanges.</p>
        </div>
      )}
    </div>
  );
};
