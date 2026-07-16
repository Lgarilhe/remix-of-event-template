import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useUserAiContext, type AiContextTone } from '@/hooks/useAiContext';
import { EditorialChoiceList } from './EditorialChoiceList';
import { cn } from '@/lib/utils';

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
    example: 'Salut Marie, ton profil a retenu mon attention pour un poste qui pourrait vraiment te plaire…',
  },
  {
    value: 'vous',
    label: 'Vouvoiement',
    description: 'Professionnel et respectueux, le classique.',
    example: 'Bonjour Marie, votre parcours a retenu mon attention pour une opportunité à la hauteur de votre expérience…',
  },
  {
    value: 'casual',
    label: 'Décontracté',
    description: 'Léger et spontané, sans formalisme.',
    example: 'Hello Marie ! Je suis tombé sur ton profil et franchement, il fallait que je t’écrive…',
  },
  {
    value: 'formal',
    label: 'Formel',
    description: 'Soutenu et institutionnel, pour les profils seniors.',
    example: 'Madame, je me permets de vous contacter au sujet d’une opportunité correspondant à votre expertise…',
  },
];

const DO_SUGGESTIONS = [
  'Mentionner le télétravail dès le 1er message',
  'Annoncer la fourchette de salaire',
  'Messages courts et directs',
  'Personnaliser avec le parcours du candidat',
];

const DONT_SUGGESTIONS = [
  'Pas d’emojis',
  'Pas de jargon RH',
  'Pas de flatterie exagérée',
  'Jamais plus de 2 relances',
];

const TextToggle: React.FC<{
  label: string;
  active: boolean;
  tone: 'do' | 'dont';
  onToggle: () => void;
}> = ({ label, active, tone, onToggle }) => (
  <button
    type="button"
    onClick={onToggle}
    aria-pressed={active}
    className={cn(
      'group flex items-baseline gap-2 w-full text-left py-1 transition-transform duration-200 hover:translate-x-1'
    )}
  >
    <span
      className={cn(
        'shrink-0 w-4 text-center font-mono text-sm transition-colors',
        active
          ? tone === 'do' ? 'text-success' : 'text-destructive'
          : 'text-muted-foreground/40 group-hover:text-foreground'
      )}
      aria-hidden="true"
    >
      {tone === 'do' ? '+' : '−'}
    </span>
    <span
      className={cn(
        'text-sm transition-colors leading-relaxed',
        active
          ? cn(
              'text-foreground underline decoration-2 underline-offset-4',
              tone === 'do' ? 'decoration-emerald-500/70' : 'decoration-destructive/60'
            )
          : 'text-muted-foreground group-hover:text-foreground'
      )}
    >
      {label}
    </span>
  </button>
);

export const SceneAiTone: React.FC<Props> = ({ onNext, onBack, onSkip }) => {
  const { aiContext, save, isSaving } = useUserAiContext();
  const [tone, setTone] = useState<AiContextTone | null>(null);
  const [freeText, setFreeText] = useState('');
  const [doList, setDoList] = useState<Set<string>>(new Set());
  const [dontList, setDontList] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated) return;
    if (aiContext.tone || aiContext.free_text || aiContext.do.length || aiContext.dont.length) {
      setTone(aiContext.tone);
      setFreeText(aiContext.free_text);
      setDoList(new Set(aiContext.do));
      setDontList(new Set(aiContext.dont));
    }
    setHydrated(true);
  }, [aiContext, hydrated]);

  const selectedTone = TONES.find((t) => t.value === tone);

  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>) => (value: string) => {
    setter((prev) => {
      const next = new Set(prev);
      next.has(value) ? next.delete(value) : next.add(value);
      return next;
    });
  };

  const handleSubmit = () => {
    if (!tone) return;
    save({
      ...aiContext,
      tone,
      free_text: freeText.trim(),
      do: Array.from(doList),
      dont: Array.from(dontList),
    });
    onNext();
  };

  return (
    <div className="w-full">
      <div className="mb-8">
        <h2 className="font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]">
          Comment écrivez-vous ?
        </h2>
        <p className="text-muted-foreground text-[15px] leading-relaxed mt-3 max-w-md">
          L'IA Konekt rédige vos messages d'approche. Donnez-lui votre ton une fois —
          chaque message sonnera comme vous, pas comme un robot.
        </p>
      </div>

      <EditorialChoiceList
        options={TONES.map(({ value, label, description }) => ({ value, label, description }))}
        selected={tone ? [tone] : []}
        mode="single"
        onSelect={(v) => setTone(v as AiContextTone)}
      />

      {/* Aperçu du ton — citation */}
      <AnimatePresence mode="wait">
        {selectedTone && (
          <motion.blockquote
            key={selectedTone.value}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="border-l-2 border-emerald-500/50 pl-4 my-6"
          >
            <p className="font-editorial italic text-lg text-foreground/80 leading-relaxed">
              «&nbsp;{selectedTone.example}&nbsp;»
            </p>
          </motion.blockquote>
        )}
      </AnimatePresence>

      {/* Consignes */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="grid sm:grid-cols-2 gap-x-8 gap-y-5 mt-8"
      >
        <div>
          <p className="text-sm font-semibold text-foreground mb-2">À faire, toujours</p>
          {DO_SUGGESTIONS.map((item) => (
            <TextToggle
              key={item}
              label={item}
              tone="do"
              active={doList.has(item)}
              onToggle={() => toggleIn(setDoList)(item)}
            />
          ))}
        </div>
        <div>
          <p className="text-sm font-semibold text-foreground mb-2">À éviter, absolument</p>
          {DONT_SUGGESTIONS.map((item) => (
            <TextToggle
              key={item}
              label={item}
              tone="dont"
              active={dontList.has(item)}
              onToggle={() => toggleIn(setDontList)(item)}
            />
          ))}
        </div>
      </motion.div>

      {/* Contexte libre */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.45 }}
        className="mt-8"
      >
        <label htmlFor="aitone-free-text" className="block text-sm font-semibold text-foreground mb-2">
          Autre chose à savoir ? <span className="font-normal text-muted-foreground">(facultatif)</span>
        </label>
        <Textarea
          id="aitone-free-text"
          value={freeText}
          onChange={(e) => setFreeText(e.target.value)}
          placeholder="Ex : je signe toujours « À très vite », je mentionne le télétravail dès le premier message…"
          maxLength={1000}
          rows={3}
          className="border border-border text-sm resize-none bg-background/50"
        />
      </motion.div>

      {/* Navigation */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
        className="flex items-center justify-between mt-8"
      >
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Retour
        </button>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-4 decoration-border transition-colors"
          >
            Je préfère passer
          </button>
          <Button
            onClick={handleSubmit}
            disabled={!tone || isSaving}
            className="gap-2 bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          >
            {isSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
            Continuer
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
