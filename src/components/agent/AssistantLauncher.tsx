import React from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgent } from '@/contexts/AgentContext';

// Pages dont le bas à droite porte déjà une zone de saisie (« Envoyer », composer
// de l'assistant) : la bulle la recouvrirait.
const HIDDEN_ROUTES = ['/agents', '/inbox'];
// Éditeur de séquence affiché (body[data-sequence-editor], posé par StepsEditor) :
// la bulle recouvrirait l'aperçu du message et la barre de vérification. Elle
// reste montée (le focus lui revient), seulement masquée ; Ctrl K reste.
const HIDDEN_IN_EDITOR = '[body[data-sequence-editor]_&]:hidden';

// Étoile à quatre branches, tracée sur une grille de 24.
const STAR = 'M12 2C12.6 7.4 16.6 11.4 22 12C16.6 12.6 12.6 16.6 12 22C11.4 16.6 7.4 12.6 2 12C7.4 11.4 11.4 7.4 12 2Z';

// Trois étoiles (placement dans une grille de 28) qui scintillent l'une après
// l'autre : la grande, puis la moyenne, puis la petite.
const STARS = [
  { place: 'translate(0.2 5.2) scale(0.9)', delay: '0s' },
  { place: 'translate(15.6 1.6) scale(0.45)', delay: '0.8s' },
  { place: 'translate(18.4 16.9) scale(0.3)', delay: '1.6s' },
] as const;

const sparkle = (delay: string): React.CSSProperties => ({
  transformBox: 'fill-box',
  transformOrigin: 'center',
  animationDuration: '2.4s',
  animationDelay: delay,
});

/**
 * Bouton rond flottant, en bas à droite : ouvre le tiroir de l'assistant d'un
 * clic, comme Ctrl K. Monté par AppLayout, donc réservé aux pages connectées
 * avec barre latérale. Le tiroir (z-modal) passe au-dessus ; le bouton reste
 * monté pour que le focus lui revienne à la fermeture. Fond de l'accent de la
 * marque, étoiles pleines qui scintillent (keyframes `twinkle` du kit) ; elles
 * restent fixes quand le système demande moins d'animations.
 */
export const AssistantLauncher: React.FC = () => {
  const { openAgent } = useAgent();
  const { pathname } = useLocation();

  if (HIDDEN_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`))) {
    return null;
  }

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const shortcut = isMac ? '⌘K' : 'Ctrl K';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={() => openAgent()}
          aria-label="Ouvrir l'assistant"
          className={`fixed bottom-4 right-4 z-sticky h-14 w-14 rounded-full border-0 bg-brand p-0 text-brand-foreground shadow-lg hover:scale-105 hover:bg-brand-hover [&_svg]:size-8 ${HIDDEN_IN_EDITOR}`}
        >
          <svg viewBox="0 0 28 28" fill="currentColor" aria-hidden="true">
            {STARS.map(({ place, delay }) => (
              <g key={place} transform={place}>
                <path className="animate-twinkle" style={sparkle(delay)} d={STAR} />
              </g>
            ))}
          </svg>
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{`Assistant (${shortcut})`}</TooltipContent>
    </Tooltip>
  );
};
