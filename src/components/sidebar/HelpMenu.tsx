/**
 * Menu Aide de la rangée basse (§2.4) : deux entrées, aucune fenêtre dedans.
 *
 * Les fenêtres (raccourcis, vidéo) sont rendues par AppSidebar hors de
 * <Sidebar> : sur téléphone, le contenu de la feuille est démonté à sa
 * fermeture, et une fenêtre rendue dedans disparaîtrait aussitôt.
 * L'ouverture attend la fermeture du menu : une ref note la demande, puis
 * onCloseAutoFocus empêche le retour du focus, ferme la feuille sur
 * téléphone et appelle le callback (sinon le retour du focus refermerait la
 * fenêtre).
 */
import { useRef } from 'react';
import { CircleHelp, Keyboard, PlayCircle } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';

export interface HelpMenuProps {
  onOpenShortcuts: () => void;
  onOpenTutorial: () => void;
  /** Classes du bouton déclencheur (taille et forme fixées par la rangée basse). */
  triggerClassName?: string;
  /** Côté de l'infobulle. */
  tooltipSide?: 'top' | 'right';
  collapsed?: boolean;
}

type Pending = 'shortcuts' | 'tutorial' | null;

export function HelpMenu({ onOpenShortcuts, onOpenTutorial, triggerClassName, tooltipSide = 'top', collapsed = false }: HelpMenuProps) {
  const pendingRef = useRef<Pending>(null);
  const closeMobile = useCloseMobileSidebar();

  const onCloseAutoFocus = (event: Event) => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    event.preventDefault();
    closeMobile();
    if (pending === 'shortcuts') onOpenShortcuts();
    else onOpenTutorial();
  };

  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Aide" className={triggerClassName}>
              <CircleHelp aria-hidden="true" className="h-4 w-4" />
            </button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side={tooltipSide}>Aide</TooltipContent>
      </Tooltip>
      <DropdownMenuContent
        side={collapsed ? 'right' : 'top'}
        align="end"
        sideOffset={8}
        className="w-56 rounded-xl"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DropdownMenuItem
          onSelect={() => { pendingRef.current = 'shortcuts'; }}
          className="cursor-pointer min-h-11 md:min-h-8"
        >
          <Keyboard aria-hidden="true" className="mr-2 h-4 w-4" />
          Raccourcis clavier
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => { pendingRef.current = 'tutorial'; }}
          className="cursor-pointer min-h-11 md:min-h-8"
        >
          <PlayCircle aria-hidden="true" className="mr-2 h-4 w-4" />
          Vidéo du tutoriel
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
