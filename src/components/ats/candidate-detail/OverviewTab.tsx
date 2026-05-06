/**
 * OverviewTab — vrai hub candidat.
 *
 * Premier onglet par défaut quand on ouvre la modale. Tout ce qui
 * compte sur ce candidat est visible en 1 coup d'œil — pas besoin de
 * cliquer dans 8 onglets pour avoir le contexte.
 *
 * Sections (top-to-bottom) :
 *   1. ALERTES         — bandeau rouge si stagnation / data manquante /
 *                        message à traiter (priorité absolue)
 *   2. Score Hero      — gauge + recommandation + résumé IA
 *   3. Stats grid      — 4 cards : Engagement / CV / Séquences / Rappels
 *   4. POSTES          — toutes les missions où ce candidat apparaît
 *                        (shortlisté, scoré, contacté) avec stage par mission
 *   5. ACTIVITÉ        — 5 derniers événements timeline + lien "voir tout"
 *   6. À PRÉVOIR       — prochains rappels + prochaine étape séquence
 *   7. About           — résumé LinkedIn
 *   8. Expérience      — 2 dernières positions
 *   9. Formation       — école principale
 *  10. Skills + Lang   — chips
 *  11. Notes preview   — 2 dernières notes
 */

import React, { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Target, Phone, FileText, GitBranch, Bell, Briefcase, GraduationCap,
  Sparkles, Building2, Clock, MessageCircle, StickyNote, Languages,
  Award, AlertTriangle, AlertCircle, MailWarning, Activity as ActivityIcon,
  Calendar, History, ArrowRight, CheckCircle2, XCircle, MapPin,
  PhoneOff, FileQuestion, Send, ChevronRight,
} from 'lucide-react';
import { format, formatDistanceToNow, differenceInDays, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ATSCandidate } from '@/hooks/useATSData';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { CandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { listCVs, CandidateCV } from '@/lib/cvStorage';
import { listDismissedAlerts, dismissAlert, type AlertKey } from '@/lib/candidateAlerts';
import { Check } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface Note {
  id: string;
  content: string;
  created_at: string;
  created_by: string;
}

interface Reminder {
  id: string;
  title: string;
  description: string | null;
  due_at: string;
  completed_at: string | null;
}

interface Props {
  candidate: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
  fullProfile: CandidateFullProfile;
  notes: Note[];
  reminders: Reminder[];
  organizationId: string | null;
}

// Étapes "stagnantes" si pas d'activité depuis X jours.
// Exemple : un candidat dans "Contacté" depuis 18 jours sans réponse →
// recruter doit relancer ou passer à la suite.
const STAGNATION_THRESHOLDS_DAYS: Record<string, number> = {
  'Nouveau': 7,
  'Contacté': 14,
  'Répondu': 5,
  'Pressenti': 14,
  'Pré-qualif': 7,
  'CV envoyé': 14,
  'ITW en cours': 21,
  'Offre': 14,
};
// Étapes terminales — pas de stagnation à signaler
const TERMINAL_STAGES = new Set(['Gagné', 'Perdu']);

export const OverviewTab: React.FC<Props> = ({
  candidate, enrichedProfile, fullProfile, notes, reminders, organizationId,
}) => {
  // Fetch CV count en background
  const [cvs, setCvs] = useState<CandidateCV[]>([]);
  const [cvLoading, setCvLoading] = useState(false);
  useEffect(() => {
    if (!organizationId) return;
    setCvLoading(true);
    listCVs(candidate.candidateId, organizationId)
      .then(setCvs)
      .catch(err => console.warn('[OverviewTab] CV fetch failed:', err))
      .finally(() => setCvLoading(false));
  }, [candidate.candidateId, organizationId]);

  // Fetch alertes déjà dismissées (persisted dans candidate_alert_dismissals).
  // L'user a cliqué "✓ Traité" sur ces alertes auparavant — on les filtre.
  const [dismissedKeys, setDismissedKeys] = useState<Set<AlertKey>>(new Set());
  useEffect(() => {
    if (!organizationId) return;
    listDismissedAlerts(candidate.candidateId, organizationId)
      .then(setDismissedKeys)
      .catch(err => console.warn('[OverviewTab] dismissed alerts fetch failed:', err));
  }, [candidate.candidateId, organizationId]);

  const handleDismissAlert = async (key: AlertKey) => {
    if (!organizationId) return;
    // Optimistic update — on ajoute à dismissedKeys avant le DB call
    setDismissedKeys(prev => new Set([...prev, key]));
    try {
      await dismissAlert(candidate.candidateId, organizationId, key);
      toast.success('Alerte traitée');
    } catch (err: any) {
      // Rollback en cas d'erreur
      setDismissedKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      toast.error(err?.message || 'Erreur');
    }
  };

  // ─── Compute alerts ─────────────────────────────────────────────
  const alerts = useMemo(() => {
    const result: Alert[] = [];

    // 1. Stagnation : combien de jours sur cette étape ?
    if (
      candidate.lastActivity &&
      !TERMINAL_STAGES.has(candidate.stage) &&
      STAGNATION_THRESHOLDS_DAYS[candidate.stage]
    ) {
      const daysIdle = differenceInDays(new Date(), parseISO(candidate.lastActivity));
      const threshold = STAGNATION_THRESHOLDS_DAYS[candidate.stage];
      if (daysIdle >= threshold) {
        result.push({
          key: 'stagnation',
          severity: daysIdle >= threshold * 2 ? 'critical' : 'warning',
          icon: Clock,
          title: `Stagnation : ${daysIdle} jours sur "${candidate.stage}"`,
          detail: `Seuil habituel à ${threshold} j — il faut faire bouger ou archiver.`,
        });
      }
    }

    // 2. A répondu mais pas de retour de notre part
    const repliedEnrollment = fullProfile.sequenceEnrollments.find(e =>
      e.status === 'replied' && e.repliedAt
    );
    if (repliedEnrollment?.repliedAt) {
      const daysSinceReply = differenceInDays(new Date(), parseISO(repliedEnrollment.repliedAt));
      if (daysSinceReply >= 1) {
        result.push({
          key: 'unanswered_reply',
          severity: daysSinceReply >= 3 ? 'critical' : 'warning',
          icon: MailWarning,
          title: `Répondu il y a ${daysSinceReply}j — sans réponse de ta part`,
          detail: `Sur la séquence "${repliedEnrollment.sequenceName}". Reprends la conversation.`,
        });
      }
    }

    // 3. Données manquantes critiques
    const missing: string[] = [];
    if (!candidate.email) missing.push('email');
    if (!candidate.phone) missing.push('téléphone');
    if (!cvLoading && cvs.length === 0) missing.push('CV');
    if (missing.length > 0) {
      result.push({
        key: 'missing_contacts',
        severity: 'info',
        icon: FileQuestion,
        title: `Manque ${missing.join(' / ')}`,
        detail: 'Enrichis le profil ou demande les infos directement au candidat.',
      });
    }

    // 4. Pas de score IA
    if ((candidate.score ?? 0) === 0 && fullProfile.scoringHistory.length === 0) {
      result.push({
        key: 'no_score',
        severity: 'info',
        icon: Target,
        title: 'Pas encore scoré par l\'IA',
        detail: 'Score le candidat depuis la mission pour avoir une recommandation.',
      });
    }

    // 5. Pas de connexion LinkedIn acceptée mais inscrit dans une séquence
    const activeNotConnected = fullProfile.sequenceEnrollments.find(e =>
      e.status === 'active' && e.connectionStatus === 'pending'
    );
    if (activeNotConnected) {
      const daysWaiting = differenceInDays(new Date(), parseISO(activeNotConnected.createdAt));
      if (daysWaiting >= 7) {
        result.push({
          key: 'invite_unaccepted',
          severity: 'warning',
          icon: PhoneOff,
          title: `Invitation LinkedIn pas acceptée depuis ${daysWaiting}j`,
          detail: `Sur "${activeNotConnected.sequenceName}". Bascule vers InMail ou archive.`,
        });
      }
    }

    // Filtre les alertes déjà marquées comme "Traité" par l'user
    return result.filter(a => !dismissedKeys.has(a.key));
  }, [candidate, fullProfile.sequenceEnrollments, fullProfile.scoringHistory, cvs, cvLoading, dismissedKeys]);

  // ─── Compute "Postes" : missions où ce candidat apparaît ─────────
  const positions = useMemo(() => {
    type Position = {
      jobId: string;
      jobTitle: string;
      score: number | null;
      stage: string | null;
      recommendation: string | null;
      lastUpdate: string | null;
    };
    const map = new Map<string, Position>();

    for (const sr of fullProfile.scoringHistory) {
      if (!sr.jobId) continue;
      map.set(sr.jobId, {
        jobId: sr.jobId,
        jobTitle: sr.jobTitle || sr.jobId,
        score: sr.score,
        stage: sr.pipelineStage,
        recommendation: sr.recommendation,
        lastUpdate: sr.updatedAt,
      });
    }

    // Add the active candidate's job_id if not already in scoring history
    if (candidate.jobId && !map.has(candidate.jobId)) {
      map.set(candidate.jobId, {
        jobId: candidate.jobId,
        jobTitle: candidate.jobTitle || candidate.jobId,
        score: candidate.score ?? null,
        stage: candidate.stage,
        recommendation: candidate.recommendation ?? null,
        lastUpdate: candidate.lastActivity,
      });
    }

    return Array.from(map.values()).sort((a, b) => {
      const aDate = a.lastUpdate ? new Date(a.lastUpdate).getTime() : 0;
      const bDate = b.lastUpdate ? new Date(b.lastUpdate).getTime() : 0;
      return bDate - aDate;
    });
  }, [candidate, fullProfile.scoringHistory]);

  // ─── Compute "À prévoir" : prochaines actions ────────────────────
  const upcomingActions = useMemo(() => {
    type UpcomingAction = {
      type: 'reminder' | 'sequence_step';
      title: string;
      detail: string;
      date: string;
      icon: React.ComponentType<{ className?: string }>;
    };
    const result: UpcomingAction[] = [];

    // Rappels actifs futurs
    for (const r of reminders) {
      if (r.completed_at) continue;
      if (new Date(r.due_at) < new Date()) continue;
      result.push({
        type: 'reminder',
        title: r.title,
        detail: r.description || '',
        date: r.due_at,
        icon: Bell,
      });
    }

    // Pour chaque séquence active, on n'a pas la prochaine action
    // précisément (besoin de fetch les step_executions séparément). On
    // signale juste "Étape N en cours" pour informer.
    const activeSequences = fullProfile.sequenceEnrollments.filter(e => e.status === 'active');
    for (const enrollment of activeSequences) {
      result.push({
        type: 'sequence_step',
        title: `Séquence "${enrollment.sequenceName}" en cours`,
        detail: `Étape ${enrollment.currentStep} · prochaine action automatique`,
        date: enrollment.createdAt,
        icon: GitBranch,
      });
    }

    // Tri : les rappels les plus proches en premier, puis les séquences
    return result.sort((a, b) => {
      if (a.type === 'reminder' && b.type !== 'reminder') return -1;
      if (a.type !== 'reminder' && b.type === 'reminder') return 1;
      return new Date(a.date).getTime() - new Date(b.date).getTime();
    });
  }, [reminders, fullProfile.sequenceEnrollments]);

  // ─── Compute stats ──────────────────────────────────────────────
  const aircallStats = useMemo(() => {
    const calls = fullProfile.aircallCalls || [];
    const totalDuration = calls.reduce((sum, c) => sum + (c.duration || 0), 0);
    const lastCall = calls[0];
    return {
      count: calls.length,
      totalMin: Math.floor(totalDuration / 60),
      lastDate: lastCall?.startedAt || null,
    };
  }, [fullProfile.aircallCalls]);

  const activeSequences = fullProfile.sequenceEnrollments.filter(e => e.status === 'active');
  const repliedSequences = fullProfile.sequenceEnrollments.filter(e => e.status === 'replied');
  const upcomingReminders = reminders.filter(r => !r.completed_at && new Date(r.due_at) > new Date());
  const nextReminder = upcomingReminders.sort((a, b) => new Date(a.due_at).getTime() - new Date(b.due_at).getTime())[0] || null;
  const primaryCV = cvs.find(c => c.isPrimary) || cvs[0] || null;

  // ─── Latest scoring details ─────────────────────────────────────
  const latestScoring = fullProfile.scoringHistory[0];
  const strengths = latestScoring?.scoringDetails?.strengths || [];
  const concerns = latestScoring?.scoringDetails?.concerns || [];
  const summaryFromAI = latestScoring?.scoringDetails?.summary;
  const summary = enrichedProfile?.summary || (candidate.linkedinProfileData as any)?.summary;

  // ─── Recent timeline (top 5) ────────────────────────────────────
  const recentTimeline = fullProfile.timeline.slice(0, 5);

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* ═══ 0. ALERTES — bandeau prioritaire si problèmes détectés ═══ */}
      {alerts.length > 0 && <AlertsPanel alerts={alerts} onDismiss={handleDismissAlert} />}

      {/* ═══ 1. RÉSUMÉ PROFIL — synthèse candidat-level (PAS job-fit) ═══
          Ne parle JAMAIS d'un poste précis : un candidat peut être
          shortlisté sur plusieurs missions à la fois. C'est juste qui
          est cette personne, ses points forts généraux et points
          d'attention sur le profil global. */}
      <ProfileSummaryCard
        candidate={candidate}
        enrichedProfile={enrichedProfile}
        linkedinSummary={summary}
        strengths={strengths}
        concerns={concerns}
      />


      {/* ═══ 2. STATS GRID — 4 cards en 2x2 sm / 4-cols lg ═══ */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3">
        <StatCard
          icon={Phone}
          label="Engagement"
          tone="info"
          primary={aircallStats.count > 0 ? `${aircallStats.count} appel${aircallStats.count > 1 ? 's' : ''}` : 'Aucun appel'}
          secondary={
            aircallStats.count > 0
              ? `${aircallStats.totalMin} min · dernier ${aircallStats.lastDate ? formatDistanceToNow(new Date(aircallStats.lastDate), { addSuffix: true, locale: fr }) : ''}`
              : 'Pas encore contacté par téléphone'
          }
        />
        <StatCard
          icon={FileText}
          label="CV / Documents"
          tone="brand"
          primary={
            cvLoading ? '…' :
            cvs.length === 0 ? 'Aucun CV' :
            cvs.length === 1 ? '1 CV' : `${cvs.length} versions`
          }
          secondary={
            primaryCV
              ? `${primaryCV.fileName.length > 24 ? primaryCV.fileName.slice(0, 24) + '…' : primaryCV.fileName} · ${formatDistanceToNow(new Date(primaryCV.uploadedAt), { addSuffix: true, locale: fr })}`
              : 'Drop un PDF dans l\'onglet CV'
          }
          highlight={cvs.length === 0}
        />
        <StatCard
          icon={GitBranch}
          label="Séquences"
          tone="success"
          primary={
            activeSequences.length === 0 && repliedSequences.length === 0
              ? 'Aucune'
              : activeSequences.length > 0
                ? `${activeSequences.length} active${activeSequences.length > 1 ? 's' : ''}`
                : `${repliedSequences.length} terminée${repliedSequences.length > 1 ? 's' : ''}`
          }
          secondary={(() => {
            if (activeSequences.length === 0 && repliedSequences.length === 0) return 'Pas dans une séquence';
            const parts: string[] = [];
            if (activeSequences.length > 0) parts.push(`${activeSequences.length} en cours`);
            if (repliedSequences.length > 0) parts.push(`${repliedSequences.length} répondu`);
            return parts.join(' · ');
          })()}
        />
        <StatCard
          icon={Bell}
          label="Prochain rappel"
          tone={nextReminder ? 'warning' : 'muted'}
          primary={
            nextReminder
              ? formatDistanceToNow(new Date(nextReminder.due_at), { addSuffix: true, locale: fr })
              : `${reminders.length} rappel${reminders.length > 1 ? 's' : ''}`
          }
          secondary={
            nextReminder
              ? nextReminder.title
              : reminders.length === 0
                ? 'Aucun rappel programmé'
                : 'Tout est traité'
          }
        />
      </div>

      {/* ═══ 3. POSTES — missions où ce candidat apparaît ═══ */}
      {positions.length > 0 && (
        <SectionCard
          icon={Briefcase}
          title="Postes liés"
          eyebrow={`${positions.length} mission${positions.length > 1 ? 's' : ''}`}
        >
          <div className="space-y-1.5">
            {positions.map(pos => (
              <PositionRow key={pos.jobId} position={pos} />
            ))}
          </div>
        </SectionCard>
      )}

      {/* ═══ 4. ACTIVITÉ + À PRÉVOIR — 2 cols ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
        {/* Activité récente */}
        <SectionCard
          icon={History}
          title="Activité récente"
          eyebrow={`${fullProfile.timeline.length} événements · onglet Activité pour tout voir`}
        >
          {recentTimeline.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/70 italic">
              Aucune activité encore enregistrée
            </p>
          ) : (
            <div className="space-y-2">
              {recentTimeline.map((event, i) => (
                <TimelineRow key={i} event={event} />
              ))}
            </div>
          )}
        </SectionCard>

        {/* À prévoir */}
        <SectionCard
          icon={Calendar}
          title="À prévoir"
          eyebrow={
            upcomingActions.length === 0
              ? 'Aucune action programmée'
              : `${upcomingActions.length} action${upcomingActions.length > 1 ? 's' : ''}`
          }
        >
          {upcomingActions.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/70 italic">
              Pas de rappel ni de séquence active
            </p>
          ) : (
            <div className="space-y-2">
              {upcomingActions.slice(0, 4).map((action, i) => (
                <UpcomingActionRow key={i} action={action} />
              ))}
              {upcomingActions.length > 4 && (
                <p className="text-[10.5px] text-muted-foreground/70 italic pl-9">
                  +{upcomingActions.length - 4} autre{upcomingActions.length - 4 > 1 ? 's' : ''}
                </p>
              )}
            </div>
          )}
        </SectionCard>
      </div>

      {/* ═══ 5. ABOUT ═══ */}
      {summary && (
        <SectionCard icon={Sparkles} title="À propos" eyebrow="Résumé LinkedIn">
          <p className="text-[12.5px] leading-relaxed text-foreground/85 whitespace-pre-line line-clamp-6">
            {summary}
          </p>
        </SectionCard>
      )}

      {/* ═══ 6. EXPÉRIENCE RÉCENTE ═══ */}
      {(enrichedProfile?.experiences?.length || 0) > 0 && (
        <SectionCard
          icon={Briefcase}
          title="Expérience récente"
          eyebrow={`${enrichedProfile?.experiences?.length || 0} positions`}
        >
          <div className="space-y-2.5">
            {enrichedProfile!.experiences.slice(0, 2).map((exp, i) => (
              <ExperienceRow key={i} exp={exp} />
            ))}
            {(enrichedProfile!.experiences.length || 0) > 2 && (
              <p className="text-[11px] text-muted-foreground/70 italic pl-9">
                +{enrichedProfile!.experiences.length - 2} autres positions — voir Profil
              </p>
            )}
          </div>
        </SectionCard>
      )}

      {/* ═══ 7. EDUCATION ═══ */}
      {enrichedProfile?.education?.[0]?.school && (
        <SectionCard
          icon={GraduationCap}
          title="Formation"
          eyebrow={`${enrichedProfile.education.length} école${enrichedProfile.education.length > 1 ? 's' : ''}`}
        >
          <EducationRow edu={enrichedProfile.education[0]} />
        </SectionCard>
      )}

      {/* ═══ 8. SKILLS + LANGUAGES ═══ */}
      {((enrichedProfile?.skills?.length || 0) > 0 || (enrichedProfile?.languages?.length || 0) > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 sm:gap-3">
          {(enrichedProfile?.skills?.length || 0) > 0 && (
            <SectionCard icon={Award} title="Compétences" eyebrow={`${enrichedProfile!.skills.length} skills`}>
              <div className="flex flex-wrap gap-1.5">
                {enrichedProfile!.skills.slice(0, 12).map((skill, i) => (
                  <span key={i} className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-foreground/[0.06] text-foreground/85 border border-border">
                    {skill}
                  </span>
                ))}
                {enrichedProfile!.skills.length > 12 && (
                  <span className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full text-muted-foreground border border-border bg-muted/30">
                    +{enrichedProfile!.skills.length - 12}
                  </span>
                )}
              </div>
            </SectionCard>
          )}
          {(enrichedProfile?.languages?.length || 0) > 0 && (
            <SectionCard icon={Languages} title="Langues">
              <div className="flex flex-wrap gap-1.5">
                {enrichedProfile!.languages.map((lang, i) => (
                  <span key={i} className="inline-flex items-center text-[11px] px-2 py-0.5 rounded-full bg-info/10 text-info border border-info/30">
                    {lang}
                  </span>
                ))}
              </div>
            </SectionCard>
          )}
        </div>
      )}

      {/* ═══ 9. NOTES PREVIEW ═══ */}
      {notes.length > 0 && (
        <SectionCard
          icon={StickyNote}
          title="Dernières notes"
          eyebrow={`${notes.length} note${notes.length > 1 ? 's' : ''} · voir tout dans Notes`}
        >
          <div className="space-y-2">
            {notes.slice(0, 2).map(note => (
              <div key={note.id} className="rounded-lg bg-muted/20 border border-border/60 px-3 py-2">
                <p className="text-[12px] leading-relaxed text-foreground/85 line-clamp-3">{note.content}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {formatDistanceToNow(new Date(note.created_at), { addSuffix: true, locale: fr })}
                </p>
              </div>
            ))}
            {notes.length > 2 && (
              <p className="text-[11px] text-muted-foreground/70 italic">
                +{notes.length - 2} autre{notes.length - 2 > 1 ? 's' : ''}
              </p>
            )}
          </div>
        </SectionCard>
      )}
    </div>
  );
};

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

interface Alert {
  /** Identifiant unique pour persistance dismissal en DB. */
  key: AlertKey;
  severity: 'critical' | 'warning' | 'info';
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  detail: string;
}

function AlertsPanel({
  alerts,
  onDismiss,
}: {
  alerts: Alert[];
  onDismiss: (key: AlertKey) => void;
}) {
  // Ordre par sévérité
  const sorted = [...alerts].sort((a, b) => {
    const order = { critical: 0, warning: 1, info: 2 };
    return order[a.severity] - order[b.severity];
  });

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25 }}
      className="rounded-xl border border-border bg-card overflow-hidden"
    >
      <div className="px-3 sm:px-4 py-2 border-b border-border bg-muted/20">
        <div className="flex items-center gap-2">
          <AlertCircle className="w-3.5 h-3.5 text-warning" />
          <span className="text-[10px] uppercase tracking-wider font-bold text-foreground/70">
            À traiter
          </span>
          <span className="text-[10px] tabular-nums px-1.5 py-0.5 rounded-full bg-warning/15 text-warning font-bold">
            {alerts.length}
          </span>
        </div>
      </div>
      <div className="divide-y divide-border/60">
        {sorted.map(alert => (
          <AlertRow key={alert.key} alert={alert} onDismiss={() => onDismiss(alert.key)} />
        ))}
      </div>
    </motion.div>
  );
}

function AlertRow({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  const Icon = alert.icon;
  const severityStyles = {
    critical: { tile: 'bg-destructive/10 text-destructive', dot: 'bg-destructive' },
    warning: { tile: 'bg-warning/10 text-warning', dot: 'bg-warning' },
    info: { tile: 'bg-info/10 text-info', dot: 'bg-info' },
  }[alert.severity];

  return (
    <div className="flex items-start gap-2.5 px-3 sm:px-4 py-2.5 group">
      <div className={cn('h-7 w-7 rounded-lg grid place-items-center shrink-0', severityStyles.tile)}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-foreground leading-tight flex items-center gap-1.5">
          <span className={cn('inline-block h-1.5 w-1.5 rounded-full shrink-0', severityStyles.dot)} />
          {alert.title}
        </p>
        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug">
          {alert.detail}
        </p>
      </div>
      {/* Bouton "✓ Traité" — persiste le dismiss en DB.
          Visible au hover ou tap mobile pour pas polluer l'UI. */}
      <button
        type="button"
        onClick={onDismiss}
        className="shrink-0 inline-flex items-center gap-1 h-6 px-2 rounded-full text-[10.5px] font-semibold border border-border bg-background hover:bg-success/10 hover:text-success hover:border-success/30 transition-all sm:opacity-0 sm:group-hover:opacity-100 focus-visible:opacity-100"
        aria-label="Marquer cette alerte comme traitée"
      >
        <Check className="w-3 h-3" />
        Traité
      </button>
    </div>
  );
}

/**
 * ProfileSummaryCard — synthèse candidat-level (PAS job-fit).
 *
 * Pourquoi : un candidat peut être shortlisté sur plusieurs missions
 * en parallèle. Mentionner "bon profil pour ce poste" est trompeur car
 * "ce poste" change selon la mission depuis laquelle on ouvre la modale.
 *
 * Cette card affiche donc :
 *   - Synthèse en 1 paragraphe : qui est cette personne (rôle, années
 *     XP, stack principale) — soit depuis le summary LinkedIn, soit
 *     auto-généré depuis les facts
 *   - Points forts génériques (du profil, pas du fit)
 *   - Points d'attention génériques
 *
 * Pas de score ici (il est dans le badge header + Postes liés). Pas de
 * mention de "ce poste" / "cette mission" / nom de client.
 */
function ProfileSummaryCard({
  candidate, enrichedProfile, linkedinSummary, strengths, concerns,
}: {
  candidate: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
  linkedinSummary?: string;
  strengths?: string[];
  concerns?: string[];
}) {
  // Synthèse 1-paragraphe : ordre de priorité
  //   1. Résumé LinkedIn (s'il existe — c'est ce que le candidat dit
  //      lui-même, neutre par construction)
  //   2. Auto-généré depuis facts (rôle + entreprise + années XP)
  //   3. Headline simple
  const synthesis = (() => {
    if (linkedinSummary && linkedinSummary.trim().length > 30) {
      return linkedinSummary.trim();
    }
    const role = enrichedProfile?.currentRole;
    const company = enrichedProfile?.currentCompany;
    const years = enrichedProfile?.yearsOfExperience;
    const skills = enrichedProfile?.skills?.slice(0, 4) || [];
    const parts: string[] = [];
    if (role) parts.push(`${role}${company ? ` chez ${company}` : ''}`);
    else if (candidate.headline) parts.push(candidate.headline);
    if (years && years >= 1) parts.push(`${years} an${years > 1 ? 's' : ''} d'expérience`);
    if (skills.length > 0) parts.push(`stack : ${skills.join(', ')}`);
    return parts.length > 0 ? parts.join(' · ') : null;
  })();

  // Si on n'a strictement rien (ni summary, ni xp, ni rôle), on n'affiche
  // simplement pas la card — éviter une carte vide bizarre.
  if (!synthesis && (strengths?.length ?? 0) === 0 && (concerns?.length ?? 0) === 0) {
    return null;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="rounded-xl border border-border bg-card p-4 sm:p-5"
    >
      <div className="flex items-start gap-3">
        <div className="h-9 w-9 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
          <Sparkles className="w-4 h-4 text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground">
            Résumé du profil
          </p>
          <h3 className="font-display font-bold text-[15px] sm:text-[16px] tracking-tight text-foreground leading-tight mt-0.5">
            {candidate.name}
          </h3>
        </div>
      </div>

      {synthesis && (
        <p className="text-[13px] leading-relaxed text-foreground/85 mt-3 whitespace-pre-line line-clamp-5">
          {synthesis}
        </p>
      )}

      {((strengths?.length ?? 0) > 0 || (concerns?.length ?? 0) > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 pt-3 border-t border-border/60">
          {(strengths?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-success mb-1.5">
                ✓ À retenir
              </p>
              <ul className="space-y-1">
                {strengths!.slice(0, 4).map((s, i) => (
                  <li key={i} className="text-[12px] text-foreground/85 leading-snug pl-1">
                    • {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(concerns?.length ?? 0) > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider font-bold text-warning mb-1.5">
                ⚠ Points d'attention
              </p>
              <ul className="space-y-1">
                {concerns!.slice(0, 4).map((s, i) => (
                  <li key={i} className="text-[12px] text-foreground/85 leading-snug pl-1">
                    • {s}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

function StatCard({
  icon: Icon, label, primary, secondary, tone, highlight,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  primary: string;
  secondary?: string;
  tone: 'info' | 'success' | 'warning' | 'brand' | 'muted';
  highlight?: boolean;
}) {
  const toneStyles = {
    info: { iconBg: 'bg-info/10', iconText: 'text-info' },
    success: { iconBg: 'bg-success/10', iconText: 'text-success' },
    warning: { iconBg: 'bg-warning/10', iconText: 'text-warning' },
    brand: { iconBg: 'bg-brand-purple/10', iconText: 'text-brand-purple' },
    muted: { iconBg: 'bg-emerald-500/15', iconText: 'text-foreground' },
  }[tone];

  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className={cn(
        'rounded-xl border p-3 transition-all',
        highlight
          ? 'border-dashed border-foreground/30 bg-muted/10 hover:bg-muted/20'
          : 'border-border bg-card hover:bg-muted/20',
      )}
    >
      <div className="flex items-center gap-2 mb-1.5">
        <div className={cn('h-7 w-7 rounded-lg grid place-items-center shrink-0', toneStyles.iconBg)}>
          <Icon className={cn('w-3.5 h-3.5', toneStyles.iconText)} />
        </div>
        <span className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground truncate">
          {label}
        </span>
      </div>
      <p className="font-display text-[15px] font-bold text-foreground tracking-tight leading-tight tabular-nums">
        {primary}
      </p>
      {secondary && (
        <p className="text-[10.5px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">{secondary}</p>
      )}
    </motion.div>
  );
}

function SectionCard({
  icon: Icon, title, eyebrow, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
      <div className="flex items-center gap-2 mb-2.5">
        <div className="h-7 w-7 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
          <Icon className="w-3.5 h-3.5 text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-[13px] tracking-tight text-foreground">{title}</h3>
          {eyebrow && (
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/70">
              {eyebrow}
            </p>
          )}
        </div>
      </div>
      {children}
    </div>
  );
}

function PositionRow({ position }: { position: { jobId: string; jobTitle: string; score: number | null; stage: string | null; recommendation: string | null; lastUpdate: string | null } }) {
  const scoreTone =
    position.score == null ? null :
    position.score >= 70 ? 'text-success border-success/30 bg-success/10' :
    position.score >= 50 ? 'text-warning border-warning/30 bg-warning/10' :
    'text-destructive border-destructive/30 bg-destructive/10';

  return (
    <div className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg bg-muted/15 border border-border/50 hover:bg-muted/30 transition-colors">
      <div className="h-7 w-7 rounded-md bg-emerald-500/15 grid place-items-center shrink-0">
        <Briefcase className="w-3.5 h-3.5 text-foreground" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-foreground truncate leading-tight">
          {position.jobTitle}
        </p>
        <div className="flex items-center gap-2 mt-0.5">
          {position.stage && (
            <span className="text-[10px] text-muted-foreground">
              <Target className="w-2.5 h-2.5 inline mr-0.5" />
              {position.stage}
            </span>
          )}
          {position.lastUpdate && (
            <span className="text-[10px] text-muted-foreground">
              · {formatDistanceToNow(new Date(position.lastUpdate), { addSuffix: true, locale: fr })}
            </span>
          )}
        </div>
      </div>
      {position.score != null && scoreTone && (
        <span className={cn('inline-flex items-center text-[11px] px-1.5 py-0.5 rounded-full border font-bold tabular-nums shrink-0', scoreTone)}>
          {position.score}
        </span>
      )}
    </div>
  );
}

function TimelineRow({ event }: { event: { type: string; title: string; detail?: string; date: string } }) {
  const date = event.date ? new Date(event.date) : null;
  return (
    <div className="flex items-start gap-2.5 text-[12px]">
      <div className="h-5 w-5 rounded-full bg-foreground/[0.06] grid place-items-center shrink-0 mt-0.5">
        <span className="h-1.5 w-1.5 rounded-full bg-foreground/40" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-foreground/85 leading-snug">{event.title}</p>
        {event.detail && (
          <p className="text-[10.5px] text-muted-foreground/70 mt-0.5 line-clamp-1">{event.detail}</p>
        )}
        {date && (
          <p className="text-[10px] text-muted-foreground/60 mt-0.5">
            {formatDistanceToNow(date, { addSuffix: true, locale: fr })}
          </p>
        )}
      </div>
    </div>
  );
}

function UpcomingActionRow({ action }: { action: { type: 'reminder' | 'sequence_step'; title: string; detail: string; date: string; icon: React.ComponentType<{ className?: string }> } }) {
  const Icon = action.icon;
  return (
    <div className="flex items-start gap-2.5">
      <div className={cn(
        'h-7 w-7 rounded-lg grid place-items-center shrink-0',
        action.type === 'reminder' ? 'bg-warning/10 text-warning' : 'bg-success/10 text-success'
      )}>
        <Icon className="w-3.5 h-3.5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-foreground truncate leading-tight">
          {action.title}
        </p>
        {action.detail && (
          <p className="text-[10.5px] text-muted-foreground line-clamp-1 mt-0.5">{action.detail}</p>
        )}
        <p className="text-[10px] text-muted-foreground/70 mt-0.5">
          {action.type === 'reminder'
            ? formatDistanceToNow(new Date(action.date), { addSuffix: true, locale: fr })
            : `Inscrit ${formatDistanceToNow(new Date(action.date), { addSuffix: true, locale: fr })}`}
        </p>
      </div>
    </div>
  );
}

function ExperienceRow({
  exp,
}: {
  exp: { title: string; company: string; logo?: string; startDate?: string; endDate?: string; isCurrent?: boolean };
}) {
  return (
    <div className="flex items-start gap-2.5">
      {exp.logo ? (
        <img src={exp.logo} alt="" className="w-8 h-8 rounded-lg object-contain bg-card border border-border shrink-0" />
      ) : (
        <div className="h-8 w-8 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
          <Building2 className="w-3.5 h-3.5 text-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[12.5px] font-semibold text-foreground truncate leading-tight">
          {exp.title || 'Poste'}
        </p>
        <p className="text-[11.5px] text-muted-foreground truncate">{exp.company || '—'}</p>
        <p className="text-[10.5px] text-muted-foreground/70 tabular-nums mt-0.5">
          {exp.startDate || '?'} — {exp.isCurrent ? 'Actuel' : (exp.endDate || '?')}
        </p>
      </div>
    </div>
  );
}

function EducationRow({
  edu,
}: {
  edu: { school: string; logo?: string; degree?: string; field?: string; startYear?: string; endYear?: string };
}) {
  return (
    <div className="flex items-start gap-2.5">
      {edu.logo ? (
        <img src={edu.logo} alt="" className="w-9 h-9 rounded-lg object-contain bg-card border border-border shrink-0" />
      ) : (
        <div className="h-9 w-9 rounded-lg bg-emerald-500/15 grid place-items-center shrink-0">
          <GraduationCap className="w-4 h-4 text-foreground" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <p className="text-[13px] font-semibold text-foreground truncate">{edu.school}</p>
        {(edu.degree || edu.field) && (
          <p className="text-[11.5px] text-muted-foreground truncate">
            {[edu.degree, edu.field].filter(Boolean).join(' · ')}
          </p>
        )}
        {(edu.startYear || edu.endYear) && (
          <p className="text-[10.5px] text-muted-foreground/70 tabular-nums mt-0.5">
            {edu.startYear || '?'} — {edu.endYear || 'en cours'}
          </p>
        )}
      </div>
    </div>
  );
}
