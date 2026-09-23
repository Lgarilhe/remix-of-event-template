/**
 * Tutoriels vidéo partagés : même contenu sur la page qui les porte et dans
 * le menu Aide de la barre latérale (§2.4).
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
