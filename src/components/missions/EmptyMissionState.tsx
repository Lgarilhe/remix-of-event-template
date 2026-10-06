import React from 'react';
import { EmptyState } from '@/components/layout/EmptyState';
import { Button } from '@/components/ui/button';

interface EmptyMissionStateProps {
  onCreateAI: () => void;
  onCreateManual: () => void;
}

/**
 * Aucune mission : état vide de la liste des missions (design simplifié,
 * docs/design/06-simplicite.md). Le dessin « dossier » (01-direction.md,
 * § Illustrations), une phrase qui dit quoi faire et un seul bouton plein.
 * Les deux entrées de CreateMissionV2 restent : la fiche de poste lue par
 * l'assistant (brief) et la saisie à la main (manual).
 * Retirés avec l'ancien langage : chiffres publicitaires, logos d'outils que
 * Konekt ne relie pas, lien « page carrières » sans action, fonds animés.
 */
export const EmptyMissionState: React.FC<EmptyMissionStateProps> = ({ onCreateAI, onCreateManual }) => (
  <EmptyState
    illustration="dossier"
    title="Lancez votre première mission"
    headingLevel={2}
    description="Une mission, c'est un poste à pourvoir. Collez la fiche de poste : l'assistant en tire le brief et les filtres de recherche."
    action={
      <>
        <Button type="button" variant="primary" onClick={onCreateAI} className="max-sm:min-h-11">
          Coller une fiche de poste
        </Button>
        <Button type="button" variant="ghost" onClick={onCreateManual} className="max-sm:min-h-11">
          Saisir le poste à la main
        </Button>
      </>
    }
  />
);
