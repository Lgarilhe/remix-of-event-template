import { useId, type ReactNode } from 'react';
import { easeOut, motion, useTransform, type MotionValue } from 'framer-motion';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AgentMemoryConfirmedFrame, AgentMemoryProposalActions, AgentMemoryProposalFrame, AgentMemorySummary,
} from './AgentMemoryPresentation';
import { agentMemoryScopeLabel, type AgentMemoryDraft } from '@/types/agentMemory';

interface Props {
  phase: 0 | 1 | 2 | 3;
  progress: MotionValue<number>;
  reducedMotion: boolean;
  orgType: 'agency' | 'enterprise' | 'freelance' | null;
  hasProject: boolean;
}

const EXAMPLE: AgentMemoryDraft = {
  content: 'Répondre en français, avec des explications courtes.',
  scope: 'user', kind: 'preference', effects: ['assistant'],
};
const EXAMPLE_DATE = new Date().toISOString();
const CHECK_PATH = 'M 4 10 L 8 14 L 16 5';
const TRANSITION = 0.2 / 9;

function makeSceneInert(node: HTMLDivElement | null) {
  if (node) node.inert = true;
}

function Conversation() {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] rounded-xl rounded-br-sm bg-muted px-4 py-2.5 text-md leading-relaxed text-foreground">
        <span className="whitespace-pre-wrap">Réponds en français, avec des explications courtes</span>
      </div>
    </div>
  );
}

function Proposal({ orgType }: Pick<Props, 'orgType'>) {
  return (
    <AgentMemoryProposalFrame>
      <AgentMemorySummary value={EXAMPLE} orgType={orgType} variant="proposal" />
      <AgentMemoryProposalActions illustrative />
    </AgentMemoryProposalFrame>
  );
}

/** The example shows the real closed controls; no menu portal or action is mounted. */
function EditingExample({ orgType, hasProject, keepScale }: Pick<Props, 'orgType' | 'hasProject'> & { keepScale: MotionValue<number> }) {
  const id = useId();
  const levels = [
    agentMemoryScopeLabel('organization', orgType),
    ...(hasProject ? [agentMemoryScopeLabel('project', orgType)] : []),
    agentMemoryScopeLabel('user', orgType),
  ].join(', ');
  return (
    <AgentMemoryProposalFrame>
      <p className="text-sm">{EXAMPLE.content}</p>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-scope`} className="block">Niveau</Label>
        <Select value="user" open={false}>
          <SelectTrigger id={`${id}-scope`} data-memory-scope="true" tabIndex={-1} className="min-h-11 md:min-h-0">
            <SelectValue>{agentMemoryScopeLabel('user', orgType)}</SelectValue>
          </SelectTrigger>
        </Select>
        <p className="text-xs text-muted-foreground">Choix : {levels}.</p>
      </div>
      <Button asChild size="sm" variant="primary" className="min-h-11 max-w-full whitespace-normal md:min-h-0">
        <motion.span data-memory-keep="true" style={{ scale: keepScale }}>
          <Check aria-hidden="true" className="h-3.5 w-3.5" />Garder les modifications
        </motion.span>
      </Button>
    </AgentMemoryProposalFrame>
  );
}

function ConfirmedExample({ orgType, check }: Pick<Props, 'orgType'> & { check: ReactNode }) {
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

/** Overlaid grid items reserve their largest natural height without adding a stage surface. */
function AnimatedState({ state, phase, progress, children }: Pick<Props, 'phase' | 'progress'> & {
  state: Props['phase']; children: ReactNode;
}) {
  const start = [0, 0.2, 0.44, 0.78][state];
  const end = [0.2, 0.44, 0.78, 1][state];
  const input = state === 0 ? [0, end, end + TRANSITION, 1]
    : state === 3 ? [0, start, start + TRANSITION, 1]
      : [0, start, start + TRANSITION, end, end + TRANSITION, 1];
  const opacity = useTransform(progress, input, state === 0 ? [1, 1, 0, 0]
    : state === 3 ? [0, 0, 1, 1] : [0, 0, 1, 1, 0, 0], { ease: easeOut });
  const y = useTransform(progress, input, state === 0 ? [0, 0, -4, -4]
    : state === 3 ? [4, 4, 0, 0] : [4, 4, 0, 0, -4, -4], { ease: easeOut });
  return (
    <motion.div data-memory-ticket={phase === state ? 'true' : undefined}
      className="col-start-1 row-start-1 min-w-0 self-start" style={{ opacity, y }}>
      {children}
    </motion.div>
  );
}

function AnimatedScene({ phase, progress, orgType, hasProject }: Omit<Props, 'reducedMotion'>) {
  const keepScale = useTransform(progress, [0, 0.72, 0.72 + TRANSITION, 0.755, 0.755 + TRANSITION, 1], [1, 1, 0.98, 0.98, 1, 1]);
  const checkPath = useTransform(progress, [0, 0.78 + TRANSITION, 0.78 + TRANSITION * 2, 1], [0, 0, 1, 1]);
  const checkVisible = useTransform(checkPath, (length) => length > 0 ? 1 : 0);
  return (
    <div ref={makeSceneInert} data-memory-scene="animated" aria-hidden="true"
      className="pointer-events-none grid [&_*]:transition-none">
      <AnimatedState state={0} phase={phase} progress={progress}><Conversation /></AnimatedState>
      <AnimatedState state={1} phase={phase} progress={progress}><Proposal orgType={orgType} /></AnimatedState>
      <AnimatedState state={2} phase={phase} progress={progress}><EditingExample orgType={orgType} hasProject={hasProject} keepScale={keepScale} /></AnimatedState>
      <AnimatedState state={3} phase={phase} progress={progress}>
        <ConfirmedExample orgType={orgType} check={<svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0 text-success">
          <motion.path d={CHECK_PATH} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ pathLength: checkPath, opacity: checkVisible }} />
        </svg>} />
      </AnimatedState>
    </div>
  );
}

export function AgentMemoryMotionScene({ reducedMotion, ...props }: Props) {
  if (!reducedMotion) return <AnimatedScene {...props} />;
  return (
    <div ref={makeSceneInert} data-memory-scene="static" aria-hidden="true" className="pointer-events-none [&_*]:transition-none">
      <div data-memory-ticket="true">
        <ConfirmedExample orgType={props.orgType} check={<Check className="h-4 w-4 shrink-0 text-success" />} />
      </div>
    </div>
  );
}
