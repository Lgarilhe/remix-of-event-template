/**
 * Écran « Séquences » de l'organisation (lot 5c-2), derrière l'interrupteur
 * konekt.sequences-v2 (src/lib/sequencesBeta.ts, garde SequencesGate).
 *
 * Onglets (?onglet=) : « Toutes » (tableau des séquences de l'organisation),
 * « À venir » (file des étapes prévues, celle du Journal), « Modèles »
 * (modèles Konekt du code et modèles de l'organisation), « Statistiques »
 * (statistiques de toutes les séquences).
 *
 * En-tête : « Envoyer les actions du jour » sur les séquences actives de
 * l'organisation (nudge_sequences, avec la confirmation actuelle) et « Créer
 * une séquence », seul bouton plein, qui ouvre « Nouvelle séquence »
 * (NewSequenceDialog). Depuis le lot 5d-2, la création et la modification
 * passent par l'éditeur unique : /sequences/nouvelle et l'onglet Étapes de
 * /sequences/:id (rien n'est écrit avant « Enregistrer »).
 *
 * Les gestes reprennent les actions de la liste des séquences
 * (src/lib/sequenceActions.ts) : mise en pause immédiate avec « Annuler »
 * (lot 5b), « Réactiver cette séquence ? », dupliquer, enregistrer comme
 * modèle, supprimer derrière « Supprimer cette séquence ? ». Aucune écriture
 * d'exécution ni de reprise depuis cet écran : les reprises passent par le
 * serveur (resume_enrollments).
 */
import React, { useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { AlertTriangle, FastForward, Lock, Plus, Search } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useUndoableEnrollmentAction } from '@/hooks/useUndoableEnrollmentAction';
import { useOrgSequences } from '@/hooks/useOrgSequences';
import { useSourcingProjects } from '@/hooks/useSourcingProjects';
import { useMemberName } from '@/hooks/useTeamMembers';
import { hasPlanFeature } from '@/lib/featureGates';
import { plural } from '@/lib/plural';
import { cn } from '@/lib/utils';
import { newSequencePath, sequencePath } from '@/lib/sequencesBeta';
import {
  candidats,
  COLLABORATOR_DEACTIVATION_HINT,
  createSequenceListActions,
  PLAN_STATE_LOADING_MESSAGE,
  type ActivateConfirm,
  type EditorBaseStepIds,
  type SequenceWithStats,
} from '@/lib/sequenceActions';
import { sequenceRates } from '@/lib/sequenceTableStats';
import { SEOHead } from '@/components/SEOHead';
import { EmptyState, ErrorState, PageHeader, PageLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Banner, bannerActionClass } from '@/components/ui/banner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SaveAsTemplateModal } from '@/components/outreach/SaveAsTemplateModal';
import { SequenceActivityLog } from '@/components/outreach/SequenceActivityLog';
import { SequenceRow, type RowFigures } from '@/components/sequences/SequenceRow';
import { SequencesTable, SequencesTableSkeleton } from '@/components/sequences/SequencesTable';
import { TemplatesGallery } from '@/components/sequences/TemplatesGallery';
import { NewSequenceDialog } from '@/components/sequences/NewSequenceDialog';

// Statistiques : recharts (~100 Ko) chargé à l'ouverture de l'onglet.
const SequenceAnalytics = React.lazy(() => import('@/components/outreach/SequenceAnalytics'));

type SequencesTab = 'toutes' | 'a-venir' | 'modeles' | 'statistiques';
const TABS: ReadonlyArray<{ value: SequencesTab; label: string }> = [
  { value: 'toutes', label: 'Toutes' },
  { value: 'a-venir', label: 'À venir' },
  { value: 'modeles', label: 'Modèles' },
  { value: 'statistiques', label: 'Statistiques' },
];
const TAB_PARAM = 'onglet';
const parseTab = (raw: string | null): SequencesTab =>
  (TABS.some((t) => t.value === raw) ? raw : 'toutes') as SequencesTab;

// Formule sans envoi : bandeau de la spécification (section 4), une fois par personne (« Compris » mémorisé dans ce navigateur).
const freeNoticeKey = (userId: string) => `konekt:sequences-free-notice-dismissed:${userId}`;
function isFreeNoticeDismissed(userId: string | null): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(freeNoticeKey(userId)) === '1';
  } catch {
    return false;
  }
}

const OTHER_ORG_READ_ONLY_HINT = 'Séquence d’une autre organisation : vous pouvez la consulter, pas la modifier.';
const NOT_AUTHOR_READ_ONLY_HINT = 'Seul l’auteur de cette séquence peut la modifier : dupliquez-la pour l’adapter.';

export default function SequencesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get(TAB_PARAM));
  const setTab = (next: string) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'toutes') params.delete(TAB_PARAM);
    else params.set(TAB_PARAM, next);
    setSearchParams(params, { replace: true });
  };

  const { organizationId, isCollaborator } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const memberName = useMemberName();
  const { projects } = useSourcingProjects('mission');
  const planNoticeId = useId();

  // Décision 32 : aucune activation tant que l'état d'abonnement n'est pas lu.
  const { effectivePlanId, isLoading: isPlanLoading, isLoadingError: isPlanLoadError, refetch: refetchPlan } = useSubscriptionState();
  const canSendSequences = isPlanLoading || hasPlanFeature(effectivePlanId, 'sequences_send');
  const planStateUnknown = isPlanLoading || isPlanLoadError;
  const planRef = useRef({ unknown: planStateUnknown, loadError: isPlanLoadError, canSend: canSendSequences });
  planRef.current = { unknown: planStateUnknown, loadError: isPlanLoadError, canSend: canSendSequences };

  const { sequences, setSequences, loading, loadError, loadErrorDetail, detailError, extras, fetchSequences } = useOrgSequences();
  const { offerUndo, resumeIds, showSummary } = useUndoableEnrollmentAction();

  const [searchQuery, setSearchQuery] = useState('');
  const [retrying, setRetrying] = useState(false);
  const [newDialogOpen, setNewDialogOpen] = useState(false);
  // L'ancien éditeur n'est plus ouvert ici : la modification passe par la page de la séquence.
  const editorBaseStepIdsRef = useRef<EditorBaseStepIds>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [activateConfirm, setActivateConfirm] = useState<ActivateConfirm>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const duplicatingRef = useRef(false);
  const [nudging, setNudging] = useState(false);
  const [nudgeConfirmOpen, setNudgeConfirmOpen] = useState(false);
  const [saveTemplateSeq, setSaveTemplateSeq] = useState<SequenceWithStats | null>(null);
  const [freeNoticeDismissedFor, setFreeNoticeDismissedFor] = useState<string | null>(null);

  const canManage = (seq: SequenceWithStats) => !!organizationId && seq.organization_id === organizationId;
  // Contrat §8 : un collaborateur ne modifie, ne supprime et n'active que ses séquences.
  const canEdit = (seq: SequenceWithStats) =>
    canManage(seq) && (!isCollaborator || (!!userId && seq.created_by === userId));
  const readOnlyHint = (seq: SequenceWithStats) => (canManage(seq) ? NOT_AUTHOR_READ_ONLY_HINT : OTHER_ORG_READ_ONLY_HINT);
  // D3 : la mise en pause de toute la séquence n'est pas proposée à un collaborateur.
  const deactivationLocked = (seq: SequenceWithStats) => seq.is_active && isCollaborator;
  // Bouton d'un toast : les candidats restés en pause se reprennent sur la page de la séquence.
  const enrollmentsPanelAction = (sequenceId: string) => ({
    action: { label: 'Voir les inscrits', onClick: () => navigate(`${sequencePath(sequenceId)}?onglet=candidats`) },
  });

  // « Envoyer les actions du jour » : les séquences actives que la personne peut gérer.
  const nudgeSequenceIds = sequences.filter((s) => canManage(s) && s.is_active).map((s) => s.id);

  const { handleNudgeToday, activateSequence, requestToggle, handleDelete, handleDuplicate } = createSequenceListActions({
    supabase, invokeEdgeFunction, toast, navigate,
    organizationId, projectId: null, userId, isCollaborator,
    sequences, setSequences, fetchSequences, togglingId, setTogglingId,
    canManage, canEdit, readOnlyHint, deactivationLocked, enrollmentsPanelAction,
    offerUndo, resumeIds, showSummary,
    planRef, refetchPlan, planStateUnknown, isPlanLoadError, canSendSequences,
    missionSequenceIds: nudgeSequenceIds, setNudging, setNudgeConfirmOpen,
    setActivateConfirm, setDeleteConfirmId, duplicatingRef, setDuplicatingId,
    editorBaseStepIdsRef, setEditingActiveCount: () => undefined, setEditingSequence: () => undefined, setShowBuilder: () => undefined,
    // Même nom de copie que la page d'une séquence (vocabulaire figé : « Copie de … »).
    copyName: (name) => `Copie de ${name}`,
  });

  // « Modifier » : l'onglet Étapes de la page de la séquence (éditeur unique).
  const editSequence = (seq: SequenceWithStats) => navigate(`${sequencePath(seq.id)}?onglet=etapes`);

  const handleRetry = async () => {
    setRetrying(true);
    await fetchSequences();
    setRetrying(false);
  };

  // Mission de chaque séquence : nom et client, comme la liste des missions.
  const missionsById = useMemo(() => new Map(projects.map((p) => [p.id, p])), [projects]);
  const subtitleOf = (seq: SequenceWithStats): string => {
    const parts: string[] = [];
    if (!seq.is_active && seq.enrollments.total > 0) parts.push('En pause');
    if (seq.project_id) {
      const mission = missionsById.get(seq.project_id);
      if (mission) {
        parts.push(mission.name);
        const client = mission.jd_client?.trim() || mission.client_name?.trim();
        if (client) parts.push(client);
      }
    }
    const author = memberName(seq.created_by);
    if (author) parts.push(author === 'vous' ? 'par vous' : author);
    return parts.join(' · ');
  };

  const sendersOf = (seq: SequenceWithStats): string[] => {
    const ids = extras.status === 'ready' ? extras.value.contacts.get(seq.id)?.enrollers ?? [] : [];
    const names = (ids.length > 0 ? ids : seq.created_by ? [seq.created_by] : [])
      .map((id) => memberName(id))
      .map((name) => (name === 'vous' ? 'Vous' : name))
      .filter((name): name is string => !!name);
    return [...new Set(names)];
  };

  const figuresOf = (seq: SequenceWithStats): RowFigures => {
    if (extras.status !== 'ready') return { status: extras.status };
    if (detailError.counts) return { status: 'error' };
    const invites = extras.value.invites.get(seq.id) ?? { sent: 0, accepted: 0 };
    return {
      status: 'ready',
      rates: sequenceRates({
        replied: seq.enrollments.replied,
        contacted: extras.value.contacts.get(seq.id)?.contacted ?? 0,
        invitesSent: invites.sent,
        invitesAccepted: invites.accepted,
      }),
    };
  };

  const query = searchQuery.trim().toLowerCase();
  const filtered = query ? sequences.filter((s) => s.name.toLowerCase().includes(query)) : sequences;
  const someRateHidden = filtered.some((s) => {
    const f = figuresOf(s);
    return f.status === 'ready' && s.enrollments.total > 0 && f.rates.replyRate === null;
  });
  const deleteTarget = deleteConfirmId ? sequences.find((s) => s.id === deleteConfirmId) : undefined;

  const nudgeHelp = 'Avance à maintenant les actions prévues plus tard aujourd’hui, sauf les invitations LinkedIn. Elles partent progressivement pendant vos heures d’envoi.';
  const showFreeNotice = !canSendSequences && !planStateUnknown
    && !(userId && (freeNoticeDismissedFor === userId || isFreeNoticeDismissed(userId)));
  const dismissFreeNotice = () => {
    if (!userId) return;
    setFreeNoticeDismissedFor(userId);
    try {
      localStorage.setItem(freeNoticeKey(userId), '1');
    } catch {
      // stockage indisponible : le bandeau reste fermé pour la session en cours
    }
  };

  const renderAll = () => {
    if (loading) return <SequencesTableSkeleton />;
    if (loadError && sequences.length === 0) {
      return (
        <ErrorState
          title="Séquences indisponibles pour l’instant."
          description="Vérifiez votre connexion puis réessayez. Vos séquences ne sont pas perdues."
          detail={loadErrorDetail}
          onRetry={handleRetry}
          retrying={retrying}
        />
      );
    }
    if (sequences.length === 0) {
      return (
        <EmptyState
          illustration="envoi"
          title="Aucune séquence pour l’instant."
          description="Une séquence contacte vos candidats en plusieurs étapes LinkedIn et s’arrête dès qu’ils répondent. Elle se crée le plus souvent depuis une mission."
          action={
            <Button type="button" variant="outline" size="sm" onClick={() => setTab('modeles')} className="max-md:h-11">
              Voir les modèles
            </Button>
          }
        />
      );
    }
    return (
      <div className="space-y-4">
        {loadError && (
          <Banner tone="warning" icon={AlertTriangle} role="alert" className="rounded-lg border" action={
            <Button type="button" variant="link" onClick={handleRetry} loading={retrying} className={`h-auto p-0 ${bannerActionClass}`}>
              Réessayer
            </Button>
          }>
            La liste n’a pas pu être actualisée : elle date du dernier chargement.
          </Banner>
        )}
        {!loadError && (detailError.steps || detailError.counts) && (
          <Banner tone="warning" icon={AlertTriangle} role="alert" className="rounded-lg border" action={
            <Button type="button" variant="link" onClick={handleRetry} loading={retrying} className={`h-auto p-0 ${bannerActionClass}`}>
              Réessayer
            </Button>
          }>
            Inscriptions indisponibles pour l’instant.
          </Banner>
        )}

        <div className="relative max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Rechercher une séquence"
            placeholder="Rechercher une séquence"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 max-md:h-11"
          />
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={Search}
            title="Aucune séquence ne correspond à ces filtres."
            action={
              <Button type="button" variant="outline" size="sm" onClick={() => setSearchQuery('')} className="max-md:h-11">
                Effacer les filtres
              </Button>
            }
          />
        ) : (
          <SequencesTable footnote={someRateHidden ? 'Un taux s’affiche à partir de 5 candidats contactés.' : undefined}>
            {filtered.map((seq) => {
              const activationBlocked = canEdit(seq) && !seq.is_active && !canSendSequences && !planStateUnknown;
              const waitsForPlan = !seq.is_active && isPlanLoading;
              return (
                <SequenceRow
                  key={seq.id}
                  seq={seq}
                  subtitle={subtitleOf(seq)}
                  senders={sendersOf(seq)}
                  figures={figuresOf(seq)}
                  countsUnavailable={detailError.counts}
                  canEdit={canEdit(seq)}
                  canManage={canManage(seq)}
                  readOnlyHint={readOnlyHint(seq)}
                  toggleDisabled={togglingId === seq.id || waitsForPlan}
                  toggleLocked={deactivationLocked(seq)}
                  toggleTitle={deactivationLocked(seq) ? COLLABORATOR_DEACTIVATION_HINT : waitsForPlan ? PLAN_STATE_LOADING_MESSAGE : undefined}
                  activationNoticeId={activationBlocked && showFreeNotice ? planNoticeId : undefined}
                  duplicating={duplicatingId === seq.id}
                  duplicateDisabled={!!duplicatingId}
                  onToggle={() => { void requestToggle(seq); }}
                  onEdit={() => editSequence(seq)}
                  onDuplicate={() => { void handleDuplicate(seq); }}
                  onSaveTemplate={() => setSaveTemplateSeq(seq)}
                  onDelete={() => setDeleteConfirmId(seq.id)}
                />
              );
            })}
          </SequencesTable>
        )}
      </div>
    );
  };

  const count = !loading && !loadError ? sequences.length : 0;

  return (
    <PageLayout maxWidth="xl">
      <SEOHead title="Séquences | Konekt" description="Les séquences de votre organisation" />
      <PageHeader
        title="Séquences"
        actions={
          <>
            {/* Aucune séquence active : rien à avancer, le bouton n'est pas affiché (06-simplicite, règle 8). */}
            {nudgeSequenceIds.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setNudgeConfirmOpen(true)}
                      disabled={nudging}
                      loading={nudging}
                      className="max-md:h-11"
                    >
                      {!nudging && <FastForward aria-hidden="true" />}
                      {nudging ? 'En cours…' : 'Envoyer les actions du jour'}
                    </Button>
                  </span>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">{nudgeHelp}</TooltipContent>
              </Tooltip>
            )}
            <Button type="button" variant="primary" size="sm" onClick={() => setNewDialogOpen(true)} className="max-md:h-11">
              <Plus aria-hidden="true" />
              Créer une séquence
            </Button>
          </>
        }
      />

      {/* Formule sans envoi, abonnement lu : texte de la spécification, une fois par personne. */}
      {showFreeNotice && (
        <Banner
          tone="info"
          icon={Lock}
          className="mb-4 rounded-lg border"
          action={
            <span className="flex shrink-0 items-center gap-4">
              <Link to="/pricing" className={bannerActionClass}>Voir les offres</Link>
              <Button type="button" variant="link" onClick={dismissFreeNotice} className={`h-auto p-0 ${bannerActionClass}`}>
                Compris
              </Button>
            </span>
          }
        >
          <span id={planNoticeId}>
            Votre formule permet de préparer des séquences et d’écrire aux candidats un par un. L’envoi automatique, avec les relances, fait partie des formules payantes.
          </span>
        </Banner>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <div className="border-b border-border">
          <TabsList className="-mb-px h-11 gap-1 overflow-x-auto bg-transparent p-0 scrollbar-hide">
            {TABS.map(({ value, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className={cn(
                  'relative h-full shrink-0 bg-transparent px-3 text-muted-foreground',
                  'after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-foreground after:opacity-0',
                  'data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:ring-0 data-[state=active]:after:opacity-100',
                )}
              >
                {label}
                {value === 'toutes' && count > 0 && (
                  <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{count}</span>
                )}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="toutes" className="mt-6">{renderAll()}</TabsContent>
        <TabsContent value="a-venir" className="mt-6 space-y-4">
          <p className="text-sm text-muted-foreground">
            Les étapes prévues de vos séquences, jour par jour.{isCollaborator ? ' Vous y voyez les envois des candidats que vous avez inscrits.' : ''}
          </p>
          <SequenceActivityLog isOpen={false} onClose={() => undefined} embedded defaultPeriod="upcoming" />
        </TabsContent>
        <TabsContent value="modeles" className="mt-6">
          <TemplatesGallery onUse={(_sequence, key) => navigate(newSequencePath({ kind: 'modele', key }))} />
        </TabsContent>
        <TabsContent value="statistiques" className="mt-6">
          <React.Suspense fallback={null}>
            <SequenceAnalytics isOpen={false} onClose={() => undefined} embedded />
          </React.Suspense>
        </TabsContent>
      </Tabs>

      {/* « Nouvelle séquence » : départ vide, modèle ou copie, puis l'éditeur unique (/sequences/nouvelle). */}
      <NewSequenceDialog
        open={newDialogOpen}
        onOpenChange={setNewDialogOpen}
        missionId={null}
        existingSequences={sequences.filter(canManage)}
      />

      {saveTemplateSeq && (
        <SaveAsTemplateModal
          isOpen={!!saveTemplateSeq}
          onClose={() => setSaveTemplateSeq(null)}
          sequenceId={saveTemplateSeq.id}
          sequenceName={saveTemplateSeq.name}
          steps={saveTemplateSeq.steps}
        />
      )}

      {/* Suppression : nombre d'inscrits touchés et perte de l'anti-doublon de 90 jours. */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3">
                {deleteTarget && !detailError.counts && deleteTarget.enrollments.total > 0 ? (
                  <p>
                    {plural(deleteTarget.enrollments.total, 'candidat y est inscrit', 'candidats y sont inscrits')}. Leurs envois à venir
                    sont annulés, et Konekt ne pourra plus s’en servir pour éviter de les recontacter dans les 90 jours.
                  </p>
                ) : (
                  <p>Ses étapes et son historique d’envoi sont supprimés.</p>
                )}
                {deleteTarget && !deleteTarget.project_id && (
                  <p className="font-medium text-foreground">Cette séquence est partagée entre toutes vos missions : elle disparaîtra partout.</p>
                )}
                <p>Cette action est irréversible. Préférez la mise en pause de la séquence pour garder cette protection.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
              className="bg-destructive hover:bg-destructive/90"
            >
              Supprimer définitivement
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Réactivation avec des candidats à reprendre : confirmation préalable. */}
      <AlertDialog open={!!activateConfirm} onOpenChange={(open) => !open && setActivateConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réactiver cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {candidats(activateConfirm?.resumable ?? 0)} en pause {(activateConfirm?.resumable ?? 0) > 1 ? 'reprendront' : 'reprendra'}.
                  Chaque étape garde sa date prévue ; celles déjà passées partiront dans les prochaines heures.
                </p>
                {(activateConfirm?.otherMembers ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {candidats(activateConfirm?.otherMembers ?? 0)} inscrits par d’autres membres resteront en pause : un administrateur
                    ou le membre qui les a inscrits peut les reprendre depuis la page de la séquence.
                  </p>
                )}
                {(activateConfirm?.otherPaused ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {candidats(activateConfirm?.otherPaused ?? 0)} mis en pause pour une autre raison (un par un, compte déconnecté,
                    limite atteinte) {(activateConfirm?.otherPaused ?? 0) > 1 ? 'resteront' : 'restera'} en pause.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (activateConfirm) {
                  void activateSequence(activateConfirm.id, activateConfirm.resumable, activateConfirm.otherPaused, activateConfirm.otherMembers);
                }
                setActivateConfirm(null);
              }}
            >
              Réactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* « Envoyer les actions du jour » déclenche des envois : confirmation actuelle. */}
      <AlertDialog open={nudgeConfirmOpen} onOpenChange={setNudgeConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Envoyer maintenant les actions du jour ?</AlertDialogTitle>
            <AlertDialogDescription>
              Les actions prévues aujourd’hui dans {nudgeSequenceIds.length > 1 ? `vos ${nudgeSequenceIds.length} séquences actives` : 'votre séquence active'} partiront
              progressivement pendant vos heures d’envoi. Les relances des jours suivants gardent leur date. Hors invitations LinkedIn.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleNudgeToday(); }}>
              Envoyer maintenant
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
}
