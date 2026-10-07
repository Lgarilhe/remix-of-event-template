import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { easeInOut, motion, useMotionValueEvent, useTransform, type MotionValue } from 'framer-motion';
import { MousePointer2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  AgentMemoryConfirmedFrame, AgentMemoryProposalActions, AgentMemoryProposalFrame, AgentMemorySummary,
} from './AgentMemoryPresentation';
import { agentMemoryScopeLabel, type AgentMemoryDraft, type AgentMemoryScope } from '@/types/agentMemory';

interface Props {
  phase: 0 | 1 | 2 | 3;
  progress: MotionValue<number>;
  reducedMotion: boolean;
  orgType: 'agency' | 'enterprise' | 'freelance' | null;
  hasProject: boolean;
}

type ContextProps = Pick<Props, 'orgType' | 'hasProject'>;
const EXAMPLE: AgentMemoryDraft = {
  content: 'Répondre en français, avec des explications courtes.',
  scope: 'user', kind: 'preference', effects: ['assistant'],
};
const EXAMPLE_DATE = new Date().toISOString();
const CHECK_PATH = 'M 4 10 L 8 14 L 16 5';

function ScopeRail({ orgType, hasProject, selected, selection }: ContextProps & { selected?: boolean; selection?: MotionValue<number> }) {
  const scopes: AgentMemoryScope[] = hasProject ? ['organization', 'project', 'user'] : ['organization', 'user'];
  return (
    <div className={`absolute inset-x-2 bottom-1 grid gap-1 ${hasProject ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {scopes.map((scope) => (
        <div key={scope} className="relative min-w-0">
          <Badge variant={selected && scope === 'user' ? 'brand' : 'muted'}
            className="min-h-11 w-full justify-center whitespace-normal px-1 py-1 text-center text-2xs leading-4 transition-none">
            {agentMemoryScopeLabel(scope, orgType)}
          </Badge>
          {!selected && selection && scope === 'user' && <motion.div className="pointer-events-none absolute inset-0 rounded-full border-2 border-brand" style={{ opacity: selection }} />}
        </div>
      ))}
    </div>
  );
}

function Conversation({ highlight }: { highlight?: ReactNode }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-xl rounded-br-sm bg-muted px-4 py-2.5 text-md leading-relaxed text-foreground">
        <div className="relative">
          {highlight}
          <span className="relative whitespace-pre-wrap">Réponds en français, avec des explications courtes</span>
        </div>
      </div>
    </div>
  );
}

function ExampleSurface({ phase, orgType, highlight, check }: Pick<Props, 'phase' | 'orgType'> & { highlight?: ReactNode; check?: ReactNode }) {
  if (phase === 0) return <Conversation highlight={highlight} />;
  if (phase < 3) return (
    <AgentMemoryProposalFrame>
      <AgentMemorySummary value={EXAMPLE} orgType={orgType} variant="proposal" />
      <AgentMemoryProposalActions illustrative />
    </AgentMemoryProposalFrame>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-sm font-medium">{check}Mémoires actives</div>
      <Card className="divide-y divide-border overflow-hidden">
        <AgentMemoryConfirmedFrame>
          <AgentMemorySummary value={EXAMPLE} orgType={orgType} variant="confirmed" date={{ at: EXAMPLE_DATE }} />
        </AgentMemoryConfirmedFrame>
      </Card>
    </div>
  );
}

interface SceneSize {
  width: number;
  height: number;
  ticketWidth: number;
  ticketHeight: number;
  proposalHeight: number;
  scopeX: number;
  scopeY: number;
  keepX: number;
  keepY: number;
}

/** Layout coordinates deliberately exclude the moving parent's transform. */
function markerCenter(ticket: HTMLDivElement, selector: string) {
  const marker = ticket.querySelector<HTMLElement>(selector);
  if (!marker) return null;
  let x = marker.offsetWidth / 2;
  let y = marker.offsetHeight / 2;
  let element: HTMLElement | null = marker;
  while (element && element !== ticket) {
    x += element.offsetLeft;
    y += element.offsetTop;
    element = element.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

function useSceneSize(phase: Props['phase']) {
  const sceneRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<SceneSize>({
    width: 320, height: 336, ticketWidth: 304, ticketHeight: 220, proposalHeight: 288,
    scopeX: 44, scopeY: 130, keepX: 50, keepY: 230,
  });

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const ticket = ticketRef.current;
    if (!scene || !ticket) return;
    const measure = () => {
      const scope = markerCenter(ticket, '[data-memory-scope]');
      const keep = markerCenter(ticket, '[data-memory-keep]');
      setSize((previous) => {
        const next = {
          ...previous, width: scene.clientWidth, height: scene.clientHeight,
          ticketWidth: ticket.offsetWidth, ticketHeight: ticket.offsetHeight,
          ...(phase === 1 || phase === 2 ? { proposalHeight: ticket.offsetHeight } : {}),
          ...(scope && phase < 3 ? { scopeX: scope.x, scopeY: scope.y } : {}),
          ...(keep ? { keepX: keep.x, keepY: keep.y } : {}),
        };
        return Object.keys(next).every((key) => next[key as keyof SceneSize] === previous[key as keyof SceneSize]) ? previous : next;
      });
    };
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(scene);
    observer.observe(ticket);
    return () => observer.disconnect();
  }, [phase]);
  return { sceneRef, ticketRef, size };
}

function sceneGeometry(size: SceneSize, hasProject: boolean) {
  const count = hasProject ? 3 : 2;
  const railWidth = size.width - 16;
  const first = 8 + railWidth / (count * 2);
  const middle = hasProject ? size.width / 2 : first;
  const last = size.width - first;
  const center = (size.width - size.ticketWidth) / 2;
  const right = Math.max(8, size.width - size.ticketWidth - 8);
  const railY = size.height - 26;
  const cardLimit = size.height - 56;
  const choiceY = Math.max(0, Math.min(20, cardLimit - size.proposalHeight));
  const finalY = Math.max(0, Math.min(80, cardLimit - size.ticketHeight));
  return { first, middle, last, center, right, railY, choiceY, finalY };
}

const sceneClassName = 'pointer-events-none relative isolate overflow-hidden bg-background [&_*]:transition-none';
const ticketClassName = 'absolute left-0 top-0 w-[calc(100%-1rem)] md:w-3/5';

function StaticScene({ orgType, hasProject }: ContextProps) {
  const { sceneRef, ticketRef, size } = useSceneSize(3);
  const { right, finalY } = sceneGeometry(size, hasProject);
  return (
    <Card ref={sceneRef} data-memory-scene="static" aria-hidden="true" className={sceneClassName} style={{ height: 336 }}>
      <div ref={ticketRef} data-memory-ticket="true" className={ticketClassName} style={{ left: right, top: finalY }}>
        <ExampleSurface phase={3} orgType={orgType} check={<svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-success">
          <path d={CHECK_PATH} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>} />
      </div>
      <ScopeRail orgType={orgType} hasProject={hasProject} selected />
    </Card>
  );
}

/** All motion, including the illustrative press, follows the parent's pausable progress. */
function AnimatedScene({ phase, progress, orgType, hasProject }: Omit<Props, 'reducedMotion'>) {
  const { sceneRef, ticketRef, size } = useSceneSize(phase);
  const { first, middle, last, center, right, railY, choiceY, finalY } = sceneGeometry(size, hasProject);
  const x = useTransform(progress, [0, 0.2, 0.34, 0.44, 0.78, 0.94, 1], [8, 8, center, center, center, right, right], { ease: easeInOut });
  const y = useTransform(progress, [0, 0.2, 0.34, 0.44, 0.78, 0.94, 1], [12, 12, choiceY + 8, choiceY, choiceY, finalY, finalY], { ease: easeInOut });
  const rotate = useTransform(progress, [0, 0.2, 0.3, 0.44, 0.78, 0.89, 0.96, 1], [0, 0, -1.5, 0, 0, 1.5, 0, 0], { ease: easeInOut });
  const highlight = useTransform(progress, [0, 0.05, 0.17, 0.2, 1], [0, 0.2, 1, 1, 1]);
  const railVisible = useTransform(progress, [0, 0.43, 0.48, 1], [0, 0, 1, 1]);
  const selection = useTransform(progress, [0, 0.6, 0.63, 1], [0, 0, 1, 1]);
  const pointerX = useTransform(progress, [0, 0.44, 0.49, 0.55, 0.61, 0.67, 0.71, 1],
    [first, first, first, middle, last, center + size.scopeX, center + size.keepX, center + size.keepX], { ease: easeInOut });
  const pointerY = useTransform(progress, [0, 0.44, 0.61, 0.67, 0.71, 1],
    [railY, railY, railY, choiceY + size.scopeY, choiceY + size.keepY, choiceY + size.keepY], { ease: easeInOut });
  const pointerVisible = useTransform(progress, [0, 0.44, 0.47, 0.76, 0.78, 1], [0, 0, 1, 1, 0, 0]);
  const keepScale = useTransform(progress, [0, 0.715, 0.73, 0.75, 0.77, 1], [1, 1, 0.97, 0.97, 1, 1]);
  const pressScale = useTransform(progress, [0, 0.715, 0.735, 0.765, 1], [0.5, 0.5, 1, 1.3, 1.3]);
  const pressVisible = useTransform(progress, [0, 0.715, 0.728, 0.75, 0.77, 1], [0, 0, 1, 1, 0, 0]);
  const checkPath = useTransform(progress, [0, 0.79, 0.81, 0.92, 1], [0, 0, 0, 1, 1]);
  const checkVisible = useTransform(checkPath, (length) => length > 0 ? 1 : 0);

  // The shared presentation stays pure; only its decorative span receives a cosmetic press.
  useMotionValueEvent(keepScale, 'change', (value) => {
    const keep = ticketRef.current?.querySelector<HTMLElement>('[data-memory-keep]');
    if (keep) keep.style.transform = `scale(${value})`;
  });

  return (
    <Card ref={sceneRef} data-memory-scene="animated" aria-hidden="true" className={sceneClassName} style={{ height: 336 }}>
      <motion.div ref={ticketRef} data-memory-ticket="true" className={ticketClassName} style={{ x, y, rotate }}>
        <ExampleSurface phase={phase} orgType={orgType}
          highlight={<motion.div className="absolute inset-0 rounded-sm bg-brand/15" style={{ scaleX: highlight, transformOrigin: 'left center' }} />}
          check={<svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-success">
            <motion.path d={CHECK_PATH} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pathLength: checkPath, opacity: checkVisible }} />
          </svg>} />
      </motion.div>
      <motion.div className="absolute inset-0 pointer-events-none" style={{ opacity: railVisible }}>
        <ScopeRail orgType={orgType} hasProject={hasProject} selected={phase === 3} selection={selection} />
      </motion.div>
      <motion.div className="pointer-events-none absolute left-0 top-0 h-5 w-5 rounded-full border-2 border-brand"
        style={{ x: center + size.keepX - 10, y: choiceY + size.keepY - 10, scale: pressScale, opacity: pressVisible }} />
      <motion.div className="pointer-events-none absolute left-0 top-0 text-foreground" style={{ x: pointerX, y: pointerY, opacity: pointerVisible }}>
        <MousePointer2 className="h-5 w-5 fill-card" strokeWidth={1.5} />
      </motion.div>
    </Card>
  );
}

export function AgentMemoryMotionScene({ reducedMotion, ...props }: Props) {
  return reducedMotion ? <StaticScene orgType={props.orgType} hasProject={props.hasProject} /> : <AnimatedScene {...props} />;
}
