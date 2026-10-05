import React from 'react';
import { useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SparkleIcon } from '@/components/ui/animated-icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgent } from '@/contexts/AgentContext';

// Pages dont le bas à droite porte déjà une zone de saisie (« Envoyer », composer
// de l'assistant) : la bulle la recouvrirait.
const HIDDEN_ROUTES = ['/agents', '/inbox'];

/**
 * Bouton rond flottant, en bas à droite : ouvre le tiroir de l'assistant d'un
 * clic, comme Ctrl K. Monté par AppLayout, donc réservé aux pages connectées
 * avec barre latérale. Le tiroir (z-modal) passe au-dessus ; le bouton reste
 * monté pour que le focus lui revienne à la fermeture. L'étoile est celle du
 * kit (SparkleIcon) : elle scintille en boucle, et reste fixe quand le système
 * demande moins d'animations.
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
          variant="primary"
          onClick={() => openAgent()}
          aria-label="Ouvrir l'assistant"
          className="fixed bottom-4 right-4 z-sticky h-12 w-12 rounded-full p-0 shadow-lg hover:scale-105 [&_svg]:size-6"
        >
          <SparkleIcon />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left">{`Assistant (${shortcut})`}</TooltipContent>
    </Tooltip>
  );
};
