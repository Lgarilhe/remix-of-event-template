import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cubicBezier, motion, useMotionValueEvent, useTransform, type MotionValue } from 'framer-motion';
import { Check, MessageSquare, MousePointer2 } from 'lucide-react';
import { KonektLogo } from '@/components/KonektLogo';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AgentMemoryProposalActions, AgentMemoryProposalFrame } from './AgentMemoryPresentation';
import { agentMemoryScopeLabel, type AgentMemoryScope } from '@/types/agentMemory';

export const MEMORY_FILM_DURATION = 18;

interface Props {
  phase: 0 | 1 | 2 | 3;
  progress: MotionValue<number>;
  reducedMotion: boolean;
  orgType: 'agency' | 'enterprise' | 'freelance' | null;
  hasProject: boolean;
}

const PHRASE = '3 points clés, puis les réserves.';
const FILM_EASE = cubicBezier(0.22, 1, 0.36, 1);
const points = ['5 ans en produit.', 'Deux lancements menés.', 'Mobilité : Paris.'];
const filmClass = 'pointer-events-none relative isolate overflow-hidden rounded-xl border border-border bg-background h-80 md:h-[370px] [&_*]:transition-none [&_p]:text-sm [&_.rounded-full]:text-sm';
const time = (seconds: number) => seconds / MEMORY_FILM_DURATION;
const clamp = (value: number) => Math.max(0, Math.min(1, value));
const mix = (from: number, to: number, value: number) => from + (to - from) * value;

function useFilmTransform(progress: MotionValue<number>, seconds: number[], values: number[]) {
  return useTransform(progress, seconds.map(time), values, { ease: FILM_EASE });
}

function makeInert(node: HTMLDivElement | null) {
  if (node) node.inert = true;
}

function useFilmLayout(phase: Props['phase']) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const proposalRef = useRef<HTMLDivElement>(null);
  const phraseRef = useRef<HTMLDivElement>(null);
  const [layout, setLayout] = useState({ width: 254, height: 320, proposalHeight: 276, editX: 158, editY: 218, prefixHeight: 44, phraseHeight: 48, sourcePhraseHeight: 48 });
  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const proposal = proposalRef.current;
    if (!scene || !proposal) return;
    scene.inert = true;
    const measure = () => {
      const edit = Array.from(proposal.querySelectorAll<HTMLElement>('span')).find((element) => element.textContent === 'Modifier');
      const measured = { width: scene.clientWidth, height: scene.clientHeight, proposalHeight: proposal.offsetHeight,
        editX: edit ? edit.offsetLeft + edit.offsetWidth / 2 : 158,
        editY: edit ? edit.offsetTop + edit.offsetHeight / 2 : 218,
        prefixHeight: scene.querySelector<HTMLElement>('[data-source-prefix]')?.offsetHeight ?? 44,
        phraseHeight: phraseRef.current?.offsetHeight ?? 40 };
      setLayout((previous) => {
        const next = { ...measured, sourcePhraseHeight: phase === 0
          ? phraseRef.current?.getBoundingClientRect().height ?? previous.sourcePhraseHeight : previous.sourcePhraseHeight };
        return Object.keys(next).every((key) => previous[key as keyof typeof next] === next[key as keyof typeof next]) ? previous : next;
      });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(scene);
    observer.observe(proposal);
    if (phraseRef.current) observer.observe(phraseRef.current);
    const prefix = scene.querySelector<HTMLElement>('[data-source-prefix]');
    if (prefix) observer.observe(prefix);
    return () => observer.disconnect();
  }, [phase]);
  const laneWidth = Math.min(layout.width - 16, 400);
  return { sceneRef, proposalRef, phraseRef, ...layout, laneWidth, laneX: (layout.width - laneWidth) / 2,
    offset: Math.max(0, (layout.height - 320) / 2) };
}

function FilmHeader({ phase }: Pick<Props, 'phase'>) {
  return <div className="absolute inset-x-0 top-0 flex h-8 items-center gap-2 border-b border-border px-3 text-sm">
    <MessageSquare className="h-4 w-4" />{phase === 3 ? 'Échange suivant' : 'Assistant'}
  </div>;
}

function InkCheck({ progress, at }: { progress: MotionValue<number>; at: number }) {
  const path = useFilmTransform(progress, [0, at, at + 0.5, 18], [0, 0, 1, 1]);
  const opacity = useTransform(path, (value) => value > 0 ? 1 : 0);
  return <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-success">
    <motion.path d="M4 10 L8 14 L16 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pathLength: path, opacity }} />
  </svg>;
}

function WordGroup({ progress, at, children }: { progress: MotionValue<number>; at: number; children: ReactNode }) {
  const opacity = useFilmTransform(progress, [0, at, at + 0.3, 18], [0, 0, 1, 1]);
  const y = useFilmTransform(progress, [0, at, at + 0.45, 18], [5, 5, 0, 0]);
  return <motion.span className="inline-block" style={{ opacity, y }}>{children}</motion.span>;
}

function ResponseLine({ progress, at, children }: { progress: MotionValue<number>; at: number; children: ReactNode }) {
  const opacity = useFilmTransform(progress, [0, at, at + 0.3, 18], [0, 0, 1, 1]);
  const y = useFilmTransform(progress, [0, at, at + 0.45, 18], [8, 8, 0, 0]);
  return <motion.div style={{ opacity, y }}>{children}</motion.div>;
}

function IllustratedScopeMenu({ orgType, hasProject, progress }: Pick<Props, 'orgType' | 'hasProject' | 'progress'>) {
  const scopes: AgentMemoryScope[] = hasProject ? ['organization', 'project', 'user'] : ['organization', 'user'];
  const selection = useFilmTransform(progress, [0, 9.1, 9.4, 18], [0, 0, 1, 1]);
  return <div data-memory-scope-menu="true" className="rounded-xl border border-border bg-popover p-1 shadow-lg">
    {scopes.map((scope) => <div key={scope} className="relative flex h-10 items-center rounded-md py-1.5 pl-8 pr-2 text-sm">
      {scope === 'user' && <motion.div className="absolute inset-0 rounded-md bg-accent" style={{ opacity: selection }} />}
      {scope === 'user' && <span className="absolute left-2 flex h-4 w-4 items-center justify-center text-brand"><Check className="h-4 w-4" /></span>}
      <span className="relative">{agentMemoryScopeLabel(scope, orgType)}</span>
    </div>)}
  </div>;
}

function AnimatedFilm({ phase, progress, orgType, hasProject }: Omit<Props, 'reducedMotion'>) {
  const id = useId();
  const layout = useFilmLayout(phase);
  const { laneX, laneWidth, width, height, offset, proposalRef, phraseRef, sceneRef } = layout;
  const proposalTop = 36 + offset;
  const sourceQuoteY = 124 + layout.prefixHeight + offset;
  const quoteX = useFilmTransform(progress, [0, 2.2, 3.7, 6.25, 7.25, 10.9, 11.6, 12.1, 13.1, 18],
    [laneX + laneWidth * 0.2 + 12, laneX + laneWidth * 0.2 + 12, laneX + 12, laneX + 12, laneX + 12, laneX + 12, laneX + 12, laneX + 12, laneX + 12, laneX + 12]);
  const quoteY = useFilmTransform(progress, [0, 2.2, 3.7, 6.25, 7.25, 10.9, 11.6, 12.1, 13.1, 18],
    [sourceQuoteY, sourceQuoteY, 76 + offset, 76 + offset, 62 + offset, 62 + offset, 107 + offset, 107 + offset, 62 + offset, 62 + offset]);
  const quoteWidth = useFilmTransform(progress, [0, 2.2, 3.7, 18], [laneWidth * 0.8 - 24, laneWidth * 0.8 - 24, laneWidth - 24, laneWidth - 24]);
  const cameraScale = useFilmTransform(progress, [0, 2.2, 3.7, 18], [1.04, 1, 1, 1]);
  const quoteScale = useFilmTransform(progress, [0, 2.2, 3.7, 18], [1.04, 1, 14 / 18, 14 / 18]);
  const quoteLogicalWidth = useTransform(() => quoteWidth.get() / quoteScale.get());
  const quotePhysicalHeight = useTransform(quoteScale, (scale) => layout.phraseHeight * scale);
  const sourceOpacity = useFilmTransform(progress, [0, 2.2, 3.5, 18], [1, 1, 0, 0]);
  const prefixOpacity = useFilmTransform(progress, [0, 2, 2.2, 18], [1, 1, 0, 0]);
  const sourceY = useFilmTransform(progress, [0, 2.2, 3.5, 18], [0, 0, 72, 72]);
  const proposalOpacity = useFilmTransform(progress, [0, 3.1, 4, 6.25, 7.25, 18], [0, 0, 1, 1, 0, 0]);
  const proposalY = useFilmTransform(progress, [0, 6.25, 7.25, 18], [proposalTop, proposalTop, proposalTop - 84, proposalTop - 84]);
  const detailsOpacity = useFilmTransform(progress, [0, 6.7, 7.25, 10.9, 11.6, 18], [0, 0, 1, 1, 0, 0]);
  const detailsY = useFilmTransform(progress, [0, 6.25, 7.25, 18], [212 + offset, 212 + offset, 120 + offset, 120 + offset]);
  const menuOpacity = useFilmTransform(progress, [0, 8.2, 8.7, 9.7, 10.1, 18], [0, 0, 1, 1, 0, 0]);
  const menuY = useFilmTransform(progress, [0, 8.2, 8.7, 18], [194 + offset, 194 + offset, 180 + offset, 180 + offset]);
  const modifierScale = useFilmTransform(progress, [0, 5.9, 6.1, 6.25, 6.45, 18], [1, 1, 0.98, 0.98, 1, 1]);
  const keepScale = useFilmTransform(progress, [0, 10.2, 10.4, 10.7, 10.9, 18], [1, 1, 0.98, 0.98, 1, 1]);
  const confirmedOpacity = useFilmTransform(progress, [0, 10.8, 11.5, 18], [0, 0, 1, 1]);
  const memoryY = useFilmTransform(progress, [0, 11.3, 12.1, 13.1, 18], [67 + offset, 67 + offset, 67 + offset, 36 + offset, 36 + offset]);
  const memoryHeight = useFilmTransform(progress, [0, 11.3, 12.1, 13.1, 18], [102, 102, 102, 76, 76]);
  const memoryTitleTop = useFilmTransform(progress, [0, 12.1, 13.1, 18], [12, 12, 4, 4]);
  const memoryLabelOpacity = useFilmTransform(progress, [0, 11.4, 11.9, 12.1, 12.7, 18], [0, 0, 1, 1, 0, 0]);
  const compactLabelOpacity = useFilmTransform(progress, [0, 12.3, 13.1, 18], [0, 0, 1, 1]);
  const nextOpacity = useFilmTransform(progress, [0, 12.3, 13.2, 18], [0, 0, 1, 1]);
  const nextY = useFilmTransform(progress, [0, 12.3, 13.2, 18], [182 + offset, 182 + offset, 118 + offset, 118 + offset]);
  const pointerVisible = useFilmTransform(progress, [0, 5.4, 5.8, 10.8, 11.3, 18], [0, 0, 1, 1, 0, 0]);
  const pointerX = useFilmTransform(progress, [0, 5.5, 5.9, 6.45, 7.7, 8.4, 9.15, 9.65, 10.25, 18],
    [laneX + laneWidth, laneX + laneWidth, laneX + layout.editX, laneX + layout.editX, laneX + laneWidth - 24, laneX + laneWidth - 24, laneX + 76, laneX + 76, laneX + 104, laneX + 104]);
  const optionCount = hasProject ? 3 : 2;
  const pointerY = useFilmTransform(progress, [0, 5.5, 5.9, 6.45, 7.7, 8.4, 9.15, 9.65, 10.25, 18],
    [294 + offset, 294 + offset, proposalTop + layout.editY, proposalTop + layout.editY - 20, 154 + offset, 154 + offset, 180 + offset + 4 + (optionCount - 0.5) * 40, 180 + offset + 4 + (optionCount - 0.5) * 40, 227 + offset, 227 + offset]);
  const underline = useFilmTransform(progress, [0, 1.3, 2.1, 18], [0, 0, 1, 1]);
  const outlineVisible = useFilmTransform(progress, [0, 1.3, 1.5, 4.2, 4.8, 18], [0, 0, 1, 1, 0, 0]);
  const outline = useTransform(progress, (value) => {
    const morph = FILM_EASE(clamp((value * 18 - 2.2) / 1.5));
    const left = mix(laneX + laneWidth * 0.2 + 12, laneX, morph);
    const top = mix(sourceQuoteY + layout.sourcePhraseHeight + 3, proposalTop, morph);
    const right = mix(laneX + laneWidth - 12, laneX + laneWidth, morph);
    const bottom = top + layout.proposalHeight * morph;
    const radius = 16 * morph;
    return `M${left + radius} ${top} H${right - radius} Q${right} ${top} ${right} ${top + radius} V${bottom - radius} Q${right} ${bottom} ${right - radius} ${bottom} H${left + radius} Q${left} ${bottom} ${left} ${bottom - radius} V${top + radius} Q${left} ${top} ${left + radius} ${top}`;
  });
  const linkPath = useFilmTransform(progress, [0, 13.1, 14.1, 18], [0, 0, 1, 1]);
  const linkVisible = useFilmTransform(progress, [0, 13.1, 13.3, 14.7, 15.2, 18], [0, 0, 1, 1, 0, 0]);

  useMotionValueEvent(modifierScale, 'change', (value) => {
    const edit = Array.from(proposalRef.current?.querySelectorAll<HTMLElement>('span') ?? []).find((element) => element.textContent === 'Modifier');
    if (edit) edit.style.transform = `scale(${value})`;
  });

  return (
    <div ref={sceneRef} data-memory-scene="animated" aria-hidden="true" className={filmClass}>
      <FilmHeader phase={phase} />
      <motion.div data-memory-ticket={phase === 0 ? 'true' : undefined} className="absolute left-0 top-0"
        style={{ x: laneX, y: sourceY, width: laneWidth, scale: cameraScale, opacity: sourceOpacity }}>
        <div className="absolute right-0 rounded-xl rounded-br-sm bg-muted px-3 py-2 text-md" style={{ top: 108 + offset, width: '80%', height: layout.prefixHeight + layout.sourcePhraseHeight + 24 }}>
          <motion.div data-source-prefix="true" style={{ opacity: prefixOpacity }}><WordGroup progress={progress} at={0.1}>Retiens pour mes synthèses :</WordGroup></motion.div>
        </div>
      </motion.div>
      <motion.div ref={proposalRef} data-memory-ticket={phase === 1 ? 'true' : undefined}
        className="absolute left-0 top-0 [&>article]:space-y-2 [&>div]:space-y-2"
        style={{ x: laneX, y: proposalY, width: laneWidth, opacity: proposalOpacity }}>
        <AgentMemoryProposalFrame>
          <motion.div style={{ height: quotePhysicalHeight }} />
          <div className="flex flex-wrap gap-1.5"><Badge variant="secondary" data-memory-scope="true" className="text-sm">Pour moi</Badge><Badge variant="outline" className="text-sm">Préférence</Badge></div>
          <p className="text-sm text-muted-foreground">Effet : Présentation des résultats.</p>
          <AgentMemoryProposalActions illustrative />
        </AgentMemoryProposalFrame>
      </motion.div>
      <svg viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 h-full w-full text-brand">
        <motion.path d={outline} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ pathLength: underline, opacity: outlineVisible }} />
      </svg>
      <motion.div data-memory-ticket={phase === 2 ? 'true' : undefined} className="absolute left-0 top-0 space-y-2"
        style={{ x: laneX + 12, y: detailsY, width: laneWidth - 24, opacity: detailsOpacity }}>
        <Label htmlFor={`${id}-scope`} className="block">Niveau</Label>
        <Select value="user" open={false}>
          <SelectTrigger id={`${id}-scope`} tabIndex={-1} data-memory-scope="true" className="relative h-11">
            <SelectValue>Pour moi</SelectValue>
          </SelectTrigger>
        </Select>
        <div className="pt-3"><Button asChild variant="primary" size="sm" className="min-h-11 max-w-full whitespace-normal">
          <motion.span data-memory-keep="true" style={{ scale: keepScale }}><Check className="h-4 w-4" />Garder les modifications</motion.span>
        </Button></div>
      </motion.div>
      <motion.div className="absolute left-0 top-0" style={{ x: laneX + 12, y: menuY, width: laneWidth - 24, opacity: menuOpacity }}>
        <IllustratedScopeMenu orgType={orgType} hasProject={hasProject} progress={progress} />
      </motion.div>
      <motion.div className="absolute left-0 top-0" style={{ x: laneX, y: memoryY, width: laneWidth, height: memoryHeight, opacity: confirmedOpacity }}>
        <Card className="relative h-full p-3">
          <motion.div className="absolute left-3 flex items-center gap-1.5 text-sm" style={{ top: memoryTitleTop, opacity: memoryLabelOpacity }}><InkCheck progress={progress} at={10.9} />Mémoire confirmée</motion.div>
          <motion.div className="absolute left-3 top-1 flex items-center gap-1.5 text-sm" style={{ opacity: compactLabelOpacity }}><Check className="h-4 w-4 text-success" />Pour moi · Format retenu</motion.div>
        </Card>
      </motion.div>
      <motion.div ref={phraseRef} data-memory-phrase="true" className="absolute left-0 top-0 text-lg font-medium leading-6"
        style={{ x: quoteX, y: quoteY, width: quoteLogicalWidth, scale: quoteScale, transformOrigin: 'left top' }}>
        <WordGroup progress={progress} at={0.55}>3 points clés,</WordGroup>{' '}<WordGroup progress={progress} at={1}>puis les réserves.</WordGroup>
      </motion.div>
      <motion.div data-memory-ticket={phase === 3 ? 'true' : undefined} className="absolute left-0 top-0"
        style={{ x: laneX, y: nextY, width: laneWidth, opacity: nextOpacity }}>
        <div className="flex justify-end"><div className="max-w-[80%] rounded-xl rounded-br-sm bg-muted px-3 py-2 text-md leading-relaxed">Prépare la synthèse de Léa.</div></div>
      </motion.div>
      <svg viewBox={`0 0 ${width} ${height}`} className="pointer-events-none absolute inset-0 h-full w-full text-brand">
        <motion.path d={`M${laneX + laneWidth - 8} ${110 + offset} C${laneX + laneWidth - 8} ${154 + offset} ${laneX + 12} ${148 + offset} ${laneX + 12} ${182 + offset}`}
          fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ pathLength: linkPath, opacity: linkVisible }} />
      </svg>
      <div className="absolute flex items-start gap-2 text-sm leading-5" style={{ left: laneX, top: 184 + offset, width: laneWidth }}>
        <ResponseLine progress={progress} at={14}><KonektLogo variant="mark" theme="auto" size={20} /></ResponseLine>
        <div className="min-w-0 flex-1">
          {points.map((point, index) => <ResponseLine key={point} progress={progress} at={14 + index * 0.18}><p>{index + 1}. {point}</p></ResponseLine>)}
          <div className="mt-2"><ResponseLine progress={progress} at={14.54}><p className="font-medium">Réserves</p></ResponseLine>
            <ResponseLine progress={progress} at={14.72}><p>Disponibilité à préciser.</p></ResponseLine></div>
        </div>
      </div>
      <motion.div data-memory-cursor="true" className="absolute left-0 top-0 text-foreground"
        style={{ x: pointerX, y: pointerY, opacity: pointerVisible }}><MousePointer2 className="h-5 w-5 fill-card" strokeWidth={1.5} /></motion.div>
    </div>
  );
}

function StaticFilm({ orgType }: Pick<Props, 'orgType'>) {
  return <div ref={makeInert} data-memory-scene="static" aria-hidden="true" className="pointer-events-none space-y-3 rounded-xl border border-border bg-background p-3 [&_*]:transition-none">
    <div><p className="mb-1 text-sm font-medium">Votre consigne</p><p className="text-sm">Retiens pour mes synthèses : {PHRASE}</p></div>
    <div data-memory-ticket="true" className="border-t border-border pt-3">
      <p className="flex items-center gap-1.5 text-sm font-medium"><Check className="h-4 w-4 text-success" />Validée · {agentMemoryScopeLabel('user', orgType)}</p>
      <p className="mt-1 text-sm">Le format s’applique à vos synthèses.</p>
    </div>
    <div className="border-t border-border pt-3"><p className="mb-1 text-sm font-medium">La prochaine synthèse</p>
      {points.map((point, index) => <p key={point} className="text-sm">{index + 1}. {point}</p>)}
      <p className="mt-2 text-sm font-medium">Réserves</p><p className="text-sm">Disponibilité à préciser.</p>
    </div>
  </div>;
}

export function AgentMemoryMotionScene({ reducedMotion, ...props }: Props) {
  return reducedMotion ? <StaticFilm orgType={props.orgType} /> : <AnimatedFilm {...props} />;
}
