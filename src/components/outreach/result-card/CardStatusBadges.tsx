import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { MessageSquare, CheckCircle2, Star, Zap, Loader2, Target, Archive, Sparkles, GitBranch } from 'lucide-react';
import airtableLogo from '@/assets/airtable-logo.svg';
import notionLogo from '@/assets/notion-logo.webp';
import { ProjectEnrollmentInfo } from '@/hooks/useProjectEnrollments';

interface CardStatusBadgesProps {
  candidateStatus?: { status: string; score?: number | null; recommendation?: string | null } | null;
  profile: { open_to_work?: boolean; premium?: boolean };
  airtableMatch?: { airtable_id: string; source_base: string; full_name: string | null; status: string | null; match_type?: 'url' | 'fuzzy' } | null;
  notionMatch?: { id: string; name: string } | null;
  historyData?: any;
  historyLoading?: boolean;
  /** Score IA pour ce candidat sur le job courant (si déjà scoré) */
  jobScore?: { match_score: number; recommendation?: string; scoringDepth?: 'quick' | 'deep' } | null;
  /** LinkedIn signal "Likely to respond" — affiché en badge "Réactif" si true */
  isLikelyToRespond?: boolean;
  /** Si le candidat est déjà dans une séquence pour cette mission. */
  enrollmentInfo?: ProjectEnrollmentInfo | null;
}

export const CardStatusBadges: React.FC<CardStatusBadgesProps> = ({
  candidateStatus,
  profile,
  airtableMatch,
  notionMatch,
  historyData,
  historyLoading,
  jobScore,
  isLikelyToRespond,
  enrollmentInfo,
}) => {
  const historyTotal = historyData
    ? historyData.placements.length + historyData.shortlists.length + historyData.notes.length + historyData.appointments.length
    : 0;

  // Mapping statut enrollment → label/couleur. Réutilisé pour le tooltip.
  const enrollmentLabel = enrollmentInfo
    ? enrollmentInfo.replied_at
      ? 'A répondu'
      : enrollmentInfo.status === 'paused'
      ? 'En pause'
      : enrollmentInfo.status === 'completed'
      ? 'Séquence terminée'
      : enrollmentInfo.status === 'cancelled' || enrollmentInfo.status === 'stopped'
      ? 'Stoppé'
      : `Étape ${(enrollmentInfo.current_step_order ?? 0) + 1}`
    : null;

  const enrollmentTone = enrollmentInfo
    ? enrollmentInfo.replied_at
      ? 'success'
      : enrollmentInfo.status === 'paused'
      ? 'warning'
      : enrollmentInfo.status === 'cancelled' || enrollmentInfo.status === 'stopped'
      ? 'destructive'
      : 'info'
    : null;

  return (
    <>
      {/* Badge "En séquence" — affiché en priorité quand le candidat est
          déjà tracké dans une séquence pour cette mission. Évite les
          enrollments en double et signale visuellement les conv en cours. */}
      {enrollmentInfo && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge
              className={`text-xs px-1.5 py-0 h-4 sm:h-5 gap-1 shrink-0 cursor-default border ${
                enrollmentTone === 'success'
                  ? 'bg-success/10 text-success border-success/30'
                  : enrollmentTone === 'warning'
                  ? 'bg-warning/10 text-warning border-warning/30'
                  : enrollmentTone === 'destructive'
                  ? 'bg-destructive/10 text-destructive border-destructive/30'
                  : 'bg-info/10 text-info border-info/30'
              }`}
            >
              <GitBranch className="w-3 h-3" />
              <span className="hidden sm:inline">{enrollmentLabel}</span>
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs font-medium">
              {enrollmentInfo.sequence_name || 'Séquence'}
            </p>
            <p className="text-xs text-muted-foreground">
              {enrollmentLabel}
              {enrollmentInfo.replied_at && (
                <> · le {new Date(enrollmentInfo.replied_at).toLocaleDateString('fr-FR')}</>
              )}
            </p>
          </TooltipContent>
        </Tooltip>
      )}
      {candidateStatus && (
        <>
          {candidateStatus.status === 'messaged' && (
            <Badge className="bg-info text-info-foreground text-xs px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0">
              <MessageSquare className="w-3 h-3" />
              <span className="hidden sm:inline">Contacté</span>
            </Badge>
          )}
          {candidateStatus.status === 'replied' && (
            <Badge className="bg-success text-success-foreground text-xs px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0">
              <CheckCircle2 className="w-3 h-3" />
              <span className="hidden sm:inline">Répondu</span>
            </Badge>
          )}
          {candidateStatus.status === 'shortlisted' && (
            <Badge className="bg-warning text-warning-foreground text-xs px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0">
              <Star className="w-3 h-3" />
              <span className="hidden sm:inline">Shortlist</span>
            </Badge>
          )}
          {candidateStatus.status === 'scored' && !jobScore && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0 text-brand-purple border-brand-purple/30 bg-brand-purple/10">
              <Target className="w-3 h-3" />
              {candidateStatus.score && <span>{candidateStatus.score}%</span>}
            </Badge>
          )}
          {candidateStatus.status === 'dismissed' && (
            <Badge variant="outline" className="text-xs px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0 text-warning border-warning/30 bg-warning/10">
              <Archive className="w-3 h-3" />
              <span className="hidden sm:inline">Archivé</span>
            </Badge>
          )}
        </>
      )}
      {/* Job Score promu inline (avant : row 4 séparée) — le plus important
          quand un candidat est scoré, doit être visible IMMÉDIATEMENT près du nom */}
      {jobScore && jobScore.match_score > 0 && (
        <Badge
          variant="outline"
          className={`text-xs font-bold tabular-nums px-1.5 py-0 h-4 sm:h-5 shrink-0 gap-1 ${
            jobScore.match_score >= 70
              ? 'border-success/40 bg-success/10 text-success'
              : jobScore.match_score >= 40
              ? 'border-warning/40 bg-warning/10 text-warning'
              : 'border-destructive/40 bg-destructive/10 text-destructive'
          }`}
          title={jobScore.scoringDepth === 'deep'
            ? `Score IA complet (profil visité) : ${jobScore.match_score}/100 — ${jobScore.recommendation || ''}`
            : `Score IA rapide (données de la liste) : ${jobScore.match_score}/100 — l'analyse complète se lance à l'ouverture de la fiche`}
        >
          <Target className="w-3 h-3" aria-hidden="true" />
          {jobScore.match_score}
          {/* Coche = éval. complète (profil visité), sinon score rapide (liste) */}
          {jobScore.scoringDepth === 'deep' && (
            <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
          )}
        </Badge>
      )}

      {profile.premium && (
        <Badge variant="outline" className="text-xs px-1 sm:px-1.5 py-0 h-4 sm:h-5 text-warning border-warning/30 bg-warning/10 shrink-0">
          <Star className="w-3 h-3 mr-0.5 fill-warning" />
          <span className="hidden sm:inline">Premium</span>
        </Badge>
      )}
      {profile.open_to_work && (
        <Badge className="bg-success text-success-foreground text-xs px-1 sm:px-1.5 py-0 h-4 sm:h-5 gap-0.5 shrink-0">
          <Zap className="w-3 h-3" />
          <span className="hidden sm:inline">Open to Work</span>
          <span className="sm:hidden">OTW</span>
        </Badge>
      )}
      {/* Réactif badge from HEAD (kept) */}
      {isLikelyToRespond && (
        <Badge variant="outline" className="text-xs px-1 sm:px-1.5 py-0 h-4 sm:h-5 text-brand-purple border-brand-purple/30 bg-brand-purple/10 shrink-0 hidden sm:flex">
          <Sparkles className="w-3 h-3 mr-0.5" />
          Réactif
        </Badge>
      )}
      {/* Airtable badge — design simplifié de la branche audit (tooltip + compteur compact)
          mais on garde theme tokens (success/foreground) au lieu de teal hardcodé pour cohérence. */}
      {airtableMatch && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge className={`text-xs px-1.5 py-0 h-4 sm:h-5 shrink-0 gap-1 cursor-default ${
              airtableMatch.match_type === 'fuzzy'
                ? 'bg-success/10 text-success border border-dashed border-success/40'
                : 'bg-success text-success-foreground'
            }`}>
              <img src={airtableLogo} alt="Airtable" className="w-3 h-3 object-contain shrink-0" style={{ filter: airtableMatch.match_type !== 'fuzzy' ? 'brightness(10)' : 'none' }} />
              {historyLoading && <Loader2 className="w-2.5 h-2.5 animate-spin shrink-0" />}
              {historyTotal > 0 && <span className="font-bold shrink-0">{historyTotal}</span>}
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs font-medium">
              {airtableMatch.match_type === 'fuzzy' ? 'Airtable (match approximatif)' : 'Airtable'}
            </p>
            {airtableMatch.status && <p className="text-xs text-muted-foreground">Statut : {airtableMatch.status}</p>}
            {historyData && (
              <p className="text-xs text-muted-foreground">
                {historyData.placements.length > 0 && `${historyData.placements.length} placement(s) `}
                {historyData.shortlists.length > 0 && `${historyData.shortlists.length} shortlist(s) `}
                {historyData.notes.length > 0 && `${historyData.notes.length} note(s) `}
                {historyData.appointments.length > 0 && `${historyData.appointments.length} RDV `}
              </p>
            )}
          </TooltipContent>
        </Tooltip>
      )}
      {notionMatch && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Badge variant="outline" className="text-xs px-1 py-0 h-4 sm:h-5 border-border bg-muted shrink-0">
              <img src={notionLogo} alt="Notion" className="w-3.5 h-3.5 object-contain" />
            </Badge>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs">
            <p className="text-xs font-medium">Déjà dans Notion</p>
            <p className="text-xs text-muted-foreground">{notionMatch.name}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </>
  );
};
