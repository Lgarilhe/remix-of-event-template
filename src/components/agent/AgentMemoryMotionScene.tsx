import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { easeInOut, motion, useTransform, type MotionValue } from 'framer-motion';
import { Brain, BriefcaseBusiness, Building2, MessageSquare, UserRound } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { agentMemoryScopeLabel, type AgentMemoryScope } from '@/types/agentMemory';

interface Props {
  phase: 0 | 1 | 2 | 3;
  progress: MotionValue<number>;
  reducedMotion: boolean;
  orgType: 'agency' | 'enterprise' | 'freelance' | null;
  hasProject: boolean;
}

type ContextProps = Pick<Props, 'orgType' | 'hasProject'>;

function ScopeRail({ orgType, hasProject, selected }: ContextProps & { selected: boolean }) {
  const scopes: AgentMemoryScope[] = hasProject ? ['organization', 'project', 'user'] : ['organization', 'user'];
  return (
    <div className={`absolute inset-x-3 bottom-3 grid gap-1.5 ${hasProject ? 'grid-cols-3' : 'grid-cols-2'}`}>
      {scopes.map((scope) => {
        const Icon = scope === 'organization' ? Building2 : scope === 'project' ? BriefcaseBusiness : UserRound;
        return <Badge key={scope} variant={selected && scope === 'user' ? 'brand' : 'muted'}
          className="min-h-14 min-w-0 flex-col justify-center gap-0.5 whitespace-normal px-1 py-0.5 text-center text-2xs leading-4 transition-none">
          <Icon className="h-3.5 w-3.5" />{agentMemoryScopeLabel(scope, orgType)}
        </Badge>;
      })}
    </div>
  );
}

function SceneLabels() {
  return (
    <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2 text-xs font-medium">
      <span className="flex items-center gap-1.5"><MessageSquare className="h-3.5 w-3.5" />Conversation</span>
      <span className="flex items-center gap-1.5"><Brain className="h-3.5 w-3.5" />Mémoire</span>
    </div>
  );
}

function SceneSurfaces() {
  return (
    <>
      <div className="absolute left-3 top-8 h-24 w-2/3 rounded-xl border border-border bg-card p-3 sm:top-11 sm:h-28 sm:w-2/5">
        <div className="mb-3 h-1.5 w-1/3 rounded-full bg-border-strong" />
        <div className="space-y-2">
          <div className="h-1.5 w-4/5 rounded-full bg-border" />
          <div className="h-1.5 w-3/5 rounded-full bg-border" />
        </div>
      </div>
      <div className="absolute right-2 top-24 h-28 w-2/3 rotate-2 rounded-xl border border-border bg-card shadow-sm sm:top-14 sm:w-2/5" />
      <div className="absolute right-3 top-24 h-28 w-2/3 -translate-y-2 -rotate-2 rounded-xl border border-border bg-card shadow-sm sm:top-14 sm:w-2/5" />
    </>
  );
}

function Ticket({ phase, highlight, check }: Pick<Props, 'phase'> & { highlight?: ReactNode; check?: ReactNode }) {
  const labels = ['Votre message', 'Proposition', 'Pour moi', 'Confirmée'];
  return (
    <Card className={`relative overflow-hidden p-3 ${phase > 0 ? 'border-brand shadow-lg' : 'shadow-sm'}`}>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold">
        {phase === 3 ? check : phase === 0 ? <MessageSquare className="h-3.5 w-3.5 shrink-0" /> : <Brain className="h-3.5 w-3.5 shrink-0" />}
        {labels[phase]}
      </div>
      <div className="relative">
        {highlight}
        <p className="relative text-sm leading-5">Réponds en français, avec des explications courtes.</p>
      </div>
    </Card>
  );
}

function useSceneSize() {
  const sceneRef = useRef<HTMLDivElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 320, height: 288, ticketWidth: 320 * 2 / 3 });

  useLayoutEffect(() => {
    const scene = sceneRef.current;
    const ticket = ticketRef.current;
    if (!scene || !ticket) return;
    const measure = () => {
      const next = { width: scene.clientWidth, height: scene.clientHeight, ticketWidth: ticket.offsetWidth };
      setSize((previous) => previous.width === next.width && previous.height === next.height && previous.ticketWidth === next.ticketWidth ? previous : next);
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
  }, []);
  return { sceneRef, ticketRef, size };
}

function sceneGeometry(size: { width: number; height: number; ticketWidth: number }, hasProject: boolean) {
  const center = (size.width - size.ticketWidth) / 2;
  const right = size.width - size.ticketWidth - 12;
  const count = hasProject ? 3 : 2;
  const railWidth = size.width - 24;
  const first = 12 + railWidth / (count * 2);
  const middle = hasProject ? 12 + railWidth / 2 : first;
  const last = size.width - first;
  const desktop = size.height >= 310;
  const sourceY = desktop ? 44 : 32;
  const extractionY = desktop ? 80 : 64;
  const choiceY = desktop ? 48 : 64;
  const finalY = desktop ? 48 : 80;
  const finalX = right + size.ticketWidth / 2;
  const sourceBaseY = sourceY + 96;
  const choiceBaseY = choiceY + 96;
  const finalBaseY = finalY + 96;
  const railY = size.height - 80;
  // Pixel coordinates keep normalized Motion dashes consistent with a two-pixel stroke.
  const extractionRoute = `M ${size.width * 0.2} ${sourceBaseY} C ${size.width * 0.22} ${sourceBaseY + size.height * 0.2} ${size.width * 0.43} ${choiceBaseY + size.height * 0.16} ${size.width / 2} ${choiceBaseY}`;
  const selectionRoute = `M ${size.width / 2} ${choiceBaseY} C ${size.width / 2} ${railY - size.height * 0.08} ${first} ${railY - size.height * 0.12} ${first} ${railY} L ${last} ${railY}`;
  const filingRoute = `M ${last} ${railY} C ${last} ${railY - 16} ${finalX} ${railY - 16} ${finalX} ${finalBaseY}`;
  return { center, right, first, middle, last, sourceY, extractionY, choiceY, finalY, extractionRoute, selectionRoute, filingRoute };
}

function StaticScene({ orgType, hasProject }: ContextProps) {
  const { sceneRef, ticketRef, size } = useSceneSize();
  const geometry = sceneGeometry(size, hasProject);
  return (
    <Card ref={sceneRef} data-memory-scene="static" aria-hidden="true" className="relative isolate h-72 overflow-hidden bg-muted sm:h-80">
      <SceneLabels />
      <SceneSurfaces />
      <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full text-brand">
        {[geometry.extractionRoute, geometry.selectionRoute, geometry.filingRoute].map((route) => <path key={route} d={route} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />)}
      </svg>
      <div ref={ticketRef} data-memory-ticket="true" className="absolute right-3 w-2/3 sm:w-2/5" style={{ top: geometry.finalY }}>
        <Ticket phase={3} check={<svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-success">
          <path d="M 4 10 L 8 14 L 16 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>} />
      </div>
      <ScopeRail orgType={orgType} hasProject={hasProject} selected />
    </Card>
  );
}

/** Every moving property comes from the parent's progress, so pausing freezes the entire scene. */
function AnimatedScene({ phase, progress, orgType, hasProject }: Omit<Props, 'reducedMotion'>) {
  const { sceneRef, ticketRef, size } = useSceneSize();
  const geometry = sceneGeometry(size, hasProject);
  const { center, right, first, middle, last, sourceY, extractionY, choiceY, finalY } = geometry;
  const x = useTransform(progress, [0, 0.2, 0.32, 0.44, 0.78, 0.94, 1], [12, 12, center, center, center, right, right], { ease: easeInOut });
  const y = useTransform(progress, [0, 0.2, 0.32, 0.44, 0.78, 0.94, 1], [sourceY, sourceY, extractionY, choiceY, choiceY, finalY, finalY], { ease: easeInOut });
  const scale = useTransform(progress, [0, 0.2, 0.32, 0.44, 0.78, 0.89, 0.95, 1], [1, 1, 1.035, 1, 1, 0.98, 1.015, 1], { ease: easeInOut });
  const rotate = useTransform(progress, [0, 0.2, 0.32, 0.44, 0.78, 0.9, 0.96, 1], [0, 0, -4, 1.5, 1.5, -2, 0.5, 0], { ease: easeInOut });
  const highlight = useTransform(progress, [0, 0.05, 0.18, 0.28, 0.36, 1], [0, 0.25, 1, 1, 0, 0]);
  const extractionPath = useTransform(progress, [0, 0.2, 0.44, 1], [0, 0, 1, 1]);
  const selectionPath = useTransform(progress, [0, 0.44, 0.66, 1], [0, 0, 1, 1]);
  const pointerX = useTransform(progress, [0, 0.44, 0.5, 0.57, 0.66, 1], [first - 4, first - 4, first - 4, middle - 4, last - 4, last - 4]);
  const pointerVisible = useTransform(progress, [0, 0.44, 0.47, 0.78, 0.88, 1], [0, 0, 1, 1, 0, 0]);
  const filedPath = useTransform(progress, [0, 0.78, 0.94, 1], [0, 0, 1, 1]);
  const checkPath = useTransform(progress, [0, 0.78, 0.86, 0.96, 1], [0, 0, 0, 1, 1]);
  const extractionVisible = useTransform(extractionPath, (length) => length > 0 ? 1 : 0);
  const selectionVisible = useTransform(selectionPath, (length) => length > 0 ? 1 : 0);
  const filingVisible = useTransform(filedPath, (length) => length > 0 ? 1 : 0);
  const checkVisible = useTransform(checkPath, (length) => length > 0 ? 1 : 0);

  return (
    <Card ref={sceneRef} data-memory-scene="animated" aria-hidden="true" className="relative isolate h-72 overflow-hidden bg-muted sm:h-80">
      <SceneLabels />
      <SceneSurfaces />
      <svg viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full text-brand">
        <motion.path d={geometry.extractionRoute} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ pathLength: extractionPath, opacity: extractionVisible }} />
        <motion.path d={geometry.selectionRoute} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ pathLength: selectionPath, opacity: selectionVisible }} />
        <motion.path d={geometry.filingRoute} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" style={{ pathLength: filedPath, opacity: filingVisible }} />
      </svg>
      <motion.div ref={ticketRef} data-memory-ticket="true" className="absolute left-0 top-0 w-2/3 sm:w-2/5" style={{ x, y, scale, rotate }}>
        <Ticket phase={phase}
          highlight={<motion.div className="absolute inset-0 rounded-sm bg-brand/15" style={{ scaleX: highlight, transformOrigin: 'left center' }} />}
          check={<svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-success">
            <motion.path d="M 4 10 L 8 14 L 16 5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pathLength: checkPath, opacity: checkVisible }} />
          </svg>} />
      </motion.div>
      <ScopeRail orgType={orgType} hasProject={hasProject} selected={phase >= 2} />
      <motion.div className="absolute left-0 top-0 h-2 w-2 rounded-full bg-brand" style={{ x: pointerX, y: size.height - 84, opacity: pointerVisible }} />
    </Card>
  );
}

export function AgentMemoryMotionScene({ reducedMotion, ...props }: Props) {
  return reducedMotion ? <StaticScene orgType={props.orgType} hasProject={props.hasProject} /> : <AnimatedScene {...props} />;
}
