import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { EASE_OUT, SPRING_DROP, SPRING_SOFT } from './springs';
import { Obj } from './Obj';
import carteImg from '@/assets/illustrations/valide-carte.webp';
import badgeImg from '@/assets/illustrations/valide-badge.webp';
import dossierImg from '@/assets/illustrations/dossier.webp';
import briefImg from '@/assets/illustrations/brief.webp';
import fichesImg from '@/assets/illustrations/recherche-fiches.webp';
import loupeImg from '@/assets/illustrations/recherche-loupe.webp';
import prisePlugImg from '@/assets/illustrations/connexion-prise.webp';
import fichePlugImg from '@/assets/illustrations/connexion-fiche.webp';
import avionImg from '@/assets/illustrations/envoi-avion.webp';
import traceImg from '@/assets/illustrations/envoi-trace.webp';
import tasseImg from '@/assets/illustrations/cafe-tasse.webp';
import vapeurImg from '@/assets/illustrations/cafe-vapeur.webp';

/**
 * Le bureau : les objets du kit d'illustrations posés sur un sous-main. Il
 * traverse tout le parcours et se remplit avec les vraies réponses : le prénom
 * sur la carte, la société sur le dossier, le poste sur le presse-papiers, les
 * photos des premiers candidats dans les fiches.
 */

export type DeskKey = 'card' | 'folder' | 'clipboard' | 'plug' | 'search' | 'plane' | 'cup';

export interface DeskCandidate {
  photo?: string | null;
  initials: string;
}

export interface DeskData {
  firstName?: string;
  /** Deuxième ligne de la carte : le profil choisi (ou survolé). */
  profileLabel?: string;
  orgName?: string;
  logoUrl?: string | null;
  jobTitle?: string;
  skills?: string[];
  linkedIn?: 'none' | 'connecting' | 'connected';
  candidates?: DeskCandidate[];
  scanning?: boolean;
  /** Un brouillon de message existe : l'avion trace sa route (rien n'est envoyé). */
  messageReady?: boolean;
  stamped?: boolean;
}

/** `idle` : l'objet attend son acte (posé, estompé) ; `ready` : il est en service. */
export type DeskState = 'idle' | 'ready';

interface DeskProps {
  states: Record<DeskKey, DeskState>;
  focus: DeskKey | null;
  data: DeskData;
  className?: string;
}

/** Emplacement de chaque objet, en % du sous-main (largeur du cadre pour `w`). */
const SLOT: Record<DeskKey, { left: number; top: number; w: number; rotate: number; z: number; depth: number }> = {
  card: { left: 3, top: 5, w: 28, rotate: -7, z: 3, depth: 1.5 },
  folder: { left: 30, top: 2, w: 43, rotate: 2, z: 2, depth: 0.7 },
  clipboard: { left: 68, top: 5, w: 27, rotate: 5, z: 3, depth: 1.2 },
  search: { left: 29, top: 36, w: 43, rotate: -1, z: 4, depth: 1.3 },
  plane: { left: 64, top: 42, w: 32, rotate: 4, z: 5, depth: 1.8 },
  plug: { left: 3, top: 78, w: 42, rotate: 0, z: 2, depth: 0.9 },
  cup: { left: 75, top: 70, w: 21, rotate: 3, z: 3, depth: 1.1 },
};

const INK = 'hsl(var(--paper-ink))';
const INK_SOFT = 'hsl(var(--paper-ink-soft))';
const PAPER = 'hsl(var(--paper))';
const PAPER_SHADE = 'hsl(var(--paper-shade))';

const Layer: React.FC<{ src: string; className?: string; style?: React.CSSProperties }> = ({ src, className, style }) => (
  <img src={src} alt="" draggable={false} className={cn('pointer-events-none absolute inset-0 h-full w-full select-none', className)} style={style} />
);

/** Cadre à ratio fixe : les calques s'y superposent, les textes y suivent la largeur (unités cqw). */
const Frame: React.FC<{ ratio: number; className?: string; clipX?: boolean; children: React.ReactNode }> = ({ ratio, className, clipX, children }) => (
  <div className={cn('relative w-full', className)} style={{ aspectRatio: String(ratio), containerType: 'inline-size', overflowX: clipX ? 'clip' : undefined }}>
    {children}
  </div>
);

const SHADOW = 'drop-shadow(0 14px 12px rgba(0,0,0,0.42))';

/* ─── Carte d'identité : prénom, profil, initiale ─── */
const CardObject: React.FC<{ data: DeskData; stamped: boolean }> = ({ data, stamped }) => {
  const reduced = useReducedMotion();
  const initial = (data.firstName ?? '').trim().charAt(0).toUpperCase();
  return (
    <Frame ratio={400 / 480}>
      <div className="absolute inset-0" style={{ filter: SHADOW }}>
        <Layer src={carteImg} />
        <div className="absolute flex items-center justify-center" style={{ left: '22.1%', top: '27.5%', width: '40%', height: '33.3%' }}>
          <AnimatePresence mode="popLayout">
            {initial && (
              <motion.span
                key={initial}
                initial={reduced ? false : { scale: 0.3, opacity: 0, rotate: -12 }}
                animate={{ scale: 1, opacity: 1, rotate: 0 }}
                exit={{ scale: 0.3, opacity: 0 }}
                transition={SPRING_DROP}
                className="font-semibold leading-none"
                style={{ fontSize: '21cqw', color: INK_SOFT }}
              >
                {initial}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="absolute flex items-center px-[3%]" style={{ left: '15.8%', top: '66.3%', width: '51.7%', height: '7.1%' }}>
          <span className="truncate font-semibold" style={{ fontSize: '6.6cqw', color: INK }}>{data.firstName}</span>
        </div>
        <div className="absolute flex items-center px-[3%]" style={{ left: '15.8%', top: '79%', width: '51.7%', height: '6.9%' }}>
          <AnimatePresence mode="wait">
            <motion.span
              key={data.profileLabel ?? ''}
              initial={reduced ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.14 }}
              className="truncate"
              style={{ fontSize: '5.6cqw', color: INK_SOFT }}
            >
              {data.profileLabel}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
      <AnimatePresence>
        {stamped && (
          <motion.img
            src={badgeImg}
            alt=""
            draggable={false}
            initial={reduced ? false : { scale: 3.2, opacity: 0, rotate: 24 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            transition={{ ...SPRING_DROP, delay: 0.2 }}
            className="pointer-events-none absolute inset-0 h-full w-full select-none"
            style={{ transformOrigin: '77% 19%', filter: SHADOW }}
          />
        )}
      </AnimatePresence>
    </Frame>
  );
};

/* ─── Dossier : logo sur la feuille, nom sur l'étiquette ─── */
const FolderObject: React.FC<{ data: DeskData }> = ({ data }) => {
  const reduced = useReducedMotion();
  const [logoFailed, setLogoFailed] = useState<string | null>(null);
  const logo = data.logoUrl && logoFailed !== data.logoUrl ? data.logoUrl : null;
  const initials = (data.orgName ?? '').trim().slice(0, 2).toUpperCase();
  return (
    <Frame ratio={480 / 380}>
      <div className="absolute inset-0" style={{ filter: SHADOW }}>
        <Layer src={dossierImg} />
        {/* Feuille de gauche : le logo, imprimé (multiply) */}
        <div className="absolute flex items-center justify-center" style={{ left: '17%', top: '34%', width: '26%', height: '32%', transform: 'rotate(-9deg)' }}>
          <AnimatePresence mode="wait">
            {logo ? (
              <motion.img
                key={logo}
                src={logo}
                alt=""
                referrerPolicy="no-referrer"
                onError={() => setLogoFailed(logo)}
                initial={reduced ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={SPRING_DROP}
                className="max-h-full max-w-full object-contain"
                style={{ mixBlendMode: 'multiply' }}
              />
            ) : initials ? (
              <motion.span
                key="initials"
                initial={reduced ? false : { scale: 0.4, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={SPRING_DROP}
                className="font-semibold"
                style={{ fontSize: '11cqw', color: INK_SOFT }}
              >
                {initials}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </div>
        {/* Étiquette collée sur la chemise */}
        <AnimatePresence>
          {data.orgName && (
            <motion.div
              initial={reduced ? false : { opacity: 0, scale: 1.5, rotate: 6 }}
              animate={{ opacity: 1, scale: 1, rotate: -3 }}
              transition={{ ...SPRING_DROP, delay: 0.1 }}
              className="absolute flex items-center justify-center rounded-sm px-[2%]"
              style={{
                left: '53%',
                top: '52%',
                width: '34%',
                height: '17%',
                background: PAPER,
                boxShadow: `inset 0 0 0 1px ${INK}`,
              }}
            >
              <span className="line-clamp-2 text-center font-semibold uppercase leading-tight" style={{ fontSize: '3.5cqw', color: INK, letterSpacing: '0.04em' }}>
                {data.orgName}
              </span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Frame>
  );
};

/* ─── Presse-papiers : le poste s'écrit, les compétences suivent ─── */
const ClipboardObject: React.FC<{ data: DeskData }> = ({ data }) => {
  const reduced = useReducedMotion();
  const skills = (data.skills ?? []).slice(0, 4);
  return (
    <Frame ratio={341 / 480}>
      <div className="absolute inset-0" style={{ filter: SHADOW }}>
        <Layer src={briefImg} />
        {/* Les deux traits dessinés d'origine sont recouverts d'une retouche de la couleur du papier */}
        <div aria-hidden="true" className="absolute" style={{ left: '21%', top: '32%', width: '32%', height: '15%', background: PAPER, boxShadow: `0 0 6px 5px ${PAPER}` }} />
        <div className="absolute overflow-hidden" style={{ left: '17%', top: '25%', width: '45%', height: '37%' }}>
          <p className="line-clamp-3 break-words font-semibold leading-snug" style={{ fontSize: '7.4cqw', color: INK }}>
            {data.jobTitle}
          </p>
          <ul className="mt-[5%] space-y-[3%]">
            <AnimatePresence initial={false}>
              {skills.map((s, i) => (
                <motion.li
                  key={s}
                  initial={reduced ? false : { opacity: 0, x: -8 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ ...SPRING_SOFT, delay: i * 0.06 }}
                  className="truncate leading-snug"
                  style={{ fontSize: '5.4cqw', color: INK_SOFT }}
                >
                  {s}
                </motion.li>
              ))}
            </AnimatePresence>
          </ul>
        </div>
      </div>
    </Frame>
  );
};

/* ─── Prise et fiche : elles se branchent quand LinkedIn est relié ─── */
const PlugObject: React.FC<{ state: NonNullable<DeskData['linkedIn']> }> = ({ state }) => {
  const reduced = useReducedMotion();
  const connected = state === 'connected';
  const gap = connected ? 0 : state === 'connecting' ? 5 : 11;
  return (
    <Frame ratio={480 / 133} clipX>
      {/* Pas d'ombre portée ici : ces calques ont un voile presque transparent que le filtre rendrait en rectangle sombre. */}
      <div className="absolute inset-0">
        <motion.div className="absolute inset-0" animate={{ x: `${-gap}%` }} transition={reduced ? { duration: 0 } : { ...SPRING_DROP, stiffness: 300 }}>
          <Layer src={prisePlugImg} />
        </motion.div>
        <motion.div className="absolute inset-0" animate={{ x: `${gap}%` }} transition={reduced ? { duration: 0 } : { ...SPRING_DROP, stiffness: 300 }}>
          <Layer src={fichePlugImg} />
        </motion.div>
      </div>
      <AnimatePresence>
        {connected && !reduced && (
          <motion.span
            key="spark"
            aria-hidden="true"
            initial={{ scale: 0.2, opacity: 0.9 }}
            animate={{ scale: 2.6, opacity: 0 }}
            transition={{ duration: 0.7, ease: EASE_OUT }}
            className="absolute rounded-full border-2 border-brand"
            style={{ left: '46%', top: '30%', width: '8%', aspectRatio: '1' }}
          />
        )}
      </AnimatePresence>
    </Frame>
  );
};

/* ─── Fiches et loupe : les photos des premiers candidats dans les cartes ─── */
// Centres des trois pastilles dessinées (mesurés sur le calque 480 x 466), en % du cadre.
const AVATAR_SLOTS = [
  { x: 20.7, y: 70.5 },
  { x: 49.9, y: 73.8 },
  { x: 79.6, y: 71.9 },
];

const SearchObject: React.FC<{ candidates: DeskCandidate[]; scanning: boolean }> = ({ candidates, scanning }) => {
  const reduced = useReducedMotion();
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  return (
    <Frame ratio={480 / 466}>
      <div className="absolute inset-0" style={{ filter: SHADOW }}>
        <Layer src={fichesImg} />
        {AVATAR_SLOTS.map((slot, i) => {
          const c = candidates[i];
          if (!c) return null;
          const showPhoto = c.photo && !failed[c.photo];
          return (
            <motion.div
              key={`${i}-${c.photo ?? c.initials}`}
              initial={reduced ? false : { scale: 0, rotate: -30 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ ...SPRING_DROP, delay: 0.15 + i * 0.12 }}
              className="absolute flex items-center justify-center overflow-hidden rounded-full"
              style={{
                left: `${slot.x}%`,
                top: `${slot.y}%`,
                width: '14.4%',
                aspectRatio: '1',
                translate: '-50% -50%',
                background: PAPER_SHADE,
                boxShadow: `0 0 0 1.5px ${INK}`,
              }}
            >
              {showPhoto ? (
                <img
                  src={c.photo ?? ''}
                  alt=""
                  referrerPolicy="no-referrer"
                  onError={() => setFailed((f) => ({ ...f, [c.photo ?? '']: true }))}
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="font-semibold" style={{ fontSize: '4.2cqw', color: INK_SOFT }}>{c.initials}</span>
              )}
            </motion.div>
          );
        })}
      </div>
      <motion.div
        className="absolute inset-0"
        style={{ transformOrigin: '60% 30%', filter: SHADOW }}
        animate={
          reduced
            ? undefined
            : scanning
              ? { x: ['-14%', '16%', '-6%', '12%'], y: ['10%', '-2%', '14%', '2%'], rotate: [-10, 8, -4, 6] }
              : { x: '4%', y: '-4%', rotate: 0 }
        }
        transition={scanning ? { duration: 3.4, repeat: Infinity, ease: 'easeInOut', repeatType: 'mirror' } : SPRING_SOFT}
      >
        <Layer src={loupeImg} />
      </motion.div>
    </Frame>
  );
};

/* ─── Avion : il trace sa route quand un brouillon existe, sans partir ─── */
const PlaneObject: React.FC<{ ready: boolean }> = ({ ready }) => {
  const reduced = useReducedMotion();
  return (
    <Frame ratio={480 / 313}>
      <motion.div
        className="absolute inset-0"
        initial={false}
        animate={reduced ? undefined : { clipPath: ready ? 'inset(0 0% 0 0)' : 'inset(0 100% 0 0)' }}
        transition={{ duration: 1.1, ease: EASE_OUT }}
      >
        <Layer src={traceImg} />
      </motion.div>
      <motion.div
        className="absolute inset-0"
        style={{ filter: SHADOW }}
        animate={ready && !reduced ? { x: '8%', y: '-8%', rotate: -5 } : { x: '-4%', y: '4%', rotate: 0 }}
        transition={SPRING_SOFT}
      >
        <Layer src={avionImg} />
      </motion.div>
    </Frame>
  );
};

/* ─── Tasse : la pause pendant que l'IA travaille ─── */
const CupObject: React.FC = () => {
  const reduced = useReducedMotion();
  return (
    <Frame ratio={433 / 480}>
      <div className="absolute inset-0" style={{ filter: SHADOW }}>
        <Layer src={tasseImg} />
      </div>
      <motion.div
        className="absolute inset-0"
        animate={reduced ? undefined : { y: ['10%', '-10%'], opacity: [0, 1, 0] }}
        transition={{ duration: 3.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <Layer src={vapeurImg} />
      </motion.div>
    </Frame>
  );
};

/* ─── Le bureau ─── */

/** Anneau qui s'étend une fois quand l'objet passe de « en attente » à « en service ». */
const WakeRing: React.FC<{ active: boolean }> = ({ active }) => {
  const [ring, setRing] = useState(0);
  const previous = useRef(active);
  useEffect(() => {
    if (active && !previous.current) setRing((n) => n + 1);
    previous.current = active;
  }, [active]);
  if (!ring) return null;
  return (
    <motion.span
      key={ring}
      aria-hidden="true"
      className="pointer-events-none absolute -inset-[6%] border-2 border-brand"
      style={{ borderRadius: '1.5rem' }}
      initial={{ opacity: 0.9, scale: 0.86 }}
      animate={{ opacity: 0, scale: 1.22 }}
      transition={{ duration: 0.95, ease: EASE_OUT }}
    />
  );
};

interface DeskItemProps {
  slotKey: DeskKey;
  focused: boolean;
  idle: boolean;
  delay: number;
  lifted: boolean;
  onLift: (key: DeskKey | null) => void;
  children: React.ReactNode;
}

/**
 * Un objet du bureau. On peut l'attraper et le lâcher : il revient à sa place
 * en rebondissant (souris seulement : au doigt, le glisser gênerait le défilement).
 */
const DeskItem: React.FC<DeskItemProps> = ({ slotKey, focused, idle, delay, lifted, onLift, children }) => {
  const reduced = useReducedMotion();
  const slot = SLOT[slotKey];
  const canDrag = useMemo(() => !reduced && typeof window !== 'undefined' && window.matchMedia('(hover: hover) and (pointer: fine)').matches, [reduced]);
  return (
    <div className="absolute" style={{ left: `${slot.left}%`, top: `${slot.top}%`, width: `${slot.w}%`, zIndex: lifted ? 40 : focused ? 20 : slot.z }}>
      <Obj depth={slot.depth} delay={delay} enter="drop" rotate={slot.rotate} float={focused ? 7 : idle ? 0 : 4}>
        <motion.div
          animate={{ scale: focused ? 1.09 : idle ? 0.94 : 0.98, opacity: idle ? 0.42 : 1 }}
          transition={reduced ? { duration: 0 } : SPRING_SOFT}
          style={{ filter: idle ? 'grayscale(0.6)' : undefined }}
          className="relative"
        >
          <WakeRing active={!idle} />
          <motion.div
            drag={canDrag}
            dragSnapToOrigin
            dragElastic={0.45}
            dragMomentum={false}
            dragTransition={{ bounceStiffness: 260, bounceDamping: 16 }}
            whileHover={canDrag ? { y: -6, rotate: 1.6 } : undefined}
            whileTap={canDrag ? { scale: 0.97 } : undefined}
            whileDrag={{ scale: 1.07 }}
            onDragStart={() => onLift(slotKey)}
            onDragEnd={() => onLift(null)}
            className={canDrag ? 'cursor-grab active:cursor-grabbing' : undefined}
          >
            {children}
          </motion.div>
        </motion.div>
      </Obj>
    </div>
  );
};

export const Desk: React.FC<DeskProps> = ({ states, focus, data, className }) => {
  const [lifted, setLifted] = useState<DeskKey | null>(null);
  const item = (key: DeskKey, node: React.ReactNode, delay: number) => (
    <DeskItem key={key} slotKey={key} focused={focus === key} idle={states[key] === 'idle'} delay={delay} lifted={lifted === key} onLift={setLifted}>
      {node}
    </DeskItem>
  );

  return (
    <div className={cn('relative w-full', className)} style={{ aspectRatio: '1 / 1', containerType: 'inline-size' }}>
      {/* Sous-main : le bureau sur lequel les objets se posent */}
      <div aria-hidden="true" className="absolute inset-[3%] border border-border bg-card/70" style={{ borderRadius: '2rem' }}>
        <div className="absolute inset-3 border border-dashed border-border-strong/60" style={{ borderRadius: '1.4rem' }} />
      </div>
      {item('folder', <FolderObject data={data} />, 0.1)}
      {item('card', <CardObject data={data} stamped={!!data.stamped} />, 0)}
      {item('clipboard', <ClipboardObject data={data} />, 0.2)}
      {item('search', <SearchObject candidates={data.candidates ?? []} scanning={!!data.scanning} />, 0.3)}
      {item('plane', <PlaneObject ready={!!data.messageReady} />, 0.4)}
      {item('plug', <PlugObject state={data.linkedIn ?? 'none'} />, 0.5)}
      {item('cup', <CupObject />, 0.6)}
    </div>
  );
};
