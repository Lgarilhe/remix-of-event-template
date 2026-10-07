/**
 * OverviewTab : le premier onglet de la fiche, ce qui compte sur ce candidat
 * d'un coup d'œil. Design simplifié (docs/design/06-simplicite.md) : des
 * sections séparées par un filet, sans cadre ; une ligne n'existe que si elle
 * a quelque chose à dire (pas de « Aucun appel » ni de « 0 rappel »).
 *
 * Sections, de haut en bas :
 *   1. À traiter       stagnation, réponse sans suite, données manquantes
 *   2. Résumé          qui est cette personne (jamais le fit d'une mission)
 *   3. Repères         appels, CV, séquences, prochain rappel (s'il y en a)
 *   4. Postes liés     les missions où ce candidat apparaît, avec la note
 *   5. Activité récente et À prévoir
 *   6. À propos, expérience, formation, compétences, langues, dernières notes
 */

import React, { useEffect, useMemo, useState } from 'react';
import {
  Target, Bell, GraduationCap, Building2, Clock, GitBranch,
  MailWarning, PhoneOff, FileQuestion, Check,
} from 'lucide-react';
import { formatDistanceToNow, differenceInDays, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { ATSCandidate, ATS_STAGES, STAGNATION_DAYS, stagnantDays } from '@/hooks/useATSData';
import { atsColumnTitle, candidateColumnKey } from '@/lib/stageDisplay';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { CandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { listCVs, CandidateCV } from '@/lib/cvStorage';
import { listDismissedAlerts, dismissAlert, type AlertKey } from '@/lib/candidateAlerts';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';
import { ScorePill } from '@/components/missions/v3/pipeline/CandidateListRow';
import { REVEAL_ON_ROW } from '@/components/missions/v3/cadrage/sectionUi';

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

// Étapes « sans mouvement » : les délais sont ceux de la carte du /pipeline
// (STAGNATION_DAYS, une seule table). Pas de délai pour À trier ni Retenu :
// plan 0c, section 6.4, comme le kanban de mission.

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

    // 1. Stagnation : combien de jours dans cette étape ? Depuis l'entrée dans
    //    l'étape (lot 0c-4), à défaut depuis la dernière action. Même délai que la carte.
    const stageKey = candidateColumnKey(candidate);
    const daysIdle = stagnantDays({ ...candidate, stage: stageKey });
    if (daysIdle !== null) {
      const threshold = STAGNATION_DAYS[stageKey];
      result.push({
        key: 'stagnation',
        severity: daysIdle >= threshold * 2 ? 'critical' : 'warning',
        icon: Clock,
        // Sans date d'entrée dans l'étape (séquence ou InMail), le délai part de la dernière action.
        title: candidate.stageEnteredAt
          ? `Stagnation : ${daysIdle} jours à l'étape « ${atsColumnTitle(stageKey)} »`
          : `Stagnation : aucune action depuis ${daysIdle} jours (étape « ${atsColumnTitle(stageKey)} »)`,
        detail: `Au-delà de ${threshold}\u00a0j dans cette étape\u00a0: il faut faire bouger ou archiver.`,
      });
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
          title: `Répondu il y a ${daysSinceReply}\u00a0j, sans réponse de votre part`,
          detail: `Sur la séquence "${repliedEnrollment.sequenceName}". Reprenez la conversation.`,
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
        detail: 'Enrichissez le profil ou demandez les informations directement au candidat.',
      });
    }

    // 4. Pas de score IA
    if ((candidate.score ?? 0) === 0 && fullProfile.scoringHistory.length === 0) {
      result.push({
        key: 'no_score',
        severity: 'info',
        icon: Target,
        title: 'Pas encore scoré par l\'IA',
        detail: 'Évaluez le candidat depuis la mission pour obtenir une recommandation.',
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
          detail: `Sur "${activeNotConnected.sequenceName}". Passez à un InMail ou archivez.`,
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
        // Étape de la mission ouverte : celle de la colonne. Les autres missions n'ont que
        // pipeline_stage, qui n'est une colonne que pour certaines étapes (À trier, Retenu,
        // Contacté, Écarté le laissent vide, une étape d'entretien y met son identifiant) :
        // une valeur qui n'est pas une colonne se masque, jamais une clé brute.
        stage: sr.jobId === candidate.jobId
          ? candidateColumnKey(candidate)
          : ATS_STAGES.some(st => st.key === sr.pipelineStage) ? sr.pipelineStage : null,
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
        stage: candidateColumnKey(candidate),
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

  // ─── Repères : seulement ce qui existe ──────────────────────────
  const facts: { label: string; value: string }[] = [];
  if (aircallStats.count > 0) {
    facts.push({
      label: 'Appels',
      value: [
        `${aircallStats.count} appel${aircallStats.count > 1 ? 's' : ''}`,
        `${aircallStats.totalMin} min`,
        aircallStats.lastDate ? `dernier ${formatDistanceToNow(new Date(aircallStats.lastDate), { addSuffix: true, locale: fr })}` : null,
      ].filter(Boolean).join(' · '),
    });
  }
  if (primaryCV) {
    facts.push({
      label: 'CV',
      value: [
        cvs.length > 1 ? `${cvs.length} versions` : null,
        primaryCV.fileName,
        formatDistanceToNow(new Date(primaryCV.uploadedAt), { addSuffix: true, locale: fr }),
      ].filter(Boolean).join(' · '),
    });
  }
  if (activeSequences.length > 0 || repliedSequences.length > 0) {
    facts.push({
      label: 'Séquences',
      value: [
        activeSequences.length > 0 ? `${activeSequences.length} en cours` : null,
        repliedSequences.length > 0 ? `${repliedSequences.length} avec réponse` : null,
      ].filter(Boolean).join(' · '),
    });
  }
  if (nextReminder) {
    facts.push({
      label: 'Prochain rappel',
      value: `${nextReminder.title} · ${formatDistanceToNow(new Date(nextReminder.due_at), { addSuffix: true, locale: fr })}`,
    });
  }

  // Le résumé affiche déjà le texte LinkedIn quand il est assez long : pas de second « À propos » identique.
  const summaryShownAbove = !!summary && summary.trim().length > 30;

  return (
    <div className="space-y-8">
      {/* ═══ 1. À TRAITER ═══ */}
      {alerts.length > 0 && <AlertsPanel alerts={alerts} onDismiss={handleDismissAlert} />}

      {/* ═══ 2. RÉSUMÉ DU PROFIL, qui est cette personne (pas le fit d'une mission) ═══
          Un candidat peut être retenu sur plusieurs missions à la fois : ce
          texte ne parle jamais d'un poste précis. */}
      <ProfileSummary
        candidate={candidate}
        enrichedProfile={enrichedProfile}
        linkedinSummary={summary}
        strengths={strengths}
        concerns={concerns}
      />

      {/* ═══ 3. REPÈRES ═══ */}
      {facts.length > 0 && (
        <dl className="divide-y divide-border border-y border-border">
          {facts.map(fact => (
            <div key={fact.label} className="flex items-baseline gap-4 py-2.5">
              <dt className="w-32 shrink-0 text-sm text-muted-foreground">{fact.label}</dt>
              <dd className="min-w-0 flex-1 text-sm text-foreground">{fact.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* ═══ 4. POSTES, les missions où ce candidat apparaît ═══ */}
      {positions.length > 0 && (
        <Section
          title="Postes liés"
          hint={`${positions.length} mission${positions.length > 1 ? 's' : ''}`}
        >
          <ul className="divide-y divide-border">
            {positions.map(pos => (
              <PositionRow key={pos.jobId} position={pos} />
            ))}
          </ul>
        </Section>
      )}

      {/* ═══ 5. ACTIVITÉ ET À PRÉVOIR ═══ */}
      {recentTimeline.length > 0 && (
        <Section
          title="Activité récente"
          hint={fullProfile.timeline.length > recentTimeline.length ? 'Les autres événements sont dans l\'onglet Activité' : undefined}
        >
          <ul className="space-y-3">
            {recentTimeline.map((event, i) => (
              <TimelineRow key={i} event={event} />
            ))}
          </ul>
        </Section>
      )}

      {upcomingActions.length > 0 && (
        <Section title="À prévoir">
          <ul className="space-y-3">
            {upcomingActions.slice(0, 4).map((action, i) => (
              <UpcomingActionRow key={i} action={action} />
            ))}
          </ul>
          {upcomingActions.length > 4 && (
            <p className="mt-3 text-sm text-muted-foreground">
              + {upcomingActions.length - 4} autre{upcomingActions.length - 4 > 1 ? 's' : ''}
            </p>
          )}
        </Section>
      )}

      {/* ═══ 6. À PROPOS, quand le résumé n'a pas déjà repris le texte LinkedIn ═══ */}
      {summary && !summaryShownAbove && (
        <Section title="À propos">
          <p className="line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
            {summary}
          </p>
        </Section>
      )}

      {/* ═══ 7. EXPÉRIENCE RÉCENTE ═══ */}
      {(enrichedProfile?.experiences?.length || 0) > 0 && (
        <Section
          title="Expérience récente"
          hint={`${enrichedProfile?.experiences?.length || 0} poste${(enrichedProfile?.experiences?.length || 0) > 1 ? 's' : ''}`}
        >
          <ul className="space-y-3">
            {enrichedProfile!.experiences.slice(0, 2).map((exp, i) => (
              <ExperienceRow key={i} exp={exp} />
            ))}
          </ul>
          {(enrichedProfile!.experiences.length || 0) > 2 && (
            <p className="mt-3 text-sm text-muted-foreground">
              + {enrichedProfile!.experiences.length - 2} autre{enrichedProfile!.experiences.length - 2 > 1 ? 's' : ''} dans l'onglet Profil
            </p>
          )}
        </Section>
      )}

      {/* ═══ 8. FORMATION ═══ */}
      {enrichedProfile?.education?.[0]?.school && (
        <Section title="Formation">
          <EducationRow edu={enrichedProfile.education[0]} />
        </Section>
      )}

      {/* ═══ 9. COMPÉTENCES ET LANGUES ═══ */}
      {(enrichedProfile?.skills?.length || 0) > 0 && (
        <Section title="Compétences">
          <div className="flex flex-wrap gap-1.5">
            {enrichedProfile!.skills.slice(0, 12).map((skill, i) => (
              <Badge key={i} variant="muted">{skill}</Badge>
            ))}
            {enrichedProfile!.skills.length > 12 && (
              <Badge variant="outline">+ {enrichedProfile!.skills.length - 12}</Badge>
            )}
          </div>
        </Section>
      )}
      {(enrichedProfile?.languages?.length || 0) > 0 && (
        <Section title="Langues">
          <div className="flex flex-wrap gap-1.5">
            {enrichedProfile!.languages.map((lang, i) => (
              <Badge key={i} variant="muted">{lang}</Badge>
            ))}
          </div>
        </Section>
      )}

      {/* ═══ 10. DERNIÈRES NOTES ═══ */}
      {notes.length > 0 && (
        <Section
          title="Dernières notes"
          hint={notes.length > 2 ? `${notes.length} notes, toutes dans l'onglet Notes` : undefined}
        >
          <ul className="divide-y divide-border">
            {notes.slice(0, 2).map(note => (
              <li key={note.id} className="py-3 first:pt-0">
                <p className="line-clamp-3 whitespace-pre-wrap text-sm leading-relaxed text-foreground">{note.content}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(note.created_at), { addSuffix: true, locale: fr })}
                </p>
              </li>
            ))}
          </ul>
        </Section>
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

/** Une section : un filet au-dessus, un titre, une ligne d'aide au besoin. */
function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border pt-6">
      <h3 className="text-md font-semibold text-foreground">{title}</h3>
      {hint && <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
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
    <section aria-label="À traiter">
      <h3 className="eyebrow mb-2">À traiter</h3>
      <ul className="divide-y divide-border border-y border-border">
        {sorted.map(alert => (
          <AlertRow key={alert.key} alert={alert} onDismiss={() => onDismiss(alert.key)} />
        ))}
      </ul>
    </section>
  );
}

function AlertRow({ alert, onDismiss }: { alert: Alert; onDismiss: () => void }) {
  // La couleur dit l'urgence : rouge en retard, orange à surveiller, neutre sinon.
  const tone = { critical: 'destructive', warning: 'warning', info: 'default' }[alert.severity] as 'destructive' | 'warning' | 'default';

  return (
    <li className="group flex items-start gap-3 py-3">
      <IconTile tone={tone} size="md" className="rounded-full">
        <alert.icon className="h-4 w-4" aria-hidden="true" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{alert.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{alert.detail}</p>
      </div>
      {/* « Traité » persiste en base ; visible au survol, au focus ou au toucher. */}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onDismiss}
        aria-label={`Marquer comme traité : ${alert.title}`}
        className={cn('shrink-0 hover:bg-success-muted hover:text-success', REVEAL_ON_ROW)}
      >
        <Check aria-hidden="true" />
        Traité
      </Button>
    </li>
  );
}

/**
 * ProfileSummary : synthèse à l'échelle du candidat, pas du poste.
 *
 * Un candidat peut être retenu sur plusieurs missions en parallèle ; dire
 * « bon profil pour ce poste » serait trompeur, car « ce poste » change selon
 * la mission d'où la fiche est ouverte. Le texte vient, dans l'ordre : du
 * résumé LinkedIn (ce que la personne dit d'elle-même), des faits (rôle,
 * entreprise, années d'expérience), de l'intitulé. Rien du tout : pas de
 * section.
 */
function ProfileSummary({
  candidate, enrichedProfile, linkedinSummary, strengths, concerns,
}: {
  candidate: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
  linkedinSummary?: string;
  strengths?: string[];
  concerns?: string[];
}) {
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

  if (!synthesis && (strengths?.length ?? 0) === 0 && (concerns?.length ?? 0) === 0) {
    return null;
  }

  return (
    <section aria-label="Résumé du profil">
      <h3 className="text-md font-semibold text-foreground">Résumé du profil</h3>

      {synthesis && (
        <p className="mt-2 line-clamp-6 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">
          {synthesis}
        </p>
      )}

      {((strengths?.length ?? 0) > 0 || (concerns?.length ?? 0) > 0) && (
        <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(strengths?.length ?? 0) > 0 && (
            <div>
              <p className="text-sm font-medium text-success">À retenir</p>
              <ul className="mt-1.5 space-y-1">
                {strengths!.slice(0, 4).map((item, i) => (
                  <li key={i} className="text-sm leading-snug text-foreground-secondary">{item}</li>
                ))}
              </ul>
            </div>
          )}
          {(concerns?.length ?? 0) > 0 && (
            <div>
              <p className="text-sm font-medium text-warning">Points d'attention</p>
              <ul className="mt-1.5 space-y-1">
                {concerns!.slice(0, 4).map((item, i) => (
                  <li key={i} className="text-sm leading-snug text-foreground-secondary">{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

const RAW_JOB_ID = /^(project:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function PositionRow({ position }: { position: { jobId: string; jobTitle: string; score: number | null; stage: string | null; recommendation: string | null; lastUpdate: string | null } }) {
  return (
    <li className="flex items-center gap-3 py-3 first:pt-0">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">
          {RAW_JOB_ID.test(position.jobTitle) ? 'Mission sans titre' : position.jobTitle}
        </p>
        {(position.stage || position.lastUpdate) && (
          <p className="mt-0.5 text-sm text-muted-foreground">
            {position.stage && <span>{atsColumnTitle(position.stage)}</span>}
            {position.stage && position.lastUpdate && ' · '}
            {position.lastUpdate && formatDistanceToNow(new Date(position.lastUpdate), { addSuffix: true, locale: fr })}
          </p>
        )}
      </div>
      {position.score != null && position.score > 0 && <ScorePill score={position.score} />}
    </li>
  );
}

function TimelineRow({ event }: { event: { type: string; title: string; detail?: string; date: string } }) {
  const date = event.date ? new Date(event.date) : null;
  return (
    <li className="flex items-start gap-3">
      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm text-foreground">{event.title}</p>
        {event.detail && <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{event.detail}</p>}
      </div>
      {date && (
        <time dateTime={event.date} className="shrink-0 text-xs text-muted-foreground">
          {formatDistanceToNow(date, { addSuffix: true, locale: fr })}
        </time>
      )}
    </li>
  );
}

function UpcomingActionRow({ action }: { action: { type: 'reminder' | 'sequence_step'; title: string; detail: string; date: string; icon: React.ComponentType<{ className?: string }> } }) {
  return (
    <li className="flex items-start gap-3">
      <IconTile size="sm" className="rounded-full">
        <action.icon className="h-3.5 w-3.5" aria-hidden="true" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{action.title}</p>
        {action.detail && <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{action.detail}</p>}
        <p className="mt-0.5 text-xs text-muted-foreground">
          {action.type === 'reminder'
            ? formatDistanceToNow(new Date(action.date), { addSuffix: true, locale: fr })
            : `Inscrit ${formatDistanceToNow(new Date(action.date), { addSuffix: true, locale: fr })}`}
        </p>
      </div>
    </li>
  );
}

function ExperienceRow({
  exp,
}: {
  exp: { title: string; company: string; logo?: string; startDate?: string; endDate?: string; isCurrent?: boolean };
}) {
  return (
    <li className="flex items-start gap-3">
      {exp.logo ? (
        <img src={exp.logo} alt="" className="h-9 w-9 shrink-0 rounded-lg border border-border bg-background object-contain p-0.5" />
      ) : (
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
          <Building2 className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{exp.title || 'Poste'}</p>
        {exp.company && <p className="truncate text-sm text-foreground-secondary">{exp.company}</p>}
        <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
          {exp.startDate || '?'} à {exp.isCurrent ? 'aujourd\'hui' : (exp.endDate || '?')}
        </p>
      </div>
    </li>
  );
}

function EducationRow({
  edu,
}: {
  edu: { school: string; logo?: string; degree?: string; field?: string; startYear?: string; endYear?: string };
}) {
  return (
    <div className="flex items-start gap-3">
      {edu.logo ? (
        <img src={edu.logo} alt="" className="h-9 w-9 shrink-0 rounded-lg border border-border bg-background object-contain p-0.5" />
      ) : (
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
          <GraduationCap className="h-4 w-4" aria-hidden="true" />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{edu.school}</p>
        {(edu.degree || edu.field) && (
          <p className="truncate text-sm text-foreground-secondary">
            {[edu.degree, edu.field].filter(Boolean).join(' · ')}
          </p>
        )}
        {(edu.startYear || edu.endYear) && (
          <p className="mt-0.5 text-sm tabular-nums text-muted-foreground">
            {edu.startYear || '?'} à {edu.endYear || 'en cours'}
          </p>
        )}
      </div>
    </div>
  );
}
