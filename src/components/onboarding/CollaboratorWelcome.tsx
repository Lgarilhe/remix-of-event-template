import React from 'react';
import { Building2, ArrowRight, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';

interface Props {
  orgName: string;
  onCreateWorkspace: () => void;
  onSkip: () => void;
}

const ACTION_CLASS = 'min-h-11 flex-1 sm:min-h-0';

/** Accueil d'un collaborateur externe qui vient de rejoindre un espace (Auth.tsx). */
export const CollaboratorWelcome: React.FC<Props> = ({ orgName, onCreateWorkspace, onSkip }) => {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="flex w-full max-w-md flex-col items-center gap-6 text-center">
        <IconTile icon={Building2} size="lg" aria-hidden="true" />

        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Vous avez rejoint {orgName}</h1>
          <p className="text-sm text-muted-foreground">Vous y participez en tant que collaborateur externe.</p>
        </div>

        <p className="text-sm text-foreground-secondary">
          Souhaitez-vous aussi créer votre propre espace de travail ?
        </p>

        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <Button variant="primary" onClick={onCreateWorkspace} className={ACTION_CLASS}>
            Créer mon espace
            <ArrowRight aria-hidden="true" />
          </Button>
          <Button variant="outline" onClick={onSkip} className={ACTION_CLASS}>
            <Clock aria-hidden="true" />
            Plus tard
          </Button>
        </div>
      </div>
    </div>
  );
};
