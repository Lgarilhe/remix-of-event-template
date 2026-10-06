/**
 * Hook for managing enrollment preview state:
 * - Lazy AI message generation per candidate
 * - Variable resolution for non-AI steps
 * - Inline editing with local overrides
 * - Bulk generation with concurrency control
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { invokeWithCredits, estimateActionCredits } from '@/lib/invokeWithCredits';
import type { EdgeFunctionError } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { isClosedChannelStep } from '@/lib/sequenceCompatibility';
import { requiresAiReview } from '@/lib/contactRecipientsGuard';

export interface SequenceStepPreview {
  stepId: string;
  stepOrder: number;
  actionType: string;
  channel?: string;
  messageTemplate: string;
  subjectTemplate: string;
  useAiPersonalization: boolean;
  aiTone?: string;
  delayDays?: number;
  delayHours?: number;
  delayMinutes?: number;
  condition?: string;
  timeoutDays?: number;
  timeoutBranchStepId?: string | null;
  parentStepId?: string | null;
  branch?: string | null;
  /** Cible « oui » d'une vérification (if_true_goto_step). */
  ifTrueGotoStep?: string | null;
  /** Cible « non » d'une vérification (if_false_goto_step). */
  ifFalseGotoStep?: string | null;
  /** Étape suivante explicite (next_step_id), chaînage suivi par le moteur. */
  nextStepId?: string | null;
  /** Version d'un test A/B (variant_group), null hors test. */
  variantGroup?: string | null;
  /** Fin de séquence après cette étape (ends_sequence). */
  endsSequence?: boolean | null;
}

/** Vrai si la séquence a des embranchements : un seul chemin sera suivi par candidat. */
export function hasBranching(steps: readonly SequenceStepPreview[]): boolean {
  return steps.some(s => !!(s.ifTrueGotoStep || s.ifFalseGotoStep || s.timeoutBranchStepId || s.parentStepId || s.branch));
}

/**
 * Étapes des AUTRES branches que celle de `stepId`, pour que l'IA ne rédige
 * pas une étape comme si les messages de l'autre chemin étaient partis. Suit
 * le routage du moteur : vérification oui / non (if_true_goto_step,
 * if_false_goto_step, puis chaînage next_step_id depuis chaque cible) et
 * arbre parent_step_id / branch (enfants d'un même parent, par branche).
 */
export function otherBranchStepIds(steps: readonly SequenceStepPreview[], stepId: string): Set<string> {
  const byId = new Map(steps.map(s => [s.stepId, s]));
  const chainFrom = (startId: string | null | undefined): Set<string> => {
    const out = new Set<string>();
    let current = startId ? byId.get(startId) : undefined;
    while (current && !out.has(current.stepId) && out.size < steps.length) {
      out.add(current.stepId);
      current = current.nextStepId ? byId.get(current.nextStepId) : undefined;
    }
    return out;
  };
  const descendantsOf = (rootId: string): Set<string> => {
    const out = new Set<string>([rootId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const s of steps) {
        if (s.parentStepId && out.has(s.parentStepId) && !out.has(s.stepId)) {
          out.add(s.stepId);
          grew = true;
        }
      }
    }
    return out;
  };

  // Chaque décision donne plusieurs branches (ensembles d'étapes exclusifs).
  const decisions: Set<string>[][] = [];
  for (const s of steps) {
    if (s.ifTrueGotoStep && s.ifFalseGotoStep) {
      decisions.push([chainFrom(s.ifTrueGotoStep), chainFrom(s.ifFalseGotoStep)]);
    }
  }
  const childrenByParent = new Map<string, Map<string, Set<string>>>();
  for (const s of steps) {
    if (!s.parentStepId || !s.branch) continue;
    const byBranch = childrenByParent.get(s.parentStepId) ?? new Map<string, Set<string>>();
    const set = byBranch.get(s.branch) ?? new Set<string>();
    descendantsOf(s.stepId).forEach(id => set.add(id));
    byBranch.set(s.branch, set);
    childrenByParent.set(s.parentStepId, byBranch);
  }
  childrenByParent.forEach(byBranch => {
    if (byBranch.size > 1) decisions.push(Array.from(byBranch.values()));
  });

  const excluded = new Set<string>();
  for (const branches of decisions) {
    const own = branches.find(b => b.has(stepId));
    if (!own) continue;
    for (const other of branches) {
      if (other === own) continue;
      other.forEach(id => { if (!own.has(id)) excluded.add(id); });
    }
  }
  return excluded;
}

/** Texte affiché quand la génération IA d'un aperçu a échoué. */
export const PREVIEW_GENERATION_FAILED_MESSAGE =
  "La génération a échoué. Réessayez pour voir le message avant l'inscription, ou modifiez-le.";

/**
 * Code d'un aperçu refusé par generate-outreach-message : le texte proposé
 * porte encore une violation bloquante du moteur (rémunération, signature
 * « Recruteur », formulation de cabinet). Correctif 2 du plan du lot 5.
 */
export const PREVIEW_NOT_COMPLIANT_CODE = 'PREVIEW_NOT_COMPLIANT';

/** Texte affiché sous un aperçu en échec : la phrase du serveur pour un aperçu refusé, sinon l'échec générique. */
export function previewErrorMessage(err: unknown): string {
  const e = err as EdgeFunctionError | null | undefined;
  return e?.code === PREVIEW_NOT_COMPLIANT_CODE && e.message ? e.message : PREVIEW_GENERATION_FAILED_MESSAGE;
}

export interface GeneratedMessage {
  subject: string;
  message: string;
  personalizationPoints?: string[];
  isEdited: boolean;
  isGenerated: boolean;
  isGenerating: boolean;
  error?: string;
}

export type PreviewMap = Map<string, Map<string, GeneratedMessage>>; // candidateId -> stepId -> message

/**
 * Override des règles de timing d'une étape pour TOUS les candidats de
 * l'inscription en cours (une seule valeur par fenêtre, pas par candidat),
 * sans toucher à la séquence elle-même.
 *
 * Ex : la séquence prévoit un délai de 5 jours avant le 2e message, mais pour
 * cette inscription on veut relancer plus vite (3 jours).
 * → stepConfigOverrides[stepId] = { delayDays: 3 }
 *
 * Écrit sur chaque sequence_enrollments.tracking_data.step_config_overrides.
 * Lu par le cron process-sequences au moment de scheduler le step :
 *   override.delayDays ?? step.delay_days
 */
// Alias de type (et non interface) : il s'écrit tel quel dans la colonne JSON
// tracking_data, sans conversion.
export type StepConfigOverride = {
  /** Délai en jours avant l'exécution du step (override de step.delay_days). */
  delayDays?: number;
  /** Délai en heures additionnel (override de step.delay_hours). */
  delayHours?: number;
  /** Pour les steps wait_* : nombre de jours avant timeout (override de step.timeout_days). */
  timeoutDays?: number;
};

interface UseEnrollmentPreviewOptions {
  steps: SequenceStepPreview[];
  profiles: LinkedInProfile[];
  /**
   * Candidats visés par la génération groupée, son compteur et l'estimation de
   * crédits (par défaut : tous). L'aperçu exclut ainsi les candidats retirés,
   * passés, déjà contactés ou incompatibles avec la séquence.
   */
  targetProfiles?: LinkedInProfile[];
  job?: { id: string; title: string; client?: any; skills?: string[]; description?: string; location?: string; accompagnement?: string[] } | null;
  accountId: string;
  /**
   * Clé de conservation des aperçus pendant la session (séquence, mission,
   * compte d'envoi). Sans clé, les aperçus vivent le temps du composant.
   */
  sessionKey?: string;
}

// Steps that have sendable messages
const MESSAGE_ACTION_TYPES = ['message', 'inmail', 'smart_message', 'email', 'connection_request', 'whatsapp_message'];

/**
 * Étape dont le message part : un modèle écrit, ou une étape à message
 * rédigée par l'IA pour chaque candidat, même sans modèle (le moteur la
 * rédige et l'envoie : aiWillGenerate de process-sequences). Jamais une
 * invitation sans note : le moteur ne rédige pas de note. Un canal fermé
 * (e-mail, WhatsApp, D2) est sauté par le moteur, ni aperçu ni génération
 * facturée pour lui.
 */
export function hasMessage(step: Pick<SequenceStepPreview, 'actionType' | 'messageTemplate' | 'useAiPersonalization'>): boolean {
  if (!MESSAGE_ACTION_TYPES.includes(step.actionType) || isClosedChannelStep(step.actionType)) return false;
  if (step.messageTemplate?.trim()) return true;
  return !!step.useAiPersonalization && step.actionType !== 'connection_request';
}

/**
 * Étape comptée comme déjà envoyée dans l'historique simulé (prevSentSteps).
 * Une étape d'un canal fermé n'est jamais partie : la compter ferait écrire à
 * l'IA une relance d'un message que le candidat n'a pas reçu.
 */
function isSentReachStep(step: SequenceStepPreview): boolean {
  return MESSAGE_ACTION_TYPES.includes(step.actionType) && !isClosedChannelStep(step.actionType);
}

// ── Aperçus conservés pendant la session (revue design D-46) ──
// Fermer la préparation ne jette plus les messages déjà générés (facturés) ni
// les retouches : ils sont gardés en mémoire, par séquence, mission et compte
// d'envoi, puis par candidat. Rien n'est écrit dans le navigateur : un
// rechargement de la page les efface. Un aperçu n'est repris que si son étape
// n'a pas changé depuis (même type, même modèle, même réglage IA).

interface StoredPreview {
  signature: string;
  message: GeneratedMessage;
}

/** Nombre de préparations gardées ; la plus ancienne part au-delà. */
const SESSION_LIMIT = 20;
const sessionPreviews = new Map<string, Map<string, Map<string, StoredPreview>>>();

function stepSignature(step: SequenceStepPreview): string {
  return [step.actionType, step.useAiPersonalization ? 'ia' : '', step.aiTone ?? '', step.subjectTemplate, step.messageTemplate].join('\u0001');
}

function isWorthKeeping(msg: GeneratedMessage): boolean {
  return !msg.isGenerating && (msg.isGenerated || msg.isEdited);
}

function keepInSession(key: string | undefined, step: SequenceStepPreview | undefined, candidateId: string, msg: GeneratedMessage) {
  if (!key || !step || !isWorthKeeping(msg)) return;
  let byCandidate = sessionPreviews.get(key);
  if (!byCandidate) {
    if (sessionPreviews.size >= SESSION_LIMIT) {
      const oldest = sessionPreviews.keys().next().value;
      if (oldest !== undefined) sessionPreviews.delete(oldest);
    }
    byCandidate = new Map();
    sessionPreviews.set(key, byCandidate);
  }
  let byStep = byCandidate.get(candidateId);
  if (!byStep) {
    byStep = new Map();
    byCandidate.set(candidateId, byStep);
  }
  byStep.set(step.stepId, { signature: stepSignature(step), message: { ...msg, isGenerating: false } });
}

function restoreFromSession(key: string | undefined, steps: SequenceStepPreview[], profiles: LinkedInProfile[]): PreviewMap {
  const restored: PreviewMap = new Map();
  const stored = key ? sessionPreviews.get(key) : undefined;
  if (!stored) return restored;
  const signatures = new Map(steps.map(s => [s.stepId, stepSignature(s)]));
  for (const profile of profiles) {
    const byStep = stored.get(profile.id);
    if (!byStep) continue;
    const messages = new Map<string, GeneratedMessage>();
    byStep.forEach((entry, stepId) => {
      if (signatures.get(stepId) === entry.signature) messages.set(stepId, { ...entry.message, isGenerating: false });
    });
    if (messages.size > 0) restored.set(profile.id, messages);
  }
  return restored;
}

/**
 * Variables résolues dans l'aperçu. Le texte résolu est enregistré tel quel dans
 * tracking_data.message_overrides et envoyé par le moteur : ce qui est montré
 * est ce qui part. {{city}} vient de la localisation du profil (le moteur ne la
 * connaît pas) et {{sender_name}} du prénom de l'expéditeur. {{calendly_link}}
 * reste dans le texte : le moteur y met le lien d'agenda de la mission à l'envoi.
 */
export function resolveVariables(template: string, profile: LinkedInProfile, senderName?: string): string {
  if (!template) return '';
  const city = (profile.location || '').split(',')[0]?.trim() || '';
  const resolved = template
    .replace(/\{\{first_name\}\}/gi, profile.first_name || profile.name?.split(' ')[0] || '')
    .replace(/\{\{last_name\}\}/gi, profile.last_name || profile.name?.split(' ').slice(1).join(' ') || '')
    .replace(/\{\{full_name\}\}/gi, profile.name || '')
    .replace(/\{\{company\}\}/gi, profile.work_experience?.[0]?.company || '')
    .replace(/\{\{headline\}\}/gi, profile.headline || '')
    .replace(/\{\{location\}\}/gi, profile.location || '')
    .replace(/\{\{city\}\}/gi, city)
    .replace(/\{\{job_title\}\}/gi, profile.work_experience?.[0]?.role || profile.work_experience?.[0]?.position || '');
  // Sans prénom connu, la variable reste : le moteur la remplit à l'envoi.
  return senderName ? resolved.replace(/\{\{sender_name\}\}/gi, senderName) : resolved;
}

/** Réglages d'approche d'une mission (sourcing_projects.job_details.outreach_config). */
export interface MissionOutreachConfig {
  recruitment_mode?: 'internal' | 'client';
  sender_role?: string;
  anonymize_client?: boolean;
  anonymized_alias?: string;
}

/** Identifiant de mission sans le préfixe « project: » des postes synthétiques du sourcing. */
export function normalizeMissionJobId(rawJobId: string | null | undefined): string | null {
  if (!rawJobId) return null;
  return rawJobId.startsWith('project:') ? rawJobId.slice('project:'.length) : rawJobId;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Mission d'un poste pour les envois (project_id, lot 0b) : l'identifiant sans
 * le préfixe « project: », seulement s'il a la forme d'un uuid. Sinon
 * undefined : rien n'est envoyé, le serveur résout la mission.
 */
export function missionIdOfJob(rawJobId: string | null | undefined): string | undefined {
  const id = normalizeMissionJobId(rawJobId);
  return id && UUID_RE.test(id) ? id : undefined;
}

/**
 * Lit outreach_config et le nom du client de la mission liée au poste. Partagé
 * par l'aperçu d'inscription et l'InMail groupé : sans ces réglages, la
 * génération retombe sur le mode cabinet et n'anonymise pas le client.
 * status : 'idle' (aucun poste), 'loading', 'ready' (trouvé ou poste hors
 * mission), 'error' (lecture en échec, réglages inconnus).
 */
export function useMissionOutreachConfig(rawJobId: string | null | undefined) {
  const [state, setState] = useState<{
    outreachConfig: MissionOutreachConfig | null;
    missionClientName: string | null;
    status: 'idle' | 'loading' | 'ready' | 'error';
  }>({ outreachConfig: null, missionClientName: null, status: rawJobId ? 'loading' : 'idle' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // 🔧 FIX CRITIQUE : depuis le flow Sourcing, useLinkedInSearch génère
    // des jobs synthétiques avec id: "project:{uuid}". Sans décaper ce
    // préfixe, la requête ne trouve RIEN → outreach_config null → repli
    // CABINET (mode INTERNE jamais appliqué, client jamais anonymisé).
    const jobId = normalizeMissionJobId(rawJobId);
    if (!jobId) {
      setState({ outreachConfig: null, missionClientName: null, status: 'idle' });
      return;
    }
    setState(prev => ({ ...prev, status: 'loading' }));
    (async () => {
      try {
        // Un identifiant non uuid (poste externe) ferait échouer id.eq : on ne
        // compare alors que job_id.
        const base = supabase.from('sourcing_projects').select('id, job_id, job_details, client_name');
        const { data, error } = await (UUID_RE.test(jobId)
          ? base.or(`id.eq.${jobId},job_id.eq.${jobId}`)
          : base.eq('job_id', jobId)
        ).limit(1).maybeSingle();
        if (cancelled) return;
        if (error) throw error;
        const jd = (data?.job_details ?? null) as Record<string, unknown> | null;
        setState({
          outreachConfig: (jd?.outreach_config ?? null) as MissionOutreachConfig | null,
          missionClientName: data?.client_name
            ?? ((jd?.client as Record<string, unknown> | undefined)?.name as string | undefined)
            ?? null,
          status: 'ready',
        });
      } catch (err) {
        console.warn('[useMissionOutreachConfig] outreach_config fetch failed:', err);
        if (!cancelled) setState({ outreachConfig: null, missionClientName: null, status: 'error' });
      }
    })();
    return () => { cancelled = true; };
  }, [rawJobId, attempt]);

  const retry = useCallback(() => setAttempt(a => a + 1), []);
  return { ...state, retry };
}

/**
 * Prénom de l'expéditeur pour signer les messages générés : « Laurent », pas
 * « L. Garilhe » ni le nom de famille. Sources dans l'ordre :
 *  1. user_metadata.first_name (signup direct)
 *  2. profiles.display_name (1er token = prénom)
 *  3. user_metadata.full_name (1er token)
 *  4. partie locale de l'e-mail « prenom.nom » (jamais le nom de famille)
 * undefined si rien d'utilisable : la génération prend alors son défaut explicite.
 */
export function useSenderFirstName(): string | undefined {
  const { user } = useAuthReady();
  const [profileDisplayName, setProfileDisplayName] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    const userId = user?.id;
    if (!userId) {
      setProfileDisplayName(null);
      return;
    }
    (async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('display_name')
          .eq('user_id', userId)
          .maybeSingle();
        if (!cancelled && data?.display_name) {
          setProfileDisplayName(data.display_name);
        }
      } catch (err) {
        console.warn('[useSenderFirstName] profile display_name fetch failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);

  const meta = (user?.user_metadata ?? {}) as { first_name?: string; full_name?: string };
  if (meta.first_name?.trim()) return meta.first_name.trim();
  if (profileDisplayName?.trim()) {
    const firstToken = profileDisplayName.trim().split(/\s+/)[0];
    if (firstToken && firstToken.length >= 2) return firstToken;
  }
  if (meta.full_name?.trim()) {
    const firstToken = meta.full_name.trim().split(/\s+/)[0];
    if (firstToken && firstToken.length >= 2) return firstToken;
  }
  if (user?.email) {
    const tokens = user.email.split('@')[0].split(/[._-]/);
    // Format "prenom.nom" → tokens[0] = prénom (>= 2 caractères). Format
    // "p.nom" : on ne renvoie PAS le nom (signal IA), plutôt undefined.
    if (tokens[0] && tokens[0].length >= 2) {
      return tokens[0].charAt(0).toUpperCase() + tokens[0].slice(1);
    }
  }
  return undefined;
}

export function useEnrollmentPreview({ steps, profiles, targetProfiles, job, accountId, sessionKey }: UseEnrollmentPreviewOptions) {
  const [previews, setPreviews] = useState<PreviewMap>(() => restoreFromSession(sessionKey, steps, profiles));
  // Dernier état des aperçus, lu par les générations en cours : une closure
  // figée (raccourci clavier, workers de la génération groupée) ne voyait pas
  // les messages modifiés entre-temps et les régénérait par-dessus.
  const previewsRef = useRef<PreviewMap>(previews);
  useEffect(() => { previewsRef.current = previews; }, [previews]);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  // Lot 5a-2 : numéro de la dernière génération IA réussie. Toute génération
  // ou régénération le change, ce qui décoche la case de relecture.
  const [aiGenerationVersion, setAiGenerationVersion] = useState(0);
  const abortRef = useRef(false);
  // Préparation fermée : plus aucune génération ne part (celles en cours
  // arrivent quand même et sont conservées pour la session).
  const unmountedRef = useRef(false);
  // Candidats inscrits : leurs aperçus ne sont plus conservés.
  const discardedRef = useRef<Set<string>>(new Set());
  const targets = targetProfiles ?? profiles;

  useEffect(() => {
    unmountedRef.current = false;
    return () => { unmountedRef.current = true; };
  }, []);

  const keep = useCallback((step: SequenceStepPreview | undefined, candidateId: string, msg: GeneratedMessage) => {
    if (discardedRef.current.has(candidateId)) return;
    keepInSession(sessionKey, step, candidateId, msg);
  }, [sessionKey]);

  // Les retouches et les aperçus affichés rejoignent la session à chaque
  // changement ; un aperçu en cours de génération garde la version précédente.
  useEffect(() => {
    if (!sessionKey) return;
    const stepsById = new Map(steps.map(s => [s.stepId, s]));
    previews.forEach((byStep, candidateId) => {
      byStep.forEach((msg, stepId) => keep(stepsById.get(stepId), candidateId, msg));
    });
  }, [previews, steps, sessionKey, keep]);

  /** Oublie les aperçus des candidats inscrits (ils ne servent plus). */
  const discardSessionPreviews = useCallback((candidateIds: string[]) => {
    const stored = sessionKey ? sessionPreviews.get(sessionKey) : undefined;
    for (const id of candidateIds) {
      discardedRef.current.add(id);
      stored?.delete(id);
    }
  }, [sessionKey]);

  // Overrides des règles de timing par étape pour l'inscription en cours :
  // une seule valeur, appliquée à TOUS les candidats inscrits depuis cette
  // fenêtre. Map<stepId, { delayDays?, delayHours?, timeoutDays? }>.
  // Vide par défaut → utilise les valeurs de la séquence.
  // Inclus dans tracking_data.step_config_overrides de chaque inscription,
  // lu par process-sequences au scheduling.
  const [stepConfigOverrides, setStepConfigOverrides] = useState<Map<string, StepConfigOverride>>(new Map());

  const setStepConfig = useCallback((stepId: string, config: StepConfigOverride | null) => {
    setStepConfigOverrides(prev => {
      const next = new Map(prev);
      // Si config = null OU object vide → on retire l'override (revient au défaut)
      if (!config || (config.delayDays === undefined && config.delayHours === undefined && config.timeoutDays === undefined)) {
        next.delete(stepId);
      } else {
        next.set(stepId, config);
      }
      return next;
    });
  }, []);

  const getStepConfig = useCallback((stepId: string): StepConfigOverride | undefined => {
    return stepConfigOverrides.get(stepId);
  }, [stepConfigOverrides]);

  /**
   * Sérialise les overrides en objet plat compatible JSONB pour
   * sequence_enrollments.tracking_data.step_config_overrides.
   * Format : { [stepId]: { delayDays?, delayHours?, timeoutDays? } }
   */
  const getStepConfigOverrides = useCallback((): Record<string, StepConfigOverride> => {
    const result: Record<string, StepConfigOverride> = {};
    stepConfigOverrides.forEach((cfg, stepId) => {
      result[stepId] = cfg;
    });
    return result;
  }, [stepConfigOverrides]);

  // outreach_config de la mission (sourcing_projects.job_details). Sans ça,
  // l'edge function tombe sur le fallback "MODE SUCCÈS = cabinet externe" même
  // si la mission est en mode interne, et n'anonymise pas le client.
  const { outreachConfig, missionClientName } = useMissionOutreachConfig(job?.id);

  // Prénom de l'expéditeur (signature des messages et {{sender_name}}).
  const senderName = useSenderFirstName();

  // 🔍 DEBUG : log ce qui arrive aux call sites pour qu'on puisse voir
  // si outreach_config est bien fetché et passé.
  useEffect(() => {
    if (job?.id) {
      console.log('[EnrollmentPreview] Config IA :', {
        jobId: job.id,
        outreach_mode: outreachConfig?.recruitment_mode || '(undefined → fallback CABINET legacy)',
        sender_role: outreachConfig?.sender_role || '(undefined)',
        anonymize: outreachConfig?.anonymize_client || false,
        client_name: missionClientName || '(undefined)',
        sender_first_name: senderName || '(undefined)',
      });
    }
  }, [job?.id, outreachConfig, missionClientName, senderName]);

  const messageSteps = steps.filter(hasMessage);
  const totalToGenerate = targets.length;

  const getPreview = useCallback((candidateId: string, stepId: string): GeneratedMessage | undefined => {
    return previews.get(candidateId)?.get(stepId);
  }, [previews]);

  const setPreview = useCallback((candidateId: string, stepId: string, msg: Partial<GeneratedMessage>) => {
    setPreviews(prev => {
      const next = new Map(prev);
      const candidateMap = new Map(next.get(candidateId) || new Map());
      const existing = candidateMap.get(stepId) || {
        subject: '', message: '', isEdited: false, isGenerated: false, isGenerating: false,
      };
      candidateMap.set(stepId, { ...existing, ...msg });
      next.set(candidateId, candidateMap);
      previewsRef.current = next;
      return next;
    });
  }, []);

  // ignoreBulkAbort : génération d'un seul candidat (bouton, Ctrl+Entrée),
  // jamais bloquée par l'arrêt d'une génération groupée précédente.
  const generateForCandidate = useCallback(async (profile: LinkedInProfile, options?: { ignoreBulkAbort?: boolean }) => {
    // 🔧 Accumulator local pour résoudre un BUG de closure :
    // setPreview est async (passe par React state), donc dans la même
    // boucle, lire `previews.get(profile.id)?.get(s.stepId)` retourne
    // la valeur AVANT les writes faits dans les itérations précédentes.
    //
    // Conséquence : pour le step #5 (RELANCE), prevSentSteps n'avait
    // PAS le message #3 généré juste avant → l'IA recevait
    // prevSentSteps=[] → générait une "relance" sans contexte → message
    // bidon générique du type "Je relance brièvement, je sais que LinkedIn
    // déborde [...]" sans aucun lien avec le 1er message.
    //
    // Fix : on maintient une Map locale synchrone qui contient les
    // messages déjà générés dans cette boucle. C'est ELLE qu'on utilise
    // pour construire prevSentSteps, pas le React state.
    const localPreviews = new Map<string, GeneratedMessage>();

    // Pré-charge les previews déjà existants (cas où l'user a déjà
    // généré certains steps avant ; on ne les regenere pas mais on
    // veut les inclure dans prevSentSteps des steps suivants).
    const existingCandidateMap = previewsRef.current.get(profile.id);
    if (existingCandidateMap) {
      existingCandidateMap.forEach((msg, stepId) => {
        if (msg.isGenerated || msg.isEdited) localPreviews.set(stepId, msg);
      });
    }

    for (const step of messageSteps) {
      if (unmountedRef.current) return;
      if (abortRef.current && !options?.ignoreBulkAbort) return;

      // Jamais de régénération d'un message déjà généré ou modifié à la main
      // (« Générer tous les aperçus », touche Entrée) : seul le bouton
      // « Régénérer » de l'étape (regenerateStep) le remplace. Lecture fraîche
      // à chaque étape : un message modifié ou lancé ailleurs pendant la boucle
      // est respecté. Un message en erreur reste régénérable.
      const current = previewsRef.current.get(profile.id)?.get(step.stepId);
      const existing = localPreviews.get(step.stepId) ?? current;
      if (existing && (existing.isEdited || existing.isGenerated || existing.isGenerating)) {
        if (current && (current.isEdited || current.isGenerated)) localPreviews.set(step.stepId, current);
        continue;
      }

      setPreview(profile.id, step.stepId, { isGenerating: true, error: undefined });

      // Détecte si ce step est l'InMail FALLBACK (= dernier inmail de la
      // séquence + il y a un wait_connection avant lui). Dans ce cas, le
      // candidat n'a accepté NI la connexion NI reçu de message direct
      // (les messages dans le linéaire de la séquence appartiennent à la
      // branche "si accepté" et n'ont jamais été envoyés).
      // → prevSentSteps doit refléter la VRAIE histoire : seulement le
      // connection_request (qui n'a pas été accepté).
      const isLastInmail =
        step.actionType === 'inmail' &&
        !steps.some(s => s.actionType === 'inmail' && s.stepOrder > step.stepOrder);
      const waitConnectionBefore = steps.find(s =>
        s.actionType === 'wait_connection' && s.stepOrder < step.stepOrder
      );
      const isInmailFallback = isLastInmail && !!waitConnectionBefore;

      // Construit prevSentSteps simulés pour ce step :
      // - Cas normal : tous les steps "reach" linéairement avant
      // - Cas InMail FALLBACK : SEULEMENT les steps avant le wait_connection
      //   (= profile_visit + connection_request) car les messages "if accepted"
      //   n'ont jamais été envoyés
      const upperBound = isInmailFallback
        ? waitConnectionBefore!.stepOrder
        : step.stepOrder;
      // Séquence à embranchements : les étapes de l'autre chemin ne sont
      // jamais parties pour ce candidat.
      const otherBranch = otherBranchStepIds(steps, step.stepId);
      const prevSentSteps = steps
        .filter(s =>
          s.stepOrder < upperBound &&
          isSentReachStep(s) &&
          !otherBranch.has(s.stepId)
        )
        .sort((a, b) => a.stepOrder - b.stepOrder)
        .map(s => {
          const prev = localPreviews.get(s.stepId);
          return {
            actionType: s.actionType,
            finalMessage: prev?.message
              ? prev.message.replace(/<br\s*\/?>(\s*)/gi, '\n')
              : '',
            stepOrder: s.stepOrder,
          };
        });

      if (step.useAiPersonalization) {
        try {
          // Normalise le network_distance : Unipile renvoie 1/2/3 ou
          // 'DISTANCE_1' etc. On standardise pour que l'IA comprenne :
          // 'FIRST_DEGREE' = déjà connecté, 'SECOND_DEGREE' = ami d'ami,
          // 'THIRD_DEGREE' = inconnu réseau, 'OUT_OF_NETWORK' = hors réseau.
          const rawNd = (profile as any).network_distance;
          const normalizedNetworkDistance =
            rawNd === 1 || rawNd === '1' || rawNd === 'DISTANCE_1' || rawNd === 'FIRST_DEGREE'
              ? 'FIRST_DEGREE'
              : rawNd === 2 || rawNd === '2' || rawNd === 'DISTANCE_2' || rawNd === 'SECOND_DEGREE'
              ? 'SECOND_DEGREE'
              : rawNd === 3 || rawNd === '3' || rawNd === 'DISTANCE_3' || rawNd === 'THIRD_DEGREE'
              ? 'THIRD_DEGREE'
              : rawNd === 'OUT_OF_NETWORK'
              ? 'OUT_OF_NETWORK'
              : null;

          // Build rich profile data — the more context, the better the AI personalization
          const profileData = {
            name: profile.name,
            headline: profile.headline,
            location: profile.location,
            summary: profile.summary || (profile as any).about,
            currentRole: profile.work_experience?.[0]?.role || profile.work_experience?.[0]?.position,
            currentCompany: profile.work_experience?.[0]?.company,
            skills: profile.skills?.map(s => typeof s === 'string' ? s : s.name).filter(Boolean) || [],
            // 🔑 Network distance : sans ça l'IA hallucine "on est déjà
            // connectés" sur des profils 2nd/3rd degree. Avec ça, l'IA
            // adapte son accroche selon le statut réel.
            networkDistance: normalizedNetworkDistance,
            openToWork: !!(profile as any).open_to_work,
            premium: !!(profile as any).premium,
            pastPositions: profile.work_experience?.slice(0, 4).map(w =>
              `${w.role || w.position || ''} @ ${w.company || ''}`.trim()
            ).filter(Boolean) || [],
            education: (profile as any).education?.slice(0, 2).map((e: any) =>
              [e.school_name || e.school, e.degree_name || e.degree, e.field_of_study || e.field].filter(Boolean).join(' - ')
            ) || [],
            yearsOfExperience: (() => {
              const exps = profile.work_experience || [];
              if (exps.length === 0) return undefined;
              let earliest = 9999;
              for (const exp of exps) {
                const start = (exp as any).start_date || (exp as any).starts_at;
                if (start) {
                  const year = typeof start === 'object' && start?.year ? start.year
                    : typeof start === 'string' ? parseInt(start.split('-')[0]) : 9999;
                  if (year < earliest) earliest = year;
                }
              }
              return earliest < 9999 ? new Date().getFullYear() - earliest : undefined;
            })(),
          };

          const { data, error } = await invokeWithCredits<{
            subject?: string;
            message?: string;
            personalization_points?: string[];
          }>('generate-outreach-message', 'outreach_message', {
            profile: profileData,
            job: job ? {
              title: job.title,
              // Si on a missionClientName plus à jour côté DB, on l'utilise
              // pour respecter le client.name réel de la mission.
              client: job.client || (missionClientName ? { name: missionClientName } : undefined),
              skills: job.skills || [],
              description: job.description,
              location: job.location,
              accompagnement: job.accompagnement || [],
            } : undefined,
            tone: step.aiTone || 'professional',
            senderName,
            accountId,
            profileId: profile.provider_id || profile.id,
            candidateLinkedInUrl: (profile as any).profile_url || (profile as any).public_profile_url || (profile as any).linkedin_url,
            messageTemplate: step.messageTemplate,
            subjectTemplate: step.subjectTemplate,
            // Contexte séquence : permet à l'edge function de différencier
            // PREMIER MESSAGE / RELANCE 1 / INMAIL DE RELANCE / etc.
            // Aligné sur le shared module sequence-message-context.ts.
            sequenceContext: {
              currentActionType: step.actionType,
              prevSentSteps,
            },
            // Config outreach mission : INTERNE / CABINET, sender_role
            // (TA / CTO / Founder...), anonymisation client. Sans ça
            // l'edge function tombait sur le fallback MODE SUCCÈS =
            // cabinet → AI disait "j'accompagne une scale-up tech"
            // même quand la mission était config en INTERNE.
            outreachConfig: outreachConfig || undefined,
            // Mission (préfixe « project: » accepté) : le serveur relit ses
            // réglages d'approche quand outreachConfig est absent (SEQ-051).
            missionId: job?.id || undefined,
          });

          if (error) throw error;

          // Texte brut : la preview est rendue en texte (whitespace-pre-wrap),
          // plus en HTML. Les champs LinkedIn interpolés ne doivent jamais
          // atteindre innerHTML (XSS stockée, audit 2026-09-01).
          const formattedMessage = data?.message || step.messageTemplate;

          const generatedMsg: GeneratedMessage = {
            subject: data?.subject || step.subjectTemplate || '',
            message: formattedMessage,
            personalizationPoints: data?.personalization_points,
            isGenerated: true,
            isGenerating: false,
            isEdited: false,
          };
          // Met à jour l'accumulator local AVANT setPreview pour que la
          // prochaine itération de la boucle voie bien ce step comme
          // déjà généré (utilisé pour construire prevSentSteps des
          // steps suivants).
          localPreviews.set(step.stepId, generatedMsg);
          setPreview(profile.id, step.stepId, generatedMsg);
          setAiGenerationVersion(v => v + 1);
          // Écrit aussi pour la session : si la préparation a été fermée
          // pendant l'appel, le message payé n'est pas perdu.
          keep(step, profile.id, generatedMsg);
        } catch (err: any) {
          console.error('Preview generation error:', err);
          // Fallback to template with variables resolved
          const fallbackMsg: GeneratedMessage = {
            subject: resolveVariables(step.subjectTemplate, profile, senderName),
            message: resolveVariables(step.messageTemplate, profile, senderName),
            isGenerated: false,
            isGenerating: false,
            isEdited: false,
            error: previewErrorMessage(err),
          };
          localPreviews.set(step.stepId, fallbackMsg);
          setPreview(profile.id, step.stepId, fallbackMsg);
        }
      } else {
        // No AI: resolve variables (template only)
        const noAiMsg: GeneratedMessage = {
          subject: resolveVariables(step.subjectTemplate, profile, senderName),
          message: resolveVariables(step.messageTemplate, profile, senderName),
          isGenerated: true,
          isGenerating: false,
          isEdited: false,
        };
        // Important : on l'ajoute aussi à localPreviews pour que les
        // steps suivants reçoivent ce message comme prevSentStep (même
        // pour les steps non-IA, le message a été "envoyé" du point de
        // vue séquentiel).
        localPreviews.set(step.stepId, noAiMsg);
        setPreview(profile.id, step.stepId, noAiMsg);
        keep(step, profile.id, noAiMsg);
      }
    }
  }, [messageSteps, steps, job, accountId, setPreview, keep, outreachConfig, missionClientName, senderName]);

  // Génération pour un seul candidat : indépendante de l'arrêt de la
  // génération groupée, interrompue quand la préparation se ferme.
  const generateForCandidateById = useCallback(async (candidateId: string) => {
    const profile = profiles.find(p => p.id === candidateId);
    if (!profile) return;
    // L'arrêt de « Générer tous les aperçus » ne bloque pas une génération
    // demandée ensuite pour ce seul candidat (le drapeau reste levé pour les
    // travailleurs de la génération groupée arrêtée).
    await generateForCandidate(profile, { ignoreBulkAbort: true });
  }, [profiles, generateForCandidate]);

  const regenerateStep = useCallback(async (candidateId: string, stepId: string) => {
    const profile = profiles.find(p => p.id === candidateId);
    const step = messageSteps.find(s => s.stepId === stepId);
    if (!profile || !step) return;

    // Clear edited state to allow regeneration
    setPreview(candidateId, stepId, { isEdited: false, isGenerated: false });

    // Force regeneration by temporarily clearing the preview
    const tempPreviews = new Map(previews);
    const candidateMap = tempPreviews.get(candidateId);
    if (candidateMap) {
      candidateMap.delete(stepId);
    }

    // Re-run generation for this specific step
    setPreview(candidateId, stepId, { isGenerating: true, error: undefined });

    if (step.useAiPersonalization) {
      try {
        // 🐛 Fix bug snake_case (audit Opus) : avant on envoyait
        // current_company / current_title (snake_case), mais l'edge
        // function lit currentCompany / currentRole (camelCase) → les
        // champs étaient ignorés silencieusement à la régénération.
        // Du coup le poste actuel disparaissait du contexte.
        // Maintenant : payload aligné sur generateForCandidate.
        const rawNd = (profile as any).network_distance;
        const normalizedNetworkDistance =
          rawNd === 1 || rawNd === '1' || rawNd === 'DISTANCE_1' || rawNd === 'FIRST_DEGREE'
            ? 'FIRST_DEGREE'
            : rawNd === 2 || rawNd === '2' || rawNd === 'DISTANCE_2' || rawNd === 'SECOND_DEGREE'
            ? 'SECOND_DEGREE'
            : rawNd === 3 || rawNd === '3' || rawNd === 'DISTANCE_3' || rawNd === 'THIRD_DEGREE'
            ? 'THIRD_DEGREE'
            : rawNd === 'OUT_OF_NETWORK'
            ? 'OUT_OF_NETWORK'
            : null;

        const profileData = {
          name: profile.name,
          headline: profile.headline,
          location: profile.location,
          summary: profile.summary || (profile as any).about,
          currentRole: profile.work_experience?.[0]?.role || profile.work_experience?.[0]?.position,
          currentCompany: profile.work_experience?.[0]?.company,
          skills: profile.skills?.map(s => typeof s === 'string' ? s : s.name).filter(Boolean) || [],
          pastPositions: profile.work_experience?.slice(0, 4).map(w =>
            `${w.role || w.position || ''} @ ${w.company || ''}`.trim()
          ).filter(Boolean) || [],
          education: (profile as any).education?.slice(0, 2).map((e: any) =>
            [e.school_name || e.school, e.degree_name || e.degree, e.field_of_study || e.field].filter(Boolean).join(' - ')
          ) || [],
          networkDistance: normalizedNetworkDistance,
          openToWork: !!(profile as any).open_to_work,
          premium: !!(profile as any).premium,
        };

        // Idem qu'au-dessus : on simule prevSentSteps + détection
        // InMail fallback (cas où la connexion n'a pas été acceptée,
        // donc les messages de la branche "accepté" n'ont pas été
        // envoyés en réalité — l'IA ne doit pas les inclure).
        const isLastInmail =
          step.actionType === 'inmail' &&
          !steps.some(s => s.actionType === 'inmail' && s.stepOrder > step.stepOrder);
        const waitConnectionBefore = steps.find(s =>
          s.actionType === 'wait_connection' && s.stepOrder < step.stepOrder
        );
        const isInmailFallback = isLastInmail && !!waitConnectionBefore;
        const upperBound = isInmailFallback
          ? waitConnectionBefore!.stepOrder
          : step.stepOrder;

        const otherBranch = otherBranchStepIds(steps, step.stepId);
        const prevSentSteps = steps
          .filter(s =>
            s.stepOrder < upperBound &&
            isSentReachStep(s) &&
            !otherBranch.has(s.stepId)
          )
          .sort((a, b) => a.stepOrder - b.stepOrder)
          .map(s => {
            const prev = previewsRef.current.get(candidateId)?.get(s.stepId);
            return {
              actionType: s.actionType,
              finalMessage: prev?.message
                ? prev.message.replace(/<br\s*\/?>(\s*)/gi, '\n')
                : '',
              stepOrder: s.stepOrder,
            };
          });

        const { data, error } = await invokeWithCredits<{
          subject?: string;
          message?: string;
          personalization_points?: string[];
        }>('generate-outreach-message', 'outreach_message', {
          profile: profileData,
          job: job ? {
            title: job.title,
            client: job.client || (missionClientName ? { name: missionClientName } : undefined),
            skills: job.skills || [],
            description: job.description,
            location: job.location,
            accompagnement: job.accompagnement || [],
          } : undefined,
          tone: step.aiTone || 'professional',
          senderName,
          accountId,
          profileId: profile.provider_id || profile.id,
          messageTemplate: step.messageTemplate,
          subjectTemplate: step.subjectTemplate,
          sequenceContext: {
            currentActionType: step.actionType,
            prevSentSteps,
          },
          outreachConfig: outreachConfig || undefined,
          missionId: job?.id || undefined,
        });

        if (error) throw error;

        // Texte brut, rendu en whitespace-pre-wrap côté modal (plus d'innerHTML).
        const formattedMessage = data?.message || step.messageTemplate;

        const regenerated: GeneratedMessage = {
          subject: data?.subject || '',
          message: formattedMessage,
          personalizationPoints: data?.personalization_points,
          isGenerated: true,
          isGenerating: false,
          isEdited: false,
        };
        setPreview(candidateId, stepId, regenerated);
        setAiGenerationVersion(v => v + 1);
        keep(step, candidateId, regenerated);
      } catch (err) {
        setPreview(candidateId, stepId, {
          subject: resolveVariables(step.subjectTemplate, profile, senderName),
          message: resolveVariables(step.messageTemplate, profile, senderName),
          isGenerated: false,
          isGenerating: false,
          error: previewErrorMessage(err),
        });
      }
    } else {
      const resolved: GeneratedMessage = {
        subject: resolveVariables(step.subjectTemplate, profile, senderName),
        message: resolveVariables(step.messageTemplate, profile, senderName),
        isGenerated: true,
        isGenerating: false,
        isEdited: false,
      };
      setPreview(candidateId, stepId, resolved);
      keep(step, candidateId, resolved);
    }
  }, [profiles, messageSteps, steps, job, accountId, previews, setPreview, keep, outreachConfig, missionClientName, senderName]);

  const editMessage = useCallback((candidateId: string, stepId: string, field: 'subject' | 'message', value: string) => {
    // Un message modifié à la main part tel quel (getMessageOverrides) : l'avis
    // d'échec de génération ne s'applique plus.
    setPreview(candidateId, stepId, {
      [field]: value,
      isEdited: true,
      error: undefined,
    });
  }, [setPreview]);

  // Bulk generate with concurrency limit
  const generateAll = useCallback(async (maxConcurrent = 3) => {
    setIsBulkGenerating(true);
    abortRef.current = false;

    const queue = [...targets];

    const worker = async () => {
      while (queue.length > 0 && !abortRef.current) {
        // Préparation fermée : les candidats restants ne sont pas générés.
        if (unmountedRef.current) break;
        const profile = queue.shift();
        if (!profile) break;
        await generateForCandidate(profile);
      }
    };

    const workers = Array.from({ length: Math.min(maxConcurrent, queue.length) }, () => worker());
    await Promise.all(workers);

    setIsBulkGenerating(false);
  }, [targets, generateForCandidate]);

  const cancelBulkGeneration = useCallback(() => {
    abortRef.current = true;
    setIsBulkGenerating(false);
  }, []);

  // Get overrides for enrollment.
  //
  // Important : on inclut ICI tous les messages prévisualisés (générés
  // par l'IA ET édités manuellement). Avant on n'incluait que les
  // édits manuels — du coup les previews IA étaient régénérées à zéro
  // par le cron au moment d'envoyer, et la preview montrée à l'user
  // dans la modal n'avait AUCUN impact sur ce qui partait vraiment.
  //
  // Le cron process-sequences lit enrollment.tracking_data.message_overrides
  // avant d'appeler generatePersonalizedMessage : si un override existe
  // pour le step_id courant → il est utilisé tel quel comme final_message
  // (avec juste le replacement de variables non résolues). Sinon il
  // tombe dans le pipeline de génération from-scratch (legacy).
  const getMessageOverrides = useCallback((candidateId: string): Record<string, {
    subject?: string;
    message?: string;
    /** isEdited=true : l'user a édité manuellement la preview avant
     *  enrollment. Le cron doit JAMAIS la regénérer (intention user
     *  explicite). */
    isEdited?: boolean;
  }> => {
    const overrides: Record<string, { subject?: string; message?: string; isEdited?: boolean }> = {};
    // Dernier état (pas la closure du clic) : une modification faite pendant
    // une inscription groupée vaut pour les candidats pas encore inscrits.
    const candidateMap = previewsRef.current.get(candidateId);
    if (!candidateMap) return overrides;

    candidateMap.forEach((msg, stepId) => {
      if (msg.isGenerated || msg.isEdited) {
        // Convertit les <br> de l'éditeur en \n pour le stockage propre.
        const cleanMessage = (msg.message || '').replace(/<br\s*\/?>(\s*)/gi, '\n');
        overrides[stepId] = {
          subject: msg.subject,
          message: cleanMessage,
          isEdited: msg.isEdited,
        };
      }
    });
    return overrides;
  }, []);

  // Candidate analysis for bulk mode
  const candidateAnalysis = {
    total: targets.length,
    withEmail: targets.filter(p => p.contact_info?.emails?.length).length,
    withPhone: targets.filter(p => p.contact_info?.phones?.length).length,
    withoutEmail: targets.filter(p => !p.contact_info?.emails?.length).length,
    withoutPhone: targets.filter(p => !p.contact_info?.phones?.length).length,
  };

  // Une génération par candidat ET par étape personnalisée : compter les
  // candidats seuls divisait l'estimation par le nombre d'étapes de la séquence.
  // Le coût unitaire vient de l'estimateur du produit, sur le modèle qui servira
  // à l'appel : le littéral 2 utilisé jusqu'ici était le plancher de l'action,
  // pas son estimation, et annonçait moins de la moitié de ce qui sera exigé.
  const aiStepCount = messageSteps.filter(s => s.useAiPersonalization).length;
  const hasAiSteps = aiStepCount > 0;
  const creditsPerMessage = estimateActionCredits('outreach_message');
  const estimatedCredits = targets.length * aiStepCount * creditsPerMessage;

  // Aperçus prêts : candidats visés dont tous les messages sont générés ou
  // modifiés. Dérivé des aperçus (et non compté à chaque clic) : relancer la
  // génération du même candidat ne fait plus dépasser le total.
  const generatedCount = messageSteps.length === 0
    ? 0
    : targets.filter(p => messageSteps.every(s => {
        const msg = previews.get(p.id)?.get(s.stepId);
        return !!msg && (msg.isGenerated || msg.isEdited);
      })).length;

  // Lot 5a-2 : étapes dont le message partirait rédigé par l'IA (jamais une
  // invitation). Le moteur ne les envoie plus sans texte relu : chaque
  // candidat à inscrire doit avoir leur texte généré (ou écrit à la main).
  // Compte des candidats visés à qui il en manque au moins un.
  const aiReviewSteps = messageSteps.filter(requiresAiReview);
  const aiReviewMissingCount = aiReviewSteps.length === 0
    ? 0
    : targets.filter(p => aiReviewSteps.some(s => {
        const msg = previews.get(p.id)?.get(s.stepId);
        return !msg || msg.isGenerating || !(msg.isGenerated || msg.isEdited);
      })).length;

  return {
    previews,
    messageSteps,
    hasMessageSteps: messageSteps.length > 0,
    hasAiSteps,
    /** Lot 5a-2 : étapes à message rédigées par l'IA, à générer et relire avant l'inscription. */
    aiReviewSteps,
    /** Lot 5a-2 : candidats visés dont un message rédigé par l'IA manque encore. */
    aiReviewMissingCount,
    /** Lot 5a-2 : change à chaque génération ou régénération IA (décoche la case de relecture). */
    aiGenerationVersion,
    generatedCount,
    totalToGenerate,
    isBulkGenerating,
    estimatedCredits,
    /** Coût estimé d'un message personnalisé par l'IA, en crédits. */
    creditsPerMessage,
    /** Prénom de l'expéditeur, pour resolveVariables (aperçu du premier message, lot 5a). */
    senderName,
    candidateAnalysis,
    getPreview,
    generateForCandidateById,
    regenerateStep,
    editMessage,
    generateAll,
    cancelBulkGeneration,
    getMessageOverrides,
    discardSessionPreviews,
    // Per-step rule overrides (delays, timeouts) for this enrollment only.
    getStepConfig,
    setStepConfig,
    getStepConfigOverrides,
  };
}
