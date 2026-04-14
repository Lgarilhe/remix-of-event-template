import React, { useMemo } from "react";
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowDown, Send } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Parse [OPTIONS] ["opt1", "opt2"] [/OPTIONS] blocks from assistant text.
 * Returns { cleanText, options } where cleanText has the block removed.
 */
function parseOptions(text: string): { cleanText: string; options: string[] } {
  const match = text.match(/\[OPTIONS\]\s*(\[.*?\])\s*\[\/OPTIONS\]/s);
  if (!match) return { cleanText: text, options: [] };

  let options: string[] = [];
  try {
    options = JSON.parse(match[1]);
  } catch {
    // Fallback: extract quoted strings
    const raw = match[1];
    const re = /"([^"]+)"/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(raw)) !== null) options.push(m[1]);
  }

  const cleanText = text.replace(match[0], "").trim();
  return { cleanText, options };
}

function OptionButtons({ options }: { options: string[] }) {
  // We can't easily send a message programmatically with assistant-ui primitives,
  // so we render the options as visual chips. The user can click to copy to input.
  if (options.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mt-3">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => {
            // Find the composer input and set its value
            const input = document.querySelector<HTMLTextAreaElement>(
              '[data-skalr-composer] textarea, [data-skalr-composer] input'
            );
            if (input) {
              const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLTextAreaElement.prototype, 'value'
              )?.set || Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'value'
              )?.set;
              nativeInputValueSetter?.call(input, opt);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.focus();
            }
          }}
          className="px-3 py-1.5 text-xs font-medium border border-border bg-background hover:bg-muted text-foreground transition-colors"
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function SkalrUserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] px-4 py-2.5 bg-foreground text-background text-sm rounded-sm">
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => <span>{text}</span>,
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantTextWithOptions({ text }: { text: string }) {
  const { cleanText, options } = useMemo(() => parseOptions(text), [text]);

  return (
    <>
      <MarkdownTextPrimitive
        remarkPlugins={[remarkGfm]}
        className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-3 prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-a:text-primary prose-a:no-underline hover:prose-a:underline"
        preprocess={() => cleanText}
      />
      <OptionButtons options={options} />
    </>
  );
}

function SkalrAssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="max-w-[85%] px-4 py-2.5 border border-border bg-muted/30 text-sm rounded-sm">
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => <AssistantTextWithOptions text={text} />,
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

export function SkalrThread() {
  return (
    <ThreadPrimitive.Root className="flex flex-col h-full bg-background">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <ThreadPrimitive.Messages
          components={{
            UserMessage: SkalrUserMessage,
            AssistantMessage: SkalrAssistantMessage,
          }}
        />
        <ThreadPrimitive.ScrollToBottom asChild>
          <button
            className={cn(
              "absolute bottom-20 right-4 h-8 w-8 flex items-center justify-center rounded-sm",
              "bg-foreground text-background hover:bg-foreground/90 transition-colors",
            )}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>

      <div className="border-t border-border px-4 py-3 shrink-0" data-skalr-composer>
        <ComposerPrimitive.Root className="flex items-end gap-2 border border-border/60 focus-within:border-primary/30 focus-within:shadow-sm transition-all duration-200 px-3 py-2.5 bg-muted/20 rounded-sm">
          <ComposerPrimitive.Input
            placeholder="Décrivez le profil recherché..."
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none min-h-[24px] max-h-[120px]"
            autoFocus
          />
          <ComposerPrimitive.Send asChild>
            <button className="h-8 w-8 flex items-center justify-center bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-all duration-150 active:scale-90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed rounded-sm">
              <Send className="h-3.5 w-3.5" />
            </button>
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}
