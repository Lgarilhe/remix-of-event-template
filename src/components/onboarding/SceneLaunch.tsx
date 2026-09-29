import React from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  orgName?: string;
  linkedInConnected: boolean;
  /** Ouvre la création de la première mission. */
  onFinish: () => void;
  /** Sortie sans mission : tableau de bord. */
  onSkip: () => void;
}

/**
 * Fin du tunnel : la fiche de gauche montre ce qui est configuré, cette scène
 * ne garde que la suite : créer une mission. Le seul point resté en suspens
 * (LinkedIn non relié) est dit une fois, avec son lien.
 */
export const SceneLaunch: React.FC<Props> = ({ orgName, linkedInConnected, onFinish, onSkip }) => (
  <div className="flex w-full flex-col gap-6">
    <div>
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        {orgName ? `${orgName} est prêt` : 'Votre espace est prêt'}
      </h1>
      <p className="mt-2 max-w-md text-md text-foreground-secondary">
        Il reste à décrire un poste. L'IA Konekt en tire une première recherche de candidats.
      </p>
    </div>

    {!linkedInConnected && (
      <p className="max-w-md text-sm text-muted-foreground">
        LinkedIn n'est pas encore connecté : la recherche et les messages en ont besoin.{' '}
        <Link
          to="/settings/account/connections"
          className="rounded-md font-medium text-foreground underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          Le connecter dans les Paramètres
        </Link>
      </p>
    )}

    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" size="lg" onClick={onFinish} className="min-h-11 md:min-h-0">
        Créer ma première mission
        <ArrowRight aria-hidden="true" />
      </Button>
      <Button variant="ghost" onClick={onSkip} className="min-h-11 text-muted-foreground md:min-h-0">
        Aller au tableau de bord
      </Button>
    </div>
  </div>
);
