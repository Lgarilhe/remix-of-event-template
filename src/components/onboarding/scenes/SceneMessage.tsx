import React, { useEffect, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { PenLine, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { draftFirstMessage, DraftError, type DraftedMessage, type WritingTone } from '@/lib/onboarding/outreach';
import type { PreviewCandidate } from '@/lib/onboarding/search';
import { NavRow } from '../parts/NavRow';
import { SceneHeading } from '../parts/SceneHeading';
import { useTypewriter } from '../stage/useTypewriter';
import { SPRING_DROP, SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';

interface Props {
  candidate: PreviewCandidate;
  missionId: string;
  jobTitle: string;
  client: { name: string; sector: string } | null;
  skills: string[];
  description: string;
  location: string | null;
  senderName: string;
  tone: WritingTone | null;
  onTone: (tone: WritingTone) => void;
  /** Ton gardé (ou null : on passe). Le parcours l'écrit sur le profil. */
  onDone: (tone: WritingTone | null) => void;
  onBack: () => void;
  /** Le bureau suit : l'avion trace sa route quand un brouillon existe. */
  onDraft: (has: boolean) => void;
}

const TONES: Array<{ value: WritingTone; label: string; line: string }> = [
  { value: 'vous', label: 'Je vouvoie', line: 'Sobre et respectueux, le ton par défaut.' },
  { value: 'tu', label: 'Je tutoie', line: 'Naturel, comme entre pairs du métier.' },
];

const MAX_DRAFTS = 3;

/** La lettre : papier crème, encre, le texte qui s'écrit à la vitesse d'un stylo rapide. */
const Letter: React.FC<{ candidate: PreviewCandidate; text: string; typing: boolean }> = ({ candidate, text, typing }) => {
  const reduced = useReducedMotion();
  const { shown, done } = useTypewriter(text, { speed: 10, start: typing });
  return (
    <motion.figure
      initial={reduced ? false : { opacity: 0, y: 30, rotate: -2 }}
      animate={{ opacity: 1, y: 0, rotate: -0.6 }}
      transition={SPRING_DROP}
      className="rounded-md p-5 shadow-xl"
      style={{ background: 'hsl(var(--paper))', color: 'hsl(var(--paper-ink))' }}
    >
      <figcaption className="mb-3 flex items-baseline justify-between gap-3 border-b pb-2 text-xs" style={{ borderColor: 'hsl(var(--paper-shade))', color: 'hsl(var(--paper-ink-soft))' }}>
        <span>
          À <strong className="font-semibold" style={{ color: 'hsl(var(--paper-ink))' }}>{candidate.name}</strong>
        </span>
        <span>Brouillon, rien n'est envoyé</span>
      </figcaption>
      <p className="whitespace-pre-line text-md leading-relaxed" aria-label={text}>
        <span aria-hidden="true">
          {shown}
          {!done && <span className="ml-px inline-block h-4 w-px translate-y-0.5 animate-pulse" style={{ background: 'hsl(var(--paper-ink))' }} />}
        </span>
      </p>
    </motion.figure>
  );
};

/**
 * Un premier message, écrit pour un vrai candidat de l'aperçu, avec le ton
 * choisi. C'est aussi là que le ton se règle : il devient celui de tous les
 * messages que Konekt rédigera pour vous.
 */
export const SceneMessage: React.FC<Props> = ({ candidate, missionId, jobTitle, client, skills, description, location, senderName, tone, onTone, onDone, onBack, onDraft }) => {
  const [draft, setDraft] = useState<DraftedMessage | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<DraftError | null>(null);
  const [count, setCount] = useState(0);
  const chosen: WritingTone = tone ?? 'vous';
  const d = useDelay();

  useEffect(() => onDraft(!!draft), [draft, onDraft]);

  const write = async () => {
    setBusy(true);
    setError(null);
    try {
      const next = await draftFirstMessage({ candidate, missionId, jobTitle, client, skills, description, location, tone: chosen, senderName });
      setDraft(next);
      setCount((n) => n + 1);
    } catch (e) {
      setError(e instanceof DraftError ? e : new DraftError("Le message n'a pas pu être rédigé. Réessayez dans un instant.", 'other'));
    } finally {
      setBusy(false);
    }
  };

  const pickTone = (value: WritingTone) => {
    if (busy) return;
    onTone(value);
  };

  const limitReached = count >= MAX_DRAFTS;

  return (
    <div className="space-y-6">
      <SceneHeading eyebrow="Premiers résultats" title="Comment écrivez-vous aux candidats ?" accent={['écrivez-vous']}>
        <p>Choisissez le ton, et regardez ce que Konekt écrirait à {candidate.firstName}. Rien n'est envoyé.</p>
      </SceneHeading>

      <div role="radiogroup" aria-label="Ton des messages" className="grid gap-3 sm:grid-cols-2">
        {TONES.map((t, i) => (
          <motion.div key={t.value} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SOFT, delay: d(0.5 + i * 0.08) }}>
            <Button
              variant="outline"
              role="radio"
              aria-checked={chosen === t.value}
              onClick={() => pickTone(t.value)}
              className={cn(
                'h-auto w-full flex-col items-start gap-0.5 whitespace-normal p-4 text-left font-normal',
                chosen === t.value && 'border-brand bg-accent',
              )}
            >
              <span className="text-base font-semibold text-foreground">{t.label}</span>
              <span className="text-sm text-muted-foreground">{t.line}</span>
            </Button>
          </motion.div>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {busy ? (
          <motion.div key="busy" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 rounded-md border border-border bg-card p-5" aria-busy="true">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-11/12" />
            <Skeleton className="h-3.5 w-2/3" />
            <p role="status" className="pt-1 text-xs text-muted-foreground">Konekt lit le profil de {candidate.firstName} et rédige. De 5 à 15 secondes.</p>
          </motion.div>
        ) : draft ? (
          <motion.div key={`draft-${count}`} exit={{ opacity: 0 }} className="space-y-3">
            <Letter candidate={candidate} text={draft.message} typing />
            {draft.points.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Repris de son profil : <span className="text-foreground-secondary">{draft.points.join(' · ')}</span>
              </p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      {error && (
        <p role="alert" className="rounded-lg border border-border bg-card p-3 text-sm text-foreground-secondary">
          {error.message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant={draft ? 'outline' : 'primary'} size={draft ? 'default' : 'lg'} onClick={() => void write()} disabled={busy || limitReached || error?.kind === 'credits'}>
          {draft ? <RefreshCw aria-hidden="true" /> : <PenLine aria-hidden="true" />}
          {draft ? `Réécrire en ${chosen === 'tu' ? 'tutoyant' : 'vouvoyant'}` : `Voir un exemple pour ${candidate.firstName}`}
        </Button>
        {limitReached && <span className="text-xs text-muted-foreground">Trois exemples suffisent pour se faire une idée.</span>}
      </div>

      <NavRow
        onBack={onBack}
        onNext={() => onDone(chosen)}
        nextLabel={draft ? 'Garder ce ton' : 'Continuer'}
        skipLabel={draft ? undefined : 'Passer'}
        onSkip={draft ? undefined : () => onDone(null)}
      />
    </div>
  );
};
