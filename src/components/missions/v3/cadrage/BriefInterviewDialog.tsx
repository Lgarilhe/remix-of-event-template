// Refonte mission, écran Cadrage : brief vocal guidé. Une fenêtre pose une
// question à la fois (sur ce qui manque au poste), le recruteur répond à voix
// haute ou au clavier, l'IA range la réponse dans le brief et pose la suivante,
// jusqu'à ce que le poste soit assez complet pour une bonne recherche et une
// bonne notation.
//
// Présentation (design simplifié, voir docs/design/06-simplicite.md) : une vraie
// fenêtre du kit en trois bandes (en-tête, corps qui défile, barre d'action),
// deux colonnes dès md. À gauche la conversation : la question en héros, la
// réponse, le micro. À droite « Le poste », qui se remplit sous les yeux
// (BriefRecapPanel). Un seul bouton plein à tout instant : le micro tant qu'il
// n'y a rien à envoyer, Arrêter pendant l'écoute, Envoyer ensuite. Écrits en
// ternaires, jamais deux variant="primary" littéraux dans ce dossier (garde de
// lot12-cadrage).
//
// Chaque réponse est écrite tout de suite dans le brief (updateField, le même
// enregistrement automatique que le reste de l'écran) : fermer la fenêtre ne
// perd rien, sauf une réponse tapée et pas encore envoyée (confirmation). Les
// réponses brutes s'ajoutent au texte libre du poste (raw_brief), que la
// notation lit aussi. Règles pures : briefInterviewModel.ts ; tour de parole
// côté serveur : edge function brief-interview.
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, ArrowRight, ListChecks, Search } from 'lucide-react';
import { toast } from 'sonner';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Banner, bannerActionClass } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { IconTile } from '@/components/ui/IconTile';
import { SaveStatus, type SaveState } from '@/components/ui/save-status';
import { Textarea } from '@/components/ui/textarea';
import { KonektLogo } from '@/components/KonektLogo';
import { VoiceDictation } from '@/components/missions/VoiceDictation';
import type { JobDetailsSaveStatus } from '@/hooks/useJobDetailsAutosave';
import { isInsufficientCreditsError } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { deepMerge } from '@/lib/deepMerge';
import { plural } from '@/lib/plural';
import type { JobDetails } from '@/types/jobDetails';
import { cn } from '@/lib/utils';
import { BriefRecapAside, BriefRecapSummary } from './BriefRecapPanel';
import { cadrageReadiness, type StepsState } from './cadrageModel';
import {
  LONG_ANSWER_CHARS,
  MAX_ANSWERS,
  TOPIC_QUESTIONS,
  appendAnswers,
  applyBriefUpdates,
  briefPayload,
  briefRecapRows,
  describeUpdates,
  firstQuestion,
  freshRowIds,
  interviewProgress,
  interviewTopics,
  newInterviewSteps,
  splitQuestion,
  type BriefUpdates,
  type TopicId,
} from './briefInterviewModel';
import { TOUCH, useReturnFocus } from './sectionUi';

export interface NewInterviewStep {
  name: string;
  duration_minutes?: number;
}

export interface BriefInterviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jd: JobDetails;
  updateField: (patch: Partial<JobDetails>) => void;
  /** Noms des étapes d'entretien déjà créées. */
  stepNames: string[];
  stepsState: StepsState;
  /** Création des étapes citées. Absent quand le process n'est pas modifiable : les étapes ne sont alors pas demandées. */
  onAddSteps?: (steps: NewInterviewStep[]) => Promise<void>;
  /** Passe à l'écran Sourcing. */
  onContinue: () => void;
  /** L'anneau du bandeau, tel quel : même calcul que la page derrière la fenêtre. */
  ring?: ReactNode;
  /** État d'enregistrement du poste, que le bandeau possède. */
  saveStatus?: JobDetailsSaveStatus;
  onRetrySave?: () => void;
}

interface TurnResponse {
  updates?: BriefUpdates;
  next_question?: string | null;
  next_topic?: TopicId | null;
  done?: boolean;
}

interface Turn {
  question: string;
  /** Texte de la réponse, vide si la question a été passée. */
  answer: string;
  skipped: boolean;
  /** Ce que la réponse a ajouté au brief. */
  added: string[];
}

interface Question {
  text: string;
  topic: TopicId | null;
}

interface SessionGuard {
  /** Un envoi est en cours : sa réponse serait jetée si la fenêtre se fermait. */
  busy: boolean;
  /** Une réponse tapée ou dictée n'est pas encore envoyée. */
  draft: boolean;
}

const sameText = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const finePointer = () => typeof window !== 'undefined' && !!window.matchMedia?.('(hover: hover)').matches;

const shortcutLabel = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? 'Cmd + Entrée' : 'Ctrl + Entrée';

/** Souris et clavier : le champ de réponse. Doigt : la question (le clavier de l'appareil ne s'ouvre pas d'office). */
function focusStart(root: ParentNode | null | undefined) {
  const wanted = finePointer() ? 'field' : 'question';
  const target =
    root?.querySelector<HTMLElement>(`[data-autofocus="${wanted}"]`) ?? root?.querySelector<HTMLElement>('[data-autofocus]');
  target?.focus({ preventScroll: true });
}

/** Visage de l'assistant : monogramme Konekt fixe, creusé en bg-background pour rester visible sur la fenêtre. */
function AssistantFace() {
  return (
    <span aria-hidden="true" className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-background">
      <KonektLogo variant="mark" theme="auto" size={14} ariaLabel="" />
    </span>
  );
}

const PROBLEM_TEXT = {
  credits: "Il n'y a plus assez de crédits IA pour continuer. Vous pouvez compléter le brief au clavier, sur la page.",
  error: "Votre réponse n'a pas pu être ajoutée au brief. Elle est gardée dans le champ : renvoyez-la.",
  save: "Le brief n'a pas pu être enregistré.",
} as const;

interface SessionProps extends Omit<BriefInterviewDialogProps, 'open' | 'onOpenChange'> {
  onClose: () => void;
  listening: boolean;
  onListeningChange: (listening: boolean) => void;
  onGuardChange: (guard: SessionGuard) => void;
}

function InterviewSession({
  jd,
  updateField,
  stepNames,
  stepsState,
  onAddSteps,
  onContinue,
  ring,
  saveStatus,
  onRetrySave,
  onClose,
  listening,
  onListeningChange,
  onGuardChange,
}: SessionProps) {
  // Dernières valeurs lues : la réponse du modèle arrive après un délai, pendant
  // lequel le brief a pu bouger (enregistrement, saisie sur la page derrière).
  const jdRef = useRef(jd);
  jdRef.current = jd;
  const stepNamesRef = useRef(stepNames);
  stepNamesRef.current = stepNames;
  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);

  const stepsAvailable = stepsState === 'ready' && !!onAddSteps;
  const [skipped, setSkipped] = useState<TopicId[]>([]);
  const topics = interviewTopics(jd, { stepCount: stepNames.length, stepsAvailable, skipped });

  const [current, setCurrent] = useState<Question | null>(() => {
    const first = firstQuestion(topics);
    return first ? { text: first.text, topic: first.topic } : null;
  });
  const [phase, setPhase] = useState<'asking' | 'thinking' | 'done'>(current ? 'asking' : 'done');
  const [answer, setAnswer] = useState('');
  const [interim, setInterim] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [failure, setFailure] = useState<null | 'error' | 'credits'>(null);
  const answersRef = useRef<string[]>([]);
  const usedVoiceRef = useRef(false);

  const uid = useId();
  const qid = `${uid}-question`;
  const hintId = `${uid}-hint`;
  const errId = `${uid}-error`;
  const columnRef = useRef<HTMLDivElement>(null);
  const answerRef = useRef<HTMLTextAreaElement>(null);
  const sendRef = useRef<HTMLButtonElement>(null);
  const wasThinking = useRef(false);
  const wasListening = useRef(false);

  const onTranscript = useCallback((chunk: string) => {
    usedVoiceRef.current = true;
    setAnswer((prev) => (prev ? `${prev} ${chunk}` : chunk));
  }, []);
  const onComplete = useCallback(() => {
    // Le texte dicté est déjà dans la réponse : rien d'autre à faire à l'arrêt.
  }, []);

  // ---- ce qu'on montre
  const readiness = cadrageReadiness(jd, stepNames.length, stepsState);
  const ready = readiness.status === 'ready';
  const thinking = phase === 'thinking';
  const blocked = failure === 'credits';
  const hasAnswer = answer.trim() !== '';
  // Un seul bouton plein à tout instant : le micro tant qu'il n'y a rien à envoyer, Arrêter pendant l'écoute, Envoyer ensuite.
  const sendIsMain = hasAnswer && !listening;
  const shown = listening && interim ? [answer, interim].filter(Boolean).join(' ') : answer;
  const longAnswer = shown.length >= LONG_ANSWER_CHARS;
  const rows = briefRecapRows(jd, stepNames);
  const last = turns[turns.length - 1];
  const noted = last ? last.added.length > 0 : false;
  const notedCount = turns.reduce((n, t) => n + t.added.length, 0);
  const freshIds = freshRowIds(last?.added ?? []);
  const question = current ? splitQuestion(current.text) : null;
  const topic = topics.find((t) => t.id === current?.topic);
  const group = topic ? (topic.required ? 'Pour lancer la recherche' : 'Pour mieux cibler') : null;
  const noteLine = last
    ? noted
      ? `Noté dans le brief : ${last.added[0]}${last.added.length > 1 ? ` et ${plural(last.added.length - 1, 'autre')}` : ''}.`
      : last.skipped
        ? 'Question passée.'
        : 'Rien à retenir dans cette réponse.'
    : null;
  const announce =
    last && !thinking
      ? noted
        ? `Noté dans le brief : ${last.added.join('. ')}.`
        : last.skipped
          ? 'Question passée.'
          : 'Rien à retenir dans cette réponse.'
      : '';
  const status = thinking
    ? 'Ajout de votre réponse au brief…'
    : listening
      ? longAnswer
        ? 'Écoute en cours. Votre réponse est longue : arrêtez et envoyez-la.'
        : 'Écoute en cours'
      : longAnswer
        ? 'Votre réponse est longue. Envoyez-la, vous pourrez ajouter la suite à la question suivante.'
        : '';
  const saveState: SaveState | null = saveStatus === 'saving' || saveStatus === 'saved' ? saveStatus : null;
  const problem = phase === 'asking' && failure ? failure : saveStatus === 'error' ? 'save' : null;
  const errorBlock = problem && (
    <div id={errId}>
      <Banner
        tone="warning"
        icon={AlertTriangle}
        role="alert"
        className="rounded-lg border"
        action={
          problem === 'save' && onRetrySave ? (
            <Button type="button" variant="link" onClick={onRetrySave} className={cn('h-auto p-0', bannerActionClass, 'max-md:min-h-11')}>
              Réessayer
            </Button>
          ) : undefined
        }
      >
        {PROBLEM_TEXT[problem]}
      </Banner>
    </div>
  );

  // ---- effets de présentation
  useEffect(() => {
    onGuardChange({ busy: thinking, draft: phase === 'asking' && !blocked && hasAnswer });
  }, [onGuardChange, thinking, phase, blocked, hasAnswer]);
  useEffect(() => () => onGuardChange({ busy: false, draft: false }), [onGuardChange]);

  // Après un envoi (réussi ou en échec), le bouton qui avait le focus est désactivé : le focus revient dans la fenêtre,
  // sauf si la personne est allée cliquer ailleurs.
  useEffect(() => {
    if (phase === 'thinking') {
      wasThinking.current = true;
      return;
    }
    if (!wasThinking.current) return;
    wasThinking.current = false;
    const active = document.activeElement;
    if (active && active !== document.body && !active.closest('[role="dialog"]')) return;
    focusStart(columnRef.current);
  }, [phase]);

  // À l'arrêt de l'écoute, le bouton d'arrêt disparaît : s'il y a un texte, le focus va sur Envoyer (Entrée valide).
  useEffect(() => {
    if (listening) {
      wasListening.current = true;
      return;
    }
    if (!wasListening.current) return;
    wasListening.current = false;
    if (answerRef.current?.value.trim()) sendRef.current?.focus({ preventScroll: true });
  }, [listening]);

  useEffect(() => {
    columnRef.current?.scrollTo?.({ top: 0 });
  }, [turns.length]);
  useEffect(() => {
    const el = answerRef.current;
    if (el && listening) el.scrollTop = el.scrollHeight;
  }, [shown, listening]);

  const submit = async (skip: boolean) => {
    if (phase !== 'asking' || !current) return;
    const text = skip ? '' : answer.trim();
    if (!skip && !text) return;
    const nextSkipped = skip && current.topic ? [...skipped, current.topic] : skipped;
    const ctx = { stepCount: stepNamesRef.current.length, stepsAvailable, skipped: nextSkipped };
    const sentTopics = interviewTopics(jdRef.current, ctx);
    setPhase('thinking');
    setFailure(null);

    const { data, error } = await invokeWithCredits<TurnResponse>(
      'brief-interview',
      'brief_interview',
      {
        brief: briefPayload(jdRef.current),
        topics: sentTopics.map((t) => ({ id: t.id, state: t.state })),
        steps: stepNamesRef.current,
        history: turns.map((t) => ({ question: t.question, answer: t.answer })),
        question: current.text,
        answer: text || null,
      },
      { description: 'Brief vocal guidé' },
    );
    if (!aliveRef.current) return;
    if (error || !data?.success) {
      setPhase('asking');
      setFailure(isInsufficientCreditsError(error) ? 'credits' : 'error');
      if (!isInsufficientCreditsError(error)) {
        toast.error("L'IA n'a pas répondu. Réessayez dans un instant.");
      }
      return;
    }

    // Rangement de la réponse dans le brief.
    const updates = data.updates ?? {};
    const base = jdRef.current;
    const patch = applyBriefUpdates(base, updates, Date.now());
    if (text) {
      answersRef.current.push(text);
      Object.assign(patch, {
        voice_transcript: answersRef.current.join('\n\n'),
        raw_brief: appendAnswers(base.raw_brief, [text]),
        ...(usedVoiceRef.current ? { brief_source: 'voice' as const } : {}),
      });
    }
    if (Object.keys(patch).length > 0) updateField(patch);

    let created = onAddSteps ? newInterviewSteps(updates, stepNamesRef.current) : [];
    if (created.length > 0 && onAddSteps) {
      try {
        await onAddSteps(created);
      } catch {
        // Le hook des étapes annonce déjà l'erreur ; rien n'a été créé.
        created = [];
      }
      if (!aliveRef.current) return;
    }

    const turn: Turn = { question: current.text, answer: text, skipped: skip, added: describeUpdates(updates, created) };
    setTurns((t) => [...t, turn]);
    setAnswer('');
    setInterim('');
    setSkipped(nextSkipped);

    // Question suivante : celle du modèle, sinon la première chose obligatoire encore à faire.
    const afterTopics = interviewTopics(deepMerge(base, patch) as JobDetails, {
      stepCount: stepNamesRef.current.length + created.length,
      stepsAvailable,
      skipped: nextSkipped,
    });
    let next: Question | null =
      data.done || !data.next_question ? null : { text: data.next_question, topic: data.next_topic ?? null };
    if (next && sameText(next.text, current.text)) next = null;
    if (!next) {
      const missing = afterTopics.find((t) => t.required && t.state === 'todo' && t.id !== current.topic);
      if (missing) next = { text: TOPIC_QUESTIONS[missing.id], topic: missing.id };
    }
    if (interviewProgress(afterTopics).nothingLeft || answersRef.current.length >= MAX_ANSWERS) next = null;

    setCurrent(next);
    setPhase(next ? 'asking' : 'done');
  };

  const leaveToSourcing = () => {
    onClose();
    onContinue();
  };
  // Le lien « Aller au sourcing » de la colonne ne sert qu'avant la fin : à l'écran de fin, le pied le porte déjà.
  const posteContinue = phase === 'done' ? undefined : leaveToSourcing;
  const poste = { readiness, ring, rows, freshIds, freshKey: turns.length };

  return (
    <>
      <div className="flex shrink-0 items-center gap-3 border-b border-border py-4 pl-4 pr-14 sm:pl-6">
        <div className="min-w-0 flex-1">
          <DialogTitle className="text-md">Brief vocal</DialogTitle>
          <DialogDescription className="mt-0.5 text-xs max-sm:sr-only">
            Répondez à voix haute ou au clavier. Chaque réponse complète le brief du poste.
          </DialogDescription>
        </div>
        {saveState && <SaveStatus state={saveState} className="max-sm:hidden" />}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] md:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex min-h-0 flex-col">
          <div ref={columnRef} className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-5 sm:px-6">
            <BriefRecapSummary {...poste} onContinue={posteContinue} />

            {phase === 'done' ? (
              <>
                <div className="konekt-fade-up flex flex-col items-start gap-3">
                  <IconTile icon={ready ? Search : ListChecks} tone={ready ? 'brand' : 'warning'} size="lg" aria-hidden="true" />
                  <h3 id={qid} tabIndex={-1} data-autofocus="question" className="text-lg font-semibold text-foreground">
                    {ready ? 'Le brief est prêt pour chercher et noter des profils.' : 'Le brief est enregistré.'}
                  </h3>
                  <p className="text-sm text-foreground-secondary">
                    {ready ? 'Tout reste modifiable dans la page.' : readiness.sentence}
                  </p>
                  {notedCount > 0 && (
                    <p className="text-sm text-muted-foreground">
                      {plural(notedCount, 'information notée', 'informations notées')} dans le brief.
                    </p>
                  )}
                </div>
                {errorBlock}
              </>
            ) : (
              current &&
              question && (
                <>
                  {noteLine && (
                    <p aria-hidden="true" className={cn('text-sm text-foreground-secondary', noted && 'md:hidden')}>
                      {noteLine}
                    </p>
                  )}
                  <div key={current.text} className="konekt-fade-up flex flex-col gap-3">
                    {group && <p className="eyebrow">{group}</p>}
                    <div className="flex gap-3">
                      <AssistantFace />
                      <div className="min-w-0 flex-1 space-y-1">
                        <h3 id={qid} tabIndex={-1} data-autofocus="question" className="text-lg font-semibold text-foreground">
                          {question.question}
                        </h3>
                        {question.hint && (
                          <p id={hintId} className="text-sm text-foreground-secondary">
                            {question.hint}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>

                  {errorBlock}

                  <Textarea
                    ref={answerRef}
                    data-autofocus="field"
                    value={shown}
                    onChange={(e) => setAnswer(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                        e.preventDefault();
                        if (!listening && !blocked) void submit(false);
                      }
                    }}
                    readOnly={listening || thinking}
                    aria-labelledby={qid}
                    aria-describedby={[question.hint ? hintId : null, errorBlock ? errId : null].filter(Boolean).join(' ') || undefined}
                    aria-invalid={failure === 'error' ? true : undefined}
                    aria-busy={thinking || undefined}
                    aria-keyshortcuts="Control+Enter Meta+Enter"
                    placeholder="Votre réponse. Vous pouvez aussi la dicter avec le micro."
                    rows={3}
                    className="max-h-48 min-h-24 resize-none"
                  />

                  <div className="flex min-h-5 items-center justify-between gap-3">
                    <p role="status" className="flex min-w-0 items-center gap-2 text-sm text-foreground-secondary">
                      {listening && <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-danger" />}
                      {status}
                    </p>
                    {hasAnswer && !listening && !thinking && (
                      <p className="shrink-0 text-xs text-muted-foreground max-sm:hidden [@media(hover:none)]:hidden">
                        <kbd className="font-mono text-xs">{shortcutLabel()}</kbd> pour envoyer
                      </p>
                    )}
                  </div>

                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => void submit(true)}
                    disabled={thinking || listening || blocked}
                    className={cn('-ml-3 self-start', TOUCH)}
                  >
                    Passer cette question
                  </Button>
                </>
              )
            )}
          </div>

          {phase === 'done' ? (
            <DialogFooter className="shrink-0 border-t border-border px-4 py-3 sm:px-6">
              <Button type="button" variant="ghost" size="lg" onClick={onClose} className={cn(TOUCH, 'max-sm:w-full')}>
                Rester sur le brief
              </Button>
              <Button
                type="button"
                variant={ready ? 'primary' : 'secondary'}
                size="lg"
                onClick={leaveToSourcing}
                className={cn(TOUCH, 'max-sm:w-full')}
              >
                Aller au sourcing
                <ArrowRight aria-hidden="true" />
              </Button>
            </DialogFooter>
          ) : (
            <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-border px-4 py-3 sm:px-6">
              <VoiceDictation
                variant="mission-v3"
                startLabel="Répondre à voix haute"
                layout="bar"
                startVariant={hasAnswer ? 'secondary' : 'primary'}
                disabled={thinking || blocked}
                onRecordingChange={onListeningChange}
                onTranscript={onTranscript}
                onInterim={setInterim}
                onComplete={onComplete}
                className="max-sm:shrink-0"
              />
              <Button
                ref={sendRef}
                type="button"
                size="lg"
                variant={sendIsMain ? 'primary' : 'secondary'}
                loading={thinking}
                disabled={!hasAnswer || listening || blocked}
                onClick={() => void submit(false)}
                className={cn(TOUCH, 'max-sm:flex-1')}
              >
                <span>
                  {failure === 'error' ? 'Renvoyer' : 'Envoyer'}
                  <span className="max-sm:sr-only"> la réponse</span>
                </span>
              </Button>
            </div>
          )}
        </div>

        <BriefRecapAside {...poste} onContinue={posteContinue} />
      </div>

      {/* Une seule région annoncée, présente dès l'ouverture : ce que la dernière réponse a noté. La question est lue par le focus. */}
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
    </>
  );
}

export function BriefInterviewDialog({ open, onOpenChange, ...session }: BriefInterviewDialogProps) {
  const listeningRef = useRef(false);
  const guardRef = useRef<SessionGuard>({ busy: false, draft: false });
  const [listening, setListening] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const returnFocus = useReturnFocus();

  const onListeningChange = useCallback((value: boolean) => {
    listeningRef.current = value;
    setListening(value);
  }, []);
  const onGuardChange = useCallback((guard: SessionGuard) => {
    guardRef.current = guard;
  }, []);

  const handleOpenChange = (next: boolean) => {
    // Pendant l'écoute, le texte en cours serait perdu : il faut d'abord arrêter le micro.
    if (!next && listeningRef.current) {
      toast.info("Arrêtez l'écoute pour fermer : le texte en cours serait perdu.");
      return;
    }
    // Pendant un envoi, la réponse du serveur serait jetée alors que le crédit est dépensé.
    if (!next && guardRef.current.busy) {
      toast.info("Un instant : votre réponse est en cours d'ajout au brief.");
      return;
    }
    // Une réponse tapée ou dictée et pas envoyée ne se jette pas en silence.
    if (!next && guardRef.current.draft) {
      setLeaving(true);
      return;
    }
    onOpenChange(next);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          className="flex h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0 sm:h-[min(34rem,90dvh)] sm:w-[calc(100%-2rem)] md:max-w-3xl max-sm:[&>button:last-child]:min-h-11 max-sm:[&>button:last-child]:min-w-11"
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.remember();
            focusStart(event.target as HTMLElement | null);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.restore();
          }}
        >
          <InterviewSession
            {...session}
            listening={listening}
            onClose={() => handleOpenChange(false)}
            onListeningChange={onListeningChange}
            onGuardChange={onGuardChange}
          />
        </DialogContent>
      </Dialog>

      <AlertDialog open={leaving} onOpenChange={setLeaving}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitter sans envoyer ?</AlertDialogTitle>
            <AlertDialogDescription>Votre réponse n'est pas encore envoyée. Si vous quittez maintenant, elle sera perdue.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Revenir à ma réponse</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                setLeaving(false);
                onOpenChange(false);
              }}
            >
              Quitter sans envoyer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
