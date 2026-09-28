/**
 * Guide de configuration audio de l'assistant d'entretien : selon la situation
 * (visio, téléphone, sur place), ce qu'il faut régler pour que la transcription
 * reçoive les deux voix. « Compris » ferme le guide ; seul « Démarrer
 * l'enregistrement » lance l'enregistrement (revue design E-09).
 */

import React, { useEffect, useId, useState } from 'react';
import { AlertTriangle, CheckCircle2, Headphones, Info, Monitor, Users, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

type AudioScenario = 'visio_headset' | 'visio_speaker' | 'phone_headset' | 'in_person';

const SCENARIOS = [
  {
    key: 'visio_headset' as const,
    icon: Headphones,
    label: 'Visio + casque',
    description: 'Google Meet, Teams ou Zoom, avec un casque audio',
    capturesBoth: false,
    steps: [
      { text: "Avant de démarrer, partagez l'onglet de votre visio dans Chrome.", important: true },
      { text: "Cliquez sur « Partager l'écran », puis choisissez l'onglet de la visio.", important: false },
      { text: "Cochez « Partager aussi l'audio de l'onglet ».", important: true },
      { text: "Le service de transcription reçoit alors les deux voix\u00a0: votre micro et l'audio de la visio.", important: false },
    ],
    alternativeTitle: 'Autre solution\u00a0: un mixeur audio virtuel',
    alternative:
      'Installez VB-Cable (Windows) ou BlackHole (Mac) pour mélanger automatiquement le micro et la sortie audio. Réglage unique, cinq minutes environ.',
  },
  {
    key: 'visio_speaker' as const,
    icon: Monitor,
    label: 'Visio en salle',
    description: 'Visio sur écran avec haut-parleurs (salle de réunion)',
    capturesBoth: true,
    steps: [
      { text: "Le micro de l'ordinateur capte les deux voix.", important: false },
      { text: "Placez l'ordinateur près de vous pour une meilleure qualité.", important: true },
      { text: 'Évitez les bruits de fond (fenêtres, ventilation).', important: false },
    ],
  },
  {
    key: 'phone_headset' as const,
    icon: Headphones,
    label: 'Téléphone + casque',
    description: 'Aircall, Ringover ou autre téléphonie en ligne, avec un casque',
    capturesBoth: false,
    steps: [
      { text: 'Le micro du casque capte seulement votre voix.', important: false },
      { text: 'Pour capter aussi le candidat, activez le haut-parleur de votre téléphonie.', important: true },
      { text: "Ou utilisez l'enregistrement d'appel de votre téléphonie.", important: false },
      { text: "L'enregistrement pourra être transcrit après l'appel.", important: false },
    ],
    alternativeTitle: 'Astuce\u00a0: Aircall',
    alternative:
      "Avec Aircall, les appels sont enregistrés automatiquement\u00a0: Konekt peut récupérer la transcription après l'appel grâce à l'intégration Aircall.",
  },
  {
    key: 'in_person' as const,
    icon: Users,
    label: 'Entretien sur place',
    description: 'Le candidat est dans la même pièce que vous',
    capturesBoth: true,
    steps: [
      { text: "Le micro de l'ordinateur capte les deux voix dans la pièce.", important: false },
      { text: "Placez l'ordinateur entre vous et le candidat.", important: true },
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
          <Info className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
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
              Casque détecté&nbsp;: suivez les instructions de votre situation pour capter les deux voix.
            </>
          ) : (
            <>
              <Monitor className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              Micro intégré détecté&nbsp;: les deux voix seront captées.
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
        <Button variant="ghost" size="sm" onClick={onReady} className="w-full text-muted-foreground max-md:min-h-11">
          Passer le guide
        </Button>
      )}
    </section>
  );
};
