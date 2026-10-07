import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Brain, Check, MessageSquare, RotateCcw } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { agentMemoryScopeLabel } from '@/types/agentMemory';

interface Props {
  orgType: 'agency' | 'enterprise' | 'freelance' | null;
  hasProject: boolean;
  onDone: () => void;
  onSkip: () => void;
}

type Phase = 0 | 1 | 2 | 3;
const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const TIMELINE: ReadonlyArray<readonly [number, Phase]> = [[1100, 1], [2400, 2], [3900, 3]];

/** Decorative example only: no live proposal, permission change or memory write. */
function MemoryExample({ phase, orgType, hasProject }: Pick<Props, 'orgType' | 'hasProject'> & { phase: Phase }) {
  if (phase === 0) return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium"><MessageSquare className="h-4 w-4" />Dans la conversation</div>
      <p className="rounded-lg bg-muted p-3 text-sm">« Réponds en français, avec des explications courtes. »</p>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium"><Brain className="h-4 w-4" />{phase === 3 ? 'Préférence confirmée' : 'À garder en mémoire ?'}</div>
      <p className="text-sm">Répondre en français, avec des explications courtes.</p>
      {phase === 1 ? <Badge variant="muted">Proposition à confirmer</Badge> : (
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={phase === 2 ? 'brand' : 'muted'}>{agentMemoryScopeLabel('user', orgType)}</Badge>
          {phase === 2 && <>
            {hasProject && <Badge variant="muted">{agentMemoryScopeLabel('project', orgType)}</Badge>}
            <Badge variant="muted">{agentMemoryScopeLabel('organization', orgType)}</Badge>
          </>}
          {phase === 3 && <Badge variant="success"><Check className="h-3.5 w-3.5" />Confirmée</Badge>}
        </div>
      )}
    </div>
  );
}

/** One 4.12-second demonstration, frozen afterward; the explanation stays readable throughout. */
export function AgentMemoryIntro({ orgType, hasProject, onDone, onSkip }: Props) {
  const motionPreference = useReducedMotion();
  const [liveReducedMotion, setLiveReducedMotion] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const reducedMotion = motionPreference !== false || liveReducedMotion;
  const [phase, setPhase] = useState<Phase>(reducedMotion ? 3 : 0);
  const [replay, setReplay] = useState(0);

  // The installed Motion hook captures the initial preference; listen for later changes as well.
  useEffect(() => {
    if (!window.matchMedia) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setLiveReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (reducedMotion || document.visibilityState === 'hidden') {
      setPhase(3);
      return;
    }
    setPhase(0);
    const timers = TIMELINE.map(([delay, next]) => window.setTimeout(() => setPhase(next), delay));
    const stop = () => {
      timers.forEach(window.clearTimeout);
      setPhase(3);
    };
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') stop(); };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      timers.forEach(window.clearTimeout);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [reducedMotion, replay]);

  const organizationLevel = orgType === 'agency' ? 'votre cabinet' : orgType === 'enterprise'
    ? 'votre entreprise' : orgType === 'freelance' ? 'votre activité' : 'votre organisation';
  const projectLevel = orgType === 'enterprise' ? 'ce poste' : 'cette mission';

  return (
    <section aria-label="Découvrir la mémoire" className="flex min-h-0 flex-1 flex-col gap-3">
      <div role="region" aria-label="Exemple et explication de la mémoire" tabIndex={0}
        className="min-h-0 space-y-3 overflow-y-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="muted">Exemple</Badge>
        <Button type="button" variant="ghost" size="sm" className="min-h-11 md:min-h-0" disabled={reducedMotion}
          aria-label="Rejouer l’exemple de fonctionnement" onClick={() => setReplay((current) => current + 1)}>
          <RotateCcw aria-hidden="true" className="h-4 w-4" />Rejouer
        </Button>
      </div>
      <Card aria-hidden="true" className="overflow-hidden">
        <div className="min-h-44 p-3">
          {reducedMotion ? <MemoryExample phase={3} orgType={orgType} hasProject={hasProject} /> : (
            <motion.div key={`${replay}:${phase}`} initial={phase === 0 ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE_OUT }}>
              <MemoryExample phase={phase} orgType={orgType} hasProject={hasProject} />
            </motion.div>
          )}
        </div>
      </Card>
      {reducedMotion && <p className="text-xs text-muted-foreground">Exemple fixe, animations réduites.</p>}
      <ol className="list-decimal space-y-2 pl-5 text-sm text-foreground-secondary">
        <li>L’assistant repère une consigne. Relisez, modifiez ou ignorez sa proposition.</li>
        <li>Choisissez le niveau : pour vous{hasProject ? `, pour ${projectLevel}` : ''} ou pour {organizationLevel}.</li>
        <li>Confirmez pour l’appliquer. Vous pourrez ensuite la désactiver.</li>
      </ol>
      <p className="text-sm text-foreground-secondary">Vos préférences de langue, de longueur et de format peuvent devenir automatiques si vous l’activez. Les critères de recrutement restent à confirmer.</p>
      </div>
      <div className="flex shrink-0 flex-col gap-2 border-t border-border pt-3 sm:flex-row-reverse sm:items-center">
        <Button type="button" variant="primary" className="h-auto min-h-11 whitespace-normal py-2 md:min-h-9" onClick={onDone}>Compris, ouvrir mes mémoires</Button>
        <Button type="button" variant="ghost" className="min-h-11 md:min-h-9" onClick={onSkip}>Passer</Button>
      </div>
    </section>
  );
}
