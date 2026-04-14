import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowDown, Send } from "lucide-react";
import { cn } from "@/lib/utils";

function SkalrUserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] px-4 py-2.5 bg-foreground text-background text-sm">
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => <span>{text}</span>,
          }}
        />
      </div>
    </MessagePrimitive.Root>
  );
}

function SkalrAssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start">
      <div className="max-w-[85%] px-4 py-2.5 border border-border bg-muted/30 text-sm">
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => (
              <MarkdownTextPrimitive
                text={text}
                remarkPlugins={[remarkGfm]}
                className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0.5 prose-headings:mb-2 prose-headings:mt-3 prose-pre:bg-muted prose-pre:border prose-pre:border-border"
              />
            ),
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
              "absolute bottom-20 right-4 h-8 w-8 flex items-center justify-center",
              "bg-foreground text-background hover:bg-foreground/90 transition-colors",
            )}
          >
            <ArrowDown className="h-4 w-4" />
          </button>
        </ThreadPrimitive.ScrollToBottom>
      </ThreadPrimitive.Viewport>

      <div className="border-t border-border px-4 py-3 shrink-0">
        <ComposerPrimitive.Root className="flex items-end gap-2 border border-border/60 focus-within:border-primary/30 focus-within:shadow-sm transition-all duration-200 px-3 py-2.5 bg-muted/20">
          <ComposerPrimitive.Input
            placeholder="Decrivez le profil recherche..."
            className="flex-1 resize-none bg-transparent text-sm text-foreground placeholder:text-muted-foreground/40 focus:outline-none min-h-[24px] max-h-[120px]"
            autoFocus
          />
          <ComposerPrimitive.Send asChild>
            <button className="h-8 w-8 flex items-center justify-center bg-foreground text-background hover:bg-foreground/90 shrink-0 transition-all duration-150 active:scale-90 disabled:bg-muted disabled:text-muted-foreground disabled:cursor-not-allowed">
              <Send className="h-3.5 w-3.5" />
            </button>
          </ComposerPrimitive.Send>
        </ComposerPrimitive.Root>
      </div>
    </ThreadPrimitive.Root>
  );
}
