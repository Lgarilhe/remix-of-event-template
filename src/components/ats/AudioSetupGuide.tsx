/**
 * Guide de configuration audio de l'assistant d'entretien : selon la situation
 * (visio dans le navigateur, application installée, sur place), ce qu'il faut
 * choisir pour que la transcription reçoive les deux voix. « Compris » ferme le guide ; seul « Démarrer
 * l'enregistrement » lance l'enregistrement (revue design E-09).
 */

import React, { useEffect, useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, Headphones, Info, Monitor, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type AudioScenario = 'visio_browser' | 'visio_app' | 'in_person';

const SCENARIOS = [
  {
    key: 'visio_browser' as const,
    icon: Headphones,
    label: 'Visio dans le navigateur',
    description: 'Google Meet ou Teams dans un onglet Chrome ou Edge, avec ou sans casque',
    capturesBoth: true,
    steps: [
      { text: "Choisissez « Visio ou appel », puis « Démarrer l'enregistrement ».", important: false },
      { text: "Dans la fenêtre de partage du navigateur, choisissez l'onglet de la visio.", important: true },
      { text: "Cochez « Partager aussi l'audio de l'onglet ».", important: true },
      {
        text: "Votre micro et l'audio de la visio sont transcrits séparément\u00a0: chaque voix est attribuée sans confusion, même avec un casque.",
        important: false,
      },
    ],
  },
  {
    key: 'visio_app' as const,
    icon: Monitor,
    label: 'Application installée ou téléphonie en ligne',
    description: 'Teams, Zoom ou Aircall installés sur l\u2019ordinateur',
    capturesBoth: false,
    steps: [
      { text: "Choisissez « Visio ou appel », puis « Démarrer l'enregistrement ».", important: false },
      { text: "Dans la fenêtre de partage du navigateur, ouvrez « Écran entier » et choisissez votre écran.", important: true },
      { text: "Cochez « Partager aussi l'audio du système ».", important: true },
      { text: "Cette option n'existe que sous Windows. Sous macOS, ouvrez la visio ou l'appel dans un onglet Chrome ou Edge.", important: false },
    ],
    alternativeTitle: 'Appel passé depuis un téléphone',
    alternative:
      "Le son d'un téléphone n'entre pas dans l'ordinateur\u00a0: mettez-le sur haut-parleur près du micro et choisissez « Sur place ».",
  },
  {
    key: 'in_person' as const,
    icon: Users,
    label: 'Sur place, ou téléphone sur haut-parleur',
    description: 'Le candidat est dans la même pièce, ou sur un téléphone posé près de vous',
    capturesBoth: true,
    steps: [
      { text: "Choisissez « Sur place », puis « Démarrer l'enregistrement ».", important: false },
      { text: "Le micro de l'ordinateur capte les deux voix\u00a0: placez l'ordinateur entre vous et le candidat.", important: true },
      { text: 'Choisissez de préférence un bureau fermé, pour limiter le bruit.', important: false },
      { text: "Prévenez le candidat que l'entretien est transcrit et analysé par l'IA Konekt.", important: true },
    ],
  },
];

interface AudioSetupGuideProps {
  /** Le guide est lu (« Compris », « Passer le guide »). */
  onReady?: () => void;
  /** Le guide est fermé par sa croix. */
  onDismiss?: () => void;
  compact?: boolean;
}

export const AudioSetupGuide: React.FC<AudioSetupGuideProps> = ({ onReady, onDismiss, compact = false }) => {
  const baseId = useId();
  const [selectedScenario, setSelectedScenario] = useState<AudioScenario | ''>('');
  const [dismissed, setDismissed] = useState(() => {
    try {
      return sessionStorage.getItem('audio-guide-dismissed') === '1';
    } catch {
      return false;
    }
  });

  // Micro détecté : un casque ne capte que la voix de la personne qui le porte.
  const [hasHeadset, setHasHeadset] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then((devices) => {
      const audioInputs = devices.filter((d) => d.kind === 'audioinput');
      const hasExternal = audioInputs.some((d) => {
        const label = d.label.toLowerCase();
        return ['headset', 'airpods', 'jabra', 'plantronics', 'usb', 'bluetooth'].some((word) => label.includes(word));
      });
      setHasHeadset(hasExternal);
    }).catch(() => setHasHeadset(null));
  }, []);

  if (dismissed && compact) return null;

  const scenario = SCENARIOS.find((s) => s.key === selectedScenario);
  const titleId = `${baseId}-titre`;
  const situationId = `${baseId}-situation`;

  return (
    <section aria-labelledby={titleId} className="space-y-4 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <h4 id={titleId} className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <Info className="h-4 w-4 shrink-0" aria-hidden="true" />
          Configuration audio
        </h4>
        {onDismiss && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Fermer le guide"
                onClick={() => {
                  setDismissed(true);
                  try {
                    sessionStorage.setItem('audio-guide-dismissed', '1');
                  } catch { /* stockage indisponible */ }
                  onDismiss();
                }}
                className="max-md:h-11 max-md:w-11"
              >
                <X aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Fermer le guide</TooltipContent>
          </Tooltip>
        )}
      </div>

      {hasHeadset !== null && (
        <p
          className={cn(
            'flex items-start gap-2 rounded-lg border px-3 py-2 text-xs',
            hasHeadset ? 'border-warning/30 bg-warning-muted text-foreground' : 'border-border bg-muted text-foreground-secondary',
          )}
        >
          {hasHeadset ? (
            <>
              <Headphones className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
              Casque détecté&nbsp;: en visio, choisissez « Visio ou appel » pour capter aussi la voix du candidat.
            </>
          ) : (
            <>
              <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden="true" />
              Micro intégré détecté&nbsp;: en visio, un casque avec micro améliore nettement la transcription de votre voix.
            </>
          )}
        </p>
      )}

      <div className="space-y-2">
        <p id={situationId} className="eyebrow">Votre situation</p>
        <ToggleGroup
          type="single"
          role="radiogroup"
          aria-labelledby={situationId}
          variant="outline"
          value={selectedScenario}
          onValueChange={(value) => setSelectedScenario((value || '') as AudioScenario | '')}
          className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-1"
        >
          {SCENARIOS.map((s) => (
            <ToggleGroupItem
              key={s.key}
              value={s.key}
              className="h-auto items-start justify-start gap-2 p-3 text-left font-normal data-[state=on]:border-foreground data-[state=on]:bg-accent"
            >
              <s.icon className="mt-0.5 h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block text-sm font-semibold text-foreground">{s.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{s.description}</span>
              </span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      {scenario && (
        <div className="space-y-3">
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            {scenario.capturesBoth ? (
              <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-hidden="true" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            )}
            {scenario.capturesBoth ? 'Les deux voix seront captées' : 'Un réglage est nécessaire pour capter les deux voix'}
          </p>

          <ol className="space-y-1.5">
            {scenario.steps.map((step, i) => (
              <li
                key={i}
                className={cn(
                  'flex items-start gap-2 rounded-lg px-3 py-2 text-xs',
                  step.important ? 'border border-border-strong bg-muted font-medium text-foreground' : 'text-foreground-secondary',
                )}
              >
                <span className="w-4 shrink-0 text-center font-semibold tabular-nums text-foreground">{i + 1}</span>
                {step.text}
              </li>
            ))}
          </ol>

          {scenario.alternative && (
            <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-foreground-secondary">
              <p className="mb-0.5 font-semibold text-foreground">{scenario.alternativeTitle}</p>
              {scenario.alternative}
            </div>
          )}

          {onReady && (
            <Button variant="outline" onClick={onReady} className="w-full max-md:min-h-11">
              Compris
            </Button>
          )}
        </div>
      )}

      {!scenario && onReady && (
        <Button variant="ghost" size="sm" onClick={onReady} className="w-full max-md:min-h-11">
          Passer le guide
        </Button>
      )}
    </section>
  );
};
