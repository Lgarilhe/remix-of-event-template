// Refonte mission, lot 5f-2c : panneau « Contacter » ouvert depuis la sélection du Pipeline.
// Lot 5f-2d : le même flux sert les autres entrées (feuille du Sourcing et des fiches, messagerie,
// page d'une séquence) ; ses props nouvelles sont facultatives et valent, absentes, le lot 5f-2c.
// Hors mission (missionId et job nuls) aucune ligne n'est écrite dans le Pipeline ; un candidat sans
// ligne (rowId nul) sort de onEnrolled par l'identifiant de son profil.
//
// De haut en bas : la séquence (choisie d'avance, avec le compte d'envoi et la
// première action), les candidats en trois groupes (prêts, à compléter, exclus,
// chaque raison en toutes lettres), l'aperçu du premier message du candidat
// courant, la jauge du plafond LinkedIn, puis le pied (case des destinataires et
// boutons). Contrat décrit dans docs/refonte-mission/lot5f2c-conception.md.
//
// Ce composant lit et classe ; il n'écrit que par enrollCandidates (lot 5f-1), en
// mode groupé, et jamais lui-même une inscription, une exécution ni une étape de
// candidat (la règle Retenu passe par enrollCandidates). Une séquence à message
// rédigé par l'IA ne s'inscrit pas ici : « Relire les messages » ouvre la fenêtre
// de préparation (génération, relecture, inscription un par un), car le moteur
// n'envoie jamais un texte IA que la personne n'a pas relu.
//
// Tous les hooks sont appelés avant le moindre retour anticipé.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { UpgradePrompt } from '@/components/ui/UpgradePrompt';
import { supabase } from '@/integrations/supabase/client';
import { EnrollmentPreviewModal } from '@/components/outreach/EnrollmentPreviewModal';
import type { LinkedInProfile } from '@/components/outreach/types';
import { SendingAccountNotice } from '@/components/outreach/enrollment-preview/SendingAccountNotice';
import { useSendingAccount } from '@/components/outreach/enrollment-preview/useSendingAccount';
import {
  FirstMessagePreviewBlock,
  RecipientsConfirm,
  type FirstMessagePreview,
  type FirstMessagePreviewItem,
} from '@/components/outreach/enrollment-preview/RecipientsConfirm';
import { useRecipientsConfirm } from '@/components/outreach/enrollment-preview/useRecipientsConfirm';
import { firstMessagePath } from '@/components/outreach/enrollment-preview/firstMessagePath';
import {
  DUPLICATE_CHECK_FAILED_MESSAGE,
  NO_LINKEDIN_ACCOUNT_DESCRIPTION,
  NO_LINKEDIN_ACCOUNT_TITLE,
  SEQUENCES_PLAN_REQUIRED_MESSAGE,
  findBlockingSequenceEnrollments,
  firstActionSummary,
} from '@/components/outreach/enrollment-preview/enrollmentHelpers';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { useLinkedInQuotaStatus } from '@/hooks/useLinkedInQuotaStatus';
import { useOrganization } from '@/hooks/useOrganization';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import type { SequenceStepPreview } from '@/hooks/useEnrollmentPreview';
import { previewDisplayText, usePreviewValues } from '@/hooks/usePreviewValues';
import { enrollCandidates } from '@/lib/enrollCandidates';
import { hasPlanFeature } from '@/lib/featureGates';
import { plural } from '@/lib/plural';
import { sequenceActionLabel } from '@/lib/sequenceCatalog';
import { normalizeNetworkDistance, pickFirstStep } from '@/lib/sequenceCompatibility';
import { sequencePath } from '@/lib/sequencesBeta';
import { invalidateMissionContacted, invalidateStageReaders } from '@/lib/stageDisplay';
import { inviteNoteText, templateKeys } from '@/lib/templatePreview';
import {
  classifyContactEntries,
  contactSummary,
  type ContactEligibility,
  type ContactOverride,
} from '@/lib/contactFlowGroups';
import { missionSequenceMenu } from '@/lib/missionSequencePick';
import { gaugeKindOf, quotaGauge } from '@/lib/quotaGauge';
import { cn } from '@/lib/utils';
import { announceEnrollOutcome } from './announceEnrollOutcome';
import { flowSequenceInfo, isPreviewedMessageStep, toFlowSteps } from './flowSteps';
import { QuotaGauge } from './QuotaGauge';
import { RecipientGroups } from './RecipientGroups';
import { SequencePicker } from './SequencePicker';
import type { ContactFlowProps, FlowCandidate } from './types';
import { useContactEligibility } from './useContactEligibility';
import { useContactSequences } from './useContactSequences';
import { useSequenceSteps } from './useSequenceSteps';

/**
 * Candidats au plus par inscription : même valeur que CONTACT_FLOW_MAX de
 * useContactCandidates (missions/v3/pipeline), qui coupe la sélection ; ce
 * fichier n'importe pas la coquille de la page mission.
 */
const CONTACT_FLOW_MAX = 400;

/** Candidats par paquet du balayage des aperçus (le serveur en accepte 20 par appel). */
const SWEEP_PACKET = 20;

/** Cibles de 44 px sur téléphone et tablette, comme la liste des contactés. */
const TOUCH = 'max-lg:min-h-11';

/** Types d'étape dont l'objet part avec le message (InMail, e-mail, message IA en InMail). */
const SUBJECT_ACTIONS: readonly string[] = ['inmail', 'email', 'smart_message'];

const NO_OVERRIDES: ReadonlySet<ContactOverride> = new Set();

const STEPS_LOAD_FAILED_MESSAGE = 'Impossible de charger les étapes de la séquence. Réessayez.';
const STEPS_EMPTY_MESSAGE =
  "Cette séquence ne contient aucune étape. Ajoutez au moins une étape avant d'inscrire des candidats.";
const PREFERRED_MISSING_MESSAGE =
  "La séquence demandée n'est pas disponible : elle est en pause, sans étape ou hors de votre vue. Choisissez-en une autre.";
const AI_PREVIEW_MESSAGE = "Message rédigé par l'IA Konekt pour chaque candidat : relisez-les avant l'inscription.";

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

type PreviewReader = Pick<ReturnType<typeof usePreviewValues>, 'entryOf' | 'sendTime' | 'retry'>;

/**
 * Premier message que recevra ce candidat : parcours du moteur depuis la première
 * étape (firstMessagePath), à « Vérifier la relation » la branche du candidat si sa
 * relation est connue, sinon les deux avec leur condition. Texte rendu avec les
 * valeurs du serveur (preview_values) : squelette pendant la préparation, raison à
 * la place du texte quand le serveur n'en donne pas, jamais un texte deviné.
 */
function firstMessageOf(
  candidate: FlowCandidate,
  steps: readonly SequenceStepPreview[],
  reader: PreviewReader,
): FirstMessagePreview {
  const distance = normalizeNetworkDistance(candidate.profile.network_distance);
  const connected = distance === 'FIRST_DEGREE'
    ? true
    : distance === 'SECOND_DEGREE' || distance === 'THIRD_DEGREE' || distance === 'OUT_OF_NETWORK' ? false : null;
  const candidateName = candidate.name || 'ce candidat';
  const { messages, firstAction } = firstMessagePath(steps, isPreviewedMessageStep, connected);
  if (messages.length === 0) {
    const label = firstAction ? sequenceActionLabel(firstAction.actionType) : null;
    return {
      candidateName,
      items: [],
      emptyLabel: label ? `Aucun message écrit. Première action : ${lowerFirst(label)}.` : 'Aucun message écrit.',
    };
  }
  const items = messages.map(({ step, condition }): FirstMessagePreviewItem => {
    const label = sequenceActionLabel(step.actionType);
    // Étape rédigée par l'IA : rien à montrer avant la génération, qui se fait dans « Relire les messages ».
    if (step.useAiPersonalization && step.actionType !== 'connection_request') {
      return { key: step.stepId, label, condition, text: AI_PREVIEW_MESSAGE };
    }
    const entry = reader.entryOf(candidate.id);
    if (!entry || entry.status === 'loading') return { key: step.stepId, label, condition, text: '', loading: true };
    if (entry.status === 'unavailable') {
      return {
        key: step.stepId,
        label,
        condition,
        text: '',
        unavailable: entry.message,
        onRetry: entry.retryable ? reader.retry : undefined,
      };
    }
    const text = previewDisplayText(step.messageTemplate, entry.values, reader.sendTime, entry.atSend);
    const subject = SUBJECT_ACTIONS.includes(step.actionType)
      ? previewDisplayText(step.subjectTemplate, entry.values, reader.sendTime, entry.atSend) || null
      : null;
    return {
      key: step.stepId,
      label,
      condition,
      subject,
      // La note d'invitation est coupée à 300 caractères, comme le moteur la coupe.
      text: step.actionType === 'connection_request' ? inviteNoteText(text) : text,
    };
  });
  return { candidateName, items };
}

/**
 * Rangée « Voir les contactés » des portes, pour ne jamais enfermer la personne dans le mode Contacter.
 * Sans libellé (le conteneur a sa propre croix), aucun bouton.
 */
function LeaveButton({ onLeave, label }: { onLeave: () => void; label: string | null }) {
  if (!label) return null;
  return (
    <Button type="button" variant="ghost" size="xs" className={cn('shrink-0', TOUCH)} onClick={onLeave}>
      {label}
    </Button>
  );
}

export function ContactFlow({
  missionId,
  job,
  candidates,
  candidatesStatus,
  overflow = 0,
  refreshing = false,
  onRetryCandidates,
  onEnrolled,
  onOpenCandidate,
  onLeave,
  accountId: imposedAccountId,
  notice = null,
  leaveLabel = 'Voir les contactés',
  emptyHint = 'Cochez des candidats dans la liste, puis « Contacter ».',
  onBusyChange,
  onChanged,
  preferredSequenceId = null,
}: ContactFlowProps): JSX.Element {
  const { organizationId, isAdmin } = useOrganization();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Plan : optimiste pendant la lecture (le serveur reste l'arbitre : il met l'inscription en pause si le plan n'envoie pas).
  const { effectivePlanId, isLoading: planLoading, isLoadingError: planLoadFailed } = useSubscriptionState();
  const canSendSequences = planLoading || planLoadFailed || hasPlanFeature(effectivePlanId, 'sequences_send');

  // Le compte d'envoi vient du point d'entrée quand il en impose un (messagerie : celui de la conversation) ;
  // sinon c'est le compte propre de la personne. Un compte de collègue reste bloqué par useSendingAccount.
  const { selectedAccount, accountsLoading } = useFilteredLinkedInAccounts();
  const accountId = imposedAccountId ?? selectedAccount;
  const sendingAccount = useSendingAccount(accountId);

  // Séquence : la plus récente de la mission est choisie d'avance, sauf choix de la personne encore proposé.
  // Séquence demandée par l'adresse (page d'une séquence) : choisie d'avance ; absente du menu (en pause, sans
  // étape, hors de la vue), elle n'est jamais remplacée en silence par une autre : aucune séquence choisie.
  // Le constat « absente » ne se fait que sur une liste à jour : pendant la relecture d'une liste gardée en
  // cache, la séquence peut y arriver, et rien n'est dit.
  const sequencesRead = useContactSequences();
  const menu = useMemo(() => missionSequenceMenu(sequencesRead.sequences, missionId), [sequencesRead.sequences, missionId]);
  const [chosenSequenceId, setChosenSequenceId] = useState<string | null>(preferredSequenceId);
  const selected = useMemo(() => {
    if (chosenSequenceId) {
      const kept = [...menu.mission, ...menu.others].find((sequence) => sequence.id === chosenSequenceId);
      if (kept) return kept;
      if (chosenSequenceId === preferredSequenceId) return null;
    }
    return menu.pick;
  }, [menu, chosenSequenceId, preferredSequenceId]);
  const selectedId = selected?.id ?? null;
  const preferredMissing = !!preferredSequenceId
    && chosenSequenceId === preferredSequenceId
    && !selected
    && sequencesRead.settled;

  const stepsRead = useSequenceSteps(selectedId);
  const rawSteps = stepsRead.steps;
  const stepsReady = rawSteps !== null && rawSteps.length > 0;
  // Avertissement du point d'entrée : texte fixe, ou calculé sur les étapes de la séquence choisie.
  const noticeText = typeof notice === 'function' ? (rawSteps ? notice(rawSteps) : null) : notice;
  const steps = useMemo(() => (rawSteps ? toFlowSteps(rawSteps) : []), [rawSteps]);
  const info = useMemo(() => flowSequenceInfo(steps), [steps]);
  const previewKeys = useMemo(
    () => templateKeys(steps.flatMap((step) => [step.messageTemplate, step.subjectTemplate])),
    [steps],
  );
  const firstAction = useMemo(() => (rawSteps && rawSteps.length > 0 ? firstActionSummary(rawSteps) : null), [rawSteps]);
  const rotation = !!selected?.multi_sender_enabled
    && Array.isArray(selected.sender_accounts)
    && selected.sender_accounts.length > 0;

  // Éligibilité : anti-doublon, déjà dans la séquence, compatibilité avec le réseau.
  const eligibility = useContactEligibility({
    sequenceId: selectedId,
    rawSteps,
    candidates,
    organizationId: canSendSequences ? organizationId : null,
  });
  const { blocking, recent, incompatible, warnings, recentMap, retry: retryEligibility } = eligibility;

  // Aperçu des premiers messages (preview_values) : c'est lui qui apprend quels profils sont effacés.
  const previewValues = usePreviewValues({
    organizationId,
    missionId,
    sequenceId: selectedId,
    accountId,
    jobTitle: job?.title ?? null,
    keys: previewKeys,
  });
  const { request: requestPreviewValues, entryOf: previewEntryOf } = previewValues;
  // Derrière la porte « formule gratuite » rien n'est lu : personne n'en verrait le résultat.
  const previewsEnabled = canSendSequences
    && !!organizationId
    && !!accountId
    && !sendingAccount.belongsToOtherMember
    && stepsReady;

  // Profils effacés sur demande (cas gdpr_erased du serveur : aucun nouvel essai possible). Clé de contenu :
  // les groupes ne sont recalculés que si cet ensemble change, pas à chaque aperçu reçu.
  const erasedKey = candidates
    .filter((candidate) => {
      const entry = previewEntryOf(candidate.id);
      return entry?.status === 'unavailable' && !entry.retryable;
    })
    .map((candidate) => candidate.id)
    .join('\u0001');
  const erased = useMemo<ReadonlySet<string>>(() => new Set(erasedKey ? erasedKey.split('\u0001') : []), [erasedKey]);

  // Dérogations : propres à la séquence choisie ET aux candidats montrés. Elles sont remises à vide dès que
  // l'un ou l'autre change (comme les fenêtres d'inscription, dont la liste est figée) : une dérogation
  // levée pour deux contacts récents ne doit pas s'appliquer en silence à un candidat coché ensuite.
  const candidatesKey = useMemo(() => candidates.map((candidate) => candidate.id).join('\u0001'), [candidates]);
  const overrideScope = `${selectedId ?? ''}|${candidatesKey}`;
  const [overrideState, setOverrideState] = useState<{ scope: string; set: ReadonlySet<ContactOverride> }>({
    scope: '',
    set: NO_OVERRIDES,
  });
  const overridesEnabled = !info.aiReview;
  const overrides = overridesEnabled && overrideState.scope === overrideScope ? overrideState.set : NO_OVERRIDES;
  // Le bouton cliqué disparaît (le candidat change de groupe) : le focus va au résumé, qui annonce le changement.
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const focusSummary = useRef(false);
  const toggleOverride = useCallback((override: ContactOverride) => {
    focusSummary.current = true;
    setOverrideState((previous) => {
      const next = new Set(previous.scope === overrideScope ? previous.set : NO_OVERRIDES);
      if (next.has(override)) next.delete(override);
      else next.add(override);
      return { scope: overrideScope, set: next };
    });
  }, [overrideScope]);
  useEffect(() => {
    if (!focusSummary.current) return;
    focusSummary.current = false;
    summaryRef.current?.focus({ preventScroll: true });
  }, [overrides]);

  const contactEligibility = useMemo<ContactEligibility>(
    () => ({ blocking, erased, recent, incompatible, warnings }),
    [blocking, erased, recent, incompatible, warnings],
  );
  const groups = useMemo(
    () => classifyContactEntries(candidates, contactEligibility, {
      aiReview: info.aiReview,
      canOverrideRecent: isAdmin,
      overrides,
    }),
    [candidates, contactEligibility, info.aiReview, isAdmin, overrides],
  );
  const ready = groups.ready;
  const readyIds = useMemo(() => ready.map((entry) => entry.source.id), [ready]);
  const recipients = useRecipientsConfirm(readyIds, { aiReview: false });

  // Candidats montrés à « Relire les messages » : les prêts et ceux dont seul le message IA reste à relire.
  // Séquence à message IA : les contacts récents et les incompatibles y vont aussi, car c'est la fenêtre qui
  // offre alors leurs dérogations (le panneau n'en propose pas, elles ne se transmettent pas à la fenêtre).
  const reviewProfiles = useMemo(() => {
    const ids = new Set(ready.map((entry) => entry.source.id));
    for (const entry of groups.incomplete) if (entry.reason === 'ai_review') ids.add(entry.source.id);
    if (info.aiReview) {
      for (const entry of groups.excluded) {
        if (entry.reason === 'recent_contact' || entry.reason === 'too_far' || entry.reason === 'connection_only') ids.add(entry.source.id);
      }
    }
    return candidates.filter((candidate) => ids.has(candidate.id)).map((candidate) => candidate.profile);
  }, [candidates, ready, groups.incomplete, groups.excluded, info.aiReview]);
  // Figé à l'ouverture : la fenêtre ne doit pas voir sa liste de candidats changer sous elle.
  const [review, setReview] = useState<{
    sequence: { id: string; name: string; steps: NonNullable<typeof rawSteps> };
    profiles: LinkedInProfile[];
  } | null>(null);

  // Aperçu : candidat courant parmi les prêts (suivi par identifiant, la liste peut changer).
  const [previewId, setPreviewId] = useState<string | null>(null);
  const previewPosition = Math.max(0, ready.findIndex((entry) => entry.source.id === previewId));
  const previewCandidate = ready[previewPosition]?.source ?? null;
  const previewProfile = previewCandidate?.profile ?? null;
  const goToPreview = (position: number) => setPreviewId(ready[position]?.source.id ?? null);

  // Le candidat courant d'abord.
  useEffect(() => {
    if (!previewsEnabled || !previewProfile) return;
    void requestPreviewValues([previewProfile]);
  }, [previewsEnabled, previewProfile, requestPreviewValues]);

  // Puis tous les candidats avec un lien LinkedIn, un paquet à la fois : c'est ainsi qu'on sait,
  // avant le clic, quels profils sont effacés. Un paquet en échec n'arrête pas le balayage.
  const sweepProfiles = useMemo(
    () => candidates.filter((candidate) => candidate.hasLinkedIn).map((candidate) => candidate.profile),
    [candidates],
  );
  useEffect(() => {
    if (!previewsEnabled || sweepProfiles.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (let from = 0; from < sweepProfiles.length; from += SWEEP_PACKET) {
        if (cancelled) return;
        try {
          await requestPreviewValues(sweepProfiles.slice(from, from + SWEEP_PACKET));
        } catch (err) {
          console.warn('[ContactFlow] aperçus: un paquet a échoué', err);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewsEnabled, sweepProfiles, requestPreviewValues]);

  // Jauge du plafond LinkedIn (le plafond ne bloque jamais l'inscription : le moteur reporte l'excédent).
  // C'est une estimation : elle lit le compte d'envoi choisi et ses compteurs d'aujourd'hui. Elle n'est
  // donc montrée que si la première action part vraiment de ce compte et maintenant (pas de rotation
  // d'expéditeurs, pas de délai d'un jour ou plus avant la première étape).
  const firstStep = useMemo(
    () => (rawSteps && rawSteps.length > 0 ? pickFirstStep(rawSteps, () => 0).step ?? null : null),
    [rawSteps],
  );
  const firstStepType = firstStep?.action_type ?? null;
  const firstStepLater = !!firstStep
    && (firstStep.delay_days ?? 0) * 1440 + (firstStep.delay_hours ?? 0) * 60 + (firstStep.delay_minutes ?? 0) >= 1440;
  const gaugeApplies = !rotation && !firstStepLater && gaugeKindOf(firstStepType) !== null;
  const quota = useLinkedInQuotaStatus(gaugeApplies ? accountId : null);
  // Candidats qui consomment une place : ceux que l'inscription visera (messages IA compris), sauf, pour une
  // invitation, ceux déjà en relation (l'invitation est sautée et la place rendue).
  const gaugeCount = useMemo(
    () => reviewProfiles.filter(
      (profile) => !(gaugeKindOf(firstStepType) === 'invitations' && warnings.get(profile.id) === 'connection_already_connected'),
    ).length,
    [reviewProfiles, firstStepType, warnings],
  );
  const quotaStatus = quota.data;
  const gauge = useMemo(
    () => (gaugeApplies && quotaStatus
      ? quotaGauge(firstStepType, {
        usedToday: quotaStatus.today.visible_actions,
        capToday: quotaStatus.caps.visible_actions,
        usedWeekInvitations: quotaStatus.week.invitations,
        capWeekInvitations: quotaStatus.caps.weekly_invitations,
      }, gaugeCount)
      : null),
    [gaugeApplies, quotaStatus, firstStepType, gaugeCount],
  );
  const quotaUnavailable = gaugeApplies && quota.isError && gaugeCount > 0;

  const [enrolling, setEnrolling] = useState(false);
  const enrollingRef = useRef(false);
  // Le conteneur retient sa fermeture tant que l'écriture dure.
  useEffect(() => {
    onBusyChange?.(enrolling);
  }, [enrolling, onBusyChange]);

  const openSequence = useCallback(() => {
    if (!selectedId) return;
    // Hors mission, sequencePath n'a pas de « ? » : l'onglet s'ajoute avec « ? ».
    if (!missionId) {
      navigate(`${sequencePath(selectedId)}?onglet=candidats`);
      return;
    }
    navigate(`${sequencePath(selectedId, missionId)}&onglet=candidats`);
  }, [navigate, selectedId, missionId]);

  const handleEnroll = async () => {
    if (recipients.blocked) return;
    if (enrollingRef.current) return;
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
    // Jamais d'inscription sans l'anti-doublon lu.
    if (!selected || !rawSteps || rawSteps.length === 0 || !recentMap) return;
    const readyProfiles = ready.map((entry) => entry.source.profile);
    if (readyProfiles.length === 0) return;

    enrollingRef.current = true;
    setEnrolling(true);
    try {
      const outcome = await enrollCandidates({
        mode: 'batch',
        supabase,
        organizationId,
        accountId,
        sequence: { id: selected.id, steps: rawSteps },
        job,
        allProfiles: candidates.map((candidate) => candidate.profile),
        candidates: readyProfiles,
        recentEnrollments: recentMap,
        // La dérogation « Inscrire quand même » n'est servie que pour les contacts récents dérogés.
        allowDuplicates: ready.some((entry) => entry.overridden && entry.reason === 'recent_contact'),
        noCandidatesMessage: 'Aucun candidat à inscrire',
        firstStepTiming: 'business_hours',
      });
      announceEnrollOutcome(outcome, {
        sequenceName: selected.name,
        firstAction,
        onOpenSequence: openSequence,
        toast,
      });
      if (outcome.status === 'done') {
        if (outcome.results.success > 0) void invalidateMissionContacted(queryClient);
        if (outcome.retained && outcome.retained.saved > 0) void invalidateStageReaders(queryClient);
        const enrolled = new Set(outcome.enrolledIds);
        // Une clé par candidat traité : sa ligne du Pipeline, sinon l'identifiant de son profil (aucune ligne).
        const handledRowIds = candidates.filter((candidate) => enrolled.has(candidate.id)).map((candidate) => candidate.rowId ?? candidate.id);
        if (handledRowIds.length > 0) {
          onEnrolled(handledRowIds);
          return;
        }
      }
      // Refusée, en échec ou rien d'inscrit : rien ne quitte la sélection, les groupes et les séquences sont relus
      // (une séquence désactivée entre-temps ne doit pas rester choisie).
      retryEligibility();
      sequencesRead.refetch();
    } finally {
      enrollingRef.current = false;
      setEnrolling(false);
    }
  };

  const openReview = () => {
    if (!selected || !rawSteps || rawSteps.length === 0 || reviewProfiles.length === 0) return;
    setReview({ sequence: { id: selected.id, name: selected.name, steps: rawSteps }, profiles: reviewProfiles });
  };

  // La fenêtre a inscrit (ou retenu) : les candidats entrés dans la séquence quittent la sélection.
  const handleReviewDone = async () => {
    const done = review;
    setReview(null);
    if (!done) return;
    void invalidateMissionContacted(queryClient);
    let handledRowIds: string[] = [];
    try {
      const { blocking: entered } = await findBlockingSequenceEnrollments(supabase, done.sequence.id, done.profiles);
      const ids = new Set(done.profiles.filter((profile) => entered.has(profile.id)).map((profile) => profile.id));
      handledRowIds = candidates.filter((candidate) => ids.has(candidate.id)).map((candidate) => candidate.rowId ?? candidate.id);
    } catch (err) {
      // Lecture en échec : personne ne quitte la sélection à tort, les groupes sont relus.
      console.warn('[ContactFlow] inscrits de la fenêtre non relus', err);
    }
    if (handledRowIds.length > 0) {
      onEnrolled(handledRowIds);
    } else {
      // Rien d'inscrit (par exemple « Retenir sans contacter ») : les groupes sont relus et l'appelant prévenu.
      retryEligibility();
      onChanged?.();
    }
  };

  // ── Portes ──
  const gate = (content: JSX.Element) => <div className="space-y-3 px-4 py-4 text-sm sm:px-5">{content}</div>;

  if (!canSendSequences) {
    return gate(
      <>
        <UpgradePrompt title="Séquences" description={SEQUENCES_PLAN_REQUIRED_MESSAGE} />
        <LeaveButton onLeave={onLeave} label={leaveLabel} />
      </>,
    );
  }

  if (candidatesStatus === 'loading') {
    return (
      <div className="space-y-3 px-4 py-4 sm:px-5" aria-busy="true" aria-label="Chargement des candidats sélectionnés">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (candidatesStatus === 'error') {
    return gate(
      <div role="alert" className="space-y-2">
        <p className="text-foreground">Les candidats sélectionnés n'ont pas pu être chargés.</p>
        <div className="flex flex-wrap items-center gap-2">
          {onRetryCandidates && (
            <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={onRetryCandidates}>
              Réessayer
            </Button>
          )}
          <LeaveButton onLeave={onLeave} label={leaveLabel} />
        </div>
      </div>,
    );
  }

  if (candidates.length === 0) {
    return gate(
      <>
        <div className="space-y-1">
          <p className="text-foreground">Aucun candidat sélectionné.</p>
          <p className="text-muted-foreground">{emptyHint}</p>
        </div>
        {leaveLabel && (
          <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={onLeave}>
            {leaveLabel}
          </Button>
        )}
      </>,
    );
  }

  if (!accountId) {
    if (accountsLoading) {
      return (
        <div className="space-y-3 px-4 py-4 sm:px-5" aria-busy="true" aria-label="Chargement des comptes LinkedIn">
          <Skeleton className="h-9 w-full" />
        </div>
      );
    }
    return gate(
      <>
        <p className="text-foreground">Reliez votre compte LinkedIn pour contacter.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button asChild variant="outline" size="sm" className={TOUCH}>
            <Link to="/settings/account/connections">Relier LinkedIn</Link>
          </Button>
          <LeaveButton onLeave={onLeave} label={leaveLabel} />
        </div>
      </>,
    );
  }

  // ── Panneau ──
  const eligibilityReady = eligibility.status === 'ready' && !!recentMap;
  const enrollDisabled = enrolling
    || refreshing
    || ready.length === 0
    || !stepsReady
    || !eligibilityReady
    || !!sendingAccount.blockReason
    || recipients.blocked;
  const reviewDisabled = enrolling
    || refreshing
    || reviewProfiles.length === 0
    || !stepsReady
    || !eligibilityReady
    || !!sendingAccount.blockReason;
  const showFooter = !!selected && stepsReady;

  let candidatesSection: JSX.Element | null = null;
  if (selected) {
    if (stepsRead.status === 'error') {
      candidatesSection = (
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-foreground">{STEPS_LOAD_FAILED_MESSAGE}</p>
          <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={stepsRead.refetch}>
            Réessayer
          </Button>
        </div>
      );
    } else if (rawSteps !== null && rawSteps.length === 0) {
      candidatesSection = (
        <p role="alert" className="text-sm text-foreground">{STEPS_EMPTY_MESSAGE}</p>
      );
    } else if (rawSteps === null || eligibility.status === 'loading') {
      candidatesSection = (
        <div className="space-y-2" aria-busy="true" aria-label="Vérification des candidats">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      );
    } else if (eligibility.status === 'error') {
      candidatesSection = (
        <div role="alert" className="space-y-2 text-sm">
          <p className="text-foreground">{DUPLICATE_CHECK_FAILED_MESSAGE}</p>
          <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={retryEligibility}>
            Réessayer
          </Button>
        </div>
      );
    } else {
      candidatesSection = (
        <div className="space-y-3">
          <p ref={summaryRef} tabIndex={-1} role="status" className="text-sm text-foreground outline-none">
            {contactSummary(groups)}
          </p>
          <RecipientGroups
            groups={groups}
            canOverrideRecent={isAdmin}
            overrides={overrides}
            onToggleOverride={toggleOverride}
            onOpenCandidate={onOpenCandidate}
            overridesEnabled={overridesEnabled}
          />
          {previewsEnabled && previewCandidate && (
            <FirstMessagePreviewBlock
              preview={firstMessageOf(previewCandidate, steps, previewValues)}
              navigation={{
                index: previewPosition,
                total: ready.length,
                onPrevious: () => goToPreview(previewPosition - 1),
                onNext: () => goToPreview(previewPosition + 1),
              }}
            />
          )}
          {gauge && <QuotaGauge model={gauge} />}
          {!gauge && quotaUnavailable && (
            <p className="text-xs text-muted-foreground">Plafond LinkedIn indisponible pour l'instant.</p>
          )}
        </div>
      );
    }
  }

  return (
    <div data-contact-flow="" className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-5 px-4 py-4 sm:px-5">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 text-sm font-semibold text-foreground">
            {`Contacter ${plural(candidates.length, 'candidat')}`}
          </h3>
          <LeaveButton onLeave={onLeave} label={leaveLabel} />
        </div>

        <div className="space-y-2">
          <SequencePicker
            menu={menu}
            selectedId={selectedId}
            status={sequencesRead.status}
            onRetry={sequencesRead.refetch}
            onSelect={setChosenSequenceId}
            missionId={missionId}
          />
          {preferredMissing && <p role="note" className="text-xs text-foreground">{PREFERRED_MISSING_MESSAGE}</p>}
          {selected && (
            <div className="space-y-1.5">
              {rotation && !sendingAccount.blockReason ? (
                <p className="text-xs text-foreground">Envoyé depuis les comptes de la rotation de la séquence.</p>
              ) : (
                <SendingAccountNotice state={sendingAccount} />
              )}
              {firstAction && <p className="text-xs text-muted-foreground">{firstAction}</p>}
            </div>
          )}
          {noticeText && (
            <p role="note" className="rounded-lg border border-warning/25 bg-warning-muted px-3 py-2 text-xs text-foreground">
              {noticeText}
            </p>
          )}
        </div>

        {candidatesSection}

        {overflow > 0 && (
          <p className="text-xs text-muted-foreground">
            {`${CONTACT_FLOW_MAX} candidats au plus par inscription : ${overflow > 1
              ? `les ${plural(overflow, 'autre')} ne sont pas inclus dans cette inscription`
              : "l'autre n'est pas inclus dans cette inscription"}.`}
          </p>
        )}
      </div>

      {showFooter && (
        // lg:pr-20 : à partir de lg le panneau est à côté de la page et la bulle de l'assistant (fixe, 56 px, en bas
        // à droite) le recouvre ; en plein écran (sous lg) le panneau passe au-dessus de la bulle.
        <div className="sticky bottom-0 mt-auto shrink-0 space-y-3 border-t border-border bg-background px-4 py-3 sm:px-5 lg:pr-20">
          <RecipientsConfirm
            count={ready.length}
            confirmed={recipients.confirmed}
            onConfirmedChange={recipients.setConfirmed}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            {info.aiReview ? (
              <Button
                type="button"
                variant="primary"
                className={TOUCH}
                disabled={reviewDisabled}
                onClick={openReview}
              >
                {`Relire les messages (${reviewProfiles.length})`}
              </Button>
            ) : (
              <>
                {info.messageSteps.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    className={TOUCH}
                    disabled={reviewDisabled}
                    onClick={openReview}
                  >
                    Relire les messages
                  </Button>
                )}
                <Button
                  type="button"
                  variant="primary"
                  className={TOUCH}
                  disabled={enrollDisabled}
                  loading={enrolling}
                  onClick={() => { void handleEnroll(); }}
                >
                  {`Inscrire ${plural(ready.length, 'candidat')}`}
                </Button>
              </>
            )}
          </div>
        </div>
      )}

      {review && (
        <EnrollmentPreviewModal
          isOpen
          onClose={() => setReview(null)}
          sequence={review.sequence}
          profiles={review.profiles}
          accountId={accountId}
          job={job}
          notice={noticeText}
          onSuccess={() => { void handleReviewDone(); }}
        />
      )}
    </div>
  );
}
