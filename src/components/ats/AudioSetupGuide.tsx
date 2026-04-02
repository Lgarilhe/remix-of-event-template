import React, { useState, useEffect } from 'react';
import { Headphones, Monitor, Users, ChevronDown, CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '@/lib/utils';

type AudioScenario = 'visio_headset' | 'visio_speaker' | 'phone_headset' | 'in_person' | null;

const SCENARIOS = [
  {
    key: 'visio_headset' as const,
    icon: Headphones,
    label: 'Visio + casque',
    description: 'Google Meet, Teams, Zoom avec casque audio',
    capturesBoth: false,
    steps: [
      { text: 'Avant de lancer le coaching, partagez l\'onglet de votre visio dans Chrome', important: true },
      { text: 'Cliquez "Partager l\'écran" → sélectionnez l\'onglet de la visio', important: false },
      { text: 'Cochez "Partager aussi l\'audio de l\'onglet"', important: true },
      { text: 'Deepgram recevra les 2 voix : votre micro + l\'audio de la visio', important: false },
    ],
    alternativeTitle: 'Alternative : mixeur audio virtuel',
    alternative: 'Installez VB-Cable (Windows) ou BlackHole (Mac) pour mixer automatiquement le micro et la sortie audio. Configuration unique de 5 min.',
  },
  {
    key: 'visio_speaker' as const,
    icon: Monitor,
    label: 'Visio en salle',
    description: 'Visio sur écran avec haut-parleurs (salle de réunion)',
    capturesBoth: true,
    steps: [
      { text: 'Le micro du PC captera les 2 voix automatiquement', important: false },
      { text: 'Placez le PC à proximité pour une meilleure qualité', important: true },
      { text: 'Évitez les bruits de fond (fenêtres, ventilation)', important: false },
    ],
  },
  {
    key: 'phone_headset' as const,
    icon: Headphones,
    label: 'Téléphone + casque',
    description: 'Aircall, Ringover ou autre téléphonie IP avec casque',
    capturesBoth: false,
    steps: [
      { text: 'Le micro du casque captera votre voix uniquement', important: false },
      { text: 'Pour capter aussi le candidat, activez le haut-parleur sur votre softphone', important: true },
      { text: 'Ou utilisez la fonction "Enregistrement d\'appel" de votre téléphonie', important: false },
      { text: 'L\'enregistrement pourra être transcrit après l\'appel', important: false },
    ],
    alternativeTitle: 'Astuce : Aircall',
    alternative: 'Si vous utilisez Aircall, les appels sont enregistrés automatiquement. Skalr peut récupérer le transcript après l\'appel via l\'intégration Aircall.',
  },
  {
    key: 'in_person' as const,
    icon: Users,
    label: 'Entretien sur place',
    description: 'Le candidat est physiquement présent',
    capturesBoth: true,
    steps: [
      { text: 'Le micro du PC captera les 2 voix dans la pièce', important: false },
      { text: 'Placez le PC entre vous et le candidat', important: true },
      { text: 'Idéalement en bureau fermé pour limiter le bruit', important: false },
      { text: 'Prévenez le candidat que l\'entretien est assisté par IA (transparence)', important: true },
    ],
  },
];

interface AudioSetupGuideProps {
  onReady?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}

export const AudioSetupGuide: React.FC<AudioSetupGuideProps> = ({ onReady, onDismiss, compact = false }) => {
  const [selectedScenario, setSelectedScenario] = useState<AudioScenario>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    return sessionStorage.getItem('audio-guide-dismissed') === '1';
  });

  // Detect audio devices
  const [hasHeadset, setHasHeadset] = useState<boolean | null>(null);
  useEffect(() => {
    navigator.mediaDevices?.enumerateDevices().then(devices => {
      const audioInputs = devices.filter(d => d.kind === 'audioinput');
      const hasExternal = audioInputs.some(d =>
        d.label.toLowerCase().includes('headset') ||
        d.label.toLowerCase().includes('airpods') ||
        d.label.toLowerCase().includes('jabra') ||
        d.label.toLowerCase().includes('plantronics') ||
        d.label.toLowerCase().includes('usb') ||
        d.label.toLowerCase().includes('bluetooth')
      );
      setHasHeadset(hasExternal);
    }).catch(() => setHasHeadset(null));
  }, []);

  if (dismissed && compact) return null;

  const scenario = SCENARIOS.find(s => s.key === selectedScenario);

  return (
    <div className="border border-border p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Info className="w-4 h-4 text-foreground" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-foreground">Configuration audio</h3>
        </div>
        {onDismiss && (
          <button
            onClick={() => {
              setDismissed(true);
              sessionStorage.setItem('audio-guide-dismissed', '1');
              onDismiss();
            }}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Auto-detection hint */}
      {hasHeadset !== null && (
        <div className={cn(
          "flex items-center gap-2 px-3 py-2 text-xs border",
          hasHeadset
            ? "border-amber-400/50 bg-amber-50/30 text-amber-700"
            : "border-border text-muted-foreground"
        )}>
          {hasHeadset ? (
            <>
              <Headphones className="w-3.5 h-3.5" />
              Casque détecté — consultez les instructions pour capter les 2 voix
            </>
          ) : (
            <>
              <Monitor className="w-3.5 h-3.5" />
              Micro intégré détecté — les 2 voix seront captées automatiquement
            </>
          )}
        </div>
      )}

      {/* Scenario selector */}
      <div>
        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-2">Votre situation</p>
        <div className="grid grid-cols-2 gap-2">
          {SCENARIOS.map(s => (
            <button
              key={s.key}
              onClick={() => setSelectedScenario(s.key)}
              className={cn(
                "flex items-start gap-2 p-3 text-left border transition-all",
                selectedScenario === s.key
                  ? "border-border bg-accent/50"
                  : "border-border hover:border-border"
              )}
            >
              <s.icon className="w-4 h-4 text-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold uppercase tracking-wider text-foreground">{s.label}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{s.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Selected scenario steps */}
      {scenario && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {scenario.capturesBoth ? (
              <CheckCircle2 className="w-4 h-4 text-foreground" />
            ) : (
              <AlertTriangle className="w-4 h-4 text-amber-600" />
            )}
            <p className="text-xs font-bold uppercase tracking-wider text-foreground">
              {scenario.capturesBoth
                ? 'Les 2 voix seront captées automatiquement'
                : 'Configuration nécessaire pour capter les 2 voix'}
            </p>
          </div>

          <div className="space-y-1.5">
            {scenario.steps.map((step, i) => (
              <div key={i} className={cn(
                "flex items-start gap-2 px-3 py-2 text-xs",
                step.important ? "border border-border bg-accent/50 font-medium text-foreground" : "text-muted-foreground"
              )}>
                <span className="shrink-0 w-4 text-center font-bold text-foreground">{i + 1}</span>
                {step.text}
              </div>
            ))}
          </div>

          {scenario.alternative && (
            <div className="px-3 py-2 border border-dashed border-border text-xs text-muted-foreground">
              <p className="font-bold text-foreground mb-0.5">{scenario.alternativeTitle}</p>
              {scenario.alternative}
            </div>
          )}

          {/* Ready button */}
          {onReady && (
            <button
              onClick={() => {
                setAcknowledged(true);
                onReady();
              }}
              className="relative overflow-hidden w-full h-[36px] bg-foreground text-background border border-border text-xs font-bold uppercase tracking-wider group"
            >
              <span className="relative z-10">J'ai compris — lancer le coaching</span>
            </button>
          )}
        </div>
      )}

      {/* Quick start without selecting */}
      {!scenario && onReady && (
        <button
          onClick={onReady}
          className="w-full h-[34px] text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground hover:text-foreground hover:border-border transition-colors"
        >
          Passer — je connais ma config
        </button>
      )}
    </div>
  );
};
