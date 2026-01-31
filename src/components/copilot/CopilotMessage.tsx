import React from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, User, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { CopilotMessage as CopilotMessageType, CopilotAction } from '@/contexts/CopilotContext';

interface CopilotMessageProps {
  message: CopilotMessageType;
  onExecuteAction?: (action: CopilotAction) => void;
}

export function CopilotMessage({ message, onExecuteAction }: CopilotMessageProps) {
  const isUser = message.role === 'user';

  return (
    <div
      className={cn(
        'flex gap-3 p-3 rounded-lg',
        isUser ? 'bg-muted/50' : 'bg-background'
      )}
    >
      <div
        className={cn(
          'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center',
          isUser ? 'bg-primary text-primary-foreground' : 'bg-gradient-to-br from-violet-500 to-purple-600 text-white'
        )}
      >
        {isUser ? <User className="h-4 w-4" /> : <Bot className="h-4 w-4" />}
      </div>
      
      <div className="flex-1 min-w-0 space-y-2">
        <div className="prose prose-sm dark:prose-invert max-w-none">
          <ReactMarkdown
            components={{
              p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
              ul: ({ children }) => <ul className="list-disc pl-4 mb-2">{children}</ul>,
              ol: ({ children }) => <ol className="list-decimal pl-4 mb-2">{children}</ol>,
              li: ({ children }) => <li className="mb-1">{children}</li>,
              code: ({ children }) => (
                <code className="bg-muted px-1 py-0.5 rounded text-sm">{children}</code>
              ),
              pre: ({ children }) => (
                <pre className="bg-muted p-2 rounded overflow-x-auto text-sm">{children}</pre>
              ),
            }}
          >
            {message.content}
          </ReactMarkdown>
        </div>

        {/* Render suggested actions */}
        {message.actions && message.actions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-2">
            {message.actions.map((action) => (
              <Button
                key={action.id}
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1.5"
                onClick={() => onExecuteAction?.(action)}
                disabled={action.executed}
              >
                <Zap className="h-3 w-3" />
                {action.label}
                {action.executed && ' ✓'}
              </Button>
            ))}
          </div>
        )}

        {/* Timestamp */}
        <div className="text-xs text-muted-foreground">
          {message.timestamp.toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </div>
      </div>
    </div>
  );
}
