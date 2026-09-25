/**
 * Émojis que la personne peut insérer dans un message à un candidat
 * (composeur de la messagerie, éditeur InMail), et réactions LinkedIn. C'est
 * du contenu de message, choisi par celui qui écrit : l'interface de Konekt
 * n'en affiche jamais pour elle-même (docs/design/01-direction.md, revue
 * design D-70). Le cliquet design ne compte pas ce fichier dans les émojis
 * d'interface ; une seule liste pour les deux éditeurs.
 */

export const MESSAGE_EMOJIS = [
  '👋', '🤝', '💼', '🚀', '🎯', '💡',
  '✨', '⭐', '🙏', '😊', '👍', '🙌',
  '🔥', '📈', '📌', '✅', '💬', '📞',
] as const;

/** Réactions proposées sur un message LinkedIn, avec leur nom lu à voix haute. */
export const LINKEDIN_REACTIONS: ReadonlyArray<{ emoji: string; label: string }> = [
  { emoji: '👍', label: 'pouce levé' },
  { emoji: '❤️', label: 'cœur' },
  { emoji: '🔥', label: 'feu' },
  { emoji: '👏', label: 'applaudissements' },
  { emoji: '😂', label: 'rire' },
  { emoji: '😮', label: 'surprise' },
];
