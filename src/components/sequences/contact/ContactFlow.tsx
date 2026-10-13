// Refonte mission, lot 5f-2c : panneau « Contacter » ouvert depuis la sélection du Pipeline.
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

/** Rangée « Voir les contactés » des portes, pour ne jamais enfermer la personne dans le mode Contacter. */
function LeaveButton({ onLeave }: { onLeave: () => void }) {
  return (
    <Button type="button" variant="ghost" size="xs" className={cn('shrink-0', TOUCH)} onClick={onLeave}>
      Voir les contactés
    </Button>
  );
}

export function ContactFlow({
  missionId,
  job,
  candidates,
  candidatesStatus,
  overflow,
  onRetryCandidates,
  onEnrolled,
  onOpenCandidate,
  onLeave,
}: ContactFlowProps): JSX.Element {
  const { organizationId, isAdmin } = useOrganization();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Plan : optimiste pendant la lecture (le serveur reste l'arbitre : il met l'inscription en pause si le plan n'envoie pas).
  const { effectivePlanId, isLoading: planLoading, isLoadingError: planLoadFailed } = useSubscriptionState();
  const canSendSequences = planLoading || planLoadFailed || hasPlanFeature(effectivePlanId, 'sequences_send');

  const { selectedAccount, accountsLoading } = useFilteredLinkedInAccounts();
  const accountId = selectedAccount;
  const sendingAccount = useSendingAccount(accountId);

  // Séquence : la plus récente de la mission est choisie d'avance, sauf choix de la personne encore proposé.
  const sequencesRead = useContactSequences(missionId);
  const menu = useMemo(() => missionSequenceMenu(sequencesRead.sequences, missionId), [sequencesRead.sequences, missionId]);
  const [chosenSequenceId, setChosenSequenceId] = useState<string | null>(null);
  const selected = useMemo(() => {
    if (chosenSequenceId) {
      const kept = [...menu.mission, ...menu.others].find((sequence) => sequence.id === chosenSequenceId);
      if (kept) return kept;
    }
    return menu.pick;
  }, [menu, chosenSequenceId]);
  const selectedId = selected?.id ?? null;

  const stepsRead = useSequenceSteps(selectedId);
  const rawSteps = stepsRead.steps;
  const stepsReady = rawSteps !== null && rawSteps.length > 0;
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
  const eligibility = useContactEligibility({ sequenceId: selectedId, rawSteps, candidates, organizationId });
  const { blocking, recent, incompatible, warnings, recentMap, retry: retryEligibility } = eligibility;

  // Aperçu des premiers messages (preview_values) : c'est lui qui apprend quels profils sont effacés.
  const previewValues = usePreviewValues({
    organizationId,
    missionId,
    sequenceId: selectedId,
    accountId,
    jobTitle: job.title,
    keys: previewKeys,
  });
  const { request: requestPreviewValues, entryOf: previewEntryOf } = previewValues;
  const previewsEnabled = !!organizationId && !!accountId && !sendingAccount.belongsToOtherMember && stepsReady;

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

  // Dérogations : propres à la séquence choisie, remises à vide quand elle change.
  const [overrideState, setOverrideState] = useState<{ sequenceId: string | null; set: ReadonlySet<ContactOverride> }>({
    sequenceId: null,
    set: NO_OVERRIDES,
  });
  const overrides = overrideState.sequenceId === selectedId ? overrideState.set : NO_OVERRIDES;
  const toggleOverride = useCallback((override: ContactOverride) => {
    setOverrideState((previous) => {
      const next = new Set(previous.sequenceId === selectedId ? previous.set : NO_OVERRIDES);
      if (next.has(override)) next.delete(override);
      else next.add(override);
      return { sequenceId: selectedId, set: next };
    });
  }, [selectedId]);

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
  const reviewProfiles = useMemo(() => {
    const ids = new Set(ready.map((entry) => entry.source.id));
    for (const entry of groups.incomplete) if (entry.reason === 'ai_review') ids.add(entry.source.id);
    return candidates.filter((candidate) => ids.has(candidate.id)).map((candidate) => candidate.profile);
  }, [candidates, ready, groups.incomplete]);
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
  const quota = useLinkedInQuotaStatus(accountId);
  const firstStepType = useMemo(
    () => (rawSteps && rawSteps.length > 0 ? pickFirstStep(rawSteps, () => 0).step?.action_type ?? null : null),
    [rawSteps],
  );
  const quotaStatus = quota.data;
  const gauge = useMemo(
    () => (quotaStatus
      ? quotaGauge(firstStepType, {
        usedToday: quotaStatus.today.visible_actions,
        capToday: quotaStatus.caps.visible_actions,
        usedWeekInvitations: quotaStatus.week.invitations,
        capWeekInvitations: quotaStatus.caps.weekly_invitations,
      }, ready.length)
      : null),
    [quotaStatus, firstStepType, ready.length],
  );
  const quotaUnavailable = quota.isError && gaugeKindOf(firstStepType) !== null && ready.length > 0;

  const [enrolling, setEnrolling] = useState(false);
  const enrollingRef = useRef(false);

  const openSequence = useCallback(() => {
    if (!selectedId) return;
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
        const handledRowIds = candidates.filter((candidate) => enrolled.has(candidate.id)).map((candidate) => candidate.rowId);
        if (handledRowIds.length > 0) {
          onEnrolled(handledRowIds);
          return;
        }
      }
      // Refusée, en échec ou rien d'inscrit : rien ne quitte la sélection, les groupes sont relus.
      retryEligibility();
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
      handledRowIds = candidates.filter((candidate) => ids.has(candidate.id)).map((candidate) => candidate.rowId);
    } catch (err) {
      // Lecture en échec : personne ne quitte la sélection à tort, les groupes sont relus.
      console.warn('[ContactFlow] inscrits de la fenêtre non relus', err);
    }
    if (handledRowIds.length > 0) onEnrolled(handledRowIds);
    else retryEligibility();
  };

  // ── Portes ──
  const gate = (content: JSX.Element) => <div className="space-y-3 px-4 py-4 text-sm sm:px-5">{content}</div>;

  if (!canSendSequences) {
    return gate(
      <>
        <UpgradePrompt title="Séquences" description={SEQUENCES_PLAN_REQUIRED_MESSAGE} />
        <LeaveButton onLeave={onLeave} />
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
          <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={onRetryCandidates}>
            Réessayer
          </Button>
          <LeaveButton onLeave={onLeave} />
        </div>
      </div>,
    );
  }

  if (candidates.length === 0) {
    return gate(
      <>
        <div className="space-y-1">
          <p className="text-foreground">Aucun candidat sélectionné.</p>
          <p className="text-muted-foreground">Cochez des candidats dans la liste, puis « Contacter ».</p>
        </div>
        <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={onLeave}>
          Voir les contactés
        </Button>
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
          <LeaveButton onLeave={onLeave} />
        </div>
      </>,
    );
  }

  // ── Panneau ──
  const eligibilityReady = eligibility.status === 'ready' && !!recentMap;
  const enrollDisabled = enrolling
    || ready.length === 0
    || !stepsReady
    || !eligibilityReady
    || !!sendingAccount.blockReason
    || recipients.blocked;
  const reviewDisabled = enrolling
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
          <p className="text-sm text-foreground">{contactSummary(groups)}</p>
          <RecipientGroups
            groups={groups}
            canOverrideRecent={isAdmin}
            overrides={overrides}
            onToggleOverride={toggleOverride}
            onOpenCandidate={onOpenCandidate}
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
          <LeaveButton onLeave={onLeave} />
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
        </div>

        {candidatesSection}

        {overflow > 0 && (
          <p className="text-xs text-muted-foreground">
            {`${CONTACT_FLOW_MAX} candidats au plus par inscription : ${overflow > 1
              ? `les ${plural(overflow, 'autre')} restent sélectionnés`
              : "l'autre reste sélectionné"}.`}
          </p>
        )}
      </div>

      {showFooter && (
        // pr-20 : la bulle de l'assistant (fixe, 56 px, en bas à droite) ne doit pas recouvrir les boutons du pied.
        <div className="sticky bottom-0 mt-auto shrink-0 space-y-3 border-t border-border bg-background py-3 pl-4 pr-20 sm:pl-5 sm:pr-20">
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
          onSuccess={() => { void handleReviewDone(); }}
        />
      )}
    </div>
  );
}
