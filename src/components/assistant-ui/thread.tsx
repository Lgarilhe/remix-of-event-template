import React, { type FC, useState, useEffect, useRef, useCallback } from "react";
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  BranchPickerPrimitive,
  ActionBarPrimitive,
  MessagePartPrimitive,
  AuiIf,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowDown,
  Send,
  Copy,
  Check,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { AnimatedOrb } from "@/components/ui/AnimatedOrb";

// ── Streaming cursor (blinking dot while text is being generated) ──
function StreamingCursor() {
  return (
    <span className="inline-flex items-center ml-0.5 align-baseline">
      <span className="w-2 h-4 bg-primary/80 rounded-[1px] animate-pulse" />
    </span>
  );
}

// ── Pulsing dots while waiting for first token ──
function WaitingIndicator() {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex items-center gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-primary/60"
            style={{
              animation: `pulse 1.4s ease-in-out ${i * 0.2}s infinite`,
            }}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground/60 animate-fade-in">
        Réflexion en cours…
      </span>
    </div>
  );
}

// ── Welcome screen ──
interface ThreadWelcomeProps {
  contextMode?: string | null;
  suggestions?: { label: string; prompt: string }[];
}

export const ThreadWelcome: FC<ThreadWelcomeProps> = ({ contextMode, suggestions }) => {
  const defaultSuggestions =
    contextMode === "sourcing"
      ? [
          { label: "🔍 Lancer une recherche", prompt: "Aide-moi à sourcer des candidats pour cette mission." },
          { label: "🎯 Affiner les critères", prompt: "Quels critères dois-je utiliser pour cette recherche ?" },
          { label: "📊 Analyser le marché", prompt: "Analyse le marché pour ce type de profil." },
        ]
      : contextMode === "brief"
        ? [
            { label: "📋 Analyser le brief", prompt: "Analyse ce brief et propose un ICP." },
            { label: "✍️ Améliorer la fiche", prompt: "Comment améliorer cette fiche de poste ?" },
          ]
        : contextMode === "outreach"
          ? [
              { label: "✉️ Rédiger un message", prompt: "Aide-moi à rédiger un message d'approche." },
              { label: "📈 Optimiser la séquence", prompt: "Comment optimiser ma séquence de messages ?" },
            ]
          : [
              { label: "🔍 Sourcer des candidats", prompt: "Je cherche des candidats. Aide-moi à définir les critères." },
              { label: "✍️ Rédiger un message", prompt: "Aide-moi à rédiger un message d'approche personnalisé." },
              { label: "📊 Analyser un poste", prompt: "Analyse les postes ouverts et identifie les priorités." },
              { label: "💡 Suggérer des actions", prompt: "Quelles actions devrais-je prioriser aujourd'hui ?" },
            ];

  const items = suggestions || defaultSuggestions;

  return (
    <div className="flex flex-col items-center justify-center h-full px-6 py-12 text-center">
      <AnimatedOrb size={56} speed={4} />
      <h3 className="mt-5 text-lg font-semibold text-foreground">
        {contextMode ? "Comment puis-je vous aider ?" : "Copilot IA"}
      </h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-[320px] leading-relaxed">
        {contextMode === "sourcing"
          ? "Je suis prêt à vous aider sur cette mission."
          : contextMode === "brief"
            ? "Analysons et optimisons ce brief ensemble."
            : contextMode === "outreach"
              ? "Créons des messages d'approche percutants."
              : "Votre assistant recrutement intelligent."}
      </p>
      <div className="mt-8 w-full max-w-[360px] grid gap-2">
        {items.map((s) => (
          <ThreadPrimitive.Suggestion key={s.prompt} prompt={s.prompt} method="replace" autoSend>
            <button className="w-full text-left px-4 py-3 text-sm border border-border/60 bg-background hover:bg-muted/40 hover:border-primary/20 transition-all duration-150 rounded-xl group">
              <span className="text-foreground/90 group-hover:text-foreground transition-colors">{s.label}</span>
            </button>
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
};

// ── Markdown text part with streaming cursor ──
function MarkdownText() {
  return (
    <div className="relative">
      <MessagePartPrimitive.Text
        component={({ text, isRunning }) => (
          <span>
            <MarkdownTextPrimitive
              remarkPlugins={[remarkGfm]}
              className={cn(
                "prose prose-sm dark:prose-invert max-w-none",
                "prose-p:my-2 prose-p:leading-relaxed",
                "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
                "prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold",
                "prose-h1:text-base prose-h2:text-sm prose-h3:text-sm",
                "prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:my-3",
                "prose-code:text-xs prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-md prose-code:font-mono",
                "prose-a:text-primary prose-a:no-underline hover:prose-a:underline prose-a:font-medium",
                "prose-strong:font-semibold prose-strong:text-foreground",
                "prose-blockquote:border-l-2 prose-blockquote:border-primary/30 prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-muted-foreground",
                "prose-table:text-xs prose-th:px-3 prose-th:py-1.5 prose-td:px-3 prose-td:py-1.5 prose-th:bg-muted/50",
                "prose-hr:border-border",
              )}
            />
            {isRunning && <StreamingCursor />}
          </span>
        )}
      />
    </div>
  );
}

// ── User message ──
function SkalrUserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end mb-4 animate-fade-in">
      <div className="max-w-[80%]">
        <div className="px-4 py-3 bg-foreground text-background text-sm leading-relaxed rounded-2xl rounded-br-md">
          <MessagePrimitive.Content
            components={{
              Text: ({ text }) => <span className="whitespace-pre-wrap">{text}</span>,
            }}
          />
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

// ── Assistant message ──
function SkalrAssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start mb-4 group animate-fade-in">
      <div className="flex gap-3 max-w-[90%]">
        {/* Avatar */}
        <div className="shrink-0 mt-0.5">
          <AnimatedOrb size={28} speed={3} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="text-sm text-foreground leading-relaxed">
            {/* Waiting indicator before first token */}
            <AuiIf condition={(s) => s.message.isLast && s.thread.isRunning && s.message.content.length === 0}>
              <WaitingIndicator />
            </AuiIf>

            <MessagePrimitive.Parts>
              {({ part }) => {
                if (part.type === "text") return <MarkdownText />;
                if (part.type === "tool-call") {
                  return part.toolUI ?? <ToolCallFallback name={part.toolName} status={part.status} />;
                }
                if (part.type === "reasoning") {
                  return <ReasoningBlock text={part.text} />;
                }
                return null;
              }}
            </MessagePrimitive.Parts>
          </div>

          {/* Action bar — copy, reload, branch picker */}
          <ActionBarPrimitive.Root
            hideWhenRunning
            autohide="not-last"
            autohideFloat="single-branch"
            className="flex items-center gap-0.5 mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200"
          >
            <ActionBarPrimitive.Copy asChild>
              <button
                className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                title="Copier"
              >
                <MessagePrimitive.If copied={false}>
                  <Copy className="h-3.5 w-3.5" />
                </MessagePrimitive.If>
                <MessagePrimitive.If copied>
                  <Check className="h-3.5 w-3.5 text-primary" />
                </MessagePrimitive.If>
              </button>
            </ActionBarPrimitive.Copy>

            <ActionBarPrimitive.Reload asChild>
              <button
                className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors"
                title="Régénérer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </ActionBarPrimitive.Reload>

            {/* Branch picker for multiple regenerations */}
            <BranchPickerPrimitive.Root
              hideWhenSingleBranch
              className="flex items-center gap-0.5 ml-1"
            >
              <BranchPickerPrimitive.Previous asChild>
                <button className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-30">
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
              </BranchPickerPrimitive.Previous>
              <BranchPickerPrimitive.Count />
              <BranchPickerPrimitive.Next asChild>
                <button className="h-7 w-7 flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg transition-colors disabled:opacity-30">
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </BranchPickerPrimitive.Next>
            </BranchPickerPrimitive.Root>
          </ActionBarPrimitive.Root>
        </div>
      </div>
    </MessagePrimitive.Root>
  );
}

// ── Reasoning block (collapsible thinking display — Claude/ChatGPT style) ──

function useElapsedTime(isRunning: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (!isRunning) return;
    startRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - startRef.current) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [isRunning]);

  if (elapsed < 1) return "";
  if (elapsed < 60) return `${elapsed}s`;
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}m${s > 0 ? ` ${s}s` : ""}`;
}

function parseReasoningSteps(text: string): string[] {
  if (!text) return [];
  // Split on double newlines or numbered patterns to extract "steps"
  const lines = text.split(/\n{2,}/).filter(l => l.trim().length > 0);
  return lines;
}

function ReasoningBlock({ text, isStreaming }: { text: string; isStreaming?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const wasStreamingRef = useRef(isStreaming);
  const elapsedLabel = useElapsedTime(!!isStreaming);
  const contentRef = useRef<HTMLDivElement>(null);

  // Auto-collapse 1.5s after streaming ends
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      const timer = setTimeout(() => setExpanded(false), 1500);
      return () => clearTimeout(timer);
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming]);

  // Auto-scroll inside content while streaming
  useEffect(() => {
    if (isStreaming && expanded && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [text, isStreaming, expanded]);

  const steps = parseReasoningSteps(text);
  const hasMultipleSteps = steps.length > 1;

  return (
    <div className="my-3 animate-fade-in">
      {/* Trigger bar */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border transition-all duration-300 text-left group/reason",
          isStreaming
            ? "border-primary/25 bg-primary/[0.04] shadow-sm"
            : "border-border/40 bg-muted/20 hover:bg-muted/40 hover:border-border/60"
        )}
      >
        {/* Spinner / check icon */}
        {isStreaming ? (
          <span className="relative flex h-4 w-4 shrink-0 items-center justify-center">
            <span className="absolute h-4 w-4 rounded-full border-[1.5px] border-primary/15" />
            <span className="absolute h-4 w-4 rounded-full border-[1.5px] border-transparent border-t-primary animate-spin" />
            <span className="h-1.5 w-1.5 rounded-full bg-primary/40" />
          </span>
        ) : (
          <span className="flex h-4 w-4 shrink-0 items-center justify-center">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: "hsl(142 71% 45% / 0.7)" }} />
          </span>
        )}

        {/* Label */}
        <span className={cn(
          "flex-1 text-xs font-medium truncate",
          isStreaming ? "text-foreground" : "text-muted-foreground"
        )}>
          {isStreaming ? "Réflexion en cours…" : "Réflexion terminée"}
        </span>

        {/* Elapsed time */}
        {elapsedLabel && (
          <span className="text-[10px] text-muted-foreground/40 tabular-nums font-mono shrink-0">
            {elapsedLabel}
          </span>
        )}

        {/* Step count badge */}
        {hasMultipleSteps && !isStreaming && (
          <span className="text-[10px] text-muted-foreground/40 shrink-0">
            {steps.length} étapes
          </span>
        )}

        {/* Chevron */}
        <ChevronRight
          className={cn(
            "h-3 w-3 text-muted-foreground/40 transition-transform duration-300 shrink-0",
            expanded && "rotate-90"
          )}
        />
      </button>

      {/* Shimmer progress bar while streaming */}
      {isStreaming && (
        <div className="h-[2px] mx-3 mt-0 rounded-full bg-muted overflow-hidden">
          <div className="h-full w-full bg-gradient-to-r from-transparent via-primary/40 to-transparent animate-[shimmer_1.5s_ease-in-out_infinite]" />
        </div>
      )}

      {/* Expanded content */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-300 ease-out",
          expanded ? "max-h-[400px] opacity-100 mt-1" : "max-h-0 opacity-0"
        )}
      >
        <div
          ref={contentRef}
          className="max-h-[380px] overflow-y-auto ml-2 pl-4 border-l-2 border-primary/10 py-2 scrollbar-thin"
        >
          {hasMultipleSteps ? (
            <div className="space-y-2">
              {steps.map((step, i) => (
                <div key={i} className="flex gap-2 animate-fade-in" style={{ animationDelay: `${i * 40}ms` }}>
                  <span className="shrink-0 mt-1 flex h-3.5 w-3.5 items-center justify-center">
                    {isStreaming && i === steps.length - 1 ? (
                      <span className="h-2 w-2 rounded-full bg-primary/50 animate-pulse" />
                    ) : (
                      <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/20" />
                    )}
                  </span>
                  <p className="text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap flex-1">
                    {step}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">
              {text}
              {isStreaming && <span className="inline-block w-1.5 h-3 bg-primary/40 rounded-sm ml-0.5 animate-pulse" />}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tool call fallback (for unregistered tools) ──
function ToolCallFallback({ name, status }: { name: string; status: { type: string } }) {
  const isRunning = status.type === "running" || status.type === "requires-action";

  return (
    <div className={cn(
      "flex items-center gap-2.5 px-3.5 py-2.5 my-2 rounded-xl border transition-all duration-300 animate-fade-in",
      isRunning
        ? "border-primary/20 bg-primary/5"
        : "border-border/40 bg-muted/30"
    )}>
      {isRunning ? (
        <div className="relative flex h-4 w-4 shrink-0 items-center justify-center">
          <span className="absolute h-4 w-4 rounded-full border-2 border-primary/20" />
          <span className="absolute h-4 w-4 rounded-full border-2 border-transparent border-t-primary animate-spin" />
        </div>
      ) : (
        <span className="flex h-4 w-4 shrink-0 items-center justify-center">
          <Check className="h-3 w-3 text-primary/60" />
        </span>
      )}
      <span className={cn(
        "text-xs font-medium",
        isRunning ? "text-foreground" : "text-muted-foreground"
      )}>
        {isRunning ? `${name}…` : name}
      </span>
    </div>
  );
}

// ── Composer ──
function SkalrComposer() {
  return (
    <ComposerPrimitive.Root className="relative flex items-end gap-2 border border-border/50 focus-within:border-primary/30 focus-within:ring-1 focus-within:ring-primary/10 transition-all duration-200 px-4 py-3 bg-muted/5 rounded-2xl">
      <ComposerPrimitive.Input
        placeholder="Posez une question…"
        className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none min-h-[24px] max-h-[160px] leading-relaxed"
        autoFocus
      />
      <ComposerPrimitive.Send asChild>
        <button className="h-8 w-8 flex items-center justify-center bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-all duration-150 active:scale-90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed rounded-xl">
          <Send className="h-3.5 w-3.5" />
        </button>
      </ComposerPrimitive.Send>
      <ComposerPrimitive.Cancel asChild>
        <button className="h-8 w-8 flex items-center justify-center bg-destructive/10 text-destructive hover:bg-destructive/20 shrink-0 transition-all duration-150 rounded-xl">
          <Square className="h-3 w-3 fill-current" />
        </button>
      </ComposerPrimitive.Cancel>
    </ComposerPrimitive.Root>
  );
}

// ── Main Thread ──
interface SkalrThreadProps {
  contextMode?: string | null;
}

export function SkalrThread({ contextMode }: SkalrThreadProps) {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full min-h-0 overflow-hidden bg-background relative">
      {/* Scrollable viewport */}
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto px-4 py-6">
          {/* Welcome screen when no messages */}
          <AuiIf condition={(s) => s.thread.isEmpty}>
            <ThreadWelcome contextMode={contextMode} />
          </AuiIf>

          {/* Messages */}
          <ThreadPrimitive.Messages
            components={{
              UserMessage: SkalrUserMessage,
              AssistantMessage: SkalrAssistantMessage,
            }}
          />
        </div>

        {/* Spacer at bottom for scroll comfort */}
        <div className="h-4" />
      </ThreadPrimitive.Viewport>

      {/* Scroll-to-bottom floating button */}
      <ThreadPrimitive.ScrollToBottom asChild>
        <button
          className={cn(
            "absolute bottom-24 left-1/2 -translate-x-1/2 h-8 w-8 flex items-center justify-center",
            "rounded-full bg-background border border-border shadow-md",
            "text-foreground hover:bg-muted transition-all duration-200",
            "opacity-80 hover:opacity-100",
          )}
        >
          <ArrowDown className="h-3.5 w-3.5" />
        </button>
      </ThreadPrimitive.ScrollToBottom>

      {/* Composer area */}
      <div className="border-t border-border/30 px-4 py-3 shrink-0 bg-background">
        <div className="max-w-2xl mx-auto">
          <SkalrComposer />
          <p className="text-[10px] text-muted-foreground/30 text-center mt-2 select-none">
            L'IA peut faire des erreurs — vérifiez les informations.
          </p>
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
}
