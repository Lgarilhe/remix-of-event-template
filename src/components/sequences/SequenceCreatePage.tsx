// Nouvelle séquence dans l'éditeur unique (lot 5d-2), derrière l'interrupteur
// konekt.sequences-v2 : /sequences/nouvelle?mission=<id>&depart=zero|modele:<clé>|copie:<id>.
//
// Départ : séquence vide, modèle Konekt (sequenceStarterTemplates.ts) ou de
// l'organisation (sequence_templates), copie d'une séquence lue sous la RLS
// (« Copie de … », mêmes règles que l'ancien choix de départ). Rien n'est
// écrit avant « Enregistrer » : la séquence est créée par useSequenceSave
// (en-tête, puis save_sequence_steps), sans envoi sur la formule gratuite
// (shouldCreateInactiveForPlan, texte de la spécification), puis la page passe
// sur son adresse (remplacement : pas d'entrée d'historique en double).
// Onglets Étapes et Réglages ; brouillon local, repris à la réouverture de la
// même adresse.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useSequenceSave } from '@/hooks/useSequenceSave';
import { useInertWhile } from '@/hooks/useInertWhile';
import { useSequenceEditor } from '@/hooks/useSequenceEditor';
import { useSequenceEditorSession } from '@/hooks/useSequenceEditorSession';
import { sequenceEditorDraftKey } from '@/hooks/useSequenceEditorDraft';
import { DEFAULT_QUOTAS, useMemberQuotas } from '@/hooks/useMemberQuotas';
import { hasPlanFeature } from '@/lib/featureGates';
import { DEFAULT_STOP_CONDITIONS, type EditorBaseStepIds } from '@/lib/sequenceActions';
import { SEQUENCES_PATH, parseNewSequenceStart, sequencePath, type NewSequenceStart } from '@/lib/sequencesBeta';
import { STARTER_TEMPLATES, starterTemplateToSequence, templateRowToSequence } from '@/lib/sequenceStarterTemplates';
import { issueStepOrder, openEditorSteps } from '@/lib/sequenceEditor';
import {
  asSenderAccounts,
  asStopConditions,
  renumberByOrderGroup,
  rowToSequenceStep,
  withAlwaysOnStops,
  type SequenceIssue,
  type SequenceStepRow,
} from '@/components/outreach/sequence/sequenceGraph';
import type { Sequence, SequenceStep } from '@/types/sequence';
import { SEOHead } from '@/components/SEOHead';
import { ErrorState, PageLayout } from '@/components/layout';
import { Banner, bannerActionClass } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { SequenceHeader } from './SequenceHeader';
import { SequenceTabs } from './SequenceTabs';
import { SettingsTab, type SequenceSettingsDraft } from './SettingsTab';
import type { SendingHours } from './RhythmLine';
import { StepsEditor } from './editor/StepsEditor';
import { SaveDialogs } from './editor/SaveDialogs';

const CREATE_TABS = ['etapes', 'reglages'] as const;
/** Préfixe du brouillon d'une création : une entrée par mission et par départ. */
const NEW_DRAFT_PREFIX = 'nouvelle:';
type CreateTab = (typeof CREATE_TABS)[number];
const START_ERRORS: Record<NewSequenceStart['kind'], string> = {
  zero: 'Nouvelle séquence indisponible pour l’instant.',
  modele: 'Modèle indisponible pour l’instant.',
  copie: 'Séquence à copier indisponible pour l’instant.',
};

/** Formule sans envoi (spécification, section 4). */
export const FREE_PLAN_NOTICE = 'Votre formule permet de préparer des séquences et d’écrire aux candidats un par un. L’envoi automatique, avec les relances, fait partie des formules payantes.';

// Avis de la formule gratuite : une fois par personne, « Compris » mémorisé dans ce navigateur (même clé que /sequences).
const freeNoticeKey = (userId: string) => `konekt:sequences-free-notice-dismissed:${userId}`;
function isFreeNoticeDismissed(userId: string | null): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(freeNoticeKey(userId)) === '1';
  } catch {
    return false;
  }
}

interface CreateDraftValue {
  name: string;
  steps: SequenceStep[];
  settings: SequenceSettingsDraft | null;
}

function settingsOfSequence(seq: Sequence): SequenceSettingsDraft {
  return {
    stopConditions: withAlwaysOnStops({ ...DEFAULT_STOP_CONDITIONS, ...(seq.stopConditions ?? {}) }),
    multiSenderEnabled: !!seq.multiSenderEnabled,
    senderAccounts: seq.senderAccounts ?? [],
    rotationMode: seq.rotationMode ?? 'round_robin',
  };
}

type Mission = { name: string; title: string | null; client: string | null };
// Colonnes typées `string` : la lecture du chemin JSON (->>) dépasse sinon la profondeur des types générés.
const MISSION_COLUMNS: string = 'name, client_name, title:job_details->>title';

export function SequenceCreatePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const missionParam = searchParams.get('mission') || null;
  const departParam = searchParams.get('depart') || 'zero';
  const start = useMemo<NewSequenceStart>(() => parseNewSequenceStart(departParam) ?? { kind: 'zero' }, [departParam]);
  const tab: CreateTab = searchParams.get('onglet') === 'reglages' ? 'reglages' : 'etapes';
  const setTab = (next: string) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'etapes') params.delete('onglet');
      else params.set('onglet', next);
      return params;
    }, { replace: true });
  };

  // Formule gratuite ou abonnement pas encore lu : la séquence est créée désactivée (décision 32).
  const { effectivePlanId, isLoading: isPlanLoading, isLoadingError: isPlanLoadError } = useSubscriptionState();
  const canSendSequences = isPlanLoading || hasPlanFeature(effectivePlanId, 'sequences_send');
  const planStateUnknown = isPlanLoading || isPlanLoadError;
  // Formule lue et sans envoi : la séquence sera créée sans envoi (Brouillon), annoncé avant d'enregistrer.
  const freePlan = !canSendSequences && !planStateUnknown;
  const [freeNoticeDismissedFor, setFreeNoticeDismissedFor] = useState<string | null>(null);
  const showFreeNotice = freePlan && !(userId && (freeNoticeDismissedFor === userId || isFreeNoticeDismissed(userId)));
  const dismissFreeNotice = () => {
    if (!userId) return;
    setFreeNoticeDismissedFor(userId);
    try {
      localStorage.setItem(freeNoticeKey(userId), '1');
    } catch {
      // Stockage indisponible : l'avis reste fermé pour cette page.
    }
  };

  // Mission lue sous la RLS : la séquence n'y est rattachée que si elle est lisible.
  const [mission, setMission] = useState<{ state: 'loading' | 'ready' | 'none'; value: Mission | null }>({ state: missionParam ? 'loading' : 'none', value: null });
  useEffect(() => {
    if (!missionParam) {
      setMission({ state: 'none', value: null });
      return;
    }
    let cancelled = false;
    setMission({ state: 'loading', value: null });
    void supabase.from('sourcing_projects').select(MISSION_COLUMNS).eq('id', missionParam).maybeSingle().then(({ data }) => {
      if (cancelled) return;
      const row = data as unknown as { name: string | null; client_name: string | null; title: string | null } | null;
      setMission(row?.name ? { state: 'ready', value: { name: row.name, title: row.title?.trim() || null, client: row.client_name ?? null } } : { state: 'none', value: null });
    });
    return () => { cancelled = true; };
  }, [missionParam]);
  const missionId = mission.state === 'ready' ? missionParam : null;

  // Départ : séquence vide, modèle ou copie.
  const [initial, setInitial] = useState<{ state: 'loading' } | { state: 'error' } | { state: 'ready'; sequence: Sequence }>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (mission.state === 'loading' || !organizationId) return;
    let cancelled = false;
    setInitial({ state: 'loading' });
    const done = (sequence: Sequence | null) => {
      if (!cancelled) setInitial(sequence ? { state: 'ready', sequence } : { state: 'error' });
    };
    void (async () => {
      try {
        if (start.kind === 'zero') {
          const job = mission.value?.title || mission.value?.name;
          done({ name: job ? `Approche ${job}` : 'Nouvelle séquence', steps: [], isActive: true, stopConditions: DEFAULT_STOP_CONDITIONS });
          return;
        }
        if (start.kind === 'modele') {
          const starter = STARTER_TEMPLATES.find((t) => t.key === start.key);
          if (starter) {
            done(starterTemplateToSequence(starter));
            return;
          }
          const { data, error } = await supabase
            .from('sequence_templates')
            .select('id, name, description, steps_config, category, is_system, created_at')
            .eq('id', start.key)
            .maybeSingle();
          if (error || !data) {
            done(null);
            return;
          }
          done(templateRowToSequence({
            ...data,
            steps_config: Array.isArray(data.steps_config) ? (data.steps_config as Array<Record<string, unknown>>) : [],
          }));
          return;
        }
        // Copie complète (branches, versions, fins, options e-mail) ; les expéditeurs seulement depuis notre organisation.
        const [{ data: seq, error: seqError }, { data: rows, error: rowsError }] = await Promise.all([
          supabase
            .from('outreach_sequences')
            .select('id, name, description, organization_id, stop_conditions, sender_accounts, rotation_mode, multi_sender_enabled')
            .eq('id', start.id)
            .maybeSingle(),
          supabase.from('sequence_steps').select('*').eq('sequence_id', start.id).order('step_order', { ascending: true }),
        ]);
        if (seqError || rowsError || !seq) {
          done(null);
          return;
        }
        const sameOrganization = seq.organization_id === organizationId;
        done({
          name: `Copie de ${seq.name}`,
          description: seq.description || undefined,
          steps: renumberByOrderGroup(((rows ?? []) as unknown as SequenceStepRow[]).map(rowToSequenceStep)),
          isActive: true,
          stopConditions: asStopConditions(seq.stop_conditions),
          senderAccounts: sameOrganization ? asSenderAccounts(seq.sender_accounts) : [],
          rotationMode: seq.rotation_mode || 'round_robin',
          multiSenderEnabled: sameOrganization && !!seq.multi_sender_enabled,
        });
      } catch (err) {
        console.error('[SequenceCreatePage] départ illisible :', err);
        done(null);
      }
    })();
    return () => { cancelled = true; };
  }, [start, mission.state, mission.value, organizationId, attempt]);

  // État de l'éditeur : étapes, nom, réglages ; rien d'enregistré.
  const editor = useSequenceEditor();
  const { reset: resetEditor } = editor;
  const [name, setName] = useState('');
  const [initialName, setInitialName] = useState('');
  const [baseSettings, setBaseSettings] = useState<SequenceSettingsDraft | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SequenceSettingsDraft | null>(null);
  const [settingsErrors, setSettingsErrors] = useState<string[]>([]);
  const readySequence = initial.state === 'ready' ? initial.sequence : null;
  useEffect(() => {
    if (!readySequence) return;
    // Aucune étape n'est encore en base : une suppression ne demande pas l'historique.
    resetEditor(openEditorSteps(readySequence.steps), []);
    setName(readySequence.name);
    setInitialName(readySequence.name);
    setBaseSettings(settingsOfSequence(readySequence));
    setSettingsDraft(null);
  }, [readySequence, resetEditor]);
  const loaded = !!readySequence && baseSettings !== null;
  const settings = settingsDraft ?? baseSettings;
  const settingsDirty = !!settingsDraft && !!baseSettings && JSON.stringify(settingsDraft) !== JSON.stringify(baseSettings);

  const { isReady: quotasReady, getQuotaForUser } = useMemberQuotas();
  const hours: SendingHours | null = useMemo(() => {
    if (!quotasReady || !userId) return null;
    const own = getQuotaForUser(userId);
    return {
      start: own?.business_hours_start ?? DEFAULT_QUOTAS.business_hours_start,
      end: own?.business_hours_end ?? DEFAULT_QUOTAS.business_hours_end,
      timezone: own?.timezone ?? DEFAULT_QUOTAS.timezone,
    };
  }, [quotasReady, userId, getQuotaForUser]);

  // Enregistrement : création par useSequenceSave, puis la page de la séquence.
  const editorBaseStepIdsRef = useRef<EditorBaseStepIds>(null);
  const createdIdRef = useRef<string | null>(null);
  const { handleSaveSequence } = useSequenceSave({
    organizationId,
    projectId: missionId,
    canSendSequences,
    planStateUnknown,
    editorBaseStepIdsRef,
    navigate,
    fetchSequences: async () => undefined,
    setShowBuilder: () => undefined,
    setEditingSequence: () => undefined,
    onCreated: (id) => { createdIdRef.current = id; },
    // Créée sans envoi faute de droit d'envoi (règle existante, shouldCreateInactiveForPlan) : dit avec le texte de la spécification.
    announceCreated: ({ inactiveForPlan }) => {
      if (!inactiveForPlan) {
        toast.success('Séquence créée');
      } else if (freePlan) {
        // L'avis a déjà donné la raison : le toast dit seulement ce qui a été fait.
        toast.info('Séquence enregistrée sans envoi automatique', {
          action: { label: 'Voir les offres', onClick: () => navigate('/pricing') },
        });
      } else {
        toast.warning('Séquence enregistrée sans envoi', {
          description: 'Votre formule n’a pas pu être vérifiée : activez la séquence depuis sa page.',
        });
      }
    },
  });

  const performSave = async () => {
    if (!readySequence || !settings) return;
    const sequence: Sequence = {
      name: name.trim(),
      description: readySequence.description,
      steps: editor.steps,
      isActive: true,
      stopConditions: withAlwaysOnStops(settings.stopConditions),
      senderAccounts: settings.senderAccounts,
      rotationMode: settings.rotationMode,
      multiSenderEnabled: settings.multiSenderEnabled,
    };
    createdIdRef.current = null;
    await handleSaveSequence(sequence);
    session.draft.clear();
    // Première création : la page passe sur l'adresse de la séquence, à la place de /sequences/nouvelle (pas d'entrée d'historique en double).
    const id = createdIdRef.current;
    if (id) {
      const path = sequencePath(id, missionId);
      navigate(`${path}${path.includes('?') ? '&' : '?'}onglet=etapes`, { replace: true });
    }
  };

  const showBlocked = (errors: readonly SequenceIssue[]) => {
    const first = errors[0];
    if (!first) return;
    if (first.area === 'senders') {
      setSettingsErrors(errors.filter((e) => e.area === 'senders').map((e) => e.message));
      setTab('reglages');
      return;
    }
    setTab('etapes');
    const order = issueStepOrder(first.message);
    const target = order === null ? undefined : editor.steps.find((s) => s.order === order && (!s.variantGroup || s.variantGroup === 'A'));
    if (target) editor.select(target.id);
  };

  const resetToStart = useCallback(() => {
    editor.discard();
    setName(initialName);
    setSettingsDraft(null);
    setSettingsErrors([]);
  }, [editor, initialName]);

  const draftValue = useMemo<CreateDraftValue>(() => ({ name, steps: editor.steps, settings: settingsDraft }), [name, editor.steps, settingsDraft]);
  const session = useSequenceEditorSession<CreateDraftValue>({
    editor,
    loaded,
    name,
    settings,
    settingsDirty,
    creating: true,
    organizationId,
    sequenceId: null,
    missionId,
    stepsTabActive: tab === 'etapes',
    draftKey: sequenceEditorDraftKey(userId, organizationId, `${NEW_DRAFT_PREFIX}${missionParam ?? ''}:${departParam}`),
    draftBase: loaded ? 'creation' : null,
    draftValue,
    draftDirty: editor.dirty || name !== initialName || settingsDirty,
    onDraftRestore: (value, savedAt) => {
      editor.restore(value.steps);
      if (value.name) setName(value.name);
      if (value.settings) setSettingsDraft(value.settings);
      toast.info('Brouillon de séquence repris', {
        description: savedAt
          ? `Votre travail du ${savedAt.toLocaleDateString('fr-FR')} à ${savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} a été conservé.`
          : 'Votre travail précédent a été conservé.',
        duration: 12000,
        action: { label: 'Repartir de zéro', onClick: () => { resetToStart(); session.draft.clear(); } },
      });
    },
    removedStepCount: 0,
    activeEnrollmentCount: 0,
    perform: performSave,
    onBlocked: showBlocked,
    onDiscard: resetToStart,
  });

  // Enregistrement en cours : étapes et réglages figés jusqu'au passage sur la page de la séquence.
  const settingsAreaRef = useRef<HTMLDivElement>(null);
  useInertWhile(settingsAreaRef, session.flow.saving);

  const back = missionParam ? `/missions/${encodeURIComponent(missionParam)}?panneau=contact` : SEQUENCES_PATH;

  return (
    <PageLayout maxWidth="xl">
      <SEOHead title={`${name || 'Nouvelle séquence'} | Konekt`} description="Nouvelle séquence" />

      {(initial.state === 'loading' || (initial.state === 'ready' && !loaded)) && (
        <div role="status" aria-label="Préparation de la séquence" className="space-y-4">
          <Skeleton className="h-4 w-40 rounded-sm" />
          <Skeleton className="h-9 w-80 rounded-sm" />
          <Skeleton className="h-11 w-full rounded-sm" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-sm" />)}
        </div>
      )}

      {initial.state === 'error' && (
        <ErrorState
          title={START_ERRORS[start.kind]}
          description="Vérifiez votre connexion puis réessayez, ou partez d’une séquence vide."
          onRetry={() => setAttempt((n) => n + 1)}
          action={
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate(back)}>
              Retour
            </Button>
          }
        />
      )}

      {loaded && settings && (
        <>
          <SequenceHeader
            name={name}
            mission={missionId && mission.value ? { id: missionId, name: mission.value.name } : null}
            canRename
            onRename={async (next) => {
              setName(next);
              return true;
            }}
            dirty
            saving={session.flow.saving}
            onSave={session.flow.save}
            saveState={session.flow.state === 'saving' || session.flow.state === 'error' ? session.flow.state : 'unsaved'}
            enrollHref={null}
          />
          {showFreeNotice && (
            <Banner
              tone="info"
              icon={Lock}
              className="mb-4 rounded-lg border"
              action={
                <span className="flex shrink-0 items-center gap-4">
                  <Link to="/pricing" className={`${bannerActionClass} max-md:inline-flex max-md:min-h-11 max-md:items-center`}>Voir les offres</Link>
                  <Button type="button" variant="link" onClick={dismissFreeNotice} className={`h-auto p-0 ${bannerActionClass} max-md:min-h-11`}>
                    Compris
                  </Button>
                </span>
              }
            >
              {FREE_PLAN_NOTICE}
            </Banner>
          )}
          <Tabs value={tab} onValueChange={setTab}>
            <SequenceTabs
              active={tab}
              hasEnrollments={false}
              candidateCount={null}
              journalAlert={false}
              only={CREATE_TABS}
              stepsAlert={session.validation.errors.some((e) => e.area !== 'senders' && e.check !== 'steps')}
              settingsAlert={session.validation.errors.some((e) => e.area === 'senders')}
            />
            <TabsContent value="etapes" className="mt-6">
              <StepsEditor
                editor={editor}
                validation={session.validation}
                enrolledCount={0}
                state="ready"
                onRetry={() => undefined}
                preview={session.preview}
                extraKeys={session.customKeys}
                onShowSettings={() => setTab('reglages')}
                frozen={session.flow.saving}
              />
            </TabsContent>
            <TabsContent value="reglages" className="mt-6">
              <div ref={settingsAreaRef} aria-busy={session.flow.saving || undefined}>
                <SettingsTab
                  value={settings}
                  onChange={(next) => { setSettingsDraft(next); setSettingsErrors([]); }}
                  canEdit
                  readOnlyHint=""
                  missionLabel={mission.value ? [mission.value.name, mission.value.client].filter(Boolean).join(' · ') : null}
                  hours={hours}
                  errors={settingsErrors}
                />
              </div>
            </TabsContent>
          </Tabs>
          <SaveDialogs flow={session.flow} leave={session.leave} />
        </>
      )}
    </PageLayout>
  );
}
