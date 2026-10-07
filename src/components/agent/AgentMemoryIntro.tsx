import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useMotionValueEvent } from 'framer-motion';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogFooter } from '@/components/ui/dialog';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { agentMemoryScopeLabel } from '@/types/agentMemory';
import { AgentMemoryMotionScene } from './AgentMemoryMotionScene';

interface Props {
  orgType: 'agency' | 'enterprise' | 'freelance' | null;
  hasProject: boolean;
  onDone: () => void;
  onSkip: () => void;
}

type Phase = 0 | 1 | 2 | 3;
type PlaybackState = 'playing' | 'paused' | 'completed';
const CHAPTERS = [
  'Dans la conversation',
  'Une proposition à relire',
  'Modifier le niveau',
  'Une mémoire confirmée',
] as const;
const phaseAt = (progress: number): Phase => progress < 0.20 ? 0 : progress < 0.44 ? 1 : progress < 0.78 ? 2 : 3;

/** A single shared clock drives every movement, so pausing freezes the entire example. */
export function AgentMemoryIntro({ orgType, hasProject, onDone, onSkip }: Props) {
  const [reducedMotion, setReducedMotion] = useState(() =>
    typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [phase, setPhase] = useState<Phase>(reducedMotion ? 3 : 0);
  const [playbackState, setPlaybackState] = useState<PlaybackState>(reducedMotion ? 'completed' : 'playing');
  const [replay, setReplay] = useState(0);
  const progress = useMotionValue(reducedMotion ? 1 : 0);
  const playback = useRef<ReturnType<typeof animate> | null>(null);
  useMotionValueEvent(progress, 'change', (value) => {
    const next = phaseAt(value);
    if (next !== phase) setPhase(next);
  });

  // Follow the current preference in both directions, including while the example is open.
  useEffect(() => {
    if (!window.matchMedia) return;
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener('change', update);
    return () => preference.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (reducedMotion) {
      progress.set(1);
      setPhase(3);
      setPlaybackState('completed');
      return;
    }
    progress.set(0);
    setPhase(0);
    setPlaybackState('playing');
    const controls = animate(progress, 1, {
      duration: 9,
      ease: 'linear',
      onComplete: () => setPlaybackState('completed'),
    });
    playback.current = controls;
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden' && progress.get() < 1) {
        controls.pause();
        setPlaybackState('paused');
      }
    };
    onVisibilityChange();
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      controls.stop();
      if (playback.current === controls) playback.current = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [reducedMotion, replay, progress]);

  const restart = () => {
    playback.current?.stop();
    progress.set(0);
    setPhase(0);
    setReplay((current) => current + 1);
  };
  const togglePlayback = () => {
    if (playbackState === 'completed') restart();
    else if (playbackState === 'paused') {
      playback.current?.play();
      setPlaybackState('playing');
    } else {
      playback.current?.pause();
      setPlaybackState('paused');
    }
  };
  const playbackLabel = playbackState === 'playing' ? 'Pause' : playbackState === 'paused' ? 'Reprendre' : 'Lire';
  const levels = [
    agentMemoryScopeLabel('user', orgType),
    ...(hasProject ? [agentMemoryScopeLabel('project', orgType)] : []),
    agentMemoryScopeLabel('organization', orgType),
  ].join(' », « ');
  return (
    <section aria-label="Découvrir la mémoire" className="flex min-h-0 flex-1 flex-col gap-4">
      <div role="region" aria-label="Exemple et explication de la mémoire" tabIndex={0}
        className="min-h-0 space-y-3 overflow-y-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset">
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-muted-foreground">{reducedMotion ? 'Exemple fixe' : 'Exemple'}</span>
          <div className="flex items-center gap-1">
            <Button type="button" variant={playbackState === 'playing' || reducedMotion ? 'ghost' : 'secondary'} size="sm"
              className={`min-h-11 md:min-h-0 ${playbackState === 'playing' ? 'text-muted-foreground' : ''}`} disabled={reducedMotion}
              aria-label={playbackState === 'completed' ? 'Lire l’animation' : playbackLabel}
              aria-pressed={playbackState === 'completed' ? undefined : playbackState === 'paused'} onClick={togglePlayback}>
              {playbackState === 'playing' ? <Pause aria-hidden="true" className="h-4 w-4" /> : <Play aria-hidden="true" className="h-4 w-4" />}
              {playbackLabel}
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button type="button" variant="ghost" size="icon-sm" className="min-h-11 min-w-11 md:min-h-0 md:min-w-0" disabled={reducedMotion}
                  aria-label="Rejouer l’exemple de fonctionnement" onClick={restart}>
                  <RotateCcw aria-hidden="true" className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Rejouer l’exemple</TooltipContent>
            </Tooltip>
          </div>
        </div>
        <div aria-hidden="true" className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium">{CHAPTERS[phase]}</p>
            <span className="shrink-0 text-xs text-muted-foreground">{phase + 1}/4</span>
          </div>
          <div className="h-0.5 overflow-hidden bg-border">
            {reducedMotion ? <div className="h-full w-full bg-foreground" /> : <motion.div className="h-full w-full bg-foreground" style={{ scaleX: progress, transformOrigin: 'left' }} />}
          </div>
        </div>
        <AgentMemoryMotionScene phase={phase} progress={progress} reducedMotion={reducedMotion} orgType={orgType} hasProject={hasProject} />
        <p className="sr-only">Relisez la proposition. Modifier permet de choisir le niveau « {levels} », selon vos droits. « Pour moi » garde vos préférences personnelles dans cet espace. Confirmez pour appliquer la consigne, ou ignorez-la. Vous pourrez désactiver une mémoire à tout moment.</p>
        {reducedMotion && <p className="text-xs text-muted-foreground">Les animations sont réduites sur votre appareil.</p>}
        <p className="text-sm text-foreground-secondary">L’ajout automatique est optionnel, pour la langue, la longueur et le format. Les critères de recrutement restent à confirmer.</p>
      </div>
      <DialogFooter className="shrink-0 border-t border-border pt-4">
        <Button type="button" variant="ghost" className="min-h-11 md:min-h-9" onClick={onSkip}>Passer</Button>
        <Button type="button" variant="primary" className="min-h-11 md:min-h-9" onClick={onDone}>Ouvrir les mémoires</Button>
      </DialogFooter>
    </section>
  );
}
