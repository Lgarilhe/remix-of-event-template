import React, { useState, useMemo, useEffect, useId } from 'react';
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { AlertCircle, AlertTriangle, CalendarClock, CheckCircle2, Info, Users } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { LinkedInProfile } from './types';
import { EnrollmentPreviewModal } from './EnrollmentPreviewModal';
import { CandidateAvatar } from '@/components/candidates/shared/CandidateAvatar';
import { checkProfilesCompat, pickFirstStep, type CompatIssue } from '@/lib/sequenceCompatibility';
import { SendingAccountNotice } from './enrollment-preview/SendingAccountNotice';
import { OTHER_MEMBER_ACCOUNT_MESSAGE, useSendingAccount } from './enrollment-preview/useSendingAccount';
import { enrollmentRowFields } from './enrollment-preview/enrollmentRowFields';
import { RecipientsConfirm } from './enrollment-preview/RecipientsConfirm';
import { useRecipientsConfirm } from './enrollment-preview/useRecipientsConfirm';
import {
  alreadyInSequenceLabel,
  alreadyPassedLabel,
  classifyExistingEnrollment,
  dedupeProfilesByIdentity,
  DUPLICATE_CHECK_FAILED_MESSAGE,
  enrollFailureMessage,
  enrollmentRefusalOf,
  findBlockingSequenceEnrollments,
  firstActionSummary,
  formerPassageLabel,
  isOtherMemberAccountError,
  NO_LINKEDIN_ACCOUNT_DESCRIPTION,
  NO_LINKEDIN_ACCOUNT_TITLE,
  samePersonRefusedLabel,
  SEQUENCES_PLAN_REQUIRED_MESSAGE,
  sequenceInactiveReason,
} from './enrollment-preview/enrollmentHelpers';
import { gdprErasedEnrollLabel, refusedCandidatesLabel } from '@/lib/sequenceErrorMessages';
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
import { plural } from '@/lib/plural';
import { sequenceActionLabel } from '@/lib/sequenceCatalog';
import { hasMessage } from '@/hooks/useEnrollmentPreview';

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
  /** Refusés par la base, par nom : profil effacé (décision 12). */
  gdprErased: string[];
  /** Refusés par la base, par nom : même personne dans la séquence sous un autre identifiant (décision 21). */
  samePerson: string[];
  /** Inscrits, déjà passés par la séquence il y a plus de 90 jours sous un autre identifiant (décision 23). */
  formerPassages: number;
  errors: string[];
}

/** Toasts des candidats non inscrits (refus, déjà dans la séquence, échecs) et de l'avertissement de réinscription. */
function announceOthers(r: EnrollResults) {
  if (r.errors.length > 0) toast.error(`${r.errors.length} inscription${r.errors.length > 1 ? 's' : ''} en échec`, { description: r.errors[0] });
  if (r.gdprErased.length > 0) toast.warning(gdprErasedEnrollLabel(r.gdprErased.length), { description: refusedCandidatesLabel(r.gdprErased) });
  if (r.samePerson.length > 0) toast.warning(samePersonRefusedLabel(r.samePerson.length), { description: refusedCandidatesLabel(r.samePerson) });
  if (r.formerPassages > 0) toast.warning(formerPassageLabel(r.formerPassages));
  if (r.alreadyPassed > 0) toast.info(alreadyPassedLabel(r.alreadyPassed));
  else if (r.skipped > 0) toast.info(alreadyInSequenceLabel(r.skipped));
}

/**
 * Raison d'exclusion affichée sur un candidat grisé de la liste. Un candidat
 * déjà en relation avec une invitation prévue n'est exclu que si la séquence
 * ne contient rien d'autre ; sinon le moteur saute l'invitation et envoie les
 * messages suivants.
 */
function compatExclusionLabel(issue: CompatIssue): string {
  if (issue === 'connection_only_already_connected') return 'Déjà en relation, exclu';
  return issue === 'too_far' ? 'Hors réseau, exclu' : 'InMail inutile, exclu';
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
  const excludeId = useId();
  const duplicatesId = useId();
  // Compte d'envoi affiché avant l'inscription ; déconnecté ou relié à un
  // collègue, il bloque l'inscription (liaison stricte).
  const sendingAccount = useSendingAccount(accountId);
  // Abonnement : sans plan autorisant l'envoi, rien ne partirait (le moteur
  // mettrait les inscriptions en pause). Tant que l'état n'est pas lu, on ne
  // bloque pas : le serveur reste la référence.
  const { state: subscriptionState, effectivePlanId } = useSubscriptionState();
  const canSendSequences = !subscriptionState || hasPlanFeature(effectivePlanId, 'sequences_send');

  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Séquence avec message : préparation avec aperçu (EnrollmentPreviewModal).
  // Un message compte s'il a un modèle écrit, ou s'il est rédigé par l'IA pour
  // chaque candidat, même sans modèle : le moteur le rédige et l'envoie, il
  // doit donc être montré avant l'inscription (lot 5a).
  const hasMessageSteps = useMemo(() => {
    return sequence.steps.some((s: any) => {
      const actionType = s.action_type || s.actionType || '';
      const template = s.message_template || s.messageTemplate || '';
      const useAiPersonalization = !!(s.use_ai_personalization ?? s.useAiPersonalization);
      return (MESSAGE_ACTION_TYPES.includes(actionType) && !!template.trim())
        || hasMessage({ actionType, messageTemplate: template, useAiPersonalization });
    });
  }, [sequence.steps]);

  // Pré-flight check : détecte les profils incompatibles avec la séquence
  // (1st degree + connection_request, etc.). Affiche un warning panel
  // dans le modal et permet de filtrer avant l'enrollment.
  const compat = useMemo(
    () => checkProfilesCompat(profiles, sequence.steps),
    [profiles, sequence.steps],
  );
  // Candidats que « Exclure les incompatibles » écarte : hors réseau, InMail
  // inutile, et déjà en relation quand la séquence n'a que l'invitation.
  // Déjà en relation avec une suite (invitation sautée, suite envoyée) : averti, inscrit.
  const excludableCompat = useMemo(
    () => [...compat.blockers, ...compat.warnings].filter(r => r.issue !== 'connection_already_connected'),
    [compat.blockers, compat.warnings],
  );
  const compatibleProfiles = useMemo(() => {
    if (!excludeIncompatible) return profiles;
    const excluded = new Set(excludableCompat.map(r => r.profile.id));
    return profiles.filter(p => !excluded.has(p.id));
  }, [excludableCompat, profiles, excludeIncompatible]);

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
    const compatById = new Map(excludableCompat.map(r => [r.profile.id, r]));
    for (const profile of profiles) {
      if (enrolled.has(profile.id)) continue;
      const compatResult = compatById.get(profile.id);
      const recent = recentEnrollments?.get(profile.id);
      if (excludeIncompatible && compatResult) reasons.set(profile.id, compatExclusionLabel(compatResult.issue));
      else if (recent) reasons.set(profile.id, `${formatRecentContactLabel(recent)}, exclu`);
    }
    return reasons;
  }, [profiles, profilesToEnroll, excludableCompat, recentEnrollments, excludeIncompatible]);
  const firstAction = useMemo(() => firstActionSummary(sequence.steps), [sequence.steps]);
  // Lot 5a : case des destinataires dès 5 candidats, sur le nombre du bouton
  // (enrollCount), décochée dès que la liste change. Cette fenêtre ne sert
  // qu'aux séquences sans message, ni écrit ni rédigé par l'IA (hasMessageSteps) :
  // l'aperçu nomme la première action.
  const recipients = useRecipientsConfirm(profilesToEnroll.map(p => p.id));
  const firstStepPreviewLabel = useMemo(() => {
    const { step } = pickFirstStep(sequence.steps, () => 0);
    const label = step ? sequenceActionLabel(step.action_type || step.actionType) : null;
    return label
      ? `Aucun message écrit. Première action : ${label.charAt(0).toLowerCase()}${label.slice(1)}.`
      : 'Aucun message écrit.';
  }, [sequence.steps]);

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
      toast.error("Votre organisation n'a pas pu être identifiée", {
        description: 'Rechargez la page ou reconnectez votre compte.',
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
    // Lot 5a : dès 5 candidats, rien ne part sans la case des destinataires.
    if (recipients.blocked) return;

    setIsEnrolling(true);
    setResults(null);

    const enrollmentResults: EnrollResults = {
      success: 0,
      skipped: 0,
      alreadyPassed: 0,
      gdprErased: [],
      samePerson: [],
      formerPassages: 0,
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
      // Même personne sélectionnée sous deux identifiants : une seule
      // inscription, les autres comptées « déjà dans cette séquence ».
      const { unique: enrollSet, duplicates } = dedupeProfilesByIdentity(allowDuplicates
        ? compatibleProfiles
        : compatibleProfiles.filter(p => !recent.has(p.id)));

      if (enrollSet.length === 0) {
        toast.error(
          compatibleProfiles.length === 0
            ? 'Aucun candidat compatible avec cette séquence'
            : 'Tous les candidats ont déjà été contactés par votre organisation',
        );
        return;
      }

      // 1. Pré-contrôle : qui a déjà une inscription dans cette séquence ? La
      // contrainte DB `UNIQUE(sequence_id, profile_id)` est inconditionnelle ;
      // sous un autre identifiant du candidat ou son slug public, une
      // inscription en cours ou en pause bloque aussi, dérogation comprise
      // (SEQ-046), comme une inscription close depuis moins de 90 jours
      // (décision 21) ; au-delà, inscription avec un avertissement (décision
      // 23). Ces candidats ne sont pas envoyés à l'upsert. On
      // distingue ceux qui y sont encore (en cours, en pause) de ceux qui y
      // sont déjà passés (terminée, réponse, arrêtée), à reprendre depuis le
      // suivi. Le résultat exact viendra de
      // l'upsert ci-dessous.
      const profileIds = enrollSet.map(p => p.id);
      const { blocking, formerPassages } = await findBlockingSequenceEnrollments(supabase, sequence.id, enrollSet);
      const existingStatus = new Map(Array.from(blocking, ([id, e]) => [id, e.status]));
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
        enrollmentResults.skipped = inSequence + duplicates;
        enrollmentResults.alreadyPassed = passed;
        setResults(enrollmentResults);
        toast.info(passed > 0 ? alreadyPassedLabel(passed) : alreadyInSequenceLabel(enrollmentResults.skipped));
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
      const enrollmentRows = enrollSet.filter(p => !existingStatus.has(p.id)).map(profile => {
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

      const upsertOptions = { onConflict: 'sequence_id,profile_id', ignoreDuplicates: true };
      const { data: insertedEnrollments, error: enrollError } = await supabase
        .from('sequence_enrollments')
        .upsert(enrollmentRows, upsertOptions)
        .select('id, profile_id');

      // Pas de throw si tableau vide — tous les candidats étaient déjà inscrits
      // entre le pré-check et l'upsert (race fenêtrée + DB a tout dropé).
      let insertedRows = insertedEnrollments || [];
      // Candidats refusés ou en échec à l'insertion une par une.
      const refused = new Set<string>();
      if (enrollError) {
        // Refus de la base propre à un candidat (profil effacé, même personne
        // dans la séquence, décisions 12 et 21) : l'insertion groupée échoue en
        // entier, on reprend candidat par candidat pour inscrire les autres.
        if (!enrollmentRefusalOf(enrollError)) throw enrollError;
        insertedRows = [];
        for (const row of enrollmentRows) {
          const { data: one, error: oneError } = await supabase
            .from('sequence_enrollments')
            .upsert(row, upsertOptions)
            .select('id, profile_id');
          if (!oneError) {
            insertedRows.push(...(one ?? []));
            continue;
          }
          // Même compte pour toute la sélection : aucune ligne n'a pu passer avant.
          if (isOtherMemberAccountError(oneError)) throw oneError;
          refused.add(row.profile_id);
          const refusal = enrollmentRefusalOf(oneError);
          if (refusal === 'gdpr_erased') enrollmentResults.gdprErased.push(row.profile_name || 'Candidat sans nom');
          else if (refusal === 'same_person') enrollmentResults.samePerson.push(row.profile_name || 'Candidat sans nom');
          else {
            console.error('[SequenceEnrollModal] enrollment failed for', row.profile_id, oneError);
            enrollmentResults.errors.push(enrollFailureMessage(row.profile_name));
          }
        }
      }
      const insertedProfileIds = new Set(insertedRows.map(e => e.profile_id));
      const notInserted = profileIds.filter(id => !insertedProfileIds.has(id) && !refused.has(id));
      const { passed: passedCount } = countExisting(notInserted);
      enrollmentResults.success = insertedRows.length;
      enrollmentResults.alreadyPassed = passedCount;
      enrollmentResults.skipped = notInserted.length - passedCount + duplicates;
      enrollmentResults.formerPassages = insertedRows.filter(e => formerPassages.has(e.profile_id)).length;
      if (insertedRows.length < enrollSet.length - existingStatus.size - refused.size) {
        console.warn(`[SequenceEnrollModal] Race detected: ${enrollSet.length - existingStatus.size - refused.size - insertedRows.length} enrollment(s) deduped at DB level (concurrent enroll from another session)`);
      }
      if (insertedRows.length === 0) {
        setResults(enrollmentResults);
        announceOthers(enrollmentResults);
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

      // 4. Rien n'est écrit dans le pipeline à l'inscription : le serveur
      // passe le candidat à « Contacté » au premier envoi réel (lot 0b).

      setResults(enrollmentResults);

      toast.success(`${plural(enrollmentResults.success, 'candidat inscrit', 'candidats inscrits')} dans la séquence`, {
        description: firstAction ?? undefined,
      });
      announceOthers(enrollmentResults);
    } catch (err) {
      // Détail technique en console seulement : jamais de message brut de la base.
      console.error('Enrollment error:', err);
      // Refus de la base (SEQ-043) : compte relié à un autre membre. Réessayer
      // échouerait de la même façon : on dit pourquoi, sans proposer de réessayer.
      const otherMemberAccount = isOtherMemberAccountError(err);
      enrollmentResults.errors.push(otherMemberAccount
        ? OTHER_MEMBER_ACCOUNT_MESSAGE
        : "L'inscription n'a pas pu aboutir. Réessayez ou contactez le support.");
      setResults(enrollmentResults);
      toast.error('Inscription impossible', {
        description: otherMemberAccount ? OTHER_MEMBER_ACCOUNT_MESSAGE : 'Réessayez ou contactez le support.',
      });
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
  const incompatible = [...compat.blockers, ...compat.warnings];
  // Échec complet : on propose de réessayer, sauf pour le compte d'un collègue
  // (réessayer échouerait de la même façon).
  const failed = !!results && results.errors.length > 0 && results.success === 0
    && !results.errors.includes(OTHER_MEMBER_ACCOUNT_MESSAGE);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        // Pendant l'inscription, la fenêtre reste ouverte (Échap, clic
        // extérieur, croix) : la fermer n'arrêterait pas les inscriptions.
        if (!open && !isEnrolling) handleClose();
      }}
    >
      <DialogContent className="flex max-h-[90dvh] w-[calc(100vw-2rem)] max-w-lg flex-col gap-4 overflow-hidden">
        <DialogHeader className="pr-8">
          <DialogTitle>Inscrire dans la séquence</DialogTitle>
          <DialogDescription>
            Les candidats sélectionnés rejoindront la séquence « {sequence.name} ».
          </DialogDescription>
        </DialogHeader>

        <div className="-mx-6 min-h-0 min-w-0 flex-1 space-y-3 overflow-y-auto px-6">
          {/* Résumé */}
          <div className="space-y-2 rounded-xl border border-border bg-muted/40 p-3">
            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Users className="h-4 w-4 shrink-0" aria-hidden="true" />
              {enrollCount} sur {plural(profiles.length, 'candidat')} {enrollCount > 1 ? 'seront inscrits' : 'sera inscrit'}
            </p>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              {job && <Badge variant="outline">{job.title}</Badge>}
              <span>Séquence de {plural(sequence.steps.length, 'étape')}</span>
            </div>
            {firstAction && (
              <p className="flex items-start gap-2 text-sm text-foreground">
                <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{firstAction}</span>
              </p>
            )}
          </div>

          {notice && (
            <p role="note" className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning-muted p-3 text-sm text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
              <span>{notice}</span>
            </p>
          )}

          {/* Compatibilité : hors réseau, InMail inutile, déjà en relation
              (invitation sautée, ou invitation seule). Évite les échecs
              silencieux à l'envoi. */}
          {incompatible.length > 0 && (
            <div className="space-y-2 rounded-xl border border-warning/25 bg-warning-muted p-3">
              <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                {compat.blockers.length > 0
                  ? `${plural(compat.blockers.length, 'candidat incompatible', 'candidats incompatibles')} avec cette séquence`
                  : `${plural(compat.warnings.length, 'candidat')} avec un avertissement`}
              </p>
              <ul className="max-h-24 space-y-1 overflow-y-auto pl-6 text-xs text-foreground-secondary">
                {incompatible.slice(0, 5).map(r => (
                  <li key={r.profile.id} className="break-words">
                    <span className="font-medium text-foreground">{r.profile.name}</span>
                    {' : '}{r.message ?? 'à vérifier avant inscription.'}
                  </li>
                ))}
                {incompatible.length > 5 && (
                  <li>et {plural(incompatible.length - 5, 'autre')}</li>
                )}
              </ul>
              {excludableCompat.length > 0 && (
                <div className="flex items-center gap-2 pl-6">
                  <Checkbox
                    id={excludeId}
                    checked={excludeIncompatible}
                    onCheckedChange={(checked) => setExcludeIncompatible(checked === true)}
                  />
                  <Label htmlFor={excludeId} className="cursor-pointer text-xs font-normal text-foreground max-md:py-3">
                    Exclure les candidats incompatibles ({excludableCompat.length})
                  </Label>
                </div>
              )}
            </div>
          )}

          {/* Anti-doublon organisation : contacts récents d'un membre, toute
              séquence, tout compte et InMails groupés. Exclus par défaut ;
              dérogation réservée aux propriétaires et administrateurs. */}
          {isCheckingDuplicates && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <Spinner size="sm" label="Vérification en cours" />
              Vérification des contacts récents de l'organisation
            </p>
          )}
          {duplicateCheckFailed && !isCheckingDuplicates && (
            <div role="alert" className="flex items-start gap-2 rounded-xl border border-danger/25 bg-danger-muted p-3">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-sm text-foreground">{DUPLICATE_CHECK_FAILED_MESSAGE}</p>
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="shrink-0 max-md:h-11"
                onClick={() => setDuplicateCheckAttempt(a => a + 1)}
              >
                Réessayer
              </Button>
            </div>
          )}
          {duplicateProfiles.length > 0 && recentEnrollments && (
            <div className="space-y-2 rounded-xl border border-warning/25 bg-warning-muted p-3">
              <p className="flex items-start gap-2 text-sm font-medium text-foreground">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                {duplicateProfiles.length > 1
                  ? `${duplicateProfiles.length} candidats déjà contactés`
                  : '1 candidat déjà contacté'} par votre organisation (séquence en cours, ou contact ces {RECENT_CONTACT_WINDOW_DAYS} derniers jours)
              </p>
              <ul className="max-h-24 space-y-1 overflow-y-auto pl-6 text-xs text-foreground-secondary">
                {duplicateProfiles.slice(0, 5).map(p => {
                  const entry = recentEnrollments.get(p.id);
                  return (
                    <li key={p.id} className="break-words">
                      <span className="font-medium text-foreground">{p.name}</span>
                      {' : '}{entry ? formatRecentContactLabel(entry) : 'Déjà contacté'}
                    </li>
                  );
                })}
                {duplicateProfiles.length > 5 && (
                  <li>et {plural(duplicateProfiles.length - 5, 'autre')}</li>
                )}
              </ul>
              {isAdmin ? (
                <div className="flex items-center gap-2 pl-6">
                  <Checkbox
                    id={duplicatesId}
                    checked={enrollDuplicatesAnyway}
                    onCheckedChange={(checked) => setEnrollDuplicatesAnyway(checked === true)}
                  />
                  <Label htmlFor={duplicatesId} className="cursor-pointer text-xs font-normal text-foreground max-md:py-3">
                    Inscrire quand même ({duplicateProfiles.length})
                  </Label>
                </div>
              ) : (
                <p className="pl-6 text-xs text-foreground-secondary">
                  Exclus de l'inscription. Seuls les propriétaires et administrateurs peuvent les inscrire quand même.
                </p>
              )}
            </div>
          )}

          {/* Candidats : ceux qui ne seront pas inscrits sont atténués, avec la
              raison à la place du titre. */}
          <ul className="max-h-60 divide-y divide-border overflow-y-auto rounded-xl border border-border" aria-label="Candidats sélectionnés">
            {profiles.map((profile) => {
              const exclusion = exclusionReasons.get(profile.id);
              return (
                <li key={profile.id} className="flex items-center gap-3 px-3 py-2.5">
                  <CandidateAvatar name={profile.name} imageUrl={profile.profile_picture_url} size="md" />
                  <div className="min-w-0 flex-1">
                    <p className={cn('truncate text-sm font-medium', exclusion ? 'text-muted-foreground' : 'text-foreground')}>
                      {profile.name}
                    </p>
                    {(exclusion || profile.headline) && (
                      <p className="truncate text-xs text-muted-foreground">{exclusion ?? profile.headline}</p>
                    )}
                  </div>
                  {!results && exclusion && (
                    <Badge variant="muted" className="shrink-0">Exclu</Badge>
                  )}
                </li>
              );
            })}
          </ul>

          {!results && <SendingAccountNotice state={sendingAccount} />}

          {/* Résultat */}
          {results && (
            <div role="status" className="space-y-1.5 rounded-xl border border-border p-3 text-sm">
              {results.success > 0 && (
                <p className="flex items-center gap-2 text-foreground">
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
                  {plural(results.success, 'candidat inscrit', 'candidats inscrits')}
                </p>
              )}
              {results.success > 0 && firstAction && (
                <p className="pl-6 text-xs text-muted-foreground">{firstAction}</p>
              )}
              {results.skipped > 0 && (
                <p className="flex items-start gap-2 text-muted-foreground">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                  <span>{alreadyInSequenceLabel(results.skipped)}</span>
                </p>
              )}
              {results.alreadyPassed > 0 && (
                <p className="flex items-start gap-2 text-muted-foreground">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                  <span>{alreadyPassedLabel(results.alreadyPassed)}</span>
                </p>
              )}
              {results.samePerson.length > 0 && (
                <div className="flex items-start gap-2 text-muted-foreground">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
                  <div className="min-w-0">
                    <p>{samePersonRefusedLabel(results.samePerson.length)}</p>
                    <p className="text-xs">{refusedCandidatesLabel(results.samePerson)}</p>
                  </div>
                </div>
              )}
              {results.gdprErased.length > 0 && (
                <div className="flex items-start gap-2 text-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <div className="min-w-0">
                    <p>{gdprErasedEnrollLabel(results.gdprErased.length)}</p>
                    <p className="text-xs text-foreground-secondary">{refusedCandidatesLabel(results.gdprErased)}</p>
                  </div>
                </div>
              )}
              {results.formerPassages > 0 && (
                <p role="note" className="flex items-start gap-2 text-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                  <span>{formerPassageLabel(results.formerPassages)}</span>
                </p>
              )}
              {results.errors.length > 0 && (
                <div className="flex items-start gap-2 text-foreground">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
                  <div className="min-w-0 space-y-0.5">
                    {results.errors.map((err, i) => (
                      <p key={i}>{err}</p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {(!results || failed) && (
          <RecipientsConfirm
            count={enrollCount}
            confirmed={recipients.confirmed}
            onConfirmedChange={recipients.setConfirmed}
            preview={profilesToEnroll[0]
              ? { candidateName: profilesToEnroll[0].name || 'ce candidat', items: [], emptyLabel: firstStepPreviewLabel }
              : null}
          />
        )}
        {isEnrolling && (
          <p role="status" className="text-right text-xs text-muted-foreground">
            Inscription en cours, ne fermez pas cette fenêtre.
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={handleClose} disabled={isEnrolling} className="max-md:h-11">
            {results ? 'Fermer' : 'Annuler'}
          </Button>
          {(!results || failed) && (
            <Button
              variant="primary"
              onClick={handleEnroll}
              loading={isEnrolling}
              disabled={isEnrolling || enrollCount === 0 || duplicatesUnchecked || !!sendingAccount.blockReason || recipients.blocked}
              className="max-md:h-11"
            >
              {isEnrolling ? 'Inscription en cours…' : failed ? 'Réessayer' : <>Inscrire {enrollCount} candidat{enrollCount > 1 ? 's' : ''}</>}
            </Button>
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
