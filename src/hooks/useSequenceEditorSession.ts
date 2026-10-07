/**
 * Session d'édition d'une séquence dans l'éditeur unique (lot 5d-2), commune
 * à la page d'une séquence et à la création (/sequences/nouvelle) :
 * - vérification : validateSequence, seule règle, avec les expéditeurs reliés
 *   à l'équipe et la variable inconnue bloquante (variables personnelles de
 *   l'expéditeur connues) ;
 * - enregistrement explicite (useEditorSaveFlow), par le bouton ou Ctrl/Cmd+S ;
 * - brouillon local (useSequenceEditorDraft) et « Quitter sans enregistrer ? »
 *   (useLeaveGuard) ;
 * - aperçu réel des messages (useSequencePreview), lu seulement quand une
 *   étape à message est ouverte.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { SequenceIssue, SequenceValidationOptions } from '@/components/outreach/sequence/sequenceGraph';
import { stepHasMessageField, validateSequence } from '@/components/outreach/sequence/sequenceGraph';
import { linkedSenderIdsOf, useMultiSenderTeam } from '@/components/outreach/sequence/useMultiSenderTeam';
import type { SequenceSettingsDraft } from '@/components/sequences/SettingsTab';
import type { SequenceEditor } from '@/hooks/useSequenceEditor';
import { useEditorSaveFlow } from '@/hooks/useEditorSaveFlow';
import { useLeaveGuard } from '@/hooks/useLeaveGuard';
import { useSequenceEditorDraft } from '@/hooks/useSequenceEditorDraft';
import { useSequencePreview } from '@/hooks/useSequencePreview';
import { useUserTemplateVariables } from '@/hooks/useUserTemplateVariables';
import { templateKeys } from '@/lib/templatePreview';

interface SessionOptions<D> {
  editor: SequenceEditor;
  /** Étapes lues et modifiables. */
  loaded: boolean;
  name: string;
  settings: SequenceSettingsDraft | null;
  settingsDirty: boolean;
  /** Séquence pas encore créée : toujours à enregistrer. */
  creating: boolean;
  organizationId: string | null;
  sequenceId: string | null;
  missionId: string | null;
  /** Onglet Étapes affiché. */
  stepsTabActive: boolean;
  draftKey: string | null;
  draftBase: string | null;
  draftValue: D;
  /** Le brouillon est à garder (étapes, nom ou réglages modifiés). */
  draftDirty: boolean;
  onDraftRestore: (value: D, savedAt: Date | null) => void;
  removedStepCount: number;
  activeEnrollmentCount: number | undefined;
  perform: () => Promise<void>;
  onBlocked: (errors: readonly SequenceIssue[]) => void;
  /** Départ confirmé sans enregistrer : retour à l'état enregistré. */
  onDiscard: () => void;
  /** Séquence rédigée par l'IA (lot 5e) : « À rédiger » bloquant, « À relire » en recommandation. */
  aiDraft?: SequenceValidationOptions['aiDraft'];
}

export function useSequenceEditorSession<D>(options: SessionOptions<D>) {
  const { editor, loaded, name, settings, settingsDirty, creating, aiDraft } = options;
  const { variables } = useUserTemplateVariables();
  const customKeys = useMemo(() => variables.map((v) => v.key), [variables]);
  const multiSender = !!settings?.multiSenderEnabled;
  const senders = settings?.senderAccounts;
  const team = useMultiSenderTeam(multiSender && (senders?.length ?? 0) > 0);
  const linkedSenderIds = useMemo(() => (team.isSuccess ? linkedSenderIdsOf(team.data) : null), [team.isSuccess, team.data]);

  const validation = useMemo(() => validateSequence(
    { name, steps: editor.steps, multiSenderEnabled: multiSender, senderAccounts: senders ?? [] },
    linkedSenderIds,
    { unknownVariables: 'block', customKeys, aiDraft },
  ), [name, editor.steps, multiSender, senders, linkedSenderIds, customKeys, aiDraft]);

  const stepsDirty = loaded && (creating || editor.dirty);
  // Réglages modifiés sans que l'onglet Étapes ait été ouvert : enregistrables seuls.
  const dirty = stepsDirty || settingsDirty;
  // Seuls les réglages ont changé : seuls les expéditeurs bloquent (comme l'enregistrement des Réglages).
  const errors = useMemo(
    () => (stepsDirty ? validation.errors : validation.errors.filter((e) => e.area === 'senders')),
    [stepsDirty, validation.errors],
  );

  const flow = useEditorSaveFlow({
    dirty,
    errors,
    warnings: stepsDirty ? validation.warnings : [],
    removedStepCount: options.removedStepCount,
    activeEnrollmentCount: options.activeEnrollmentCount,
    perform: options.perform,
    onBlocked: options.onBlocked,
  });

  const draft = useSequenceEditorDraft({
    key: loaded ? options.draftKey : null,
    base: options.draftBase,
    value: options.draftValue,
    dirty: options.draftDirty,
    onRestore: options.onDraftRestore,
  });

  const leave = useLeaveGuard({
    dirty: dirty && (!creating || options.draftDirty),
    onDiscard: () => {
      options.onDiscard();
      draft.clear();
    },
    onBeforeUnload: draft.flush,
  });

  // Ctrl/Cmd+S enregistre ; jamais la fenêtre d'enregistrement du navigateur.
  const saveRef = useRef({ dirty, save: flow.save });
  saveRef.current = { dirty, save: flow.save };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.key.toLowerCase() !== 's') return;
      event.preventDefault();
      if (saveRef.current.dirty) saveRef.current.save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const selected = editor.selectedId ? editor.steps.find((s) => s.id === editor.selectedId) : undefined;
  const previewKeys = useMemo(() => templateKeys(editor.steps.flatMap((s) => [s.messageTemplate, s.subjectTemplate])), [editor.steps]);
  const preview = useSequencePreview({
    organizationId: options.organizationId,
    sequenceId: options.sequenceId,
    missionId: options.missionId,
    keys: previewKeys,
    enabled: loaded && options.stepsTabActive && !!selected && stepHasMessageField(selected.actionType),
  });

  return { validation, customKeys, stepsDirty, dirty, flow, draft, leave, preview };
}
