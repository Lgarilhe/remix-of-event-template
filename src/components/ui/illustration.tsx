/**
 * Illustration : dessin à l'encre sur papier crème, pour un état vide, une
 * panne ou une réussite (docs/design/01-direction.md, § Illustrations).
 *
 * Décorative : le titre à côté dit déjà ce qui se passe, l'image n'a donc pas
 * de texte alternatif. Chaque dessin est fait de calques de même cadrage
 * (WebP de src/assets/illustrations, chargés seulement quand l'écran les
 * affiche). Une fois les calques chargés, les pièces se posent une seule fois,
 * en une seconde au plus, jamais en boucle. Avec le mouvement réduit, le
 * dessin s'affiche directement dans son état final.
 */

import React, { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import cafeTasse from '@/assets/illustrations/cafe-tasse.webp';
import cafeVapeur from '@/assets/illustrations/cafe-vapeur.webp';
import conversationCreme from '@/assets/illustrations/conversation-creme.webp';
import conversationBleue from '@/assets/illustrations/conversation-bleue.webp';
import envoiTrace from '@/assets/illustrations/envoi-trace.webp';
import envoiAvion from '@/assets/illustrations/envoi-avion.webp';
import tachesFeuille from '@/assets/illustrations/taches-feuille.webp';
import tachesCoche1 from '@/assets/illustrations/taches-coche-1.webp';
import tachesCoche2 from '@/assets/illustrations/taches-coche-2.webp';
import tachesCoche3 from '@/assets/illustrations/taches-coche-3.webp';
import valideCarte from '@/assets/illustrations/valide-carte.webp';
import valideBadge from '@/assets/illustrations/valide-badge.webp';
import connexionPrise from '@/assets/illustrations/connexion-prise.webp';
import connexionFiche from '@/assets/illustrations/connexion-fiche.webp';
import orientationPoteau from '@/assets/illustrations/orientation-poteau.webp';
import orientationFleche from '@/assets/illustrations/orientation-fleche.webp';
import rechercheFiches from '@/assets/illustrations/recherche-fiches.webp';
import rechercheLoupe from '@/assets/illustrations/recherche-loupe.webp';
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

/** Entrée d'une pièce : son état de départ, d'où elle revient à sa place. */
interface Motion {
  /** Décalage de départ, en % du calque. */
  x?: string;
  y?: string;
  /** Rotation de départ. */
  r?: string;
  /** Échelle de départ. */
  s?: number;
  /** Opacité de départ (0 par défaut). */
  o?: number;
  /** Tracé de gauche à droite jusqu'à ce bord droit, en % du calque (trace de l'avion). */
  draw?: number;
  /** Point fixe d'une rotation ou d'un changement d'échelle. */
  origin?: string;
  /** Départ et durée, en ms : départ et durée additionnés ne dépassent pas une seconde. */
  delay?: number;
  duration: number;
  /** Léger rebond en fin de course (badge, coches, bulles, flèche). */
  spring?: boolean;
}

interface Drawing {
  /** Dimensions réelles des calques (tous au même cadrage), pour réserver la place. */
  width: number;
  height: number;
  /** Du fond vers l'avant ; le premier calque donne la taille. Sans mouvement : là dès le chargement. */
  layers: Array<{ src: string; motion?: Motion }>;
  /** Rogne au cadre du dessin : les câbles de la prise sont coupés au bord. */
  clip?: boolean;
}

const FADE: Motion = { duration: 250 };
const SPRING = 'cubic-bezier(0.34, 1.56, 0.64, 1)';

const DRAWINGS: Record<IllustrationName, Drawing> = {
  // La vapeur monte au-dessus de la tasse.
  cafe: {
    width: 433,
    height: 480,
    layers: [
      { src: cafeTasse, motion: FADE },
      { src: cafeVapeur, motion: { y: '12%', delay: 150, duration: 850 } },
    ],
  },
  // Les bulles s'ouvrent l'une après l'autre, depuis leur pointe.
  conversation: {
    width: 480,
    height: 360,
    layers: [
      { src: conversationCreme, motion: { s: 0.8, origin: '20% 91%', duration: 450, spring: true } },
      { src: conversationBleue, motion: { s: 0.8, origin: '85% 99%', delay: 280, duration: 450, spring: true } },
    ],
  },
  // L'avion part, sa trace se dessine derrière lui.
  envoi: {
    width: 480,
    height: 313,
    layers: [
      { src: envoiTrace, motion: { draw: 51, duration: 700 } },
      { src: envoiAvion, motion: { x: '-16%', y: '14%', duration: 700 } },
    ],
  },
  // Les coches se posent une à une.
  taches: {
    width: 389,
    height: 480,
    layers: [
      { src: tachesFeuille, motion: FADE },
      { src: tachesCoche1, motion: { s: 0.4, origin: '24% 32%', delay: 250, duration: 350, spring: true } },
      { src: tachesCoche2, motion: { s: 0.4, origin: '24% 52.5%', delay: 450, duration: 350, spring: true } },
      { src: tachesCoche3, motion: { s: 0.4, origin: '23.5% 73%', delay: 650, duration: 350, spring: true } },
    ],
  },
  // Le badge se pose sur la carte.
  valide: {
    width: 400,
    height: 480,
    layers: [
      { src: valideCarte, motion: FADE },
      { src: valideBadge, motion: { s: 1.5, origin: '77% 19%', delay: 250, duration: 500, spring: true } },
    ],
  },
  // La prise et la fiche se rapprochent, sans se toucher.
  connexion: {
    width: 480,
    height: 133,
    clip: true,
    layers: [
      { src: connexionPrise, motion: { x: '-8%', duration: 700 } },
      { src: connexionFiche, motion: { x: '8%', duration: 700 } },
    ],
  },
  // La flèche pivote sur son poteau.
  orientation: {
    width: 418,
    height: 480,
    layers: [
      { src: orientationPoteau },
      { src: orientationFleche, motion: { r: '-14deg', o: 1, origin: '50% 22%', duration: 900, spring: true } },
    ],
  },
  // La loupe passe au-dessus des fiches.
  recherche: {
    width: 480,
    height: 466,
    layers: [
      { src: rechercheFiches, motion: FADE },
      { src: rechercheLoupe, motion: { x: '-8%', y: '6%', r: '-10deg', origin: '60% 30%', delay: 100, duration: 800 } },
    ],
  },
  // Sans calques qui recomposent le dessin : il apparaît d'un seul tenant.
  brief: { width: 341, height: 480, layers: [{ src: brief, motion: { y: '6%', duration: 500 } }] },
  dossier: { width: 480, height: 380, layers: [{ src: dossier, motion: { y: '6%', duration: 500 } }] },
};

const SIZES = {
  sm: 'max-h-20 max-w-32',
  md: 'max-h-28 max-w-40',
  lg: 'max-h-36 max-w-48',
} as const;

/** Variables lues par les animations illu-enter et illu-draw (tailwind.config.ts). */
const motionStyle = (m: Motion) =>
  ({
    '--illu-x': m.x,
    '--illu-y': m.y,
    '--illu-r': m.r,
    '--illu-s': m.s,
    '--illu-o': m.o,
    '--illu-draw-to': m.draw === undefined ? undefined : `${100 - m.draw}%`,
    '--illu-delay': m.delay ? `${m.delay}ms` : undefined,
    '--illu-duration': `${m.duration}ms`,
    '--illu-ease': m.spring ? SPRING : undefined,
    transformOrigin: m.origin,
  }) as React.CSSProperties;

export interface IllustrationProps {
  name: IllustrationName;
  /** sm : état compact ; md : état vide d'une page ; lg : page entière. */
  size?: keyof typeof SIZES;
  className?: string;
}

function Layers({ name, size = 'md', className }: IllustrationProps) {
  const { width, height, layers, clip } = DRAWINGS[name];
  const refs = useRef<Array<HTMLImageElement | null>>([]);
  const [settled, setSettled] = useState(0);
  // Les pièces partent ensemble, une fois tous les calques là (ou en échec).
  const ready = settled >= layers.length;

  useEffect(() => {
    // Calques déjà en cache : prêts avant même le premier rendu.
    if (refs.current.every((img) => img?.complete)) setSettled(layers.length);
  }, [layers.length]);

  const settle = () => setSettled((n) => n + 1);

  return (
    <div aria-hidden="true" className={cn('relative block w-fit', clip && 'overflow-hidden', className)}>
      {layers.map(({ src, motion }, i) => (
        <img
          key={src}
          ref={(el) => {
            refs.current[i] = el;
          }}
          src={src}
          width={width}
          height={height}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={settle}
          onError={settle}
          style={ready && motion ? motionStyle(motion) : undefined}
          className={cn(
            'pointer-events-none select-none',
            i === 0 ? cn('block h-auto w-auto', SIZES[size]) : 'absolute inset-0 h-full w-full',
            !ready && 'opacity-0',
            ready && motion && (motion.draw === undefined ? 'animate-illu-enter' : 'animate-illu-draw'),
            // Mouvement réduit : pas d'attente avant l'état final (la durée est déjà coupée, src/index.css).
            'motion-reduce:![animation-delay:0ms]',
          )}
        />
      ))}
    </div>
  );
}

export function Illustration(props: IllustrationProps) {
  // Un autre dessin repart de zéro (chargement et entrée).
  return <Layers key={props.name} {...props} />;
}
