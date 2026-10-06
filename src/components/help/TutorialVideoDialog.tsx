/**
 * TutorialVideoDialog : bouton d'aide qui ouvre une fenêtre avec un tutoriel
 * vidéo court (screencast où l'on voit le curseur naviguer).
 *
 * Générique : chaque écran peut monter son propre tuto (title + videoSrc +
 * points clés), et le menu Aide de la barre latérale propose celui de la page
 * affichée (src/components/help/tutorials.ts). Les vidéos vivent dans
 * public/tutos/ (webm, tournées via le harnais Playwright, voir LOGBOOK
 * 2026-07-02). Revue design, lot 12 : boutons du kit, puces neutres (A-15).
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
  /** Masque le bouton d'aide (la fenêtre s'ouvre d'ailleurs). */
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
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              onClick={() => handleOpenChange(true)}
              aria-label="Ouvrir le tutoriel vidéo"
              className={cn('text-muted-foreground', className)}
            >
              <CircleHelp aria-hidden="true" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Tutoriel vidéo</TooltipContent>
        </Tooltip>
      )}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl p-0 overflow-hidden gap-0">
          <DialogHeader className="px-5 pt-4 pb-3">
            <DialogTitle>{title}</DialogTitle>
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
            // Puces de liste neutres, de la couleur du texte : l'accent reste aux signaux.
            <ul className="list-disc space-y-1 border-t border-border py-3 pl-9 pr-5">
              {points.map((p) => (
                <li key={p} className="text-2xs text-muted-foreground">
                  {p}
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
              <Button
                type="button"
                variant="primary"
                size="xs"
                onClick={() => handleOpenChange(false)}
                className="shrink-0"
              >
                C'est compris
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};
