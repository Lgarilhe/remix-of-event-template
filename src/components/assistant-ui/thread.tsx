import React, { useState } from 'react';
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useMessage,
} from '@assistant-ui/react';
import {
  ArrowUp, ChevronRight, Sparkles, Paperclip, X, FileText,
  Search, PenLine, BarChart3, Lightbulb, SlidersHorizontal,
  ClipboardList, MessageSquare,
} from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { FileUpload, FileUploadTrigger, FileUploadContent } from '@/components/prompt-kit/file-upload';

interface SkalrThreadProps {
  contextMode?: string | null;
  /** Notion-style: model selector rendered inside the composer toolbar */
  modelSlot?: React.ReactNode;
}

type Suggestion = { icon: React.ComponentType<{ className?: string }>; label: string; prompt: string };
type WelcomeConfig = { title: string; subtitle: string; suggestions: Suggestion[] };

// Notion-AI-style landing: a greeting + clickable suggestions that send on
// click (ThreadPrimitive.Suggestion `send`). Shown only on an empty thread.
const WELCOME: Record<string, WelcomeConfig> = {
  free: {
    title: 'Comment puis-je t’aider ?',
    subtitle: 'Sourcing, messages d’approche, analyse de profils, prochaines actions.',
    suggestions: [
      { icon: Search, label: 'Sourcer des candidats', prompt: 'Je cherche des candidats pour un poste. Aide-moi à définir les critères.' },
      { icon: PenLine, label: 'Rédiger un message d’approche', prompt: 'Aide-moi à rédiger un message d’approche personnalisé pour un candidat.' },
      { icon: BarChart3, label: 'Analyser mes priorités', prompt: 'Analyse mes missions ouvertes et dis-moi quoi prioriser aujourd’hui.' },
      { icon: Lightbulb, label: 'Que peux-tu faire ?', prompt: 'Que peux-tu faire pour m’aider dans mon recrutement ?' },
    ],
  },
  sourcing: {
    title: 'Calibrons ta recherche',
    subtitle: 'Décris le poste, je structure les critères puis l’agent lance la recherche.',
    suggestions: [
      { icon: Search, label: 'Lancer le sourcing sur ce poste', prompt: 'Lançons le sourcing pour cette mission. Pose-moi les questions nécessaires pour calibrer.' },
      { icon: SlidersHorizontal, label: 'Affiner les critères', prompt: 'Aide-moi à affiner les critères de recherche pour ce poste.' },
    ],
  },
  brief: {
    title: 'Construisons le brief',
    subtitle: 'Je t’aide à cadrer le besoin, poste par poste.',
    suggestions: [
      { icon: ClipboardList, label: 'Compléter le brief', prompt: 'Aide-moi à compléter le brief de ce poste, champ par champ.' },
      { icon: MessageSquare, label: 'Questions à poser au client', prompt: 'Quelles questions dois-je poser au client pour bien cadrer ce recrutement ?' },
    ],
  },
  process: {
    title: 'Définissons le process',
    subtitle: 'Étapes d’évaluation, critères, deal-breakers.',
    suggestions: [
      { icon: ClipboardList, label: 'Proposer un process d’évaluation', prompt: 'Propose-moi un process d’évaluation adapté à ce poste.' },
    ],
  },
  outreach: {
    title: 'Travaillons l’approche',
    subtitle: 'Messages, séquences de relance, ton adapté au profil.',
    suggestions: [
      { icon: PenLine, label: 'Rédiger une séquence d’approche', prompt: 'Aide-moi à créer une séquence d’approche multicanale.' },
      { icon: MessageSquare, label: 'Améliorer un message', prompt: 'Améliore ce message d’approche : ' },
    ],
  },
};

/**
 * Claude/Notion-style reasoning toggle. Auto-expands while the model is still
 * "thinking" (no answer text yet), then collapses to a discreet line once the
 * answer streams. The header shimmers while thinking.
 */
const ReasoningBlock = ({ text }: { text: string }) => {
  const isRunning = useMessage((s) => s.status?.type === 'running');
  const hasText = useMessage((s) =>
    s.content?.some((part: any) => part.type === 'text' && part.text?.trim())
  );
  const streaming = isRunning && !hasText;
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const open = userToggled ?? streaming;

  return (
    <div className="text-[13px]">
      <button
        onClick={() => setUserToggled(!open)}
        className="group flex items-center gap-1.5 py-0.5 text-left"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
        <Sparkles className="h-3 w-3 text-muted-foreground/70" />
        <span
          className={cn(
            'text-[11px] font-semibold uppercase tracking-wider',
            streaming ? 'konekt-shimmer-text' : 'text-muted-foreground/70 group-hover:text-muted-foreground'
          )}
        >
          {streaming ? 'Réflexion en cours' : 'Réflexion'}
        </span>
      </button>
      <div
        className={cn(
          'grid transition-all duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="ml-[7px] mt-1 border-l border-border/60 pl-3 text-xs leading-relaxed text-muted-foreground/80 whitespace-pre-wrap">
            {text}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Claude/Notion-style shimmering status line (only when nothing rendered yet) */
const ShimmerThinking = () => (
  <div className="flex items-center gap-2.5 animate-fade-in px-1">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60">
      <AnimatedOrb size={20} speed={6} />
    </div>
    <span className="konekt-shimmer-text text-[13px] font-medium">Réflexion en cours…</span>
  </div>
);

/** Markdown renderer tuned for chat readability (Claude/ChatGPT-like) */
const MarkdownText = ({ text }: { text: string }) => (
  <div
    className={cn(
      'text-[14px] leading-[1.7] text-foreground',
      '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
      '[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:list-disc [&_ol]:list-decimal',
      '[&_li]:my-1 [&_li]:marker:text-muted-foreground',
      '[&_strong]:font-semibold [&_strong]:text-foreground',
      '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 hover:[&_a]:text-primary/80',
      '[&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-[12.5px] [&_code]:font-mono',
      '[&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
      '[&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-1.5',
      '[&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-1.5',
      '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1',
      '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:my-2',
      '[&_hr]:my-3 [&_hr]:border-border/60',
    )}
  >
    <ReactMarkdown>{text}</ReactMarkdown>
  </div>
);

/** Single assistant message — full-width, no bubble (Claude/ChatGPT style) */
const AssistantMessage = () => {
  const isRunning = useMessage((s) => s.status?.type === 'running');
  const hasText = useMessage((s) =>
    s.content?.some((part: any) => part.type === 'text' && part.text?.trim())
  );
  const hasReasoning = useMessage((s) =>
    s.content?.some((part: any) => part.type === 'reasoning' && part.text?.trim())
  );

  // Nothing streamed yet at all → single shimmer line (no double indicator)
  if (isRunning && !hasText && !hasReasoning) {
    return <ShimmerThinking />;
  }

  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60 mt-0.5">
        <AnimatedOrb size={20} speed={isRunning ? 6 : 2} />
      </div>
      <div className="flex-1 min-w-0 space-y-2 pt-0.5">
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => <MarkdownText text={text} />,
            Reasoning: ({ text }) => <ReasoningBlock text={text} />,
          }}
        />
        {isRunning && hasText && (
          <span className="inline-block w-1.5 h-4 bg-foreground/40 animate-pulse rounded-sm align-middle" />
        )}
      </div>
    </div>
  );
};

/** User message — soft right-aligned bubble (ChatGPT/Claude style) */
const UserMessage = () => (
  <div className="flex justify-end animate-fade-in">
    <div className="max-w-[80%] rounded-3xl rounded-br-md bg-muted px-4 py-2.5 text-[14px] leading-relaxed text-foreground">
      <MessagePrimitive.Content components={{ Text: ({ text }) => <span className="whitespace-pre-wrap">{text}</span> }} />
    </div>
  </div>
);

export const SkalrThread: React.FC<SkalrThreadProps> = ({ contextMode, modelSlot }) => {
  const w = WELCOME[(contextMode as string) || 'free'] ?? WELCOME.free;
  const [files, setFiles] = useState<File[]>([]);

  const addFiles = (added: File[]) =>
    setFiles((prev) => [...prev, ...added].slice(0, 5));
  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  return (
    <ThreadPrimitive.Root className="flex flex-col h-full bg-background">
      {/* Messages area */}
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto w-full max-w-2xl space-y-5">
          {/* Notion-style welcome — only on an empty thread */}
          <ThreadPrimitive.Empty>
            <div className="flex flex-col items-center text-center pt-10 pb-7">
              <AnimatedOrb size={48} />
              <h3 className="mt-4 text-xl font-display font-bold tracking-tight text-foreground">
                {w.title}
              </h3>
              <p className="mt-1.5 text-[13px] text-muted-foreground max-w-[20rem] leading-relaxed">
                {w.subtitle}
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-md mx-auto">
              {w.suggestions.map((s) => (
                <ThreadPrimitive.Suggestion
                  key={s.prompt}
                  prompt={s.prompt}
                  send
                  className="group flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card/40 px-3.5 py-3 text-left transition-all hover:border-primary/40 hover:bg-accent active:scale-[0.99]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span className="text-[13px] font-medium text-foreground/80 group-hover:text-foreground">
                    {s.label}
                  </span>
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />
        </div>
      </ThreadPrimitive.Viewport>

      {/* Composer — prompt-kit-style pill with Notion/Claude toolbar */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <div className="mx-auto w-full max-w-2xl">
          <FileUpload onFilesAdded={addFiles} multiple accept="image/*,.pdf,.doc,.docx,.txt,.csv">
            <ComposerPrimitive.Root className="relative flex flex-col rounded-[1.75rem] border border-border bg-background p-2 shadow-sm transition-all focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/5">
              {/* Attached files */}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-2 pt-1.5 pb-1">
                  {files.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="group flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 py-1 pl-2 pr-1 text-[11px] text-foreground/80"
                    >
                      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="max-w-[140px] truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                        aria-label="Retirer le fichier"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <ComposerPrimitive.Input
                placeholder={
                  contextMode === 'sourcing'
                    ? 'Décris le profil recherché…'
                    : contextMode === 'brief'
                    ? 'Pose une question sur le brief…'
                    : 'Écris un message à Konekt IA…'
                }
                rows={1}
                autoFocus
                className="w-full resize-none bg-transparent px-3 py-2.5 text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 outline-none max-h-40 min-h-[24px]"
              />

              {/* Toolbar */}
              <div className="flex items-center gap-1 pl-1 pr-0.5 pt-1">
                <FileUploadTrigger asChild>
                  <button
                    type="button"
                    title="Joindre un fichier"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                </FileUploadTrigger>

                {modelSlot}

                <ComposerPrimitive.Send
                  className={cn(
                    'ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all',
                    'bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 active:scale-95',
                    'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100'
                  )}
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                </ComposerPrimitive.Send>
              </div>
            </ComposerPrimitive.Root>

            {/* Drag-and-drop overlay */}
            <FileUploadContent>
              <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/50 bg-background px-10 py-8 shadow-xl">
                <Paperclip className="h-7 w-7 text-primary" />
                <p className="text-sm font-medium text-foreground">Dépose tes fichiers ici</p>
                <p className="text-xs text-muted-foreground">Images, PDF, Word, texte — 5 max</p>
              </div>
            </FileUploadContent>
          </FileUpload>

          <p className="mt-2 text-center text-[10.5px] text-muted-foreground/50">
            Konekt IA peut faire des erreurs — vérifie les infos importantes.
          </p>
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
};
