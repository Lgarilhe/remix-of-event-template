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
  AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Info, Loader2, Maximize2,
  MessageSquare, Mic, Plus, RotateCcw, Trash2,
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
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ATSCandidate } from '@/hooks/useATSData';
import { useOrganization } from '@/hooks/useOrganization';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import {
  LiveCoachingPanel, type CallReport, type CriterionUpdate, type ReportRecommendation,
} from './LiveCoachingPanel';

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
}

interface Criterion {
  id: string;
  label: string;
  description: string;
  category: 'technical' | 'soft_skill' | 'culture_fit' | 'motivation';
  weight: number;
  suggestedQuestions?: string[];
  ratingRubric?: Record<string, string>;
  redFlags?: string[];
}

type Recommendation = 'strong_yes' | 'yes' | 'maybe' | 'no' | 'strong_no';
type InterviewStage = 'phone_screen' | 'technique' | 'culture_fit' | 'final';
type SaveState = 'idle' | 'dirty' | 'saving' | 'error';

interface EvaluationData {
  /** Clé locale stable : l'identifiant en base, ou une clé provisoire avant la première écriture. */
  key: string;
  id?: string;
  criteria: Criterion[];
  ratings: Record<string, number>;
  comments: Record<string, string>;
  overallScore: number | null;
  savedAt?: string;
  jobTitle?: string;
  recommendation?: Recommendation;
  summary?: string;
  followUpNotes?: string;
  interviewStage?: InterviewStage;
  /** Rattachement d'une grille pas encore écrite : le candidat et le poste au moment de sa création. */
  origin?: { candidateId: string; jobId: string | null; jobTitle: string | null; organizationId: string | null };
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
  evaluation_criteria?: unknown[];
  evaluation_weights?: unknown;
}

const AUTOSAVE_DELAY_MS = 1500;

const RECOMMENDATION_KEYS: Recommendation[] = ['strong_yes', 'yes', 'maybe', 'no', 'strong_no'];
const INTERVIEW_STAGE_KEYS = Object.keys(INTERVIEW_TYPES) as InterviewStage[];

/** Catégories d'un critère : un libellé, sans couleur (revue design E-32). */
const CATEGORY_LABELS: Record<string, string> = {
  technical: 'Technique',
  soft_skill: 'Savoir-être',
  culture_fit: 'Adéquation culturelle',
  motivation: 'Motivation',
};
const CATEGORY_ORDER = ['technical', 'soft_skill', 'culture_fit', 'motivation'];

/** Poids d'un critère, écrit en toutes lettres, sans rouge. */
const WEIGHT_LABELS: Record<number, string> = { 3: 'Critique', 2: 'Important', 1: 'Bonus' };

/** Choix sélectionné d'un groupe : aplat monochrome, comme le bouton principal (E-32). */
const CHOICE_CLASS =
  'data-[state=on]:border-foreground data-[state=on]:bg-foreground data-[state=on]:font-semibold data-[state=on]:text-background data-[state=on]:hover:bg-foreground data-[state=on]:hover:text-background';

/** Refus de crédits : le toast est déjà affiché par invokeWithCredits. */
class CreditsError extends Error {}

let localKeySeq = 0;
const newLocalKey = () => `local-${Date.now()}-${++localKeySeq}`;

const formatAverage = (value: number) =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

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
  };
}

/**
 * Raccourcis de la grille (1 à 5 pour noter, flèches pour changer de critère) :
 * jamais pendant une saisie, dans un menu, ou quand une autre fenêtre est
 * ouverte par-dessus la grille (la fiche candidat qui la contient est une fenêtre).
 */
function isShortcutBlocked(e: KeyboardEvent, root: HTMLElement | null): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return true;
  const el = e.target as HTMLElement | null;
  if (el?.isContentEditable) return true;
  if (el?.closest?.('input, textarea, select, [role="menu"], [role="listbox"], [role="combobox"]')) return true;
  const overlays = document.querySelectorAll(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"]',
  );
  return Array.from(overlays).some((overlay) => !root || !overlay.contains(root));
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
  onActiveEvaluationChange, onRecordingChange,
}) => {
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const baseId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);

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
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [selectedStage, setSelectedStage] = useState<InterviewStage | ''>('');
  const [showCoaching, setShowCoaching] = useState(false);
  const [currentCriterionIdx, setCurrentCriterionIdx] = useState(0);
  // « Voir l'échelle complète » : replié à chaque changement de critère.
  const [showFullRubric, setShowFullRubric] = useState(false);
  useEffect(() => { setShowFullRubric(false); }, [currentCriterionIdx]);
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
    setShowFullRubric(false);
    setRecommendationFromReport(false);
    lastAutoNavCriterionRef.current = null;
  }, []);

  // ─── Chargement des grilles de la personne connectée ───
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setLoadState('loading');
      const { data: { user } } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setLoadState('error');
        return;
      }
      const { data, error } = await supabase
        .from('candidate_evaluations')
        .select('*')
        .eq('candidate_id', candidate.candidateId)
        .eq('created_by', user.id)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      if (error) {
        console.error('[ScorecardTab] lecture impossible :', error);
        setLoadState('error');
        return;
      }
      const loaded = (data ?? []).map(rowToEvaluation);
      commit(loaded);
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
  }, [candidate.candidateId, autoOpenFirst, autoStartCoaching, reloadTick]);

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
    if (candidate.jobId) {
      const { data: project } = await supabase
        .from('sourcing_projects')
        .select('job_title, client_name, description, filters_snapshot, job_details')
        .eq('job_id', candidate.jobId)
        .limit(1)
        .maybeSingle();

      if (project) {
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
        // Critères d'évaluation du manager, transmis à l'IA.
        if ((jd.evaluation_criteria?.length ?? 0) > 0) {
          jobContext.managerCriteria = jd.evaluation_criteria;
          jobContext.evaluationWeights = jd.evaluation_weights;
        }
      }

      try {
        const { data: notionData } = await invokeEdgeFunction<{
          job?: { description?: string; criteria?: unknown; skills?: unknown };
        }>('fetch-notion-jobs', {
          jobId: candidate.jobId,
        });
        if (notionData?.job) {
          jobContext.description = notionData.job.description || jobContext.description;
          jobContext.requirements = notionData.job.criteria;
          jobContext.skills = notionData.job.skills;
        }
      } catch { /* facultatif */ }
    }

    // Étapes du process de la mission, pour situer l'entretien.
    if (candidate.jobId && stage) {
      try {
        const { data: projectForSteps } = await supabase
          .from('sourcing_projects')
          .select('id')
          .eq('job_id', candidate.jobId)
          .limit(1)
          .maybeSingle();
        if (projectForSteps) {
          const { data: processSteps } = await supabase
            .from('mission_process_steps')
            .select('name, description, objectives, evaluation_criteria, is_eliminatory')
            .eq('project_id', projectForSteps.id)
            .order('step_order', { ascending: true });
          if (processSteps?.length) {
            jobContext.processSteps = processSteps;
            const currentStep = processSteps.find((s) => s.name.toLowerCase().includes(stage.toLowerCase()));
            if (currentStep) {
              jobContext.currentStepObjectives = currentStep.objectives;
              jobContext.currentStepIsEliminatory = currentStep.is_eliminatory;
            }
          }
        }
      } catch { /* facultatif */ }
    }
    return jobContext;
  }, [candidate.jobId, candidate.jobTitle]);

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

  const createDraft = useCallback((): string => {
    const key = newLocalKey();
    const draft: EvaluationData = {
      key,
      criteria: [],
      ratings: {},
      comments: {},
      overallScore: null,
      jobTitle: candidate.jobTitle || undefined,
      origin: {
        candidateId: candidate.candidateId,
        jobId: candidate.jobId,
        jobTitle: candidate.jobTitle,
        organizationId: organizationId || null,
      },
    };
    commit([draft, ...evaluationsRef.current]);
    return key;
  }, [candidate.candidateId, candidate.jobId, candidate.jobTitle, organizationId, commit]);

  /** Génère les critères d'une nouvelle grille et l'enregistre aussitôt (elle survit au changement d'onglet). */
  const generateInto = useCallback(async (key: string) => {
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
      const exists = evaluationsRef.current.some((e) => e.key === key);
      const filled = (ev: EvaluationData): EvaluationData => ({ ...ev, criteria, ratings: {}, comments: {}, overallScore: null, interviewStage: stage });
      if (exists) {
        commit(evaluationsRef.current.map((e) => (e.key === key ? filled(e) : e)));
      } else {
        // La personne a quitté l'écran de génération : la grille rejoint la liste.
        commit([
          filled({
            key,
            criteria: [],
            ratings: {},
            comments: {},
            overallScore: null,
            jobTitle: candidate.jobTitle || undefined,
            origin: { candidateId: candidate.candidateId, jobId: candidate.jobId, jobTitle: candidate.jobTitle, organizationId: organizationId || null },
          }),
          ...evaluationsRef.current,
        ]);
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
      if (err instanceof CreditsError) return;
      toast.error(err instanceof Error ? err.message : 'La génération de la grille a échoué. Réessayez dans un instant.');
    } finally {
      if (mountedRef.current) setGenerating(false);
    }
  }, [candidate, selectedStage, requestCriteria, commit, persist, organizationId]);

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
  const autoGenTriggered = useRef(false);
  useEffect(() => {
    if (!autoGenerate || autoGenTriggered.current || loadState !== 'ready' || generating) return;
    autoGenTriggered.current = true;
    const first = evaluationsRef.current[0];
    if (first) {
      openEvaluation(first.key);
      return;
    }
    const key = createDraft();
    openEvaluation(key);
    void generateInto(key);
  }, [autoGenerate, loadState, generating, openEvaluation, createDraft, generateInto]);

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

  // Raccourcis : 1 à 5 pour noter, flèches pour changer de critère.
  useEffect(() => {
    if (!activeEval || activeEval.criteria.length === 0) return;
    const handler = (e: KeyboardEvent) => {
      if (isShortcutBlocked(e, rootRef.current)) return;
      if (e.key >= '1' && e.key <= '5') {
        e.preventDefault();
        const criterion = activeEval.criteria[currentCriterionIdx];
        if (criterion) handleRate(criterion.id, +e.key);
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        setCurrentCriterionIdx((i) => Math.min(activeEval.criteria.length - 1, i + 1));
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        setCurrentCriterionIdx((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activeEval, currentCriterionIdx, handleRate]);

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
    const key = createDraft();
    openEvaluation(key);
    setSelectedStage('');
  }, [createDraft, openEvaluation]);

  /** Plein écran ou assistant d'entretien : la saisie en attente est écrite avant de partir. */
  const openFullPage = useCallback(async (coaching: boolean) => {
    const ok = activeKey ? await flush(activeKey) : true;
    if (!ok) {
      toast.error('Vos dernières modifications ne sont pas enregistrées', {
        description: 'Choisissez « Réessayer » à côté du statut, puis ouvrez de nouveau le plein écran.',
      });
      return;
    }
    navigate(`/ats/scorecard/${candidate.candidateId}${coaching ? '?coaching=1' : ''}`);
  }, [activeKey, flush, navigate, candidate.candidateId]);

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

  // ─── Écran de génération (grille sans critères) ───
  if (activeEval && activeEval.criteria.length === 0) {
    const titleId = `${baseId}-generation`;
    const stageLabelId = `${baseId}-type`;
    return (
      <div ref={rootRef} className="min-w-0 space-y-3">
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

  // ─── Grille ouverte ───
  if (activeEval) {
    const criteria = activeEval.criteria;
    const total = criteria.length;
    const criterionIdx = Math.min(currentCriterionIdx, total - 1);
    const criterion = criteria[criterionIdx];
    const rating = criterion ? activeEval.ratings[criterion.id] : undefined;
    const comment = criterion ? activeEval.comments[criterion.id] || '' : '';
    const questions = criterion?.suggestedQuestions || [];
    const redFlags = criterion?.redFlags || [];
    const rubric = criterion?.ratingRubric || {};
    const rubricEntries = Object.entries(rubric).sort(([a], [b]) => Number(a) - Number(b));
    const hasInput =
      Object.keys(activeEval.ratings).length > 0 || Object.values(activeEval.comments).some((c) => c && c.trim());
    const categoryAverages = CATEGORY_ORDER.map((cat) => {
      const rated = criteria.filter((c) => c.category === cat && activeEval.ratings[c.id] != null);
      if (rated.length === 0) return null;
      const avg = rated.reduce((s, c) => s + activeEval.ratings[c.id], 0) / rated.length;
      return { cat, avg };
    }).filter((x): x is { cat: string; avg: number } => x !== null);

    const ids = {
      card: `${baseId}-critere`,
      rating: `${baseId}-note`,
      scale: `${baseId}-echelle`,
      rubric: `${baseId}-bareme`,
      notes: `${baseId}-notes`,
      verdict: `${baseId}-verdict`,
      reco: `${baseId}-reco`,
      summary: `${baseId}-resume`,
      followUp: `${baseId}-suivi`,
      autoNav: `${baseId}-suivi-auto`,
    };

    const coachingPanel = showCoaching ? (
      <div className="order-first w-full min-w-0 lg:order-none lg:sticky lg:top-4 lg:w-80 lg:shrink-0">
        <LiveCoachingPanel
          candidateId={candidate.candidateId}
          candidateName={candidate.name}
          candidateHeadline={candidate.headline || ''}
          candidateProfileSummary={(() => {
            const p = candidate.linkedinProfileData as unknown as { summary?: string; about?: string; headline?: string } | null;
            return p?.summary || p?.about || p?.headline || '';
          })()}
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
      </div>
    ) : null;

    return (
      <div ref={rootRef} className="min-w-0 max-w-full space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" size="sm" onClick={closeEditor} className={cn('-ml-2', touch)}>
            <ChevronLeft aria-hidden="true" />
            Retour aux grilles
          </Button>
          <SaveIndicator state={saveState} savedAt={activeEval.savedAt} onRetry={retrySave} />
        </div>

        {/* En-tête : moyenne, progression, actions */}
        <section
          aria-label="Synthèse de la grille"
          className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 xl:flex-row xl:items-center xl:justify-between"
        >
          <div className="flex min-w-0 items-start gap-4">
            <div className="shrink-0">
              <p className="eyebrow">Moyenne</p>
              {overallScore != null ? (
                <p className="mt-0.5 text-2xl font-semibold tabular-nums text-foreground">
                  {formatAverage(overallScore)}
                  <span className="text-sm font-medium text-muted-foreground">/5</span>
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted-foreground">Pas encore de note</p>
              )}
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-1.5">
                <p className="text-sm font-semibold text-foreground">
                  {ratedCount > 1 ? `${ratedCount} critères notés` : `${ratedCount} critère noté`} sur {total}
                </p>
                {activeEval.interviewStage && <Badge variant="muted">{interviewTypeLabel(activeEval.interviewStage)}</Badge>}
              </div>
              {categoryAverages.length > 0 && (
                <dl className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
                  {categoryAverages.map(({ cat, avg }) => (
                    <div key={cat} className="flex gap-1">
                      <dt className="text-muted-foreground">{CATEGORY_LABELS[cat]}</dt>
                      <dd className="font-medium tabular-nums text-foreground">{formatAverage(avg)}</dd>
                    </div>
                  ))}
                </dl>
              )}
              <p className="truncate text-xs text-muted-foreground">
                {activeEval.jobTitle || candidate.jobTitle || 'Poste non précisé'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!showCoaching && (
              <Button variant="outline" size="sm" onClick={openCoaching} className={touch}>
                <Mic aria-hidden="true" />
                Ouvrir l'assistant d'entretien
              </Button>
            )}
            {!autoOpenFirst && (
              <Button variant="outline" size="sm" onClick={() => void openFullPage(false)} className={touch}>
                <Maximize2 aria-hidden="true" />
                Ouvrir en plein écran
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmRegenerate(true)}
              loading={generating}
              className={touch}
            >
              {!generating && <RotateCcw aria-hidden="true" />}
              Régénérer la grille
            </Button>
          </div>
        </section>

        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start">
          {/* Liste des critères (ordinateur) */}
          <nav aria-label="Critères" className="hidden w-44 shrink-0 lg:sticky lg:top-4 lg:block">
            <p className="eyebrow mb-2 px-2">Critères ({total})</p>
            <ol className="space-y-0.5">
              {criteria.map((c, idx) => {
                const r = activeEval.ratings[c.id];
                const current = idx === criterionIdx;
                return (
                  <li key={c.id}>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-current={current ? 'step' : undefined}
                      aria-label={`${c.label}, ${r != null ? `noté ${r} sur 5` : 'pas encore noté'}`}
                      onClick={() => setCurrentCriterionIdx(idx)}
                      className={cn(
                        'h-auto w-full justify-between gap-2 whitespace-normal px-2 py-1.5 text-left text-xs font-normal text-foreground-secondary',
                        current && 'bg-accent font-semibold text-foreground',
                      )}
                    >
                      <span className="line-clamp-2 min-w-0 flex-1">{c.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{r ?? '–'}</span>
                    </Button>
                  </li>
                );
              })}
            </ol>
            {showCoaching && (
              <div className="mt-3 flex items-center gap-2 border-t border-border px-2 pt-3">
                <Checkbox
                  id={ids.autoNav}
                  checked={coachingAutoNav}
                  onCheckedChange={(checked) => setCoachingAutoNav(checked === true)}
                />
                <Label htmlFor={ids.autoNav} className="text-xs font-normal text-muted-foreground">
                  Suivre les critères abordés
                </Label>
              </div>
            )}
          </nav>

          <div className="min-w-0 flex-1 space-y-3">
            {/* Liste des critères (téléphone et tablette) */}
            <nav aria-label="Critères" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:hidden">
              {criteria.map((c, idx) => {
                const r = activeEval.ratings[c.id];
                const current = idx === criterionIdx;
                return (
                  <Button
                    key={c.id}
                    variant="outline"
                    size="xs"
                    aria-current={current ? 'step' : undefined}
                    aria-label={`Critère ${idx + 1}\u00a0: ${c.label}, ${r != null ? `noté ${r} sur 5` : 'pas encore noté'}`}
                    onClick={() => setCurrentCriterionIdx(idx)}
                    className={cn('shrink-0 tabular-nums', touch, current && 'border-foreground bg-accent font-semibold')}
                  >
                    {idx + 1}
                    {r != null && <Check aria-hidden="true" />}
                  </Button>
                );
              })}
            </nav>

            {criterion && (
              <article aria-labelledby={ids.card} className="overflow-hidden rounded-xl border border-border bg-card">
                <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <Badge variant="muted">{CATEGORY_LABELS[criterion.category] ?? 'Critère'}</Badge>
                    <Badge variant={criterion.weight === 3 ? 'outline' : 'muted'}>
                      {WEIGHT_LABELS[criterion.weight] ?? 'Bonus'}
                    </Badge>
                  </div>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                    Critère {criterionIdx + 1} sur {total}
                  </span>
                </header>

                <div className="space-y-5 px-4 py-4 sm:px-5">
                  <div>
                    <h3 id={ids.card} className="text-base font-semibold text-foreground">{criterion.label}</h3>
                    {criterion.description && (
                      <p className="mt-1.5 text-sm text-foreground-secondary">{criterion.description}</p>
                    )}
                  </div>

                  <div className="space-y-2">
                    <p id={ids.rating} className="eyebrow">Votre note</p>
                    <ToggleGroup
                      type="single"
                      role="radiogroup"
                      aria-labelledby={ids.rating}
                      aria-describedby={ids.scale}
                      variant="outline"
                      value={rating ? String(rating) : ''}
                      onValueChange={(value) => {
                        if (value) handleRate(criterion.id, Number(value));
                      }}
                      className="justify-start gap-2"
                    >
                      {[1, 2, 3, 4, 5].map((score) => (
                        <ToggleGroupItem
                          key={score}
                          value={String(score)}
                          aria-label={`Noter ${score} sur 5`}
                          className={cn('h-10 w-10 p-0 text-md tabular-nums max-md:h-11 max-md:w-11', CHOICE_CLASS)}
                        >
                          {score}
                        </ToggleGroupItem>
                      ))}
                    </ToggleGroup>
                    <p id={ids.scale} className="text-xs text-muted-foreground">
                      De 1 (très faible) à 5 (exceptionnel). Touches 1 à 5 pour noter, flèches pour changer de critère.
                    </p>
                  </div>

                  {rating && !showFullRubric && rubric[String(rating)] && (
                    <p className="rounded-lg bg-muted px-3 py-2 text-sm text-foreground">
                      <span className="font-semibold tabular-nums">{`${rating}/5\u00a0: `}</span>
                      {rubric[String(rating)]}
                    </p>
                  )}

                  {rubricEntries.length > 0 && (
                    <div>
                      <Button
                        variant="ghost"
                        size="xs"
                        aria-expanded={showFullRubric}
                        aria-controls={ids.rubric}
                        onClick={() => setShowFullRubric((v) => !v)}
                        className={cn('-ml-2 text-muted-foreground hover:text-foreground', touch)}
                      >
                        <ChevronDown aria-hidden="true" className={cn('transition-transform duration-150', showFullRubric && 'rotate-180')} />
                        {showFullRubric ? "Masquer l'échelle complète" : "Voir l'échelle complète"}
                      </Button>
                      {showFullRubric && (
                        <ol id={ids.rubric} className="mt-2 space-y-1 rounded-lg border border-border p-2">
                          {rubricEntries.map(([score, desc]) => {
                            const isActive = String(rating) === score;
                            return (
                              <li
                                key={score}
                                className={cn(
                                  'flex items-start gap-2.5 rounded-md px-2 py-1.5 text-xs',
                                  isActive ? 'bg-accent font-medium text-foreground' : 'text-foreground-secondary',
                                )}
                              >
                                <span
                                  className={cn(
                                    'grid h-5 w-5 shrink-0 place-items-center rounded-md font-semibold tabular-nums',
                                    isActive ? 'bg-foreground text-background' : 'bg-muted text-foreground',
                                  )}
                                >
                                  {score}
                                </span>
                                <span>{desc}</span>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                    </div>
                  )}

                  {questions.length > 0 && (
                    <section className="space-y-2 rounded-lg border border-border px-3 py-3">
                      <h4 className="eyebrow flex items-center gap-1.5">
                        <MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />
                        À vérifier pendant l'entretien
                      </h4>
                      <ol className="space-y-1.5">
                        {questions.slice(0, 3).map((q, qi) => (
                          <li key={qi} className="flex items-start gap-2 text-sm text-foreground">
                            <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-2xs font-semibold tabular-nums text-foreground-secondary">
                              {qi + 1}
                            </span>
                            <span>{q.replace(/^["«]\s*|\s*["»]$/g, '')}</span>
                          </li>
                        ))}
                      </ol>
                    </section>
                  )}

                  {redFlags.length > 0 && (
                    <div className="flex items-start gap-2.5 rounded-lg border border-warning/30 bg-warning-muted px-3 py-2.5">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold text-warning">Point d'alerte</p>
                        <p className="text-sm text-foreground">{redFlags[0]}</p>
                      </div>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <Label htmlFor={ids.notes}>Vos notes sur ce critère</Label>
                    <Textarea
                      id={ids.notes}
                      value={comment}
                      onChange={(e) => handleComment(criterion.id, e.target.value)}
                      placeholder="Observations, exemples concrets, citations du candidat…"
                      className="min-h-20 resize-y"
                    />
                  </div>
                </div>

                <footer className="flex items-center justify-between gap-2 border-t border-border px-2 py-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentCriterionIdx(Math.max(0, criterionIdx - 1))}
                    disabled={criterionIdx === 0}
                    className={touch}
                  >
                    <ChevronLeft aria-hidden="true" />
                    Précédent
                  </Button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {criterionIdx + 1} / {total}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setCurrentCriterionIdx(Math.min(total - 1, criterionIdx + 1))}
                    disabled={criterionIdx === total - 1}
                    className={touch}
                  >
                    Suivant
                    <ChevronRight aria-hidden="true" />
                  </Button>
                </footer>
              </article>
            )}
          </div>

          {coachingPanel}
        </div>

        {/* Recommandation finale */}
        <section aria-labelledby={ids.verdict} className="space-y-4 rounded-xl border border-border bg-card p-4">
          <h3 id={ids.verdict} className="text-sm font-semibold text-foreground">Recommandation finale</h3>
          <div className="space-y-2">
            <p id={ids.reco} className="eyebrow">Votre recommandation</p>
            <ToggleGroup
              type="single"
              role="radiogroup"
              aria-labelledby={ids.reco}
              variant="outline"
              value={activeEval.recommendation ?? ''}
              onValueChange={(value) => setRecommendation((value || undefined) as Recommendation | undefined)}
              className="flex-wrap justify-start gap-2"
            >
              {RECOMMENDATION_KEYS.map((key) => (
                <ToggleGroupItem key={key} value={key} className={cn('max-md:h-11', CHOICE_CLASS)}>
                  {HIRING_VERDICTS[key].label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            {recommendationFromReport && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                Proposée par le compte rendu de l'entretien&nbsp;: vérifiez-la avant de conclure.
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={ids.summary}>Résumé et justification</Label>
            <Textarea
              id={ids.summary}
              value={activeEval.summary || ''}
              onChange={(e) => setTextField('summary', e.target.value)}
              placeholder="Ce que vous retenez de l'entretien et ce qui justifie votre recommandation…"
              className="min-h-20 resize-y"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor={ids.followUp}>Points de suivi pour le prochain entretien</Label>
            <Textarea
              id={ids.followUp}
              value={activeEval.followUpNotes || ''}
              onChange={(e) => setTextField('followUpNotes', e.target.value)}
              placeholder="Questions à creuser, points à vérifier au prochain entretien…"
              className="min-h-16 resize-y"
            />
          </div>
        </section>

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
      </div>
    );
  }

  // ─── Liste des grilles ───
  const showStatus = saveState === 'saving' || saveState === 'error';
  return (
    <div ref={rootRef} className="min-w-0 space-y-3">
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
            <Button variant="outline" size="sm" onClick={handleNewScorecard} className={touch}>
              <Plus aria-hidden="true" />
              Créer une grille
            </Button>
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
