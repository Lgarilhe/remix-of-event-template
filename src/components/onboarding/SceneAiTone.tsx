import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2, MessageSquareQuote } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUserAiContext, type AiContextTone } from '@/hooks/useAiContext';

interface Props {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

const TONES: { value: AiContextTone; label: string; description: string; example: string }[] = [
  {
    value: 'tu',
    label: 'Tutoiement',
    description: 'Direct et proche, comme entre collègues.',
    example: '« Salut Marie, ton profil a retenu mon attention pour un poste qui pourrait vraiment te plaire… »',
  },
  {
    value: 'vous',
    label: 'Vouvoiement',
    description: 'Professionnel et respectueux, le classique.',
    example: '« Bonjour Marie, votre parcours a retenu mon attention pour une opportunité à la hauteur de votre expérience… »',
  },
  {
    value: 'casual',
    label: 'Décontracté',
    description: 'Léger et spontané, sans formalisme.',
    example: '« Hello Marie ! Je suis tombé sur ton profil et franchement, il fallait que je t’écrive… »',
  },
  {
    value: 'formal',
    label: 'Formel',
    description: 'Soutenu et institutionnel, pour les profils seniors.',
    example: '« Madame, je me permets de vous contacter au sujet d’une opportunité correspondant à votre expertise… »',
  },
];

/**
 * Étape onboarding : personnalisation du ton de l'IA Konekt.
 * Écrit profiles.ai_context via useUserAiContext (même cible que Réglages > Contexte IA).
 */
export const SceneAiTone: React.FC<Props> = ({ onNext, onBack, onSkip }) => {
  const { aiContext, save, isSaving } = useUserAiContext();
  const [tone, setTone] = useState<AiContextTone | null>(null);
  const [freeText, setFreeText] = useState('');
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    if (aiContext.tone || aiContext.free_text) {
      setTone(aiContext.tone);
      setFreeText(aiContext.free_text);
    }
    setHydrated(true);
  }, [aiContext, hydrated]);

  const selectedTone = TONES.find((t) => t.value === tone);

  const handleSubmit = () => {
    if (!tone) return;
    save({ ...aiContext, tone, free_text: freeText.trim() });
    onNext();
  };

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <h2 className="font-editorial italic text-3xl md:text-4xl">Comment écrivez-vous ?</h2>
        <p className="text-muted-foreground text-sm">
          L’IA Konekt rédige vos messages d’approche. Donnez-lui votre ton — vous pourrez l’ajuster à tout moment dans les Réglages.
        </p>
      </div>

      {/* Tone cards */}
      <div className="grid grid-cols-2 gap-2.5">
        {TONES.map((t, index) => {
          const isSelected = tone === t.value;
          return (
            <motion.button
              key={t.value}
              type="button"
              onClick={() => setTone(t.value)}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 + index * 0.07, duration: 0.35 }}
              whileHover={{ y: -2 }}
              whileTap={{ scale: 0.98 }}
              className={`text-left p-3 border-2 transition-all duration-200 ${
                isSelected ? 'border-border bg-foreground/[0.04]' : 'border-border/60 hover:border-border'
              }`}
              style={isSelected ? { boxShadow: '0 4px 16px hsl(var(--skalr-pink) / 0.15)' } : {}}
              aria-pressed={isSelected}
            >
              <span className="text-sm font-semibold block">{t.label}</span>
              <span className="text-xs text-muted-foreground mt-0.5 block leading-relaxed">{t.description}</span>
            </motion.button>
          );
        })}
      </div>

      {/* Aperçu du ton */}
      <AnimatePresence mode="wait">
        {selectedTone && (
          <motion.div
            key={selectedTone.value}
            initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="border border-border bg-card/60 backdrop-blur-sm p-3.5 flex gap-3"
          >
            <MessageSquareQuote className="w-4 h-4 shrink-0 mt-0.5" style={{ color: 'hsl(var(--skalr-pink))' }} />
            <p className="text-xs text-muted-foreground italic leading-relaxed">{selectedTone.example}</p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Contexte libre */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="space-y-1.5"
      >
        <label htmlFor="aitone-free-text" className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Autre chose à savoir ? <span className="font-normal normal-case">(facultatif)</span>
        </label>
        <Textarea
          id="aitone-free-text"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="Ex : je signe toujours « À très vite », j’évite les emojis, je mentionne le télétravail dès le premier message…"
          maxLength={1000}
          rows={3}
          className="border border-border text-sm resize-none bg-background/60"
        />
      </motion.div>

      {/* Navigation */}
      <motion.div
        className="flex items-center justify-between pt-2"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4 }}
      >
        <Button variant="ghost" onClick={onBack} className="gap-2 text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={onSkip} className="text-sm text-muted-foreground">
            Passer
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!tone || isSaving}
            className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
            style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Suivant
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
