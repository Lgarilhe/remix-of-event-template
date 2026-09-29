// Refonte mission, lots 1 et 2 : cadre des panneaux à droite (conception, 3.1).
//
// Un seul panneau à la fois, lu dans l'adresse (?panneau=fiche|contact), donc
// refermé par Retour. Ordinateur (lg et plus) : colonne de 480 px sans voile, la
// liste reste visible et rétrécit. Téléphone et tablette : plein écran.
// Entrée en 200 ms (glissement de 16 px et fondu), coupée en mouvement réduit.
// Échap ferme, sauf si un menu, une liste ou une fenêtre est ouvert, ou si l'on
// écrit dans un champ. Focus : sur le titre à l'ouverture, rendu au déclencheur
// à la fermeture.
import { useEffect, useId, useLayoutEffect, useRef } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { useMissionV3 } from '../MissionV3Context';
import { CandidatePanel } from '../panels/CandidatePanel';
import { ContactPanel } from '../panels/ContactPanel';

/** Couches ouvertes qui gardent Échap pour elles (menus, listes, fenêtres). */
const OPEN_LAYER_SELECTOR = [
  '[role="dialog"][data-state="open"]',
  '[role="alertdialog"][data-state="open"]',
  '[role="menu"][data-state="open"]',
  '[role="listbox"][data-state="open"]',
].join(', ');

function isEditable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

const TITLE_WAIT_MS = 3000;

/**
 * Met le focus sur le titre du panneau ; tant qu'il n'est pas rendu (chargement),
 * sur le panneau lui-même, puis sur le titre dès qu'il apparaît si le focus n'a
 * pas bougé entre-temps.
 */
function focusTitle(aside: HTMLElement, titleId: string): () => void {
  const tryTitle = (): boolean => {
    const title = document.getElementById(titleId);
    if (!title || !aside.contains(title)) return false;
    if (!title.hasAttribute('tabindex')) title.setAttribute('tabindex', '-1');
    title.focus({ preventScroll: true });
    return true;
  };
  if (tryTitle()) return () => undefined;
  aside.focus({ preventScroll: true });
  const observer = new MutationObserver(() => {
    if (document.activeElement !== aside) {
      observer.disconnect();
      return;
    }
    if (tryTitle()) observer.disconnect();
  });
  observer.observe(aside, { childList: true, subtree: true });
  const timer = window.setTimeout(() => observer.disconnect(), TITLE_WAIT_MS);
  return () => {
    observer.disconnect();
    window.clearTimeout(timer);
  };
}

export function PanelHost() {
  const { location, closePanel } = useMissionV3();
  const reduceMotion = useReducedMotion();
  const titleId = useId();
  const asideRef = useRef<HTMLElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);

  const panel = location.panel;
  const rowId = panel === 'fiche' ? location.candidateRowId : null;
  const isOpen = panel !== null;

  // Ouverture, changement de panneau ou de candidat : focus sur le titre.
  // Première ouverture : mémorise le déclencheur (focus encore hors du panneau).
  useLayoutEffect(() => {
    const aside = asideRef.current;
    if (!isOpen || !aside) return;
    const active = document.activeElement;
    if (!wasOpenRef.current && active instanceof HTMLElement && !aside.contains(active) && active !== document.body) {
      triggerRef.current = active;
    }
    wasOpenRef.current = true;
    return focusTitle(aside, titleId);
  }, [isOpen, panel, rowId, titleId]);

  // Fermeture : focus rendu au déclencheur s'il est encore affiché.
  useEffect(() => {
    if (isOpen) return;
    if (!wasOpenRef.current) return;
    wasOpenRef.current = false;
    const trigger = triggerRef.current;
    triggerRef.current = null;
    if (trigger && trigger.isConnected) trigger.focus({ preventScroll: true });
  }, [isOpen]);

  // Échap ferme le panneau.
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing) return;
      if (isEditable(event.target)) return;
      if (document.querySelector(OPEN_LAYER_SELECTOR)) return;
      event.preventDefault();
      closePanel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, closePanel]);

  if (!isOpen) return null;

  return (
    <motion.aside
      key={panel}
      ref={asideRef}
      tabIndex={-1}
      data-testid="mission-panel"
      data-panel={panel}
      aria-labelledby={titleId}
      initial={reduceMotion ? false : { opacity: 0, x: 16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className={
        'fixed inset-0 z-40 flex min-h-0 flex-col overflow-y-auto overscroll-contain bg-background outline-none ' +
        'lg:static lg:inset-auto lg:z-auto lg:w-[480px] lg:shrink-0 lg:border-l lg:border-border'
      }
    >
      <SectionErrorBoundary key={rowId ?? panel} fallbackTitle="Ce panneau n'a pas pu s'afficher">
        {panel === 'fiche' && rowId ? (
          <CandidatePanel key={rowId} rowId={rowId} titleId={titleId} onClose={closePanel} />
        ) : (
          <ContactPanel titleId={titleId} onClose={closePanel} />
        )}
      </SectionErrorBoundary>
    </motion.aside>
  );
}
