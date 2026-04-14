import React, { type FC } from "react";
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  BranchPickerPrimitive,
  ActionBarPrimitive,
  AuiIf,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowDown, Send, Copy, Check, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedOrb } from "@/components/ui/AnimatedOrb";

// ── Welcome screen ──
interface ThreadWelcomeProps {
  contextMode?: string | null;
  suggestions?: { label: string; prompt: string }[];
}

export const ThreadWelcome: FC<ThreadWelcomeProps> = ({ contextMode, suggestions }) => {
  const defaultSuggestions = contextMode === 'sourcing'
    ? [
        { label: '🔍 Lancer une recherche', prompt: 'Aide-moi à sourcer des candidats pour cette mission.' },
        { label: '🎯 Affiner les critères', prompt: 'Quels critères dois-je utiliser pour cette recherche ?' },
        { label: '📊 Analyser le marché', prompt: 'Analyse le marché pour ce type de profil.' },
      ]
    : contextMode === 'brief'
    ? [
        { label: '📋 Analyser le brief', prompt: 'Analyse ce brief et propose un ICP.' },
        { label: '✍️ Améliorer la fiche', prompt: 'Comment améliorer cette fiche de poste ?' },
      ]
    : contextMode === 'outreach'
    ? [
        { label: '✉️ Rédiger un message', prompt: "Aide-moi à rédiger un message d'approche." },
        { label: '📈 Optimiser la séquence', prompt: 'Comment optimiser ma séquence de messages ?' },
      ]
    : [
        { label: '🔍 Sourcer des candidats', prompt: 'Je cherche des candidats. Aide-moi à définir les critères.' },
        { label: '✍️ Rédiger un message', prompt: "Aide-moi à rédiger un message d'approche personnalisé." },
        { label: '📊 Analyser un poste', prompt: 'Analyse les postes ouverts et identifie les priorités.' },
        { label: '💡 Suggérer des actions', prompt: "Quelles actions devrais-je prioriser aujourd'hui ?" },
      ];

  const items = suggestions || defaultSuggestions;

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-8 text-center">
      <AnimatedOrb size={48} speed={4} />
      <h3 className="mt-4 text-base font-semibold text-foreground">
        {contextMode ? 'Comment puis-je vous aider ?' : 'Copilot IA'}
      </h3>
      <p className="mt-1.5 text-xs text-muted-foreground max-w-[280px]">
        {contextMode === 'sourcing'
          ? 'Je suis prêt à vous aider sur cette mission.'
          : contextMode === 'brief'
          ? 'Analysons et optimisons ce brief ensemble.'
          : contextMode === 'outreach'
          ? "Créons des messages d'approche percutants."
          : 'Votre assistant recrutement intelligent.'}
      </p>
      <div className="mt-6 w-full max-w-[320px] grid gap-2">
        {items.map((s) => (
          <ThreadPrimitive.Suggestion key={s.prompt} prompt={s.prompt} method="replace" autoSend>
            <button className="w-full text-left px-3 py-2.5 text-xs font-medium border border-border bg-background hover:bg-muted/50 hover:border-primary/20 transition-all duration-150 rounded-sm">
              {s.label}
            </button>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
};

// ── User message ──
function SkalrUserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end group">
      <div className="max-w-[85%] px-4 py-2.5 bg-foreground text-background text-sm rounded-2xl rounded-br-sm">
        <MessagePrimitive.Content
          components={{ Text: ({ text }) => <span className="whitespace-pre-wrap">{text}</span> }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

// ── Assistant message ──
function SkalrAssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start group">
      <div className="flex gap-2.5 max-w-[90%]">
        <div className="shrink-0 mt-1">
          <AnimatedOrb size={24} speed={3} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="px-0 py-1 text-sm text-foreground">
            <MessagePrimitive.Content
              components={{
                Text: ({ text }) => (
                  <MarkdownTextPrimitive
                    remarkPlugins={[remarkGfm]}
                    className="prose prose-sm dark:prose-invert max-w-none
                      prose-p:my-1.5 prose-p:leading-relaxed
                      prose-ul:my-2 prose-ol:my-2
                      prose-li:my-0.5
                      prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold
                      prose-h3:text-sm
                      prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-sm
                      prose-code:text-xs prose-code:bg-muted prose-code:px-1 prose-code:py-0.5 prose-code:rounded-sm
                      prose-a:text-primary prose-a:no-underline hover:prose-a:underline
                      prose-strong:font-semibold
                      prose-blockquote:border-l-2 prose-blockquote:border-primary/30 prose-blockquote:pl-3 prose-blockquote:italic"
                    preprocess={() => text}
                  />
                ),
              }}
            />
          </div>
          {/* Action bar */}
          <ActionBarPrimitive.Root
            hideWhenRunning
            autohide="not-last"
            autohideFloat="single-branch"
            className="flex items-center gap-1 mt-1 opacity-0 group-hover:opacity-100 transition-opacity"
          >
            <ActionBarPrimitive.Copy asChild>
              <button className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-sm hover:bg-muted">
                <MessagePrimitive.If copied={false}><Copy className="h-3 w-3" /></MessagePrimitive.If>
                <MessagePrimitive.If copied><Check className="h-3 w-3 text-primary" /></MessagePrimitive.If>
              </button>
            </ActionBarPrimitive.Copy>
            <ActionBarPrimitive.Reload asChild>
              <button className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors rounded-sm hover:bg-muted">
                <RefreshCw className="h-3 w-3" />
              </button>
            </ActionBarPrimitive.Reload>
          </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

// ── Composer ──
function SkalrComposer() {
  return (
    <ComposerPrimitive.Root className="flex items-end gap-2 border border-border/60 focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 transition-all duration-200 px-3 py-2.5 bg-muted/10 rounded-xl">
      <ComposerPrimitive.Input
        placeholder="Posez une question..."
        className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none min-h-[24px] max-h-[120px]"
        autoFocus
      />
      <ComposerPrimitive.Send asChild>
        <button className="h-8 w-8 flex items-center justify-center bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-all duration-150 active:scale-90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed rounded-lg">
          <Send className="h-3.5 w-3.5" />
        </button>
      </ComposerPrimitive.Send>
    </ComposerPrimitive.Root>
  );
}

// ── Main Thread ──
interface SkalrThreadProps {
  contextMode?: string | null;
}

export function SkalrThread({ contextMode }: SkalrThreadProps) {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full bg-background">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Welcome screen when empty */}
        <AuiIf condition={(s) => s.thread.isEmpty}>
          <ThreadWelcome contextMode={contextMode} />
        </AuiIf>

        <ThreadPrimitive.Messages
          components={{
            UserMessage: SkalrUserMessage,
            AssistantMessage: SkalrAssistantMessage,
          }}
        />

        {/* Scroll-to-bottom button */}
        <ThreadPrimitive.ScrollToBottom asChild>
          <button
            className={cn(
              "absolute bottom-20 right-4 h-8 w-8 flex items-center justify-center rounded-full",
              "bg-background border border-border shadow-sm text-foreground hover:bg-muted transition-colors",
            )}
          >
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>

      <div className="border-t border-border/40 px-4 py-3 shrink-0 bg-background">
        <SkalrComposer />
        <p className="text-[10px] text-muted-foreground/40 text-center mt-2">
          L'IA peut faire des erreurs. Vérifiez les informations.
        </p>
      </div>
    </ThreadPrimitive.Root>
  );
}
