import React from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Palette, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AITone = 'formal' | 'casual' | 'direct' | 'empathetic';

interface ToneSelectorProps {
  selectedTone: AITone;
  onToneChange: (tone: AITone) => void;
  className?: string;
}

const toneOptions: Array<{
  value: AITone;
  label: string;
  description: string;
  emoji: string;
}> = [
  {
    value: 'formal',
    label: 'Formel',
    description: 'Professionnel et structuré',
    emoji: '👔',
  },
  {
    value: 'casual',
    label: 'Décontracté',
    description: 'Friendly et accessible',
    emoji: '😊',
  },
  {
    value: 'direct',
    label: 'Direct',
    description: 'Concis et efficace',
    emoji: '🎯',
  },
  {
    value: 'empathetic',
    label: 'Empathique',
    description: 'Chaleureux et à l\'écoute',
    emoji: '💬',
  },
];

export const ToneSelector: React.FC<ToneSelectorProps> = ({
  selectedTone,
  onToneChange,
  className,
}) => {
  const selectedOption = toneOptions.find(t => t.value === selectedTone);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-7 px-2 gap-1.5 text-xs text-muted-foreground hover:text-foreground",
            className
          )}
        >
          <span className="text-sm">{selectedOption?.emoji}</span>
          <span className="hidden sm:inline">{selectedOption?.label}</span>
          <Palette className="w-3 h-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-2" align="start">
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground px-2 pb-1">
            Ton des réponses IA
          </p>
          {toneOptions.map((option) => (
            <button
              key={option.value}
              onClick={() => onToneChange(option.value)}
              className={cn(
                "w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors",
                selectedTone === option.value
                  ? "bg-primary/10 text-primary"
                  : "hover:bg-muted"
              )}
            >
              <span className="text-lg">{option.emoji}</span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{option.label}</p>
                <p className="text-[10px] text-muted-foreground">{option.description}</p>
              </div>
              {selectedTone === option.value && (
                <Check className="w-4 h-4 text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
};

// Utility to get tone instructions for AI prompts
export function getToneInstructions(tone: AITone): string {
  switch (tone) {
    case 'formal':
      return `TON: Formel et professionnel
- Vouvoiement systématique
- Structure claire et organisée
- Vocabulaire précis et technique si pertinent
- Formules de politesse appropriées`;
    case 'casual':
      return `TON: Décontracté et friendly
- Tutoiement naturel
- Style conversationnel et léger
- Emojis modérés autorisés (1 max)
- Ambiance startup / tech`;
    case 'direct':
      return `TON: Direct et efficace
- Phrases courtes et impactantes
- Aller droit au but
- Éviter les formules superflues
- Focus sur l'action et les prochaines étapes`;
    case 'empathetic':
      return `TON: Empathique et chaleureux
- Montrer de l'intérêt pour la personne
- Reconnaître ses préoccupations
- Proposer du support et de l'accompagnement
- Créer un lien humain avant le business`;
    default:
      return '';
  }
}
