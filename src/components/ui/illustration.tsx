/**
 * Illustration : dessin à l'encre sur papier crème, pour un état vide, une
 * panne ou une réussite (docs/design/01-direction.md, § Illustrations).
 *
 * Décorative : le titre à côté dit déjà ce qui se passe, l'image n'a donc pas
 * de texte alternatif. Chaque dessin est fait de calques de même cadrage
 * (WebP de src/assets/illustrations, chargés seulement quand l'écran les
 * affiche). Une fois les calques chargés, le fond reste fixe et les pièces
 * mobiles rejouent leur geste en boucle, avec une pause entre deux passages
 * (décision du propriétaire, 29/09). Avec le mouvement réduit, le dessin est
 * fixe dans son état final.
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
import triDecor from '@/assets/illustrations/tri-decor.webp';
import triLoupe from '@/assets/illustrations/tri-loupe.webp';
import triFiche1 from '@/assets/illustrations/tri-fiche-1.webp';
import triFiche2 from '@/assets/illustrations/tri-fiche-2.webp';
import triFiche3 from '@/assets/illustrations/tri-fiche-3.webp';
import triCoche from '@/assets/illustrations/tri-coche.webp';
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
 * - tri : plus aucun profil à trier (Sourcing) ;
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
  | 'tri'
  | 'brief'
  | 'dossier';

/**
 * Mouvement d'une pièce, lu par les animations illu-* de tailwind.config.ts :
 * - enter : entrée jouée une fois (pièces de fond, bulle principale) ;
 * - loop : en boucle, entrée, pause à sa place, sortie ;
 * - drift : en boucle, sans pause (vapeur qui monte) ;
 * - draw : en boucle, tracé de gauche à droite, pause, effacement (trace de l'avion) ;
 * - settle : entrée puis léger flottement en boucle (dessins d'un seul tenant).
 */
interface Motion {
  anim: 'enter' | 'loop' | 'drift' | 'draw' | 'settle';
  /** État de départ : décalage (en % du calque), rotation, échelle, opacité (0 par défaut). */
  x?: string;
  y?: string;
  r?: string;
  s?: number;
  o?: number;
  /** État de sortie d'une boucle ; par défaut, l'état de départ (la pièce revient). */
  x2?: string;
  y2?: string;
  r2?: string;
  /** Bord droit de la trace, en % du calque (draw). */
  draw?: number;
  /** Point fixe d'une rotation ou d'un changement d'échelle. */
  origin?: string;
  /** Départ, en ms. */
  delay?: number;
  /** Durée de l'entrée (enter, settle) ou d'un tour de boucle, en ms. */
  duration: number;
  /** spring : léger rebond (badge, coches, bulles, flèche) ; inOut : va-et-vient régulier. */
  ease?: 'spring' | 'inOut';
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

const FADE: Motion = { anim: 'enter', duration: 250 };
const EASE = { spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)', inOut: 'cubic-bezier(0.45, 0, 0.55, 1)' } as const;
/** Classes littérales, pour que Tailwind les génère. */
const ANIMATION_CLASS = {
  enter: 'animate-illu-enter',
  loop: 'animate-illu-loop',
  drift: 'animate-illu-drift',
  draw: 'animate-illu-draw',
  settle: 'animate-illu-settle',
} as const;

const DRAWINGS: Record<IllustrationName, Drawing> = {
  // La vapeur monte sans fin au-dessus de la tasse.
  cafe: {
    width: 433,
    height: 480,
    layers: [
      { src: cafeTasse, motion: FADE },
      { src: cafeVapeur, motion: { anim: 'drift', y: '12%', y2: '-12%', delay: 150, duration: 3200, ease: 'inOut' } },
    ],
  },
  // La grande bulle s'ouvre, la petite lui répond en boucle.
  conversation: {
    width: 480,
    height: 360,
    layers: [
      { src: conversationCreme, motion: { anim: 'enter', s: 0.8, origin: '20% 91%', duration: 450, ease: 'spring' } },
      { src: conversationBleue, motion: { anim: 'loop', s: 0.8, origin: '85% 99%', delay: 280, duration: 3600, ease: 'spring' } },
    ],
  },
  // L'avion arrive avec sa trace, puis repart plus loin.
  envoi: {
    width: 480,
    height: 313,
    layers: [
      { src: envoiTrace, motion: { anim: 'draw', draw: 51, duration: 3600 } },
      { src: envoiAvion, motion: { anim: 'loop', x: '-16%', y: '14%', x2: '16%', y2: '-14%', duration: 3600 } },
    ],
  },
  // Les coches se posent une à une, puis repartent.
  taches: {
    width: 389,
    height: 480,
    layers: [
      { src: tachesFeuille, motion: FADE },
      { src: tachesCoche1, motion: { anim: 'loop', s: 0.4, origin: '24% 32%', delay: 250, duration: 3000, ease: 'spring' } },
      { src: tachesCoche2, motion: { anim: 'loop', s: 0.4, origin: '24% 52.5%', delay: 450, duration: 3000, ease: 'spring' } },
      { src: tachesCoche3, motion: { anim: 'loop', s: 0.4, origin: '23.5% 73%', delay: 650, duration: 3000, ease: 'spring' } },
    ],
  },
  // Le badge se pose sur la carte, se soulève, se repose.
  valide: {
    width: 400,
    height: 480,
    layers: [
      { src: valideCarte, motion: FADE },
      { src: valideBadge, motion: { anim: 'loop', s: 1.5, origin: '77% 19%', delay: 250, duration: 3600, ease: 'spring' } },
    ],
  },
  // La prise et la fiche se rapprochent sans se toucher, puis s'écartent.
  connexion: {
    width: 480,
    height: 133,
    clip: true,
    layers: [
      { src: connexionPrise, motion: { anim: 'loop', x: '-8%', o: 1, duration: 3000, ease: 'inOut' } },
      { src: connexionFiche, motion: { anim: 'loop', x: '8%', o: 1, duration: 3000, ease: 'inOut' } },
    ],
  },
  // La flèche pivote sur son poteau.
  orientation: {
    width: 418,
    height: 480,
    layers: [
      { src: orientationPoteau },
      { src: orientationFleche, motion: { anim: 'loop', r: '-14deg', o: 1, origin: '50% 22%', duration: 3600, ease: 'spring' } },
    ],
  },
  // La loupe passe au-dessus des fiches, s'y arrête, puis continue.
  recherche: {
    width: 480,
    height: 466,
    layers: [
      { src: rechercheFiches, motion: FADE },
      {
        src: rechercheLoupe,
        motion: { anim: 'loop', x: '-8%', y: '6%', r: '-10deg', x2: '8%', y2: '-6%', r2: '10deg', origin: '60% 30%', delay: 100, duration: 4000 },
      },
    ],
  },
  // Le bureau reste fixe : la loupe balaie le bac vide, les fiches flottent, la coche se pose.
  tri: {
    width: 480,
    height: 366,
    layers: [
      { src: triDecor, motion: FADE },
      { src: triLoupe, motion: { anim: 'loop', x: '-5%', y: '2%', r: '-8deg', o: 1, origin: '70% 48%', delay: 100, duration: 4000, ease: 'inOut' } },
      { src: triFiche1, motion: { anim: 'loop', y: '-2.5%', o: 1, delay: 0, duration: 3600, ease: 'inOut' } },
      { src: triFiche2, motion: { anim: 'loop', y: '-2.5%', o: 1, delay: 400, duration: 3600, ease: 'inOut' } },
      { src: triFiche3, motion: { anim: 'loop', y: '-2.5%', o: 1, delay: 800, duration: 3600, ease: 'inOut' } },
      { src: triCoche, motion: { anim: 'loop', s: 0.4, origin: '61.5% 23.7%', delay: 600, duration: 3600, ease: 'spring' } },
    ],
  },
  // Sans calques qui recomposent le dessin : il apparaît d'un seul tenant, puis flotte.
  brief: { width: 341, height: 480, layers: [{ src: brief, motion: { anim: 'settle', y: '6%', duration: 500 } }] },
  dossier: { width: 480, height: 380, layers: [{ src: dossier, motion: { anim: 'settle', y: '6%', duration: 500 } }] },
};

const SIZES = {
  sm: 'max-h-20 max-w-32',
  md: 'max-h-28 max-w-40',
  lg: 'max-h-36 max-w-48',
} as const;

/** Variables lues par les animations illu-* (tailwind.config.ts). */
const motionStyle = (m: Motion) =>
  ({
    '--illu-x': m.x,
    '--illu-y': m.y,
    '--illu-r': m.r,
    '--illu-s': m.s,
    '--illu-o': m.o,
    '--illu-x2': m.x2,
    '--illu-y2': m.y2,
    '--illu-r2': m.r2,
    '--illu-draw-to': m.draw === undefined ? undefined : `${100 - m.draw}%`,
    '--illu-delay': m.delay ? `${m.delay}ms` : undefined,
    '--illu-duration': `${m.duration}ms`,
    '--illu-ease': m.ease ? EASE[m.ease] : undefined,
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
            ready && motion && ANIMATION_CLASS[motion.anim],
            // Mouvement réduit : aucune animation, le dessin est fixe dans son état final.
            'motion-reduce:!animate-none',
          )}
        />
      ))}
    </div>
  );
}

export function Illustration(props: IllustrationProps) {
  // Un autre dessin repart de zéro (chargement et mouvement).
  return <Layers key={props.name} {...props} />;
}
