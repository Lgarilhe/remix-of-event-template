/**
 * TutorialVideoDialog — bouton d'aide « ? » qui ouvre un popup avec un
 * tutoriel vidéo court (screencast où l'on voit le curseur naviguer).
 *
 * Générique : chaque écran peut monter son propre tuto (title + videoSrc +
 * points clés). Les vidéos vivent dans public/tutos/ (webm, tournées via
 * le harnais Playwright — voir LOGBOOK 2026-07-02).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { CircleHelp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TutorialVideoDialogProps {
  title: string;
  description?: string;
  videoSrc: string;
  /** Points clés listés sous la vidéo. */
  points?: string[];
  /**
   * Clé d'ouverture automatique : si fournie, le tuto s'ouvre tout seul à la
   * PREMIÈRE visite de l'écran, avec une case « ne plus afficher » (cochée
   * par défaut → une seule ouverture auto, sauf si l'user la décoche).
   * Persisté en localStorage sous konekt:tuto:seen:{clé}.
   */
  autoOpenKey?: string;
  className?: string;
  /**
   * Mode contrôlé (menu Aide de la barre latérale) : si `open` est fourni,
   * l'état interne est ignoré, et l'ouverture automatique ne s'applique pas.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Masque le bouton « ? » (la fenêtre s'ouvre d'ailleurs). */
  hideTrigger?: boolean;
}

const seenStorageKey = (key: string) => `konekt:tuto:seen:${key}`;

export const TutorialVideoDialog: React.FC<TutorialVideoDialogProps> = ({
  title,
  description,
  videoSrc,
  points,
  autoOpenKey,
  className,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}) => {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const [dontShowAgain, setDontShowAgain] = useState(true);
  const autoOpenFiredRef = useRef(false);

  useEffect(() => {
    if (controlled || !autoOpenKey || autoOpenFiredRef.current) return;
    try {
      if (localStorage.getItem(seenStorageKey(autoOpenKey)) === '1') return;
    } catch { /* localStorage indisponible → pas d'auto-open */ return; }
    // Petit délai pour laisser l'écran se peindre derrière avant le popup
    const t = setTimeout(() => {
      autoOpenFiredRef.current = true;
      setInternalOpen(true);
    }, 700);
    return () => clearTimeout(t);
  }, [autoOpenKey, controlled]);

  const handleOpenChange = (next: boolean) => {
    if (!controlled) setInternalOpen(next);
    onOpenChange?.(next);
    if (!next && autoOpenKey && dontShowAgain) {
      try { localStorage.setItem(seenStorageKey(autoOpenKey), '1'); } catch { /* noop */ }
    }
  };

  return (
    <>
      {!hideTrigger && (
        <button
          type="button"
          onClick={() => handleOpenChange(true)}
          title="Aide — tutoriel vidéo"
          aria-label="Ouvrir le tutoriel vidéo"
          className={cn(
            'inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors',
            className,
          )}
        >
          <CircleHelp className="w-3.5 h-3.5" />
        </button>
      )}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0">
          <DialogHeader className="px-5 pt-4 pb-3">
            <DialogTitle className="font-display text-[16px]">{title}</DialogTitle>
            {description && (
              <DialogDescription className="text-2xs">{description}</DialogDescription>
            )}
          </DialogHeader>
          {/* monté seulement quand ouvert : pas de préchargement vidéo caché */}
          {open && (
            <video
              src={videoSrc}
              controls
              autoPlay
              muted
              loop
              playsInline
              className="w-full aspect-[16/10] bg-black"
            >
              La vidéo n'a pas pu être chargée.
            </video>
          )}
          {points?.length ? (
            <ul className="px-5 py-3 space-y-1 border-t border-border">
              {points.map((p) => (
                <li key={p} className="text-2xs text-muted-foreground flex gap-1.5">
                  <span className="text-brand-purple shrink-0">•</span>
                  <span>{p}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {autoOpenKey && (
            <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border">
              <label className="flex items-center gap-2 text-2xs text-muted-foreground cursor-pointer select-none">
                <Checkbox
                  checked={dontShowAgain}
                  onCheckedChange={(v) => setDontShowAgain(v === true)}
                />
                Ne plus afficher automatiquement
              </label>
              <button
                type="button"
                onClick={() => handleOpenChange(false)}
                className="shrink-0 h-7 px-3 rounded-full bg-foreground text-background text-2xs font-semibold hover:bg-foreground/90 transition-colors"
              >
                C'est compris
              </button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
