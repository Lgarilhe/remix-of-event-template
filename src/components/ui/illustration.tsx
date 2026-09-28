/**
 * Illustration : dessin à l'encre sur papier crème, pour un état vide, une
 * panne ou une réussite (docs/design/01-direction.md, § Illustrations).
 *
 * Décorative : le titre à côté dit déjà ce qui se passe, l'image n'a donc pas
 * de texte alternatif. Fixe, sans animation. Chargée seulement quand l'écran
 * l'affiche (fichiers WebP de src/assets/illustrations, 15 à 45 Ko).
 */

import React from 'react';
import { cn } from '@/lib/utils';
import cafe from '@/assets/illustrations/cafe.webp';
import conversation from '@/assets/illustrations/conversation.webp';
import envoi from '@/assets/illustrations/envoi.webp';
import taches from '@/assets/illustrations/taches.webp';
import valide from '@/assets/illustrations/valide.webp';
import connexion from '@/assets/illustrations/connexion.webp';
import orientation from '@/assets/illustrations/orientation.webp';
import recherche from '@/assets/illustrations/recherche.webp';
import brief from '@/assets/illustrations/brief.webp';
import dossier from '@/assets/illustrations/dossier.webp';

/**
 * Une illustration par situation :
 * - cafe : rien à faire (journée ou semaine libre) ;
 * - conversation : aucune conversation ;
 * - envoi : aucune séquence, envoi parti ;
 * - taches : aucune tâche, premiers pas ;
 * - valide : invitation acceptée, inscription réussie ;
 * - connexion : panne de connexion, compte déconnecté ;
 * - orientation : page introuvable, lien expiré ;
 * - recherche : aucun candidat, recherche sans résultat ;
 * - brief : poste à décrire ;
 * - dossier : aucune mission, aucun document.
 */
export type IllustrationName =
  | 'cafe'
  | 'conversation'
  | 'envoi'
  | 'taches'
  | 'valide'
  | 'connexion'
  | 'orientation'
  | 'recherche'
  | 'brief'
  | 'dossier';

/** Fichier et dimensions réelles (pour réserver la place avant le chargement). */
const ILLUSTRATIONS: Record<IllustrationName, { src: string; width: number; height: number }> = {
  cafe: { src: cafe, width: 436, height: 480 },
  conversation: { src: conversation, width: 480, height: 370 },
  envoi: { src: envoi, width: 480, height: 323 },
  taches: { src: taches, width: 394, height: 480 },
  valide: { src: valide, width: 405, height: 480 },
  connexion: { src: connexion, width: 480, height: 150 },
  orientation: { src: orientation, width: 422, height: 480 },
  recherche: { src: recherche, width: 476, height: 480 },
  brief: { src: brief, width: 341, height: 480 },
  dossier: { src: dossier, width: 480, height: 380 },
};

const SIZES = {
  sm: 'max-h-20 max-w-32',
  md: 'max-h-28 max-w-40',
  lg: 'max-h-36 max-w-48',
} as const;

export interface IllustrationProps {
  name: IllustrationName;
  /** sm : état compact ; md : état vide d'une page ; lg : page entière. */
  size?: keyof typeof SIZES;
  className?: string;
}

export function Illustration({ name, size = 'md', className }: IllustrationProps) {
  const { src, width, height } = ILLUSTRATIONS[name];
  return (
    <img
      src={src}
      width={width}
      height={height}
      alt=""
      aria-hidden="true"
      loading="lazy"
      decoding="async"
      draggable={false}
      className={cn('pointer-events-none h-auto w-auto select-none', SIZES[size], className)}
    />
  );
}
