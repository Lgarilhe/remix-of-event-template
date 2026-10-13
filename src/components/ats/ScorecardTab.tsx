/**
 * Grille d'entretien d'un candidat (scorecard) : les grilles de la personne
 * connectée, la génération par l'IA Konekt, la notation critère par critère et
 * la recommandation finale.
 *
 * Enregistrement continu (revue design E-04) : chaque modification (note,
 * commentaire, recommandation, résumé, points de suivi) part 1,5 s après la
 * dernière saisie. Une saisie en attente part aussi quand on quitte la grille,
 * quand le composant se démonte (changement d'onglet de la fiche) et avant
 * d'ouvrir le plein écran. Chaque écriture est relue : un refus des droits
 * répond sans erreur sur 0 ligne, c'est un échec, jamais un succès. Le statut
 * reste affiché (« Modifications non enregistrées », « Enregistrement… »,
 * « Enregistré à HH:mm », « Échec de l'enregistrement » avec « Réessayer »).
 *
 * Suppression et régénération passent par une confirmation (E-05). Verdicts,
 * types d'entretien et catégories viennent de tables en français, sans couleur
 * décorative (src/lib/verdicts.ts, E-16, E-32).
 */

import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format, isToday } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import {
  AlertTriangle, Check, ChevronLeft, ClipboardList, Loader2, Maximize2,
  Mic, Plus, RotateCcw, Trash2,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import type { Json, Tables } from '@/integrations/supabase/types';
import { invokeEdgeFunction, isInsufficientCreditsError } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { HIRING_VERDICTS, INTERVIEW_TYPES, hiringVerdictMeta, interviewTypeLabel } from '@/lib/verdicts';
import { cn } from '@/lib/utils';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/layout/ErrorState';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ATSCandidate } from '@/hooks/useATSData';
import { missionIdOfJob } from '@/hooks/useEnrollmentPreview';
import type { JobDetails } from '@/types/jobDetails';
import { useOrganization } from '@/hooks/useOrganization';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import {
  LiveCoachingPanel, type CallReport, type CriterionUpdate, type ReportRecommendation,
} from './LiveCoachingPanel';
import { plural } from '@/lib/plural';
import {
  ScorecardEditor, type ScorecardCriterion as Criterion, type ScorecardRecommendation as Recommendation,
  type ScorecardInterviewStage as InterviewStage, type ScorecardEditorValue,
} from './ScorecardEditor';

/** Résumé de la grille ouverte : l'en-tête du plein écran le suit sans interroger la base. */
export interface ScorecardSummary {
  criteriaCount: number;
  ratedCount: number;
  overallScore: number | null;
  recommendation: string | null;
}

interface ScorecardTabProps {
  candidate: ATSCandidate;
  enrichedProfile: EnrichedProfile | null;
  onOpenProfile?: () => void;
  autoStartCoaching?: boolean;
  /** Si true, déclenche la génération à l'ouverture (CTA « Préparer l'entretien »
   *  du calendrier). Ne se déclenche qu'une fois, et seulement si aucune grille
   *  n'existe déjà. */
  autoGenerate?: boolean;
  /** Si true et qu'une grille existe, ouvre directement la plus récente
   *  (plein écran : on y vient pour évaluer, pas pour voir une liste). */
  autoOpenFirst?: boolean;
  onActiveEvaluationChange?: (summary: ScorecardSummary | null) => void;
  /** L'assistant d'entretien enregistre, ou s'arrête. */
  onRecordingChange?: (recording: boolean) => void;
  /** Événement vérifié de l'entretien, fourni par le calendrier. */
  qualificationSessionId?: string | null;
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'error';

interface EvaluationData extends ScorecardEditorValue {
  /** Clé locale stable : l'identifiant en base, ou une clé provisoire avant la première écriture. */
  key: string;
  id?: string;
  savedAt?: string;
  projectId?: string | null;
  processStepId?: string | null;
  qualificationSessionId?: string | null;
  /** Rattachement d'une grille pas encore écrite : le candidat et le poste au moment de sa création. */
  origin?: { candidateId: string; jobId: string | null; jobTitle: string | null; organizationId: string | null; projectId: string | null; processStepId: string | null; qualificationSessionId: string | null };
}

/** Champs du brief de mission lus pour situer la génération. */
interface BriefFields {
  title?: string;
  client?: { name?: string };
  mission_description?: string;
  context?: string;
  seniority?: string;
  experience_min?: number;
  experience_max?: number;
  skills_must_have?: string[];
  skills_should_have?: string[];
  skills_nice_to_have?: string[];
  evaluation_criteria?: JobDetails['evaluation_criteria'];
  evaluation_weights?: unknown;
}

const AUTOSAVE_DELAY_MS = 1500;

const INTERVIEW_STAGE_KEYS = Object.keys(INTERVIEW_TYPES) as InterviewStage[];

/** Choix sélectionné d'un groupe : aplat monochrome, comme le bouton principal (E-32). */
const CHOICE_CLASS =
  'data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:font-semibold data-[state=on]:text-background data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background';

/** Refus de crédits : le toast est déjà affiché par invokeWithCredits. */
class CreditsError extends Error {}

let localKeySeq = 0;
const newLocalKey = () => `local-${Date.now()}-${++localKeySeq}`;

const formatAverage = (value: number) =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function savedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Enregistré';
  return isToday(date)
    ? `Enregistré à ${format(date, 'HH:mm')}`
    : `Enregistré le ${format(date, "d MMM 'à' HH:mm", { locale: fr })}`;
}

function computeOverallScore(ratings: Record<string, number>, criteria: Criterion[]): number | null {
  const rated = criteria.filter((c) => ratings[c.id] != null);
  if (rated.length === 0) return null;
  const totalWeight = rated.reduce((sum, c) => sum + c.weight, 0);
  const weightedSum = rated.reduce((sum, c) => sum + (ratings[c.id] || 0) * c.weight, 0);
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}

function rowToEvaluation(d: Tables<'candidate_evaluations'>): EvaluationData {
  return {
    key: d.id,
    id: d.id,
    criteria: (d.criteria as unknown as Criterion[]) || [],
    ratings: (d.ratings as unknown as Record<string, number>) || {},
    comments: (d.comments as unknown as Record<string, string>) || {},
    overallScore: d.overall_score != null ? Number(d.overall_score) : null,
    savedAt: d.updated_at,
    jobTitle: d.job_title || undefined,
    recommendation: (d.recommendation as Recommendation) || undefined,
    summary: d.summary || undefined,
    followUpNotes: d.follow_up_notes || undefined,
    interviewStage: (d.interview_stage as InterviewStage) || undefined,
    projectId: d.project_id,
    processStepId: d.process_step_id,
    qualificationSessionId: d.qualification_session_id,
  };
}

function SaveIndicator({ state, savedAt, onRetry }: { state: SaveState; savedAt?: string; onRetry: () => void }) {
  let content: React.ReactNode = null;
  if (state === 'saving') {
    content = (
      <>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Enregistrement…
      </>
    );
  } else if (state === 'error') {
    content = (
      <>
        <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-danger" aria-hidden="true" />
        <span className="text-danger">Échec de l'enregistrement</span>
        <Button variant="outline" size="xs" onClick={onRetry} className="ml-1 max-md:min-h-11">
          Réessayer
        </Button>
      </>
    );
  } else if (state === 'dirty') {
    content = (
      <>
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden="true" />
        Modifications non enregistrées
      </>
    );
  } else if (savedAt) {
    content = (
      <>
        <Check className="h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
        {savedLabel(savedAt)}
      </>
    );
  }
  return (
    <div role="status" aria-live="polite" className="flex min-h-7 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      {content}
    </div>
  );
}

/** Bouton icône : nom accessible et infobulle, cible de 44 px sur téléphone. */
function IconAction({
  label, onClick, children, describedBy, disabled,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  describedBy?: string;
  disabled?: boolean;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          aria-describedby={describedBy}
          onClick={onClick}
          disabled={disabled}
          className="max-md:h-11 max-md:w-11"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export const ScorecardTab: React.FC<ScorecardTabProps> = ({
  candidate, enrichedProfile, onOpenProfile, autoStartCoaching, autoGenerate, autoOpenFirst,
  onActiveEvaluationChange, onRecordingChange, qualificationSessionId,
}) => {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const baseId = useId();
  const mountedRef = useRef(true);
  const scope = JSON.stringify([organizationId, candidate.candidateId, candidate.projectId, candidate.jobId, qualificationSessionId]);
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [loadedScope, setLoadedScope] = useState<string | null>(null);
  const preparationRunRef = useRef(0);
  const loadedUserIdRef = useRef<string | null>(null);
  const autoGenTriggered = useRef<string | null>(null);

  // La liste vit dans une référence, source de vérité des écritures ; l'état la recopie pour l'affichage.
  const evaluationsRef = useRef<EvaluationData[]>([]);
  const [evaluations, setEvaluationsState] = useState<EvaluationData[]>([]);
  const commit = useCallback((next: EvaluationData[]) => {
    evaluationsRef.current = next;
    if (mountedRef.current) setEvaluationsState(next);
  }, []);

  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading');
  const [reloadTick, setReloadTick] = useState(0);
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [preparationMessage, setPreparationMessage] = useState<string | null>(null);
  const [preparationBlocked, setPreparationBlocked] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<InterviewStage | ''>('');
  const [showCoaching, setShowCoaching] = useState(false);
  const [currentCriterionIdx, setCurrentCriterionIdx] = useState(0);
  const [coachingAutoNav, setCoachingAutoNav] = useState(true);
  const lastAutoNavCriterionRef = useRef<string | null>(null);
  const [recommendationFromReport, setRecommendationFromReport] = useState(false);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<EvaluationData | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Enregistrement continu ───
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Les écritures passent l'une après l'autre : une écriture lente n'écrase pas une saisie plus récente.
  const queueRef = useRef<Promise<boolean>>(Promise.resolve(true));
  // Révision de chaque grille (une par modification) et dernière révision écrite en base.
  const revisionRef = useRef<Record<string, number>>({});
  const savedRevisionRef = useRef<Record<string, number>>({});
  // Identifiant obtenu à la première écriture : une écriture en file ne recrée pas la grille.
  const idByKeyRef = useRef<Record<string, string>>({});
  const failedKeyRef = useRef<string | null>(null);

  const isDirty = useCallback(
    (key: string) => (revisionRef.current[key] ?? 0) > (savedRevisionRef.current[key] ?? 0),
    [],
  );

  const activeEval = evaluations.find((ev) => ev.key === activeKey) ?? null;

  /** Écrit une grille et relit la ligne : null si l'écriture a échoué ou a été refusée. */
  const writeEvaluation = useCallback(async (ev: EvaluationData): Promise<{ id: string; updated_at: string } | null> => {
    const fields = {
      criteria: ev.criteria as unknown as Json,
      ratings: ev.ratings as unknown as Json,
      comments: ev.comments as unknown as Json,
      overall_score: ev.overallScore,
      recommendation: ev.recommendation ?? null,
      summary: ev.summary || null,
      follow_up_notes: ev.followUpNotes || null,
      interview_stage: ev.interviewStage ?? null,
      updated_at: new Date().toISOString(),
    };
    try {
      const id = ev.id ?? idByKeyRef.current[ev.key];
      if (id) {
        const { data, error } = await supabase
          .from('candidate_evaluations')
          .update(fields)
          .eq('id', id)
          .select('id, updated_at');
        if (error || !data || data.length === 0) {
          console.error('[ScorecardTab] enregistrement impossible :', error ?? 'aucune ligne modifiée');
          return null;
        }
        return data[0];
      }
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !ev.origin) {
        console.error('[ScorecardTab] enregistrement impossible : session ou rattachement absent');
        return null;
      }
      const { data, error } = await supabase
        .from('candidate_evaluations')
        .insert({
          ...fields,
          candidate_id: ev.origin.candidateId,
          job_id: ev.origin.jobId,
          job_title: ev.origin.jobTitle,
          created_by: user.id,
          organization_id: ev.origin.organizationId,
          project_id: ev.origin.projectId,
          process_step_id: ev.origin.processStepId,
          qualification_session_id: ev.origin.qualificationSessionId,
        })
        .select('id, updated_at')
        .single();
      if (error || !data) {
        console.error('[ScorecardTab] création impossible :', error ?? 'aucune ligne créée');
        return null;
      }
      idByKeyRef.current[ev.key] = data.id;
      return data;
    } catch (err) {
      console.error('[ScorecardTab] enregistrement impossible :', err);
      return null;
    }
  }, []);

  /**
   * Met une écriture en file. `snapshot` fige la grille à écrire (départ de la
   * grille, démontage) ; sinon l'écriture lit la dernière version au moment où
   * elle part.
   */
  const persist = useCallback((key: string, snapshot?: EvaluationData): Promise<boolean> => {
    // Une grille figée correspond à la révision du moment où on la fige.
    const snapshotRevision = revisionRef.current[key] ?? 0;
    const run = async (): Promise<boolean> => {
      const ev = snapshot ?? evaluationsRef.current.find((e) => e.key === key);
      if (!ev || ev.criteria.length === 0) return true;
      const revision = snapshot ? snapshotRevision : revisionRef.current[key] ?? 0;
      if (mountedRef.current) setSaveState('saving');
      const result = await writeEvaluation(ev);
      if (!result) {
        failedKeyRef.current = key;
        if (mountedRef.current) setSaveState('error');
        return false;
      }
      savedRevisionRef.current[key] = Math.max(savedRevisionRef.current[key] ?? 0, revision);
      commit(evaluationsRef.current.map((e) => (e.key === key ? { ...e, id: result.id, savedAt: result.updated_at } : e)));
      if (failedKeyRef.current === key) failedKeyRef.current = null;
      // Une saisie arrivée pendant l'écriture a déjà reprogrammé la suivante.
      if (mountedRef.current && !isDirty(key)) setSaveState('idle');
      return true;
    };
    const chained = queueRef.current.then(run, run);
    queueRef.current = chained.catch(() => false);
    return chained;
  }, [writeEvaluation, commit, isDirty]);

  const scheduleSave = useCallback((key: string) => {
    revisionRef.current[key] = (revisionRef.current[key] ?? 0) + 1;
    setSaveState('dirty');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persist(key);
    }, AUTOSAVE_DELAY_MS);
  }, [persist]);

  /** Écrit tout de suite ce qui attend ; résout à false si l'écriture échoue. */
  const flush = useCallback((key: string | null): Promise<boolean> => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (key && isDirty(key)) {
      return persist(key, evaluationsRef.current.find((e) => e.key === key));
    }
    return queueRef.current.then(() => !(key && isDirty(key)));
  }, [persist, isDirty]);

  const retrySave = useCallback(() => {
    const key = failedKeyRef.current ?? activeKey;
    if (key) void persist(key);
  }, [activeKey, persist]);

  /** Applique une modification à une grille et programme son enregistrement. */
  const updateEvaluation = useCallback((key: string, updater: (ev: EvaluationData) => EvaluationData) => {
    let changed = false;
    const next = evaluationsRef.current.map((ev) => {
      if (ev.key !== key) return ev;
      const updated = updater(ev);
      changed = updated !== ev;
      return updated;
    });
    if (!changed) return;
    commit(next);
    scheduleSave(key);
  }, [commit, scheduleSave]);

  // Démontage (changement d'onglet de la fiche, fermeture) : la saisie en attente part quand même.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      preparationRunRef.current += 1;
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      for (const ev of evaluationsRef.current) {
        if (isDirty(ev.key)) void persist(ev.key, ev);
      }
    };
  }, [persist, isDirty]);

  const openEvaluation = useCallback((key: string) => {
    setActiveKey(key);
    setCurrentCriterionIdx(0);
    setRecommendationFromReport(false);
    lastAutoNavCriterionRef.current = null;
  }, []);

  // ─── Chargement des grilles de la personne connectée ───
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadState('loading');
      setLoadedScope(null);
      setActiveKey(null);
      setGenerating(false);
      setPreparationMessage(null);
      setPreparationBlocked(false);
      preparationRunRef.current += 1;
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setLoadState('error');
        return;
      }
      loadedUserIdRef.current = user.id;
      if (qualificationSessionId) {
        if (!organizationId) return;
        const { data: interview, error: interviewError } = await supabase
          .from('qualification_sessions')
          .select('id, organization_id, candidate_profile_id, project_id, manager_id, created_by')
          .eq('id', qualificationSessionId)
          .eq('organization_id', organizationId)
          .maybeSingle();
        if (cancelled) return;
        const projectId = candidate.projectId ?? missionIdOfJob(candidate.jobId) ?? null;
        if (interviewError || !interview || interview.candidate_profile_id !== candidate.candidateId || interview.project_id !== projectId) {
          setLoadState('error');
          return;
        }
        if ((interview.manager_id || interview.created_by) !== user.id) {
          commit([]);
          setLoadedScope(scope);
          setLoadState('ready');
          setPreparationBlocked(true);
          setPreparationMessage('Cet entretien est attribué à un autre recruteur.');
          return;
        }
      }
      let query = supabase
        .from('candidate_evaluations')
        .select('*')
        .eq('candidate_id', candidate.candidateId)
        .eq('created_by', user.id);
      if (organizationId) query = query.eq('organization_id', organizationId);
      const projectId = candidate.projectId ?? missionIdOfJob(candidate.jobId) ?? null;
      query = projectId ? query.eq('project_id', projectId) : query.is('project_id', null);
      // Un rendez-vous ouvre sa grille exacte, jamais la plus récente d'un autre entretien.
      if (qualificationSessionId) query = query.eq('qualification_session_id', qualificationSessionId);
      const { data, error } = await query.order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error('[ScorecardTab] lecture impossible :', error);
        setLoadState('error');
        return;
      }
      const loaded = (data ?? []).map(rowToEvaluation);
      commit(loaded);
      setLoadedScope(scope);
      setLoadState('ready');
      // Plein écran ou assistant d'entretien : on ouvre la plus récente.
      if ((autoOpenFirst || autoStartCoaching) && loaded.length > 0) openEvaluation(loaded[0].key);
    };
    load().catch((err) => {
      if (cancelled) return;
      console.error('[ScorecardTab] lecture impossible :', err);
      setLoadState('error');
    });
    return () => {
      cancelled = true;
      // Changement de candidat : ce qui attend part avant de recharger (au démontage, l'effet
      // précédent s'en est déjà chargé).
      if (!mountedRef.current) return;
      for (const ev of evaluationsRef.current) {
        if (isDirty(ev.key)) void persist(ev.key, ev);
      }
    };
    // persist, commit, isDirty et openEvaluation sont stables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candidate.candidateId, candidate.projectId, candidate.jobId, organizationId, qualificationSessionId, autoOpenFirst, autoStartCoaching, reloadTick, scope]);

  // Assistant d'entretien demandé par l'adresse (plein écran, ?coaching=1) : il s'ouvre avec la grille,
  // pas à chaque saisie (on peut le fermer).
  useEffect(() => {
    if (autoStartCoaching && loadState === 'ready' && activeKey) setShowCoaching(true);
  }, [autoStartCoaching, loadState, activeKey]);

  // L'en-tête du plein écran suit la grille ouverte.
  const criteriaCount = activeEval?.criteria.length ?? 0;
  const ratedCount = activeEval ? activeEval.criteria.filter((c) => activeEval.ratings[c.id] != null).length : 0;
  const overallScore = activeEval?.overallScore ?? null;
  const activeRecommendation = activeEval?.recommendation ?? null;
  useEffect(() => {
    if (!onActiveEvaluationChange) return;
    onActiveEvaluationChange(
      activeKey && criteriaCount > 0
        ? { criteriaCount, ratedCount, overallScore, recommendation: activeRecommendation }
        : null,
    );
  }, [onActiveEvaluationChange, activeKey, criteriaCount, ratedCount, overallScore, activeRecommendation]);

  // ─── Génération par l'IA Konekt ───
  const buildJobContext = useCallback(async (stage: string | undefined) => {
    const jobContext: Record<string, unknown> = { title: candidate.jobTitle || 'Non spécifié' };
    // Mission par son id (lot 0c-4 : une mission V2 n'a pas de job_id) ; le job_id
    // d'une ancienne mission reste lu par la même requête, comme ScorecardFullPage.
    let projectId: string | null = null;
    const missionKey = candidate.projectId ?? missionIdOfJob(candidate.jobId) ?? null;
    if (missionKey || candidate.jobId) {
      const projectQuery = supabase
        .from('sourcing_projects')
        .select('id, job_title, client_name, description, job_details');
      const { data: project, error: projectError } = await (missionKey
        ? projectQuery.or(`id.eq.${missionKey},job_id.eq.${missionKey}`)
        : projectQuery.eq('job_id', candidate.jobId as string))
        .limit(1)
        .maybeSingle();
      if (projectError) console.error('[ScorecardTab] mission illisible, génération sans poste :', projectError);

      if (project) {
        projectId = project.id;
        const jd = ((project as { job_details?: unknown }).job_details || {}) as BriefFields;
        jobContext.title = jd.title || project.job_title || jobContext.title;
        jobContext.client = jd.client?.name || project.client_name;
        jobContext.description = jd.mission_description || jd.context || project.description;
        jobContext.seniority = jd.seniority;
        jobContext.xpMin = jd.experience_min;
        jobContext.xpMax = jd.experience_max;
        jobContext.mustHave = (jd.skills_must_have || []).join(', ');
        jobContext.shouldHave = (jd.skills_should_have || []).join(', ');
        jobContext.niceToHave = (jd.skills_nice_to_have || []).join(', ');
        // Clé lue par la fonction : compétences recherchées, indispensables d'abord.
        jobContext.skills = [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])];
        // Critères d'évaluation du manager : la fonction ne lit que « requirements »,
        // ils y sont donc écrits en texte (le critère rédhibitoire est signalé).
        if ((jd.evaluation_criteria?.length ?? 0) > 0) {
          jobContext.requirements = (jd.evaluation_criteria ?? [])
            .map((c) => `${c.label}${c.deal_breaker ? ' (rédhibitoire)' : ''}${c.description ? ` : ${c.description}` : ''}`)
            .join(' | ');
          jobContext.managerCriteria = jd.evaluation_criteria;
          jobContext.evaluationWeights = jd.evaluation_weights;
        }
      }
    }

    // Étapes du process de la mission, pour situer l'entretien : lues dès que la
    // mission est connue, qu'un type d'entretien soit choisi ou non.
    if (projectId) {
      try {
        const { data: processSteps, error: stepsError } = await supabase
          .from('mission_process_steps')
          .select('id, name, description, objectives, evaluation_criteria, is_eliminatory')
          .eq('project_id', projectId)
          .order('step_order', { ascending: true });
        if (stepsError) throw stepsError;
        if (processSteps?.length) {
          jobContext.processSteps = processSteps.map(({ id: _id, ...step }) => step);
          // Étape courante : celle du candidat (process_step_id), à défaut le type
          // d'entretien choisi (son libellé ou sa clé), retrouvé dans le nom de l'étape.
          const byStage = stage
            ? processSteps.find((s) => {
                const name = s.name.toLowerCase();
                return name.includes(interviewTypeLabel(stage).toLowerCase()) || name.includes(stage.toLowerCase());
              })
            : undefined;
          const currentStep = (candidate.processStepId
            ? processSteps.find((s) => s.id === candidate.processStepId)
            : undefined) ?? byStage;
          if (currentStep) {
            jobContext.currentStepName = currentStep.name;
            jobContext.currentStepObjectives = currentStep.objectives;
            jobContext.currentStepIsEliminatory = currentStep.is_eliminatory;
          }
        }
      } catch (err) {
        // Facultatif : la grille se génère sans les étapes.
        console.error('[ScorecardTab] étapes du process illisibles :', err);
      }
    }
    return jobContext;
  }, [candidate.projectId, candidate.jobId, candidate.jobTitle, candidate.processStepId]);

  const requestCriteria = useCallback(async (stage: InterviewStage | undefined): Promise<Criterion[]> => {
    const candidateProfile = {
      name: candidate.name,
      headline: enrichedProfile?.headline || candidate.headline,
      summary: enrichedProfile?.summary,
      skills: enrichedProfile?.skills || [],
      experiences: enrichedProfile?.experiences || [],
      education: enrichedProfile?.education || [],
      yearsOfExperience: enrichedProfile?.yearsOfExperience,
    };
    const jobContext = await buildJobContext(stage);
    // selectedModel null : modèle par défaut de l'action (jamais une valeur factice).
    const { data, error } = await invokeWithCredits<{ success?: boolean; criteria?: Criterion[]; error?: string }>(
      'generate-scorecard',
      'generate_scorecard',
      { candidateProfile, jobContext, scoringDetails: candidate.scoringDetails, interviewStage: stage },
      { modelOverride: selectedModel ?? undefined },
    );
    if (error) {
      console.error('[ScorecardTab] génération impossible :', error);
      if (isInsufficientCreditsError(error)) throw new CreditsError();
      throw new Error('La génération de la grille a échoué. Réessayez dans un instant.');
    }
    if (!data?.success) {
      console.error('[ScorecardTab] génération refusée :', data);
      throw new Error("L'IA Konekt n'a pas pu générer la grille. Réessayez dans un instant.");
    }
    if (!Array.isArray(data.criteria) || data.criteria.length === 0) {
      console.error('[ScorecardTab] grille vide :', data);
      throw new Error("L'IA Konekt a renvoyé une grille vide. Réessayez dans un instant.");
    }
    return data.criteria;
  }, [candidate, enrichedProfile, selectedModel, buildJobContext]);

  /** La préparation du rendez-vous est partagée avec sa planification : relire
   * ou attendre une grille existante ne relance jamais une génération payante. */
  const prepareScheduledEvaluation = useCallback(async (retry = false, sessionId = qualificationSessionId) => {
    if (!sessionId || !organizationId) return;
    const requestedScope = scope;
    const run = ++preparationRunRef.current;
    const isCurrent = () => mountedRef.current && scopeRef.current === requestedScope && preparationRunRef.current === run;
    setGenerating(true);
    setPreparationMessage(null);
    setPreparationBlocked(false);
    try {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        if (!isCurrent()) return;
        const { data, error } = await invokeEdgeFunction<{
          status?: 'preparing' | 'ready' | 'failed' | 'skipped';
          evaluation?: Tables<'candidate_evaluations'>;
          reason?: string;
          error?: string;
        }>('generate-scorecard', {
          qualificationSessionId: sessionId,
          organization_id: organizationId,
          background: true,
          ...(retry && attempt === 0 ? { retry: true } : {}),
        });
        if (!isCurrent()) return;
        if (error) throw error;
        if (data?.status === 'ready' && data.evaluation) {
          const row = data.evaluation;
          const projectId = candidate.projectId ?? missionIdOfJob(candidate.jobId) ?? null;
          if (row.created_by !== loadedUserIdRef.current) {
            setPreparationBlocked(true);
            setPreparationMessage('Cet entretien est attribué à un autre recruteur.');
            return;
          }
          if (row.qualification_session_id !== sessionId || row.candidate_id !== candidate.candidateId || row.organization_id !== organizationId || row.project_id !== projectId) {
            throw new Error("La grille n'a pas pu être rattachée à cet entretien. Réessayez.");
          }
          const evaluation = rowToEvaluation(row);
          if (!evaluation.criteria.length) throw new Error("La préparation n'a pas encore fourni de critères. Réessayez.");
          commit(qualificationSessionId ? [evaluation] : [evaluation, ...evaluationsRef.current.filter((existing) => existing.id !== evaluation.id)]);
          openEvaluation(evaluation.key);
          setSaveState('idle');
          return;
        }
        if (data?.status === 'failed' || data?.status === 'skipped') {
          setPreparationBlocked(data.status === 'skipped');
          setPreparationMessage(data.reason === 'assigned_elsewhere'
            ? 'Cet entretien est attribué à un autre recruteur.'
            : data.error || "La grille n'a pas pu être préparée pour cet entretien.");
          return;
        }
        if (data?.status !== 'preparing') throw new Error('La préparation est indisponible. Réessayez.');
        await new Promise<void>((resolve) => window.setTimeout(resolve, 3000));
      }
      if (isCurrent()) setPreparationMessage('La préparation continue en arrière-plan. Réessayez dans un instant pour ouvrir la grille.');
    } catch (error) {
      if (isCurrent()) setPreparationMessage(error instanceof Error ? error.message : 'La préparation est indisponible. Réessayez.');
    } finally {
      if (isCurrent()) setGenerating(false);
    }
  }, [qualificationSessionId, organizationId, scope, candidate.projectId, candidate.jobId, candidate.candidateId, commit, openEvaluation]);

  const createDraft = useCallback((): string => {
    const key = newLocalKey();
    const draft: EvaluationData = {
      key,
      criteria: [],
      ratings: {},
      comments: {},
      overallScore: null,
      jobTitle: candidate.jobTitle || undefined,
      projectId: candidate.projectId ?? missionIdOfJob(candidate.jobId) ?? null,
      processStepId: candidate.processStepId ?? null,
      qualificationSessionId: qualificationSessionId ?? null,
      origin: {
        candidateId: candidate.candidateId,
        jobId: candidate.jobId,
        jobTitle: candidate.jobTitle,
        organizationId: organizationId || null,
        projectId: candidate.projectId ?? missionIdOfJob(candidate.jobId) ?? null,
        processStepId: candidate.processStepId ?? null,
        qualificationSessionId: qualificationSessionId ?? null,
      },
    };
    commit([draft, ...evaluationsRef.current]);
    return key;
  }, [candidate.candidateId, candidate.jobId, candidate.jobTitle, candidate.projectId, candidate.processStepId, qualificationSessionId, organizationId, commit]);

  /** Génère les critères d'une nouvelle grille et l'enregistre aussitôt (elle survit au changement d'onglet). */
  const generateInto = useCallback(async (key: string) => {
    const source = evaluationsRef.current.find((evaluation) => evaluation.key === key);
    if (source?.qualificationSessionId || qualificationSessionId) {
      await prepareScheduledEvaluation(true, source?.qualificationSessionId ?? qualificationSessionId);
      return;
    }
    if (!source) return;
    const generationScope = scope;
    if (!candidate?.name && !candidate?.headline) {
      toast.error('Profil trop incomplet pour générer une grille', {
        description: 'Ajoutez au moins le nom ou le titre du candidat, puis réessayez.',
      });
      return;
    }
    setGenerating(true);
    try {
      const stage = selectedStage || undefined;
      const criteria = await requestCriteria(stage);
      if (!mountedRef.current || scopeRef.current !== generationScope) {
        // La préparation a commencé sur une autre fiche : conserver son
        // rattachement et l'enregistrer sans l'afficher chez le candidat courant.
        await writeEvaluation({ ...source, criteria, ratings: {}, comments: {}, overallScore: null, interviewStage: stage });
        return;
      }
      const exists = evaluationsRef.current.some((e) => e.key === key);
      const filled = (ev: EvaluationData): EvaluationData => ({ ...ev, criteria, ratings: {}, comments: {}, overallScore: null, interviewStage: stage });
      if (exists) {
        commit(evaluationsRef.current.map((e) => (e.key === key ? filled(e) : e)));
      } else {
        // La personne a quitté l'écran de génération : la grille rejoint la liste.
        commit([filled(source), ...evaluationsRef.current]);
      }
      if (mountedRef.current) setCurrentCriterionIdx(0);
      revisionRef.current[key] = (revisionRef.current[key] ?? 0) + 1;
      const saved = await persist(key);
      if (saved) {
        toast.success(`Grille générée\u00a0: ${plural(criteria.length, 'critère', 'critères')}`);
      } else {
        toast.error("Grille générée, mais pas encore enregistrée", {
          description: 'Vérifiez votre connexion, puis choisissez « Réessayer ».',
        });
      }
    } catch (err) {
      if (!mountedRef.current || scopeRef.current !== generationScope) return;
      if (err instanceof CreditsError) return;
      toast.error(err instanceof Error ? err.message : 'La génération de la grille a échoué. Réessayez dans un instant.');
    } finally {
      if (mountedRef.current && scopeRef.current === generationScope) setGenerating(false);
    }
  }, [candidate, selectedStage, requestCriteria, commit, persist, qualificationSessionId, prepareScheduledEvaluation, scope, writeEvaluation]);

  /** Nouveaux critères pour la grille ouverte ; les notes et commentaires sont effacés (confirmé avant). */
  const regenerate = useCallback(async () => {
    const key = activeKey;
    const ev = key ? evaluationsRef.current.find((e) => e.key === key) : null;
    if (!key || !ev) return;
    setGenerating(true);
    try {
      const criteria = await requestCriteria(ev.interviewStage || selectedStage || undefined);
      updateEvaluation(key, (e) => ({ ...e, criteria, ratings: {}, comments: {}, overallScore: null }));
      if (mountedRef.current) setCurrentCriterionIdx(0);
      const saved = await flush(key);
      if (saved) toast.success(`Grille régénérée\u00a0: ${plural(criteria.length, 'critère', 'critères')}`);
    } catch (err) {
      if (err instanceof CreditsError) return;
      toast.error(err instanceof Error ? err.message : 'La génération de la grille a échoué. Réessayez dans un instant.');
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  }, [activeKey, selectedStage, requestCriteria, updateEvaluation, flush]);

  // CTA « Préparer l'entretien » du calendrier : une seule fois, et seulement sans grille existante.
  useEffect(() => {
    if (!autoGenerate || preparationBlocked || autoGenTriggered.current === scope || loadedScope !== scope || loadState !== 'ready' || generating) return;
    autoGenTriggered.current = scope;
    const first = evaluationsRef.current[0];
    if (first && (!qualificationSessionId || first.criteria.length)) {
      openEvaluation(first.key);
      if (first.qualificationSessionId && !first.criteria.length) void prepareScheduledEvaluation(false, first.qualificationSessionId);
      return;
    }
    if (qualificationSessionId) {
      void prepareScheduledEvaluation();
      return;
    }
    const key = createDraft();
    openEvaluation(key);
    void generateInto(key);
  }, [autoGenerate, scope, loadedScope, loadState, generating, preparationBlocked, qualificationSessionId, prepareScheduledEvaluation, openEvaluation, createDraft, generateInto]);

  // ─── Saisie ───
  const handleRate = useCallback((criterionId: string, rating: number) => {
    if (!activeKey) return;
    updateEvaluation(activeKey, (ev) => {
      if (ev.ratings[criterionId] === rating) return ev;
      const ratings = { ...ev.ratings, [criterionId]: rating };
      return { ...ev, ratings, overallScore: computeOverallScore(ratings, ev.criteria) };
    });
  }, [activeKey, updateEvaluation]);

  const handleComment = useCallback((criterionId: string, comment: string) => {
    if (!activeKey) return;
    updateEvaluation(activeKey, (ev) => ({ ...ev, comments: { ...ev.comments, [criterionId]: comment } }));
  }, [activeKey, updateEvaluation]);

  const setRecommendation = useCallback((value: Recommendation | undefined) => {
    if (!activeKey) return;
    setRecommendationFromReport(false);
    updateEvaluation(activeKey, (ev) => (ev.recommendation === value ? ev : { ...ev, recommendation: value }));
  }, [activeKey, updateEvaluation]);

  const setTextField = useCallback((field: 'summary' | 'followUpNotes', value: string) => {
    if (!activeKey) return;
    updateEvaluation(activeKey, (ev) => ({ ...ev, [field]: value }));
  }, [activeKey, updateEvaluation]);

  // ─── Navigation ───
  const closeEditor = useCallback(() => {
    const key = activeKey;
    if (key) void flush(key);
    // Un brouillon sans critères ne rejoint pas la liste.
    const next = evaluationsRef.current.filter((e) => !(e.key === key && e.criteria.length === 0 && !e.id));
    if (next.length !== evaluationsRef.current.length) commit(next);
    setActiveKey(null);
  }, [activeKey, flush, commit]);

  const handleNewScorecard = useCallback(() => {
    if (qualificationSessionId && evaluationsRef.current[0]) {
      openEvaluation(evaluationsRef.current[0].key);
      return;
    }
    if (qualificationSessionId) {
      void prepareScheduledEvaluation(true);
      return;
    }
    const key = createDraft();
    openEvaluation(key);
    setSelectedStage('');
  }, [createDraft, openEvaluation, qualificationSessionId, prepareScheduledEvaluation]);

  /** Plein écran ou assistant d'entretien : la saisie en attente est écrite avant de partir. */
  const openFullPage = useCallback(async (coaching: boolean) => {
    const ok = activeKey ? await flush(activeKey) : true;
    if (!ok) {
      toast.error('Vos dernières modifications ne sont pas enregistrées', {
        description: 'Choisissez « Réessayer » à côté du statut, puis ouvrez de nouveau le plein écran.',
      });
      return;
    }
    // La mission suit dans l'adresse : un candidat présent dans deux missions
    // garde, en plein écran, le poste et les étapes de la grille ouverte.
    const params = new URLSearchParams();
    // Même repli que buildJobContext : une fiche sans projectId garde sa mission par le job_id.
    const missionKey = candidate.projectId ?? missionIdOfJob(candidate.jobId) ?? null;
    if (missionKey) params.set('mission', missionKey);
    const sessionId = activeEval?.qualificationSessionId ?? qualificationSessionId;
    if (sessionId) params.set('session', sessionId);
    if (coaching) params.set('coaching', '1');
    const query = params.toString();
    navigate(`/ats/scorecard/${candidate.candidateId}${query ? `?${query}` : ''}`);
  }, [activeKey, activeEval?.qualificationSessionId, flush, navigate, candidate.candidateId, candidate.projectId, candidate.jobId, qualificationSessionId]);

  const openCoaching = useCallback(() => {
    // Déjà en plein écran : l'assistant s'ouvre sur place.
    if (autoOpenFirst) setShowCoaching(true);
    else void openFullPage(true);
  }, [autoOpenFirst, openFullPage]);

  // ─── Suppression ───
  const confirmDelete = useCallback(async () => {
    const ev = pendingDelete;
    if (!ev) return;
    setDeleting(true);
    try {
      const id = ev.id ?? idByKeyRef.current[ev.key];
      if (id) {
        // La ligne relue prouve la suppression : un refus des droits répond sans erreur sur 0 ligne.
        const { data, error } = await supabase.from('candidate_evaluations').delete().eq('id', id).select('id');
        if (error || !data || data.length === 0) {
          console.error('[ScorecardTab] suppression impossible :', error ?? 'aucune ligne supprimée');
          toast.error("La grille n'a pas été supprimée", {
            description: 'Vérifiez votre connexion et vos droits sur cette mission, puis réessayez.',
          });
          return;
        }
      }
      commit(evaluationsRef.current.filter((e) => e.key !== ev.key));
      if (activeKey === ev.key) setActiveKey(null);
      toast.success('Grille supprimée');
    } finally {
      if (mountedRef.current) {
        setDeleting(false);
        setPendingDelete(null);
      }
    }
  }, [pendingDelete, activeKey, commit]);

  // ─── Assistant d'entretien ───
  const handleCriteriaUpdate = useCallback((updates: Record<string, CriterionUpdate>) => {
    if (!coachingAutoNav || !activeEval) return;
    const coveredIds = Object.entries(updates).filter(([, u]) => u.covered).map(([id]) => id);
    if (coveredIds.length === 0) return;
    const latestCovered = coveredIds[coveredIds.length - 1];
    if (latestCovered !== lastAutoNavCriterionRef.current) {
      lastAutoNavCriterionRef.current = latestCovered;
      const idx = activeEval.criteria.findIndex((c) => c.id === latestCovered);
      if (idx !== -1) setCurrentCriterionIdx(idx);
    }
  }, [coachingAutoNav, activeEval]);

  const handleAutoScores = useCallback((scores: Record<string, number>) => {
    for (const [id, score] of Object.entries(scores)) handleRate(id, score);
  }, [handleRate]);

  /** Le compte rendu remplit la grille, et le dit (E-16) : GO devient « Oui », jamais en silence. */
  const handleReport = useCallback((report: CallReport, recoKey: ReportRecommendation | null) => {
    if (!activeKey) return;
    updateEvaluation(activeKey, (ev) => ({
      ...ev,
      summary: report.summary || ev.summary,
      recommendation: recoKey ?? ev.recommendation,
      followUpNotes: report.open_questions?.length ? report.open_questions.join('\n') : ev.followUpNotes,
    }));
    if (recoKey) setRecommendationFromReport(true);
    const filled = [
      recoKey ? `recommandation « ${HIRING_VERDICTS[recoKey].label} »` : null,
      report.summary ? 'résumé' : null,
      report.open_questions?.length ? 'points de suivi' : null,
    ].filter(Boolean);
    toast.success('Compte rendu généré', {
      description: filled.length > 0
        ? `Repris dans la grille\u00a0: ${filled.join(', ')}. Vérifiez-les avant de conclure.`
        : undefined,
    });
  }, [activeKey, updateEvaluation]);

  // ─── Rendu ───
  const touch = 'max-md:min-h-11';

  const deleteDialog = (
    <AlertDialog
      open={!!pendingDelete}
      onOpenChange={(open) => {
        if (!open && !deleting) setPendingDelete(null);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Supprimer cette grille&nbsp;?</AlertDialogTitle>
          <AlertDialogDescription>
            {pendingDelete?.interviewStage
              ? `La grille « ${interviewTypeLabel(pendingDelete.interviewStage)} » et les notes saisies seront effacées.`
              : 'La grille et les notes saisies seront effacées.'}{' '}
            Cette action est irréversible.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Annuler</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive"
            disabled={deleting}
            onClick={(e) => {
              e.preventDefault();
              void confirmDelete();
            }}
          >
            {deleting ? 'Suppression…' : 'Supprimer la grille'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  if (loadedScope !== scope && loadState !== 'error') {
    return (
      <div className="space-y-2" aria-busy="true">
        <span className="sr-only" role="status">Chargement de la grille d'entretien</span>
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
    );
  }

  if ((qualificationSessionId || activeEval?.qualificationSessionId) && (generating || preparationMessage)) {
    return (
      <div className="space-y-3 py-4" role="status" aria-live="polite" aria-busy={generating}>
        <p className="flex items-center gap-2 text-sm text-foreground">
          {generating && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {generating ? "Préparation de la grille d'entretien…" : preparationMessage}
        </p>
        {generating && <p className="text-xs text-muted-foreground">Les critères et les questions seront disponibles ici dès que la grille sera prête.</p>}
        {!generating && !preparationBlocked && (
          <Button variant="outline" size="sm" onClick={() => void prepareScheduledEvaluation(true, activeEval?.qualificationSessionId ?? qualificationSessionId)} className={touch}>
            Réessayer
          </Button>
        )}
      </div>
    );
  }

  // ─── Écran de génération (grille sans critères) ───
  if (activeEval && activeEval.criteria.length === 0) {
    const titleId = `${baseId}-generation`;
    const stageLabelId = `${baseId}-type`;
    return (
      <div className="min-w-0 space-y-3">
        <Button variant="ghost" size="sm" onClick={closeEditor} className={cn('-ml-2', touch)}>
          <ChevronLeft aria-hidden="true" />
          Retour
        </Button>

        <section aria-labelledby={titleId} className="rounded-xl border border-border bg-card p-6">
          <div className="mx-auto max-w-md text-center">
            <h3 id={titleId} className="text-md font-semibold text-foreground">Nouvelle grille d'entretien</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              L'IA Konekt analyse le profil et le poste, puis propose six à huit critères, avec des questions à poser et des points d'alerte.
            </p>

            <div className="mt-5 space-y-2">
              <p id={stageLabelId} className="eyebrow">Type d'entretien (facultatif)</p>
              <ToggleGroup
                type="single"
                role="radiogroup"
                aria-labelledby={stageLabelId}
                variant="outline"
                size="sm"
                value={selectedStage}
                onValueChange={(value) => setSelectedStage((value || '') as InterviewStage | '')}
                disabled={generating}
                className="flex-wrap justify-center gap-2"
              >
                {INTERVIEW_STAGE_KEYS.map((stage) => (
                  <ToggleGroupItem key={stage} value={stage} className={cn('max-md:h-11', CHOICE_CLASS)}>
                    {INTERVIEW_TYPES[stage]}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              <Button
                variant="primary"
                size="lg"
                onClick={() => void generateInto(activeEval.key)}
                loading={generating}
                className={touch}
              >
                {generating ? 'Génération en cours…' : 'Générer la grille'}
              </Button>
              <ModelPicker actionId="generate_scorecard" value={selectedModel} onChange={setSelectedModel} compact disabled={generating} />
            </div>
            {generating && (
              <p role="status" className="mt-3 text-xs text-muted-foreground">
                Préparation des critères, des questions et de l'échelle de notation. Cela peut prendre jusqu'à une minute.
              </p>
            )}
          </div>
        </section>
      </div>
    );
  }

  // ─── Grille ouverte : vue partagée, données et effets conservés ici ───
  if (activeEval) {
    const criteria = activeEval.criteria;
    const total = criteria.length;
    const hasInput =
      Object.keys(activeEval.ratings).length > 0 || Object.values(activeEval.comments).some((c) => c && c.trim());

    const coachingPanel = showCoaching ? (
      <LiveCoachingPanel
        candidateId={candidate.candidateId}
        candidateName={candidate.name}
        candidateHeadline={candidate.headline || ''}
        candidateProfileSummary={(() => {
          const p = candidate.linkedinProfileData as unknown as { summary?: string; about?: string; headline?: string } | null;
          return p?.summary || p?.about || p?.headline || '';
        })()}
        candidateEmail={candidate.email}
        candidateLinkedinUrl={candidate.linkedin}
        projectId={activeEval.projectId}
        processStepId={activeEval.processStepId}
        qualificationSessionId={activeEval.qualificationSessionId ?? qualificationSessionId}
        jobId={candidate.jobId || ''}
        jobTitle={candidate.jobTitle || ''}
        jobContext={`Poste: ${candidate.jobTitle || 'N/A'}`}
        criteria={criteria}
        scorecardId={activeEval.id}
        onCriteriaUpdate={handleCriteriaUpdate}
        onAutoScores={handleAutoScores}
        onReportGenerated={handleReport}
        onRecordingChange={onRecordingChange}
        onClose={() => setShowCoaching(false)}
        onOpenProfile={onOpenProfile}
      />
    ) : null;

    return (
      <ScorecardEditor
        key={activeEval.key}
        value={{ ...activeEval, jobTitle: activeEval.jobTitle || candidate.jobTitle || undefined }}
        currentCriterionIndex={currentCriterionIdx}
        onCriterionChange={setCurrentCriterionIdx}
        onRate={handleRate}
        onComment={handleComment}
        onRecommendationChange={setRecommendation}
        onSummaryChange={(text) => setTextField('summary', text)}
        onFollowUpNotesChange={(text) => setTextField('followUpNotes', text)}
        recommendationFromReport={recommendationFromReport}
        onBack={closeEditor}
        status={<SaveIndicator state={saveState} savedAt={activeEval.savedAt} onRetry={retrySave} />}
        assistant={coachingPanel}
        assistantAutoNavigation={showCoaching ? { enabled: coachingAutoNav, onChange: setCoachingAutoNav } : undefined}
        actions={<>
          {!showCoaching && (
            <Button variant="outline" size="sm" onClick={openCoaching} className={touch}>
              <Mic aria-hidden="true" />
              Ouvrir l'assistant d'entretien
            </Button>
          )}
          {/* Actions secondaires en icônes : une seule rangée dans le tiroir, la confirmation protège la régénération. */}
          {!autoOpenFirst && (
            <IconAction label="Ouvrir en plein écran" onClick={() => void openFullPage(false)}>
              <Maximize2 aria-hidden="true" />
            </IconAction>
          )}
          <IconAction label="Régénérer la grille" onClick={() => setConfirmRegenerate(true)} disabled={generating}>
            {generating ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RotateCcw aria-hidden="true" />}
          </IconAction>
        </>}
      >
        <AlertDialog open={confirmRegenerate} onOpenChange={setConfirmRegenerate}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Régénérer la grille&nbsp;?</AlertDialogTitle>
              <AlertDialogDescription>
                L'IA Konekt propose de nouveaux critères à la place des {total} critères actuels.
                {hasInput ? ' Les notes saisies seront effacées.' : ''} Votre recommandation, le résumé et les points de suivi sont conservés.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="sm:items-center">
              <AlertDialogCancel>Annuler</AlertDialogCancel>
              <AlertDialogAction className={hasInput ? 'bg-destructive' : undefined} onClick={() => void regenerate()}>
                Régénérer la grille
              </AlertDialogAction>
              {/* Modèle et coût, à côté du bouton qui consomme (en tête sur téléphone, à gauche sur ordinateur). */}
              <div className="flex justify-center sm:order-first sm:mr-auto">
                <ModelPicker actionId="generate_scorecard" value={selectedModel} onChange={setSelectedModel} compact />
              </div>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {deleteDialog}
      </ScorecardEditor>
    );
  }

  // ─── Liste des grilles ───
  const showStatus = saveState === 'saving' || saveState === 'error';
  return (
    <div className="min-w-0 space-y-3">
      {showStatus && <SaveIndicator state={saveState} onRetry={retrySave} />}

      {loadState === 'loading' && (
        <div className="space-y-2" aria-busy="true">
          <span className="sr-only" role="status">Chargement de vos grilles</span>
          <Skeleton className="h-20 rounded-xl" />
          <Skeleton className="h-20 rounded-xl" />
        </div>
      )}

      {loadState === 'error' && (
        <ErrorState
          variant="compact"
          title="Impossible de charger vos grilles"
          description="Vérifiez votre connexion, puis réessayez."
          onRetry={() => setReloadTick((t) => t + 1)}
        />
      )}

      {loadState === 'ready' && evaluations.length === 0 && (
        <EmptyState
          variant="compact"
          icon={ClipboardList}
          title="Vous n'avez pas encore de grille pour ce candidat"
          description="Une grille propose des critères, des questions et une échelle de notation pour conduire l'entretien. Seules vos grilles s'affichent ici."
          action={
            <Button variant="primary" onClick={handleNewScorecard} className={touch}>
              <Plus aria-hidden="true" />
              Créer une grille
            </Button>
          }
        />
      )}

      {loadState === 'ready' && evaluations.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="eyebrow">Vos grilles ({evaluations.length})</p>
            {!qualificationSessionId && (
              <Button variant="outline" size="sm" onClick={handleNewScorecard} className={touch}>
                <Plus aria-hidden="true" />
                Créer une grille
              </Button>
            )}
          </div>
          <ul className="space-y-2">
            {evaluations.map((ev) => {
              const evRated = ev.criteria.filter((c) => ev.ratings[c.id] != null).length;
              const evTotal = ev.criteria.length;
              const verdict = hiringVerdictMeta(ev.recommendation);
              const titleId = `${baseId}-grille-${ev.key}`;
              const title = evTotal > 0
                ? `${evRated > 1 ? `${evRated} critères notés` : `${evRated} critère noté`} sur ${evTotal}`
                : 'Brouillon, critères à générer';
              return (
                <li
                  key={ev.key}
                  className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex min-w-0 items-start gap-3">
                    <p className="grid h-10 min-w-12 shrink-0 place-items-center rounded-lg bg-muted px-2 text-sm font-semibold tabular-nums text-foreground">
                      {ev.overallScore != null ? (
                        <span>
                          <span className="sr-only">Moyenne </span>
                          {formatAverage(ev.overallScore)}
                          <span className="text-xs font-medium text-muted-foreground">/5</span>
                        </span>
                      ) : (
                        <span>
                          <span className="sr-only">Pas encore de note</span>
                          <span aria-hidden="true">–</span>
                        </span>
                      )}
                    </p>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p id={titleId} className="text-sm font-semibold text-foreground">{title}</p>
                        {ev.interviewStage && <Badge variant="muted">{interviewTypeLabel(ev.interviewStage)}</Badge>}
                        {verdict && <Badge variant={verdict.tone}>{verdict.label}</Badge>}
                      </div>
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {ev.jobTitle || candidate.jobTitle || 'Poste non précisé'}
                        {ev.savedAt && ` · modifiée le ${format(new Date(ev.savedAt), "d MMM 'à' HH:mm", { locale: fr })}`}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      aria-describedby={titleId}
                      onClick={() => openEvaluation(ev.key)}
                      className={touch}
                    >
                      Ouvrir la grille
                    </Button>
                    <IconAction label="Supprimer la grille" describedBy={titleId} onClick={() => setPendingDelete(ev)}>
                      <Trash2 aria-hidden="true" />
                    </IconAction>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {deleteDialog}
    </div>
  );
};
