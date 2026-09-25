import React, { useState, useMemo, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Users,
  GitBranch,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  CalendarClock,
  Loader2,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LinkedInProfile } from './types';
import { EnrollmentPreviewModal } from './EnrollmentPreviewModal';
import { checkProfilesCompat, pickFirstStep, type CompatIssue } from '@/lib/sequenceCompatibility';
import { SendingAccountNotice } from './enrollment-preview/SendingAccountNotice';
import { useSendingAccount } from './enrollment-preview/useSendingAccount';
import { enrollmentRowFields } from './enrollment-preview/enrollmentRowFields';
import {
  alreadyInSequenceLabel,
  alreadyPassedLabel,
  classifyExistingEnrollment,
  DUPLICATE_CHECK_FAILED_MESSAGE,
  firstActionSummary,
  markCandidatesMessaged,
  NO_LINKEDIN_ACCOUNT_DESCRIPTION,
  NO_LINKEDIN_ACCOUNT_TITLE,
  SEQUENCES_PLAN_REQUIRED_MESSAGE,
  sequenceInactiveReason,
} from './enrollment-preview/enrollmentHelpers';
import {
  findRecentEnrollments,
  formatRecentContactLabel,
  RECENT_CONTACT_WINDOW_DAYS,
  type RecentEnrollment,
} from '@/lib/enrollmentDuplicates';
import { useOrganization } from '@/hooks/useOrganization';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { hasPlanFeature } from '@/lib/featureGates';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';

interface SequenceEnrollModalProps {
  isOpen: boolean;
  onClose: () => void;
  sequence: {
    id: string;
    name: string;
    steps: any[];
  };
  profiles: LinkedInProfile[];
  accountId: string;
  job?: {
    id: string;
    title: string;
    client?: any;
    skills?: string[];
    description?: string;
    location?: string;
    accompagnement?: string[];
  } | null;
  /** Avertissement propre au point d'entrée (ex. relation LinkedIn non vérifiée depuis la messagerie). */
  notice?: string | null;
  onSuccess: () => void;
}

const MESSAGE_ACTION_TYPES = ['message', 'inmail', 'smart_message', 'email', 'connection_request', 'whatsapp_message'];

interface EnrollResults {
  success: number;
  /** Déjà dans la séquence (en cours ou en pause). */
  skipped: number;
  /** Déjà passés par la séquence (terminée, réponse, arrêtée) : à reprendre depuis le suivi. */
  alreadyPassed: number;
  errors: string[];
}

/** Raison d'exclusion affichée sur un candidat grisé de la liste. */
function compatExclusionLabel(issue: CompatIssue): string {
  return issue === 'too_far' ? 'Hors réseau, exclu' : 'Déjà en relation, exclu';
}

export const SequenceEnrollModal: React.FC<SequenceEnrollModalProps> = ({
  isOpen,
  onClose,
  sequence,
  profiles,
  accountId,
  job,
  notice,
  onSuccess,
}) => {
  const [isEnrolling, setIsEnrolling] = useState(false);
  const [results, setResults] = useState<EnrollResults | null>(null);
  const [excludeIncompatible, setExcludeIncompatible] = useState(true);
  // Anti-doublon organisation : null = pas encore vérifié (ou vérification en
  // échec, voir duplicateCheckFailed). L'inscription reste bloquée tant que la
  // vérification n'a pas abouti.
  const [recentEnrollments, setRecentEnrollments] = useState<Map<string, RecentEnrollment> | null>(null);
  const [isCheckingDuplicates, setIsCheckingDuplicates] = useState(false);
  const [duplicateCheckFailed, setDuplicateCheckFailed] = useState(false);
  const [duplicateCheckAttempt, setDuplicateCheckAttempt] = useState(0);
  const [enrollDuplicatesAnyway, setEnrollDuplicatesAnyway] = useState(false);
  const { organizationId, isAdmin } = useOrganization();
  // Compte d'envoi affiché avant l'inscription ; déconnecté ou relié à un
  // collègue, il bloque l'inscription (liaison stricte).
  const sendingAccount = useSendingAccount(accountId);
  // Abonnement : sans plan autorisant l'envoi, rien ne partirait (le moteur
  // mettrait les inscriptions en pause). Tant que l'état n'est pas lu, on ne
  // bloque pas : le serveur reste la référence.
  const { state: subscriptionState, effectivePlanId } = useSubscriptionState();
  const canSendSequences = !subscriptionState || hasPlanFeature(effectivePlanId, 'sequences_send');

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Check if sequence has message steps (to show preview option)
  const hasMessageSteps = useMemo(() => {
    return sequence.steps.some((s: any) => {
      const actionType = s.action_type || s.actionType || '';
      const template = s.message_template || s.messageTemplate || '';
      return MESSAGE_ACTION_TYPES.includes(actionType) && template.trim();
    });
  }, [sequence.steps]);

  // Pré-flight check : détecte les profils incompatibles avec la séquence
  // (1st degree + connection_request, etc.). Affiche un warning panel
  // dans le modal et permet de filtrer avant l'enrollment.
  const compat = useMemo(
    () => checkProfilesCompat(profiles, sequence.steps),
    [profiles, sequence.steps],
  );
  const compatibleProfiles = useMemo(
    () => excludeIncompatible
      ? compat.compatible.map(c => c.profile as LinkedInProfile)
      : profiles,
    [compat.compatible, profiles, excludeIncompatible],
  );

  // Pré-contrôle organisation : candidats déjà contactés par un membre dans
  // les 90 derniers jours (toute séquence, tout compte). Chargé à l'ouverture
  // pour afficher l'avertissement avant le clic ; handleEnroll refait la
  // vérification si elle n'a pas abouti.
  const profilesKey = useMemo(() => profiles.map(p => p.id).join('|'), [profiles]);
  useEffect(() => {
    if (!isOpen || hasMessageSteps || !organizationId) return;
    let cancelled = false;
    setRecentEnrollments(null);
    setDuplicateCheckFailed(false);
    setEnrollDuplicatesAnyway(false);
    setIsCheckingDuplicates(true);
    findRecentEnrollments(supabase, organizationId, profiles)
      .then(map => { if (!cancelled) setRecentEnrollments(map); })
      .catch(err => {
        // Jamais de Map vide ici : ce serait inscrire sans anti-doublon. L'état
        // reste null, un bandeau bloquant propose de réessayer.
        console.warn('[SequenceEnrollModal] recent enrollments check failed:', err);
        if (!cancelled) setDuplicateCheckFailed(true);
      })
      .finally(() => { if (!cancelled) setIsCheckingDuplicates(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, hasMessageSteps, organizationId, profilesKey, duplicateCheckAttempt]);

  const duplicateProfiles = useMemo(
    () => (recentEnrollments ? compatibleProfiles.filter(p => recentEnrollments.has(p.id)) : []),
    [compatibleProfiles, recentEnrollments],
  );
  const allowDuplicates = isAdmin && enrollDuplicatesAnyway;
  const profilesToEnroll = useMemo(
    () => (allowDuplicates || !recentEnrollments)
      ? compatibleProfiles
      : compatibleProfiles.filter(p => !recentEnrollments.has(p.id)),
    [compatibleProfiles, recentEnrollments, allowDuplicates],
  );
  // Raison d'exclusion de chaque candidat absent de profilesToEnroll : la liste
  // les montre grisés au lieu de les confondre avec les inscrits.
  const exclusionReasons = useMemo(() => {
    const reasons = new Map<string, string>();
    const enrolled = new Set(profilesToEnroll.map(p => p.id));
    const compatById = new Map([...compat.blockers, ...compat.warnings].map(r => [r.profile.id, r]));
    for (const profile of profiles) {
      if (enrolled.has(profile.id)) continue;
      const compatResult = compatById.get(profile.id);
      const recent = recentEnrollments?.get(profile.id);
      if (excludeIncompatible && compatResult) reasons.set(profile.id, compatExclusionLabel(compatResult.issue));
      else if (recent) reasons.set(profile.id, `${formatRecentContactLabel(recent)}, exclu`);
    }
    return reasons;
  }, [profiles, profilesToEnroll, compat.blockers, compat.warnings, recentEnrollments, excludeIncompatible]);
  const firstAction = useMemo(() => firstActionSummary(sequence.steps), [sequence.steps]);

  // Plan gratuit : la fenêtre explique pourquoi et renvoie vers les offres,
  // quel que soit le point d'entrée (sourcing, messagerie, liste des séquences).
  if (!canSendSequences) {
    return (
      <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Abonnement requis</DialogTitle>
            <DialogDescription>Inscription dans « {sequence.name} »</DialogDescription>
          </DialogHeader>
          <UpgradePrompt title="Séquences" description={SEQUENCES_PLAN_REQUIRED_MESSAGE} />
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>Fermer</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (hasMessageSteps) {
    return (
      <EnrollmentPreviewModal
        isOpen={isOpen}
        onClose={onClose}
        sequence={sequence}
        profiles={profiles}
        accountId={accountId}
        job={job}
        notice={notice}
        onSuccess={onSuccess}
      />
    );
  }

  const handleEnroll = async () => {
    if (!organizationId) {
      toast.error('Organisation non détectée', {
        description: 'Rechargez la page ou reconnectez-vous.',
      });
      return;
    }
    if (!accountId) {
      toast.error(NO_LINKEDIN_ACCOUNT_TITLE, { description: NO_LINKEDIN_ACCOUNT_DESCRIPTION });
      return;
    }
    if (sendingAccount.blockReason) {
      toast.error(sendingAccount.blockReason);
      return;
    }

    setIsEnrolling(true);
    setResults(null);

    const enrollmentResults: EnrollResults = {
      success: 0,
      skipped: 0,
      alreadyPassed: 0,
      errors: [],
    };

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Session expirée : reconnectez-vous, puis réessayez.');
        return;
      }
      const userId = user.id;

      // Séquence désactivée entre l'ouverture du menu et le clic : refus.
      const inactiveReason = await sequenceInactiveReason(supabase, sequence.id);
      if (inactiveReason) {
        toast.error(inactiveReason);
        return;
      }

      // Source des profils à inscrire : on respecte le toggle "exclure les
      // incompatibles" pour éviter les échecs silencieux (1st degree +
      // connection_request, etc.), puis l'anti-doublon organisation
      // sauf dérogation cochée par un propriétaire ou admin.
      let recent = recentEnrollments;
      if (!recent) {
        recent = await findRecentEnrollments(supabase, organizationId, profiles);
        setRecentEnrollments(recent);
        setDuplicateCheckFailed(false);
      }
      const enrollSet = allowDuplicates
        ? compatibleProfiles
        : compatibleProfiles.filter(p => !recent.has(p.id));

      if (enrollSet.length === 0) {
        toast.error(
          compatibleProfiles.length === 0
            ? 'Aucun candidat compatible avec cette séquence'
            : 'Tous les candidats ont déjà été contactés par votre organisation',
        );
        return;
      }

      // 1. Pré-contrôle : qui a déjà une inscription dans cette séquence ? La
      // contrainte DB `UNIQUE(sequence_id, profile_id)` est inconditionnelle :
      // on distingue ceux qui y sont encore (en cours, en pause) de ceux qui y
      // sont déjà passés (terminée, réponse, arrêtée), à reprendre depuis le
      // suivi. Le résultat exact viendra de l'upsert ci-dessous.
      const profileIds = enrollSet.map(p => p.id);
      const { data: existingEnrollments, error: existingError } = await supabase
        .from('sequence_enrollments')
        .select('profile_id, status')
        .eq('sequence_id', sequence.id)
        .in('profile_id', profileIds);
      if (existingError) throw existingError;

      const existingStatus = new Map((existingEnrollments || []).map(e => [e.profile_id, e.status]));
      const countExisting = (ids: Iterable<string>) => {
        let inSequence = 0;
        let passed = 0;
        for (const id of ids) {
          if (!existingStatus.has(id)) continue;
          if (classifyExistingEnrollment(existingStatus.get(id)) === 'in_sequence') inSequence++;
          else passed++;
        }
        return { inSequence, passed };
      };
      if (existingStatus.size === enrollSet.length) {
        // Tous déjà inscrits → sortie avant tout INSERT
        const { inSequence, passed } = countExisting(profileIds);
        enrollmentResults.skipped = inSequence;
        enrollmentResults.alreadyPassed = passed;
        setResults(enrollmentResults);
        toast.info(passed > 0 ? alreadyPassedLabel(passed) : alreadyInSequenceLabel(inSequence));
        return;
      }

      // 2. Batch UPSERT atomique. La contrainte UNIQUE(sequence_id, profile_id)
      // élimine la race condition entre le pré-check et l'INSERT : si un autre
      // onglet/user a inscrit le même candidat entre temps, la ligne est
      // silencieusement dropée (ignoreDuplicates) et seules les VRAIES nouvelles
      // inscriptions reviennent dans `insertedEnrollments`.
      // Normalise job.id : "project:{uuid}" → uuid pour que le cron
      // process-sequences puisse retrouver le sourcing_project associé.
      const normalizedJobId = job?.id?.startsWith('project:')
        ? job.id.slice('project:'.length)
        : job?.id;
      const enrollmentRows = enrollSet.map(profile => {
        const networkDist = profile.network_distance;
        const normalizedDistance = networkDist === 1 || networkDist === '1' || networkDist === 'DISTANCE_1'
          ? 'FIRST_DEGREE'
          : networkDist === 2 || networkDist === '2' || networkDist === 'DISTANCE_2'
          ? 'SECOND_DEGREE'
          : networkDist === 3 || networkDist === '3' || networkDist === 'DISTANCE_3'
          ? 'THIRD_DEGREE'
          : typeof networkDist === 'string' ? networkDist : null;

        return {
          sequence_id: sequence.id,
          account_id: accountId,
          profile_id: profile.id,
          profile_name: profile.name,
          profile_headline: profile.headline,
          profile_url: profile.profile_url || profile.public_profile_url,
          job_id: normalizedJobId,
          job_title: job?.title,
          created_by: userId,
          user_timezone: userTimezone,
          current_step_order: 0,
          status: 'active',
          network_distance: normalizedDistance,
          organization_id: organizationId,
          ...enrollmentRowFields(profile),
        };
      });

      const { data: insertedEnrollments, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .upsert(enrollmentRows, {
          onConflict: 'sequence_id,profile_id',
          ignoreDuplicates: true,
        })
        .select('id, profile_id');

      if (enrollError) throw enrollError;
      // Pas de throw si tableau vide — tous les candidats étaient déjà inscrits
      // entre le pré-check et l'upsert (race fenêtrée + DB a tout dropé).
      const insertedRows = insertedEnrollments || [];
      const insertedProfileIds = new Set(insertedRows.map(e => e.profile_id));
      const notInserted = profileIds.filter(id => !insertedProfileIds.has(id));
      const { passed: passedCount } = countExisting(notInserted);
      enrollmentResults.success = insertedRows.length;
      enrollmentResults.alreadyPassed = passedCount;
      enrollmentResults.skipped = notInserted.length - passedCount;
      if (insertedRows.length < enrollSet.length - existingStatus.size) {
        console.warn(`[SequenceEnrollModal] Race detected: ${enrollSet.length - existingStatus.size - insertedRows.length} enrollment(s) deduped at DB level (concurrent enroll from another session)`);
      }
      if (insertedRows.length === 0) {
        setResults(enrollmentResults);
        toast.info(passedCount > 0 ? alreadyPassedLabel(passedCount) : alreadyInSequenceLabel(enrollmentResults.skipped));
        return;
      }

      // 3. Batch insert step executions for all new enrollments. Première
      // étape tirée pour CHAQUE inscription (pickFirstStep) : un test A/B en
      // première position répartit les variantes comme le moteur, au lieu de
      // n'envoyer que la première ligne.
      const now = new Date();
      const execRows = insertedRows.flatMap(enrollment => {
        const { step: firstStep, variantAssigned } = pickFirstStep(sequence.steps);
        if (!firstStep) return [];
        const scheduledAt = calculateScheduledTime(
          now,
          firstStep.delay_days || 0,
          firstStep.delay_hours || 0,
          firstStep.delay_minutes || 0,
          firstStep.preferred_hour_start ?? 9,
          firstStep.preferred_hour_end ?? 18,
          userTimezone
        );
        return [{
          enrollment_id: enrollment.id,
          step_id: firstStep.id,
          step_order: firstStep.step_order ?? 0,
          scheduled_at: scheduledAt.toISOString(),
          status: 'scheduled',
          variant_assigned: variantAssigned,
          organization_id: organizationId,
        }];
      });

      const { error: execError } = execRows.length === insertedRows.length
        ? await supabase.from('sequence_step_executions').insert(execRows)
        : { error: new Error('Aucune étape à planifier') };
      if (execError) {
        // Une inscription active sans étape planifiée n'est reprise par le
        // moteur qu'au mieux une heure plus tard : on retire les inscriptions
        // créées plutôt que d'annoncer un faux succès (même règle que l'aperçu
        // d'inscription).
        console.error('[SequenceEnrollModal] Failed to schedule first executions:', execError);
        const insertedIds = insertedRows.map(e => e.id);
        const { data: removed, error: rollbackError } = await supabase
          .from('sequence_enrollments')
          .delete()
          .in('id', insertedIds)
          .select('id');
        const rolledBack = !rollbackError && (removed?.length ?? 0) === insertedIds.length;
        enrollmentResults.success = 0;
        enrollmentResults.errors.push(rolledBack
          ? "L'inscription a échoué : aucune étape n'a pu être planifiée. Aucun message ne partira. Réessayez."
          : "Des inscriptions ont été créées sans étape ; elles démarreront dans l'heure.");
        setResults(enrollmentResults);
        toast.error(rolledBack ? 'Inscription impossible' : 'Inscription incomplète', { description: enrollmentResults.errors[0] });
        return;
      }

      // 4. Statut pipeline « contacté », sans rétrograder un candidat déjà
      // contacté, shortlisté ou qui a répondu (non bloquant).
      if (job?.id) {
        await markCandidatesMessaged(supabase, {
          rawJobId: job.id,
          userId,
          organizationId,
          profiles: enrollSet.filter(p => insertedProfileIds.has(p.id)),
        });
      }

      setResults(enrollmentResults);

      const n = enrollmentResults.success;
      toast.success(`${n} candidat${n > 1 ? 's' : ''} inscrit${n > 1 ? 's' : ''} dans la séquence`, {
        description: firstAction ?? undefined,
      });
      if (enrollmentResults.alreadyPassed > 0) toast.info(alreadyPassedLabel(enrollmentResults.alreadyPassed));
      else if (enrollmentResults.skipped > 0) toast.info(alreadyInSequenceLabel(enrollmentResults.skipped));
    } catch (err) {
      // Détail technique en console seulement : jamais de message brut de la base.
      console.error('Enrollment error:', err);
      enrollmentResults.errors.push("L'inscription n'a pas pu aboutir. Réessayez ou contactez le support.");
      setResults(enrollmentResults);
      toast.error('Inscription impossible', { description: 'Réessayez ou contactez le support.' });
    } finally {
      setIsEnrolling(false);
    }
  };

  const handleClose = () => {
    if (results && results.success > 0) {
      onSuccess();
    } else {
      onClose();
    }
  };

  const enrollCount = profilesToEnroll.length;
  // L'inscription attend la fin de la vérification des contacts récents.
  const duplicatesUnchecked = !recentEnrollments;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // Pendant l'inscription, la fenêtre reste ouverte (Échap, clic
        // extérieur, croix) : la fermer n'arrêterait pas les inscriptions.
        if (!open && !isEnrolling) handleClose();
      }}
    >
      <DialogContent className="max-w-lg w-[calc(100vw-2rem)] max-h-[90vh] overflow-y-auto bg-background border-border rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
             <GitBranch className="w-5 h-5 text-foreground" />
             <span className="uppercase tracking-wide text-sm">Inscrire dans la séquence</span>
          </DialogTitle>
          <DialogDescription>
            Ajouter les candidats sélectionnés à « {sequence.name} »
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Summary */}
          <div className="p-4 bg-muted/50 border border-border space-y-3">
            <div className="flex items-center gap-2">
              <Users className="w-5 h-5 text-foreground" />
              <span className="font-medium">
                {enrollCount} sur {profiles.length} candidat{profiles.length > 1 ? 's' : ''} {enrollCount > 1 ? 'seront inscrits' : 'sera inscrit'}
              </span>
            </div>

            {job && (
              <div className="flex items-center gap-2">
                <Badge variant="outline">{job.title}</Badge>
              </div>
            )}

            <div className="text-sm text-muted-foreground">
              Séquence de {sequence.steps.length} étape{sequence.steps.length > 1 ? 's' : ''}
            </div>
            {firstAction && (
              <div className="flex items-start gap-2 text-sm text-foreground">
                <CalendarClock className="w-4 h-4 shrink-0 mt-0.5 text-muted-foreground" aria-hidden="true" />
                <span>{firstAction}</span>
              </div>
            )}
          </div>

          {notice && (
            <div className="p-3 border border-warning/40 bg-warning/5 rounded-md flex items-start gap-2" role="note">
              <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" aria-hidden="true" />
              <p className="text-xs text-foreground">{notice}</p>
            </div>
          )}

          {/* Warning compat — détecte 1st degree + connection_request,
              hors réseau, etc. Évite les échecs silencieux à l'envoi. */}
          {(compat.blockers.length > 0 || compat.warnings.length > 0) && (
            <div className="p-3 border border-warning/40 bg-warning/5 rounded-md space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-xs font-semibold text-warning">
                    {compat.blockers.length > 0
                      ? `${compat.blockers.length} candidat${compat.blockers.length > 1 ? 's' : ''} incompatible${compat.blockers.length > 1 ? 's' : ''} avec cette séquence`
                      : `${compat.warnings.length} candidat${compat.warnings.length > 1 ? 's' : ''} avec un avertissement`}
                  </p>
                  <ul className="text-[11px] text-muted-foreground space-y-1 max-h-24 overflow-y-auto">
                    {[...compat.blockers, ...compat.warnings].slice(0, 5).map(r => (
                      <li key={r.profile.id} className="truncate">
                        <span className="font-medium text-foreground">{r.profile.name}</span>
                        {' : '}{r.message}
                      </li>
                    ))}
                    {compat.blockers.length + compat.warnings.length > 5 && (
                      <li className="italic">
                        et {compat.blockers.length + compat.warnings.length - 5} autre{compat.blockers.length + compat.warnings.length - 5 > 1 ? 's' : ''}
                      </li>
                    )}
                  </ul>
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={excludeIncompatible}
                      onChange={(e) => setExcludeIncompatible(e.target.checked)}
                      className="h-3 w-3 rounded border-border"
                    />
                    <span className="text-foreground">
                      Exclure les candidats incompatibles ({compat.blockers.length + compat.warnings.length})
                    </span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* Anti-doublon organisation : contacts récents d'un membre, toute
              séquence, tout compte et InMails groupés. Exclus par défaut ;
              dérogation réservée aux propriétaires et administrateurs. */}
          {isCheckingDuplicates && (
            <p className="flex items-center gap-2 text-[11px] text-muted-foreground" role="status">
              <Loader2 className="w-3 h-3 animate-spin" />
              Vérification des contacts récents de l'organisation
            </p>
          )}
          {duplicateCheckFailed && !isCheckingDuplicates && (
            <div className="p-3 border border-destructive/40 bg-destructive/5 rounded-md flex items-start gap-2" role="alert">
              <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" aria-hidden="true" />
              <p className="flex-1 text-xs text-destructive">{DUPLICATE_CHECK_FAILED_MESSAGE}</p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 text-xs shrink-0"
                onClick={() => setDuplicateCheckAttempt(a => a + 1)}
              >
                Réessayer
              </Button>
            </div>
          )}
          {duplicateProfiles.length > 0 && recentEnrollments && (
            <div className="p-3 border border-warning/40 bg-warning/5 rounded-md space-y-2">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0 space-y-2">
                  <p className="text-xs font-semibold text-warning">
                    {duplicateProfiles.length} candidat{duplicateProfiles.length > 1 ? 's' : ''} déjà contacté{duplicateProfiles.length > 1 ? 's' : ''} par votre organisation (séquence en cours, ou contact ces {RECENT_CONTACT_WINDOW_DAYS} derniers jours)
                  </p>
                  <ul className="text-[11px] text-muted-foreground space-y-1 max-h-24 overflow-y-auto">
                    {duplicateProfiles.slice(0, 5).map(p => {
                      const entry = recentEnrollments.get(p.id);
                      return (
                        <li key={p.id} className="truncate">
                          <span className="font-medium text-foreground">{p.name}</span>
                          {' : '}{entry ? formatRecentContactLabel(entry) : 'Déjà contacté'}
                        </li>
                      );
                    })}
                    {duplicateProfiles.length > 5 && (
                      <li className="italic">
                        et {duplicateProfiles.length - 5} autre{duplicateProfiles.length - 5 > 1 ? 's' : ''}
                      </li>
                    )}
                  </ul>
                  {isAdmin ? (
                    <label className="flex items-center gap-2 text-[11px] cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={enrollDuplicatesAnyway}
                        onChange={(e) => setEnrollDuplicatesAnyway(e.target.checked)}
                        className="h-3 w-3 rounded border-border"
                      />
                      <span className="text-foreground">
                        Inscrire quand même ({duplicateProfiles.length})
                      </span>
                    </label>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Exclus de l'inscription. Seuls les propriétaires et administrateurs peuvent les inscrire quand même.
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Candidats : ceux qui ne seront pas inscrits sont grisés, avec la raison. */}
          <ScrollArea className="h-[200px] sm:h-[240px] border border-border bg-muted/30 p-1">
            <div className="space-y-1.5">
              {profiles.map((profile) => {
                const exclusion = exclusionReasons.get(profile.id);
                return (
                  <div
                    key={profile.id}
                    className={cn(
                      'flex items-center gap-3 p-2.5 bg-background border border-border',
                      exclusion && 'opacity-60',
                    )}
                  >
                    {profile.profile_picture_url ? (
                      <img
                        src={profile.profile_picture_url}
                        alt={profile.name}
                        className="w-10 h-10 rounded-full object-cover"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
                        <span className="text-sm font-medium">
                          {profile.name?.charAt(0) || '?'}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm truncate">{profile.name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {exclusion ?? profile.headline}
                      </p>
                    </div>
                    {exclusion && (
                      <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                        Exclu
                      </Badge>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>

          {!results && <SendingAccountNotice state={sendingAccount} />}

          {/* Results */}
          {results && (
            <div className="p-4 border border-border space-y-2">
              {results.success > 0 && (
                <div className="flex items-center gap-2 text-foreground">
                  <CheckCircle className="w-4 h-4" />
                  <span>
                    {results.success} candidat{results.success > 1 ? 's' : ''} inscrit{results.success > 1 ? 's' : ''}
                  </span>
                </div>
              )}
              {results.success > 0 && firstAction && (
                <p className="text-xs text-muted-foreground pl-6">{firstAction}</p>
              )}
              {results.skipped > 0 && (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <AlertCircle className="w-4 h-4" />
                  <span>{alreadyInSequenceLabel(results.skipped)}</span>
                </div>
              )}
              {results.alreadyPassed > 0 && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{alreadyPassedLabel(results.alreadyPassed)}</span>
                </div>
              )}
              {results.errors.length > 0 && (
                <div className="text-sm text-destructive">
                  {results.errors.map((err, i) => (
                    <p key={i}>{err}</p>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {isEnrolling && (
          <p className="text-[11px] text-muted-foreground text-right" role="status">
            Inscription en cours, ne fermez pas cette fenêtre.
          </p>
        )}
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={handleClose} disabled={isEnrolling} className="border-border rounded-lg">
            {results ? 'Fermer' : 'Annuler'}
          </Button>
          {!results && (
            <div className="flex items-center gap-2">
              <Button
                 onClick={handleEnroll}
                 disabled={isEnrolling || enrollCount === 0 || duplicatesUnchecked || !!sendingAccount.blockReason}
                 className="bg-foreground text-background rounded-lg"
              >
                {isEnrolling ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Inscription…
                  </>
                ) : (
                  <>
                    <GitBranch className="w-4 h-4 mr-2" />
                    Inscrire {enrollCount} candidat{enrollCount > 1 ? 's' : ''}
                  </>
                )}
              </Button>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

// Helper: get UTC offset in hours for a timezone at a given instant
function getTimezoneOffsetHours(date: Date, tz: string): number {
  const localHour = parseInt(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(date), 10);
  const utcHour = date.getUTCHours();
  let offset = localHour - utcHour;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;
  return offset;
}

// Set date so that the LOCAL hour in `tz` equals `desiredLocalHour`
function setLocalHour(date: Date, tz: string, desiredLocalHour: number, minutes = 0): void {
  const offset = getTimezoneOffsetHours(date, tz);
  date.setUTCHours(desiredLocalHour - offset, minutes, 0, 0);
}

// Helper to calculate scheduled time respecting time windows
function calculateScheduledTime(
  fromDate: Date,
  delayDays: number,
  delayHours: number,
  delayMinutes: number,
  preferredHourStart: number,
  preferredHourEnd: number,
  timezone: string
): Date {
  const scheduled = new Date(fromDate);
  
  scheduled.setTime(scheduled.getTime()
    + delayDays * 86400000
    + delayHours * 3600000
    + delayMinutes * 60000
  );
  
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    hour12: false,
  });
  const localHour = parseInt(formatter.format(scheduled));
  
  if (localHour < preferredHourStart) {
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15));
  } else if (localHour >= preferredHourEnd) {
    scheduled.setDate(scheduled.getDate() + 1);
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15));
  }
  
  const dayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' });
  const day = dayFormatter.format(scheduled);
  if (day === 'Sun') { scheduled.setDate(scheduled.getDate() + 1); setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15)); }
  if (day === 'Sat') { scheduled.setDate(scheduled.getDate() + 2); setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 15)); }
  
  const jitterMinutes = Math.floor(Math.random() * 11) - 5;
  scheduled.setTime(scheduled.getTime() + jitterMinutes * 60000);

  const finalHour = parseInt(formatter.format(scheduled));
  if (finalHour < preferredHourStart) {
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 6));
  } else if (finalHour >= preferredHourEnd) {
    scheduled.setDate(scheduled.getDate() + 1);
    setLocalHour(scheduled, timezone, preferredHourStart, Math.floor(Math.random() * 6));
  }
  
  return scheduled;
}
