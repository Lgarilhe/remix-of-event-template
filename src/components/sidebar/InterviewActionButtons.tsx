/**
 * Actions d'un entretien qui commence : rejoindre la visio, ouvrir la fiche du
 * candidat, ouvrir la grille d'entretien, ouvrir l'assistant d'entretien.
 *
 * Partagé par la zone « Événements à venir » (ligne de l'entretien actif, en
 * `compact` : une seule ligne, actions secondaires en icônes, sans la fiche ni
 * « Ouvrir l'entretien » que la ligne ouvre déjà d'un clic) et l'alerte de
 * début d'entretien (libellés complets). L'alerte est rendue par Sonner, hors
 * du routeur et de la barre : ce composant ne lit aucun contexte, l'appelant
 * passe `onOpen` (navigation, fermeture de la barre ou de l'alerte).
 *
 * L'assistant s'ouvre sur la grille ; l'enregistrement part au clic sur
 * « Démarrer l'enregistrement » dans l'assistant (le navigateur exige le geste
 * de la personne pour ouvrir le micro).
 */
import type { ReactNode } from 'react';
import { ClipboardList, Mic, User, Video } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { InterviewLinks } from '@/lib/sidebarSignals';

export interface InterviewActionButtonsProps {
  links: InterviewLinks;
  /** Lien de visio (http ou https), sinon null. */
  joinUrl: string | null;
  /** Ouvre une page de l'application. */
  onOpen: (to: string) => void;
  /** Aperçu local : remplace l'ouverture de la visio externe. */
  onJoin?: () => void;
  /** La fiche affiche déjà le candidat et l'entretien. */
  showContextLinks?: boolean;
  /** Une ligne : actions secondaires en icônes (nom accessible et infobulle gardés), sans fiche. */
  compact?: boolean;
  /** Classes ajoutées aux boutons secondaires (survol de la barre, par exemple). */
  secondaryClassName?: string;
  className?: string;
}

const TOUCH = 'max-md:min-h-11';

export function InterviewActionButtons({
  links,
  joinUrl,
  onOpen,
  onJoin,
  showContextLinks = true,
  compact = false,
  secondaryClassName,
  className,
}: InterviewActionButtonsProps) {
  // `text` : mot affiché hors compact ; `label` : nom accessible et infobulle.
  const secondary = (label: string, text: string, icon: ReactNode, onClick: () => void) => (
    <Button
      type="button"
      variant="outline"
      size={compact ? 'icon-xs' : 'xs'}
      onClick={onClick}
      aria-label={label}
      title={compact ? label : undefined}
      className={cn(TOUCH, compact && 'max-md:min-w-11', 'rounded-md', secondaryClassName)}
    >
      {icon}
      {!compact && text}
    </Button>
  );

  return (
    <div className={cn('flex flex-wrap items-center gap-1', className)}>
      {links.coaching && (
        <Button
          type="button"
          variant="primary"
          size="xs"
          onClick={() => onOpen(links.coaching as string)}
          aria-label="Assistant d'entretien"
          title="Assistant d'entretien : enregistrement, transcription et coaching en direct"
          className={cn(TOUCH, 'rounded-md')}
        >
          <Mic aria-hidden="true" />
          {compact ? 'Assistant' : "Assistant d'entretien"}
        </Button>
      )}
      {(joinUrl || onJoin) && secondary('Rejoindre la visio', 'Rejoindre', <Video aria-hidden="true" />, () => {
        if (onJoin) onJoin();
        else if (joinUrl) window.open(joinUrl, '_blank', 'noopener,noreferrer');
      })}
      {links.candidate && !compact && showContextLinks && secondary('Fiche du candidat', 'Fiche', <User aria-hidden="true" />, () => onOpen(links.candidate as string))}
      {links.scorecard && secondary("Grille d'entretien", 'Grille', <ClipboardList aria-hidden="true" />, () => onOpen(links.scorecard as string))}
      {!links.candidate && !compact && showContextLinks && (
        <Button type="button" variant="outline" size="xs" onClick={() => onOpen(links.qualification)} className={cn(TOUCH, 'rounded-md', secondaryClassName)}>
          Ouvrir l'entretien
        </Button>
      )}
    </div>
  );
}
