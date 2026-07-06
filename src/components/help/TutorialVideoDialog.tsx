/**
 * TutorialVideoDialog — bouton d'aide « ? » qui ouvre un popup avec un
 * tutoriel vidéo court (screencast où l'on voit le curseur naviguer).
 *
 * Générique : chaque écran peut monter son propre tuto (title + videoSrc +
 * points clés). Les vidéos vivent dans public/tutos/ (webm, tournées via
 * le harnais Playwright — voir LOGBOOK 2026-07-02).
 */
import React, { useState } from 'react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog';
import { CircleHelp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TutorialVideoDialogProps {
  title: string;
  description?: string;
  videoSrc: string;
  /** Points clés listés sous la vidéo. */
  points?: string[];
  className?: string;
}

export const TutorialVideoDialog: React.FC<TutorialVideoDialogProps> = ({
  title,
  description,
  videoSrc,
  points,
  className,
}) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Aide — tutoriel vidéo"
        aria-label="Ouvrir le tutoriel vidéo"
        className={cn(
          'inline-flex items-center justify-center h-6 w-6 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors',
          className,
        )}
      >
        <CircleHelp className="w-3.5 h-3.5" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
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
        </DialogContent>
      </Dialog>
    </>
  );
};
