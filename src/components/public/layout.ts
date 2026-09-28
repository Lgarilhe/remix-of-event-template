/** Largeurs de contenu des pages publiques : légal, formulaires et tarifs, accueil. */
export const PUBLIC_WIDTH = {
  narrow: 'max-w-3xl',
  default: 'max-w-5xl',
  wide: 'max-w-6xl',
} as const;

export type PublicWidth = keyof typeof PUBLIC_WIDTH;
