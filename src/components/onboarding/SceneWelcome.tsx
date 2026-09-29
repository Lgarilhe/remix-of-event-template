import React from 'react';
import { ArrowRight, ListChecks, Search, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Illustration } from '@/components/ui/illustration';

interface Props {
  /** Durée estimée du parcours, en minutes. */
  minutes: number;
  onStart: () => void;
}

const PROMISES = [
  {
    icon: Search,
    title: 'Trouvez',
    text: 'Des candidats sur LinkedIn, classés par l’IA Konekt selon votre brief.',
  },
  {
    icon: Send,
    title: 'Contactez',
    text: 'Des séquences de messages qui s’arrêtent dès qu’un candidat répond.',
  },
  {
    icon: ListChecks,
    title: 'Suivez',
    text: 'Chaque candidat, de la première approche à l’embauche.',
  },
];

/** Première scène : ce que Konekt fait, combien de temps il faut, un seul geste. */
export const SceneWelcome: React.FC<Props> = ({ minutes, onStart }) => (
  <div className="flex w-full flex-col gap-8 sm:flex-row sm:items-center sm:gap-10">
    <div className="min-w-0 flex-1">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Bienvenue sur Konekt</h1>
      <p className="mt-3 max-w-md text-md text-foreground-secondary">
        Quelques questions pour préparer votre espace. Vous arriverez ensuite sur la création de votre première mission.
      </p>

      <ul className="mt-8 space-y-4">
        {PROMISES.map(({ icon: Icon, title, text }) => (
          <li key={title} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-foreground-secondary">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </span>
            <p className="text-sm text-foreground-secondary">
              <span className="font-semibold text-foreground">{title}.</span> {text}
            </p>
          </li>
        ))}
      </ul>

      <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2">
        <Button variant="primary" size="lg" onClick={onStart} className="min-h-11 md:min-h-0">
          Commencer
          <ArrowRight aria-hidden="true" />
        </Button>
        <p className="text-xs text-muted-foreground">Environ {minutes} min. Votre progression est enregistrée.</p>
      </div>
    </div>

    <Illustration name="taches" size="lg" className="mx-auto shrink-0 sm:mx-0" />
  </div>
);
