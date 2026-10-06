/**
 * useUndoableEnrollmentAction : gestes immédiats sur les inscriptions d'une
 * séquence, avec « Annuler » dans un toast (refonte mission, lot 5b,
 * décision 3 du plan docs/refonte-mission/lot5-plan.md).
 *
 * Pause d'un candidat, pause groupée, pause de la séquence et « Arrêter pour
 * ce candidat » partent sans fenêtre de confirmation. Le toast qui suit :
 *   - global (sonner), `role="status"`, sur le modèle de ApprovalsSection ;
 *   - 8 s, prolongé tant qu'il a le survol ou le focus ;
 *   - fermé d'office à 1 min 50 s au plus (toast.dismiss programmé), et
 *     10 s avant la fin du jeton d'annulation d'un arrêt (2 min) : un
 *     « Annuler » visible est toujours accepté par le serveur ;
 *   - Échap le ferme sans annuler ; recharger la page perd « Annuler », le
 *     geste reste ;
 *   - ne promet jamais que rien n'est parti : une étape en cours d'envoi part.
 *
 * Aucune écriture de statut 'active' ou 'completed', ni d'exécution, depuis le
 * navigateur : annuler une pause passe par l'action serveur
 * resume_enrollments (les seules inscriptions que la pause a touchées, par
 * lots de 25), arrêter et annuler un arrêt par stop_enrollments et
 * undo_stop_enrollments de process-sequences.
 */

import React, { useCallback, useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import {
  summarizeStopResponse,
  summarizeUndoPause,
  summarizeUndoStopResponse,
  UNDO_FAILED_MESSAGE,
  type ResumeCounts,
  type ResumeResponse,
  type StopResponse,
  type StopSummary,
  type UndoStopResponse,
  type UndoSummary,
} from '@/lib/sequenceErrorMessages';

/** Durée d'affichage du toast « Annuler », prolongée au survol ou au focus. */
export const UNDO_TOAST_DURATION_MS = 8_000;
/** Fermeture d'office : 1 min 50 s, sous la validité du jeton d'annulation (2 min). */
export const UNDO_TOAST_MAX_MS = 110_000;
/** Marge sous le temps restant du jeton rendu par le serveur. */
const UNDO_TOKEN_MARGIN_MS = 10_000;
/** Inscriptions par appel de reprise quand on annule une pause (le serveur en traite 100 au plus). */
export const UNDO_RESUME_CHUNK = 25;
/** Temps de reprise minimal après la fin du survol ou du focus. */
const RESUME_MIN_MS = 1_500;

export interface UndoToastOptions {
  title: string;
  description?: string | null;
  /** « warning » : geste fait en partie (le titre le dit). */
  tone?: 'neutral' | 'warning';
  /** Appelé au clic sur « Annuler », après la fermeture du toast. */
  onUndo: () => void | Promise<void>;
  /** Temps de validité restant du jeton serveur (ms) : la fermeture d'office passe 10 s avant. */
  validForMs?: number;
}

// ─── Toasts « Annuler » ouverts : Échap ferme le plus récent ────────────────

interface OpenUndoToast {
  id: string;
  close: () => void;
}

const openUndoToasts: OpenUndoToast[] = [];

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * Échap ferme un toast « Annuler » sans annuler : celui qui a le focus, sinon
 * le plus récent, sauf si une autre couche (menu, fenêtre) a déjà traité la
 * touche, ou si l'on tape dans un champ.
 */
function handleEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || openUndoToasts.length === 0) return;
  const active = document.activeElement;
  const focused = active instanceof Element ? active.closest('[data-undo-toast-id]') ?? active.querySelector?.('[data-undo-toast-id]') : null;
  const focusedId = focused?.getAttribute('data-undo-toast-id');
  const inToast = !!focusedId && active instanceof Element && !!active.closest('[data-sonner-toast]');
  if (!inToast && (event.defaultPrevented || isEditableTarget(event.target))) return;
  const target = (inToast ? openUndoToasts.find((t) => t.id === focusedId) : null) ?? openUndoToasts[openUndoToasts.length - 1];
  target?.close();
}

function forgetUndoToast(id: string) {
  const index = openUndoToasts.findIndex((t) => t.id === id);
  if (index !== -1) openUndoToasts.splice(index, 1);
  if (openUndoToasts.length === 0) document.removeEventListener('keydown', handleEscape);
}

function rememberUndoToast(entry: OpenUndoToast) {
  if (openUndoToasts.length === 0) document.addEventListener('keydown', handleEscape);
  openUndoToasts.push(entry);
}

interface UndoToastProps {
  undoId: string;
  title: string;
  description?: string | null;
  tone: 'neutral' | 'warning';
  onUndo: () => void;
  onClose: () => void;
  /** Montage et démontage du contenu (StrictMode monte deux fois en développement). */
  onMount: () => void;
  onUnmount: () => void;
}

/** Contenu du toast : titre, description, « Annuler » et « Fermer ». Minuterie de 8 s suspendue au survol et au focus. */
function UndoToast({ undoId, title, description, tone, onUndo, onClose, onMount, onUnmount }: UndoToastProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const callbacks = useRef({ onClose, onMount, onUnmount });
  callbacks.current = { onClose, onMount, onUnmount };

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    callbacks.current.onMount();
    // Élément du toast posé par sonner (focusable), sinon notre contenu.
    const host: HTMLElement = (root.closest('[data-sonner-toast]') as HTMLElement | null) ?? root;
    let remaining = UNDO_TOAST_DURATION_MS;
    let startedAt = 0;
    let timer: number | null = null;
    let hovered = false;
    let focused = false;
    const start = () => {
      if (timer !== null) window.clearTimeout(timer);
      startedAt = Date.now();
      timer = window.setTimeout(() => callbacks.current.onClose(), remaining);
    };
    const pause = () => {
      if (timer === null) return;
      window.clearTimeout(timer);
      timer = null;
      remaining = Math.max(RESUME_MIN_MS, remaining - (Date.now() - startedAt));
    };
    const onEnter = () => { hovered = true; pause(); };
    const onLeave = () => { hovered = false; if (!focused) start(); };
    const onFocusIn = () => { focused = true; pause(); };
    const onFocusOut = (event: FocusEvent) => {
      if (event.relatedTarget instanceof Node && host.contains(event.relatedTarget)) return;
      focused = false;
      if (!hovered) start();
    };
    host.addEventListener('mouseenter', onEnter);
    host.addEventListener('mouseleave', onLeave);
    host.addEventListener('focusin', onFocusIn);
    host.addEventListener('focusout', onFocusOut);
    start();
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      host.removeEventListener('mouseenter', onEnter);
      host.removeEventListener('mouseleave', onLeave);
      host.removeEventListener('focusin', onFocusIn);
      host.removeEventListener('focusout', onFocusOut);
      callbacks.current.onUnmount();
    };
  }, []);

  return React.createElement(
    'div',
    {
      ref: rootRef,
      role: 'status',
      'aria-live': 'polite',
      'data-undo-toast-id': undoId,
      className: 'flex w-full items-start gap-3 rounded-xl border border-border bg-popover p-4 font-sans text-sm text-popover-foreground shadow-xl',
    },
    React.createElement(
      'div',
      { className: 'min-w-0 flex-1' },
      React.createElement('p', { className: tone === 'warning' ? 'font-medium text-warning' : 'font-medium' }, title),
      description ? React.createElement('p', { className: 'mt-0.5 text-xs text-muted-foreground' }, description) : null,
    ),
    React.createElement(Button, { type: 'button', size: 'xs', variant: 'primary', onClick: onUndo, className: 'shrink-0' }, 'Annuler'),
    React.createElement(
      Button,
      { type: 'button', size: 'icon-xs', variant: 'ghost', onClick: onClose, 'aria-label': 'Fermer la notification', className: 'shrink-0 text-muted-foreground' },
      React.createElement(X, { 'aria-hidden': true }),
    ),
  );
}

/**
 * Affiche un toast « Annuler ». Renvoie son identifiant. Le toast se ferme seul
 * (8 s sans survol ni focus), d'office (1 min 50 s au plus), sur Échap ou sur
 * « Fermer » : dans tous ces cas rien n'est annulé.
 */
export function showUndoToast(options: UndoToastOptions): string {
  const id = `undo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const maxMs = typeof options.validForMs === 'number' && Number.isFinite(options.validForMs)
    ? Math.min(UNDO_TOAST_MAX_MS, Math.max(0, options.validForMs - UNDO_TOKEN_MARGIN_MS))
    : UNDO_TOAST_MAX_MS;
  let closed = false;
  let hardClose: number | null = null;
  const forget = () => {
    if (hardClose !== null) window.clearTimeout(hardClose);
    hardClose = null;
    forgetUndoToast(id);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    forget();
    toast.dismiss(id);
  };
  const undo = () => {
    if (closed) return;
    close();
    void Promise.resolve()
      .then(options.onUndo)
      .catch((err) => {
        console.error('[useUndoableEnrollmentAction] annulation en échec :', err);
        toast.error(UNDO_FAILED_MESSAGE);
      });
  };
  // Jeton déjà trop court : le geste est fait, sans « Annuler ».
  if (maxMs <= 0) {
    toast(options.title, options.description ? { description: options.description } : undefined);
    return id;
  }
  rememberUndoToast({ id, close });
  hardClose = window.setTimeout(close, maxMs);
  // Toast retiré sans passer par close() (toast.dismiss() global) : oublié
  // pour Échap. Un démontage suivi d'un remontage immédiat (StrictMode) ne
  // compte pas.
  let mounted = 0;
  const onMount = () => { mounted += 1; };
  const onUnmount = () => {
    mounted -= 1;
    window.setTimeout(() => {
      if (mounted === 0 && !closed) {
        closed = true;
        forget();
      }
    }, 0);
  };
  toast.custom(
    () => React.createElement(UndoToast, {
      undoId: id,
      title: options.title,
      description: options.description,
      tone: options.tone ?? 'neutral',
      onUndo: undo,
      onClose: close,
      onMount,
      onUnmount,
    }),
    // La minuterie de 8 s est celle du contenu (survol et focus) ; sonner ne ferme rien seul.
    { id, duration: Infinity, onDismiss: () => { closed = true; forget(); } },
  );
  return id;
}

/** Bilan d'un geste ou d'une annulation, dans le toast `id` s'il est donné (remplace « Annulation en cours… »). */
function showSummary(summary: UndoSummary, id?: string | number) {
  const options = { ...(id !== undefined ? { id } : {}), ...(summary.description ? { description: summary.description } : {}) };
  toast[summary.tone](summary.message, options);
}

export interface ResumeIdsResult {
  counts: ResumeCounts;
  /** Inscriptions des lots dont l'appel a échoué. */
  unprocessed: number;
  callError: string | null;
}

/** Reprise serveur (resume_enrollments) d'inscriptions données, par lots de 25. */
export async function resumeEnrollmentIds(enrollmentIds: readonly string[], organizationId?: string | null): Promise<ResumeIdsResult> {
  const ids = [...new Set(enrollmentIds)];
  const counts: ResumeCounts = { resumed: 0, nothing_to_resume: 0, account_unlinked: 0, not_paused: 0, error: 0 };
  for (let i = 0; i < ids.length; i += UNDO_RESUME_CHUNK) {
    const { data, error } = await invokeEdgeFunction<ResumeResponse>('process-sequences', {
      action: 'resume_enrollments',
      ...(organizationId ? { organization_id: organizationId } : {}),
      enrollment_ids: ids.slice(i, i + UNDO_RESUME_CHUNK),
    });
    if (error || !data?.success) {
      return { counts, unprocessed: ids.length - i, callError: data?.message || error?.message || null };
    }
    for (const key of Object.keys(counts) as Array<keyof ResumeCounts>) {
      counts[key] += Number(data.counts?.[key] ?? 0) || 0;
    }
  }
  return { counts, unprocessed: 0, callError: null };
}

export interface OfferUndoPauseOptions {
  /** Titre du toast, ex. « Séquence mise en pause pour Claire Dubois. » */
  title: string;
  description?: string | null;
  tone?: 'neutral' | 'warning';
  /** Inscriptions que la pause a réellement touchées (rendues par l'écriture) : les seules reprises. */
  enrollmentIds: readonly string[];
  candidateName?: string | null;
  /** Relecture de l'écran après l'annulation. */
  onSettled?: () => void | Promise<void>;
}

export interface StopEnrollmentsOptions {
  enrollmentIds: readonly string[];
  /** Nom du candidat quand l'arrêt n'en vise qu'un. */
  candidateName?: string | null;
  /** Relecture de l'écran après l'arrêt et après son annulation. */
  onSettled?: () => void | Promise<void>;
}

/** Annulation d'un arrêt par son jeton (2 minutes, son auteur seulement). */
async function undoStopRequest(
  ids: string[],
  token: string,
  options: StopEnrollmentsOptions,
  organizationId: () => string | null,
): Promise<void> {
  const loadingId = toast.loading('Annulation de l’arrêt…');
  try {
    const orgId = organizationId();
    const { data, error } = await invokeEdgeFunction<UndoStopResponse>('process-sequences', {
      action: 'undo_stop_enrollments',
      ...(orgId ? { organization_id: orgId } : {}),
      enrollment_ids: ids,
      token,
    });
    if (error || data?.success !== true) {
      // Demande refusée ou perdue : rien n'est écrit, le jeton n'est pas consommé.
      toast.error(data?.error_code && data.message ? data.message : UNDO_FAILED_MESSAGE, {
        id: loadingId,
        action: { label: 'Réessayer', onClick: () => { void undoStopRequest(ids, token, options, organizationId); } },
      });
    } else {
      showSummary(summarizeUndoStopResponse(data, options.candidateName), loadingId);
    }
  } catch (err) {
    console.error('[useUndoableEnrollmentAction] annulation de l’arrêt en échec :', err);
    toast.error(UNDO_FAILED_MESSAGE, { id: loadingId });
  }
  await options.onSettled?.();
}

/**
 * « Arrêter » : clôture serveur (stop_enrollments, 200 au plus), puis le toast
 * « Annuler » des inscriptions arrêtées, et « Réessayer » pour celles qu'une
 * écriture concurrente ou une erreur a laissées telles quelles.
 */
async function stopRequest(options: StopEnrollmentsOptions, organizationId: () => string | null): Promise<StopSummary> {
  const ids = [...new Set(options.enrollmentIds)];
  let summary: StopSummary;
  let payload: StopResponse | null = null;
  try {
    const orgId = organizationId();
    const { data, error } = await invokeEdgeFunction<StopResponse>('process-sequences', {
      action: 'stop_enrollments',
      ...(orgId ? { organization_id: orgId } : {}),
      enrollment_ids: ids,
    });
    // Sans code métier (réseau, délai), la réponse est illisible : l'arrêt a pu être fait.
    payload = error && !data?.error_code ? null : data;
    summary = summarizeStopResponse(payload, ids, options.candidateName);
  } catch (err) {
    console.error('[useUndoableEnrollmentAction] arrêt en échec :', err);
    summary = summarizeStopResponse(null, ids, options.candidateName);
  }
  const token = payload?.token;
  if (summary.title && token) {
    const stopped = summary.stoppedIds;
    showUndoToast({
      title: summary.title,
      description: summary.description,
      validForMs: typeof payload?.expires_in_ms === 'number' ? payload.expires_in_ms : undefined,
      onUndo: () => undoStopRequest(stopped, token, options, organizationId),
    });
  } else if (summary.title) {
    toast(summary.title, summary.description ? { description: summary.description } : undefined);
  }
  if (summary.retryIds.length > 0 && summary.retryMessage) {
    const retryIds = summary.retryIds;
    toast.error(summary.retryMessage, {
      ...(ids.length > 1 ? { description: `${retryIds.length} candidat${retryIds.length > 1 ? 's' : ''} concerné${retryIds.length > 1 ? 's' : ''}.` } : {}),
      action: { label: 'Réessayer', onClick: () => { void stopRequest({ ...options, enrollmentIds: retryIds }, organizationId); } },
    });
  }
  if (summary.refusal) {
    if (summary.refusal.tone === 'info') toast.info(summary.refusal.message);
    else toast.error(summary.refusal.message);
  }
  await options.onSettled?.();
  return summary;
}

export function useUndoableEnrollmentAction() {
  const { organizationId } = useOrganization();
  const orgRef = useRef(organizationId);
  orgRef.current = organizationId;

  /** Toast « Annuler » d'une pause : « Annuler » reprend les seules inscriptions mises en pause. */
  const offerUndoPause = useCallback((options: OfferUndoPauseOptions) => {
    const ids = [...new Set(options.enrollmentIds)];
    return showUndoToast({
      title: options.title,
      description: options.description,
      tone: options.tone,
      onUndo: async () => {
        const loadingId = toast.loading('Annulation de la pause…');
        try {
          const result = await resumeEnrollmentIds(ids, orgRef.current);
          showSummary(summarizeUndoPause({ ...result, total: ids.length, name: options.candidateName }), loadingId);
        } catch (err) {
          console.error('[useUndoableEnrollmentAction] reprise en échec :', err);
          toast.error(UNDO_FAILED_MESSAGE, { id: loadingId });
        }
        await options.onSettled?.();
      },
    });
  }, []);

  /** « Arrêter pour ce candidat » ou « Arrêter » groupé (200 au plus), avec « Annuler ». */
  const stopEnrollments = useCallback(
    (options: StopEnrollmentsOptions) => stopRequest(options, () => orgRef.current),
    [],
  );

  /** Reprise serveur d'inscriptions données (annulation d'une pause de séquence). */
  const resumeIds = useCallback((ids: readonly string[]) => resumeEnrollmentIds(ids, orgRef.current), []);

  return {
    /** Toast « Annuler » générique (pause de séquence, avec ses propres contrôles). */
    offerUndo: showUndoToast,
    offerUndoPause,
    stopEnrollments,
    resumeIds,
    showSummary,
  };
}
