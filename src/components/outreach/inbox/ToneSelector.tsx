import React from 'react';
import { MessageSquareQuote } from 'lucide-react';
import {
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

export type AITone = 'formal' | 'casual' | 'direct' | 'empathetic';

/**
 * Tons des réponses proposées par l'IA dans la messagerie (les séquences ont
 * les leurs, dans `src/lib/sequenceCatalog.ts`). Un mot et une phrase, sans
 * emoji (revue design D-70).
 */
const AI_TONES: Array<{ value: AITone; label: string; description: string }> = [
  { value: 'formal', label: 'Formel', description: 'Professionnel et structuré' },
  { value: 'casual', label: 'Décontracté', description: 'Amical et accessible' },
  { value: 'direct', label: 'Direct', description: 'Concis et efficace' },
  { value: 'empathetic', label: 'Empathique', description: "Chaleureux et à l'écoute" },
];

interface ToneSelectorProps {
  selectedTone: AITone;
  onToneChange: (tone: AITone) => void;
  className?: string;
}

/**
 * Choix du ton, en sous-menu du menu « Plus d'actions » de la conversation :
 * au clavier (flèches) comme au doigt.
 */
export const ToneSelector: React.FC<ToneSelectorProps> = ({ selectedTone, onToneChange, className }) => {
  const selected = AI_TONES.find((t) => t.value === selectedTone);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={className}>
        <MessageSquareQuote className="mr-2 h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="flex-1 whitespace-nowrap">Ton des réponses IA</span>
        {selected && <span className="ml-3 whitespace-nowrap text-xs text-muted-foreground">{selected.label}</span>}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        <DropdownMenuRadioGroup value={selectedTone} onValueChange={(value) => onToneChange(value as AITone)}>
          {AI_TONES.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value} className="min-h-11 md:min-h-0">
              <span className="flex flex-col">
                <span className="text-sm text-foreground">{option.label}</span>
                <span className="text-xs text-muted-foreground">{option.description}</span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
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
