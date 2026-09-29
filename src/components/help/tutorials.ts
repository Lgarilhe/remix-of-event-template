/**
 * Tutoriels vidéo partagés : même contenu sur la page qui les porte et dans
 * le menu Aide de la barre latérale (§2.4).
 *
 * Aide contextuelle (lot 12, A-15) : le menu Aide propose la vidéo de la page
 * affichée, lue dans ROUTE_TUTORIALS ; une page sans ligne n'a pas d'entrée
 * vidéo. Module pur, sans import : chargé tel quel par les tests (tests/ux).
 */
export interface Tutorial {
  title: string;
  description: string;
  videoSrc: string;
  points: string[];
}

export const PIPELINE_TUTORIAL: Tutorial = {
  title: 'Le pipeline en 30 secondes',
  description: "Funnel, kanban et fiches candidat : l'essentiel en vidéo.",
  videoSrc: '/tutos/pipeline-tour.webm',
  points: [
    'Cliquez sur une étape du funnel pour ouvrir le board à cet endroit',
    'Glissez une carte pour faire avancer un candidat dans le process',
    'Cliquez sur une carte pour ouvrir la fiche complète',
    'Vos étapes se personnalisent dans Cadrage → Process',
  ],
};

interface RouteTutorial {
  /** Chemin de la page (sans la requête). */
  path: RegExp;
  /** Vue de mission lue dans ?tab= (identifiants de src/lib/missionViews.ts) ; absente : toute vue. */
  tab?: string;
  tutorial: Tutorial;
}

/** Table route → tutoriel : une ligne par écran qui a sa vidéo. */
export const ROUTE_TUTORIALS: ReadonlyArray<RouteTutorial> = [
  // Pipeline d'une mission (/missions/:id?tab=pipeline) : MissionPipeline monte le même tutoriel.
  { path: /^\/missions\/[^/]+\/?$/, tab: 'pipeline', tutorial: PIPELINE_TUTORIAL },
];

/** Tutoriel de la page affichée, ou null quand elle n'en a pas. */
export function tutorialForRoute(pathname: string, search = ''): Tutorial | null {
  const tab = new URLSearchParams(search).get('tab');
  const entry = ROUTE_TUTORIALS.find((r) => r.path.test(pathname) && (r.tab === undefined || r.tab === tab));
  return entry?.tutorial ?? null;
}
