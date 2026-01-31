import React, { useState, useRef, useEffect } from 'react';
import { X, Minus, Send, Trash2, Sparkles, FileText, Users, Briefcase, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import { useCopilot } from '@/contexts/CopilotContext';
import { CopilotMessage } from './CopilotMessage';

const pageLabels: Record<string, { label: string; icon: React.ReactNode }> = {
  outreach: { label: 'Outreach', icon: <Users className="h-3 w-3" /> },
  ats: { label: 'ATS', icon: <Briefcase className="h-3 w-3" /> },
  candidates: { label: 'Candidats', icon: <Users className="h-3 w-3" /> },
  messages: { label: 'Messages', icon: <MessageSquare className="h-3 w-3" /> },
  jobs: { label: 'Jobs', icon: <FileText className="h-3 w-3" /> },
  other: { label: 'Navigation', icon: <Sparkles className="h-3 w-3" /> },
};

export function CopilotPanel() {
  const {
    isOpen,
    isMinimized,
    close,
    minimize,
    currentPage,
    selectedProfiles,
    activeJob,
    messages,
    isLoading,
    suggestions,
    sendMessage,
    clearMessages,
    executeAction,
  } = useCopilot();

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when panel opens
  useEffect(() => {
    if (isOpen && !isMinimized && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [isOpen, isMinimized]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const message = input.trim();
    setInput('');
    await sendMessage(message);
  };

  const handleQuickAction = (prompt: string) => {
    sendMessage(prompt);
  };

  if (!isOpen) return null;

  const pageInfo = pageLabels[currentPage] || pageLabels.other;

  return (
    <div
      className={cn(
        'fixed right-4 bottom-20 z-50 w-96 bg-background border rounded-xl shadow-2xl flex flex-col transition-all duration-200',
        isMinimized ? 'h-14' : 'h-[600px] max-h-[80vh]'
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b bg-gradient-to-r from-violet-500/10 to-purple-500/10 rounded-t-xl">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
            <Sparkles className="h-4 w-4 text-white" />
          </div>
          <div>
            <h3 className="font-semibold text-sm">Copilot IA</h3>
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              {pageInfo.icon}
              <span>{pageInfo.label}</span>
              {selectedProfiles.length > 0 && (
                <span className="ml-1">• {selectedProfiles.length} sélectionné(s)</span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={minimize}>
            <Minus className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={close}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!isMinimized && (
        <>
          {/* Context bar */}
          {activeJob && (
            <div className="px-4 py-2 bg-muted/50 border-b text-xs flex items-center gap-2">
              <Briefcase className="h-3 w-3 text-muted-foreground" />
              <span className="text-muted-foreground">Job actif:</span>
              <span className="font-medium truncate">{activeJob.title}</span>
            </div>
          )}

          {/* Messages area */}
          <ScrollArea className="flex-1 p-3" ref={scrollRef}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-center p-4">
                <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-500/20 to-purple-500/20 flex items-center justify-center mb-4">
                  <Sparkles className="h-8 w-8 text-violet-500" />
                </div>
                <h4 className="font-medium mb-2">Comment puis-je t'aider ?</h4>
                <p className="text-sm text-muted-foreground mb-4">
                  Je suis ton assistant IA. Je peux t'aider avec les filtres, les messages, le scoring, et plus encore.
                </p>
                
                {/* Quick actions based on context */}
                <div className="grid gap-2 w-full">
                  {currentPage === 'outreach' && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="justify-start text-xs h-8"
                        onClick={() => handleQuickAction("Configure les filtres pour le job actif")}
                      >
                        🎯 Configurer les filtres LinkedIn
                      </Button>
                      {selectedProfiles.length > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="justify-start text-xs h-8"
                          onClick={() => handleQuickAction("Rédige un message pour les profils sélectionnés")}
                        >
                          ✉️ Rédiger un message ({selectedProfiles.length})
                        </Button>
                      )}
                    </>
                  )}
                  {currentPage === 'ats' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="justify-start text-xs h-8"
                      onClick={() => handleQuickAction("Donne-moi un résumé du pipeline actuel")}
                    >
                      📊 Résumé du pipeline
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    size="sm"
                    className="justify-start text-xs h-8"
                    onClick={() => handleQuickAction("Que peux-tu faire ?")}
                  >
                    ❓ Que peux-tu faire ?
                  </Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {messages.map((message) => (
                  <CopilotMessage
                    key={message.id}
                    message={message}
                    onExecuteAction={executeAction}
                  />
                ))}
                {isLoading && (
                  <div className="flex gap-3 p-3">
                    <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center">
                      <Sparkles className="h-4 w-4 text-white animate-pulse" />
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '0ms' }} />
                      <div className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '150ms' }} />
                      <div className="w-2 h-2 rounded-full bg-violet-500 animate-bounce" style={{ animationDelay: '300ms' }} />
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {/* Suggestions bar */}
          {suggestions.length > 0 && messages.length > 0 && (
            <div className="px-3 py-2 border-t bg-muted/30">
              <div className="flex flex-wrap gap-1.5">
                {suggestions.slice(0, 3).map((suggestion) => (
                  <Button
                    key={suggestion.id}
                    variant="secondary"
                    size="sm"
                    className="h-6 text-xs"
                    onClick={() => executeAction(suggestion)}
                  >
                    {suggestion.label}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {/* Input area */}
          <div className="p-3 border-t">
            <form onSubmit={handleSubmit} className="flex gap-2">
              <Input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Demande-moi quelque chose..."
                className="flex-1 h-9 text-sm"
                disabled={isLoading}
              />
              <Button
                type="submit"
                size="icon"
                className="h-9 w-9 bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700"
                disabled={!input.trim() || isLoading}
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
            {messages.length > 0 && (
              <div className="flex justify-end mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-muted-foreground"
                  onClick={clearMessages}
                >
                  <Trash2 className="h-3 w-3 mr-1" />
                  Effacer
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
