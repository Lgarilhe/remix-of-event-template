/**
 * SkalrThread — Custom assistant-ui Thread component with Skalr styling.
 */
import React from "react";
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
} from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import { cn } from "@/lib/utils";
import { Send, User, Bot } from "lucide-react";


interface SkalrThreadProps {
  contextMode?: string | null;
}

export const SkalrThread: React.FC<SkalrThreadProps> = ({ contextMode }) => {
  return (
    <ThreadPrimitive.Root className="flex flex-col flex-1 overflow-hidden">
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <ThreadPrimitive.Messages
          components={{
            UserMessage: SkalrUserMessage,
            AssistantMessage: SkalrAssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>
      <SkalrComposer />
    </ThreadPrimitive.Root>
  );
};

// ── User Message ──
const SkalrUserMessage: React.FC = () => {
  return (
    <div className="flex gap-3 justify-end animate-fade-in">
      <div className="max-w-[80%] bg-primary/10 border border-primary/20 rounded-2xl rounded-tr-sm px-4 py-3">
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => (
              <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{text}</p>
            ),
          }}
        />
      </div>
      <div className="w-7 h-7 rounded-full bg-muted flex items-center justify-center shrink-0">
        <User className="w-3.5 h-3.5 text-muted-foreground" />
      </div>
    </div>
  );
};

// ── Assistant Message ──
const SkalrAssistantMessage: React.FC = () => {
  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="w-7 h-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        <Bot className="w-3.5 h-3.5 text-primary" />
      </div>
      <div className="flex-1 min-w-0 max-w-[90%]">
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => (
              <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 leading-relaxed" dangerouslySetInnerHTML={{ __html: '' }}>
              </div>
            ),
          }}
        />
        <div className="prose prose-sm dark:prose-invert max-w-none text-foreground/90 leading-relaxed">
          <MarkdownTextPrimitive />
        </div>
      </div>
    </div>
  );
};

// ── Composer ──
const SkalrComposer: React.FC = () => {
  return (
    <ComposerPrimitive.Root className="border-t border-border/60 bg-background/80 backdrop-blur-sm p-3">
      <div className="flex items-end gap-2 bg-muted/30 border border-border/50 rounded-xl px-3 py-2">
        <ComposerPrimitive.Input
          placeholder="Écrivez votre message..."
          className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/50 resize-none outline-none min-h-[36px] max-h-[120px] py-1"
          autoFocus
        />
        <ComposerPrimitive.Send
          className="h-8 w-8 rounded-lg bg-primary hover:bg-primary/90 flex items-center justify-center shrink-0 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
        >
          <Send className="w-3.5 h-3.5 text-primary-foreground" />
        </ComposerPrimitive.Send>
      </div>
    </ComposerPrimitive.Root>
  );
};
