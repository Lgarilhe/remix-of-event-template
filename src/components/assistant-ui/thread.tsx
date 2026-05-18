import React, { useState } from 'react';
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useMessage,
} from '@assistant-ui/react';
import {
  Send, ChevronDown, ChevronRight, Brain, Loader2,
  Search, PenLine, BarChart3, Lightbulb, SlidersHorizontal,
  ClipboardList, MessageSquare,
} from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';

interface SkalrThreadProps {
  contextMode?: string | null;
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

/** Collapsible reasoning/thinking block — Claude-style */
const ReasoningBlock = ({ text }: { text: string }) => {
  const [open, setOpen] = useState(false);
  const lines = text.split('\n').filter(Boolean);
  const preview = lines.slice(0, 2).join(' ').slice(0, 120);

  return (
    <button
      onClick={() => setOpen(!open)}
      className="w-full text-left group"
    >
      <div className="flex items-start gap-2 rounded-lg border border-border/60 bg-muted/30 px-3 py-2 transition-colors hover:bg-muted/50">
        <div className="mt-0.5 shrink-0">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 text-primary/70" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-primary/70" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <Brain className="h-3 w-3 text-primary/60" />
            <span className="text-[11px] font-semibold uppercase tracking-wider text-primary/70">
              Réflexion
            </span>
          </div>
          {open ? (
            <div className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap mt-1 animate-fade-in">
              {text}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70 truncate">
              {preview}…
            </p>
          )}
        </div>
      </div>
    </button>
  );
};

/** Animated typing indicator — pulsing orb + bouncing dots */
const TypingIndicator = () => (
  <div className="flex gap-2.5 animate-fade-in">
    <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
      <AnimatedOrb size={18} speed={6} />
    </div>
    <div className="flex items-center gap-1.5 py-2">
      <span className="w-2 h-2 rounded-full bg-primary/60 animate-bounce" style={{ animationDelay: '0ms' }} />
      <span className="w-2 h-2 rounded-full bg-primary/50 animate-bounce" style={{ animationDelay: '150ms' }} />
      <span className="w-2 h-2 rounded-full bg-primary/40 animate-bounce" style={{ animationDelay: '300ms' }} />
      <span className="text-xs text-muted-foreground/60 ml-2">Recherche en cours…</span>
    </div>
  </div>
);

/** Streaming indicator shown inside the assistant message while content is loading */
const StreamingIndicator = () => (
  <div className="flex items-center gap-2 py-1 animate-fade-in">
    <Loader2 className="h-3.5 w-3.5 text-primary/60 animate-spin" />
    <span className="text-xs text-muted-foreground/70">Génération en cours…</span>
  </div>
);

/** Single assistant message */
const AssistantMessage = () => {
  const isRunning = useMessage((s) => s.status?.type === 'running');
  const hasText = useMessage((s) =>
    s.content?.some((part: any) => part.type === 'text' && part.text?.trim())
  );

  return (
    <div className="flex gap-2.5 animate-fade-in">
      <div className="w-6 h-6 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <AnimatedOrb size={18} speed={isRunning ? 6 : 2} />
      </div>
      <div className="flex-1 min-w-0 space-y-2">
        {isRunning && !hasText && <StreamingIndicator />}
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => (
              <div className="text-[13px] leading-relaxed text-foreground [&_p]:my-1 [&_ul]:my-1 [&_ol]:my-1 [&_li]:my-0.5 [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded [&_code]:text-xs [&_strong]:font-semibold [&_h3]:text-sm [&_h3]:font-bold [&_h3]:mt-3 [&_h3]:mb-1">
                <ReactMarkdown>{text}</ReactMarkdown>
              </div>
            ),
            Reasoning: ({ text }) => <ReasoningBlock text={text} />,
          }}
        />
        {isRunning && hasText && (
          <span className="inline-block w-1.5 h-4 bg-primary/50 animate-pulse rounded-sm ml-0.5" />
        )}
      </div>
    </div>
  );
};

/** User message bubble */
const UserMessage = () => (
  <div className="flex justify-end animate-fade-in">
    <div className="max-w-[85%] px-4 py-3 text-[13px] leading-relaxed bg-foreground text-background rounded-2xl rounded-br-sm">
      <MessagePrimitive.Content
        components={{
          Text: ({ text }) => <span>{text}</span>,
        }}
      />
    </div>
  </div>
);

export const SkalrThread: React.FC<SkalrThreadProps> = ({ contextMode }) => {
  const w = WELCOME[(contextMode as string) || 'free'] ?? WELCOME.free;

  return (
    <ThreadPrimitive.Root className="flex flex-col h-full">
      {/* Messages area */}
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Notion-style welcome — only on an empty thread */}
        <ThreadPrimitive.Empty>
          <div className="flex flex-col items-center text-center pt-12 pb-6">
            <AnimatedOrb size={40} />
            <h3 className="mt-3 text-base font-display font-black text-foreground">
              {w.title}
            </h3>
            <p className="mt-1 text-xs text-muted-foreground max-w-[17rem]">
              {w.subtitle}
            </p>
          </div>
          <div className="flex flex-col gap-1.5 w-full max-w-md mx-auto">
            {w.suggestions.map((s) => (
              <ThreadPrimitive.Suggestion
                key={s.prompt}
                prompt={s.prompt}
                send
                className="group flex items-center gap-2.5 text-left text-[13px] rounded-xl border border-border px-3 py-2.5 hover:border-primary/40 hover:bg-muted/40 transition-colors"
              >
                <s.icon className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                <span className="text-foreground/80 group-hover:text-foreground">{s.label}</span>
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

        {/* Loading indicator before any assistant message appears */}
        <ThreadPrimitive.If running>
          <TypingIndicator />
        </ThreadPrimitive.If>
      </ThreadPrimitive.Viewport>

      {/* Composer */}
      <div className="shrink-0 border-t border-border/60 bg-background/80 backdrop-blur-sm px-3 py-3">
        <ComposerPrimitive.Root className="flex items-end gap-2 rounded-xl border border-border bg-background px-3 py-2 focus-within:border-primary/40 transition-colors">
          <ComposerPrimitive.Input
            placeholder={
              contextMode === 'sourcing'
                ? 'Décrivez le profil recherché…'
                : contextMode === 'brief'
                ? 'Posez une question sur le brief…'
                : 'Écrivez un message…'
            }
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 outline-none resize-none max-h-32 min-h-[20px]"
            autoFocus
          />
          <ComposerPrimitive.Send
            className={cn(
              'shrink-0 h-8 w-8 rounded-lg flex items-center justify-center transition-all',
              'bg-primary text-primary-foreground hover:bg-primary/90',
              'disabled:opacity-30 disabled:cursor-not-allowed'
            )}
          >
            <Send className="h-4 w-4" />
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
};
