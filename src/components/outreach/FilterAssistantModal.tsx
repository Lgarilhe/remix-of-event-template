import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageSquare, Send, Loader2, Sparkles, Check, X } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { LinkedInFiltersState } from './types';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  filterUpdate?: FilterUpdate | null;
}

interface FilterUpdate {
  keywords?: string;
  role?: Array<{ keywords: string; priority: string; scope: string }>;
  seniority?: string[];
  calculated_experience_min?: number | null;
  calculated_experience_max?: number | null;
  location_keywords?: string[];
  location_within_area?: number | null;
  company_keywords?: Array<{ keywords: string; priority: string; scope: string }>;
  industry_keywords?: string[];
  skills_keywords?: string[];
  open_to_work?: boolean;
}

interface FilterAssistantModalProps {
  onApplyFilters: (update: Partial<LinkedInFiltersState>) => void;
  currentFilters: LinkedInFiltersState;
}

const CHAT_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-filter-assistant`;

export const FilterAssistantModal: React.FC<FilterAssistantModalProps> = ({
  onApplyFilters,
  currentFilters,
}) => {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      role: 'assistant',
      content: "Salut ! 👋 Décris-moi le profil que tu recherches et je remplirai les filtres automatiquement. Par exemple : \"Je cherche un dev fullstack React/Node senior sur Paris en remote\"",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Focus input when modal opens
  useEffect(() => {
    if (open && inputRef.current) {
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Parse filter updates from AI response
  const parseFilterUpdates = useCallback((content: string): { cleanContent: string; filterUpdate: FilterUpdate | null } => {
    const filterMatch = content.match(/\[FILTERS_UPDATE\]([\s\S]*?)\[\/FILTERS_UPDATE\]/);
    
    if (!filterMatch) {
      return { cleanContent: content, filterUpdate: null };
    }

    try {
      const filterJson = filterMatch[1].trim();
      const filterUpdate = JSON.parse(filterJson) as FilterUpdate;
      const cleanContent = content.replace(/\[FILTERS_UPDATE\][\s\S]*?\[\/FILTERS_UPDATE\]/g, '').trim();
      return { cleanContent, filterUpdate };
    } catch (e) {
      console.error('Failed to parse filter update:', e);
      return { cleanContent: content, filterUpdate: null };
    }
  }, []);

  // Stream chat with the AI
  const streamChat = useCallback(async (userMessage: string) => {
    const userMsg: Message = { role: 'user', content: userMessage };
    setMessages(prev => [...prev, userMsg]);
    setIsLoading(true);
    setInput('');

    let assistantContent = '';

    try {
      const resp = await fetch(CHAT_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          messages: [...messages, userMsg].map(m => ({ role: m.role, content: m.content })),
        }),
      });

      if (resp.status === 429) {
        toast.error('Limite IA atteinte, réessayez plus tard');
        setIsLoading(false);
        return;
      }
      if (resp.status === 402) {
        toast.error('Crédits IA épuisés');
        setIsLoading(false);
        return;
      }
      if (!resp.ok || !resp.body) {
        throw new Error('Failed to start stream');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = '';

      const upsertAssistant = (nextChunk: string) => {
        assistantContent += nextChunk;
        setMessages(prev => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && prev.length > 1 && prev[prev.length - 2]?.role === 'user') {
            return prev.map((m, i) => (i === prev.length - 1 ? { ...m, content: assistantContent } : m));
          }
          return [...prev, { role: 'assistant', content: assistantContent }];
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        textBuffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = textBuffer.indexOf('\n')) !== -1) {
          let line = textBuffer.slice(0, newlineIndex);
          textBuffer = textBuffer.slice(newlineIndex + 1);

          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line.startsWith(':') || line.trim() === '') continue;
          if (!line.startsWith('data: ')) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === '[DONE]') break;

          try {
            const parsed = JSON.parse(jsonStr);
            const content = parsed.choices?.[0]?.delta?.content as string | undefined;
            if (content) upsertAssistant(content);
          } catch {
            textBuffer = line + '\n' + textBuffer;
            break;
          }
        }
      }

      // Parse any filter updates from the final content
      const { cleanContent, filterUpdate } = parseFilterUpdates(assistantContent);
      
      // Update the last message with parsed data
      setMessages(prev => {
        const lastIndex = prev.length - 1;
        if (lastIndex >= 0 && prev[lastIndex].role === 'assistant') {
          return prev.map((m, i) =>
            i === lastIndex ? { ...m, content: cleanContent || assistantContent, filterUpdate } : m
          );
        }
        return prev;
      });
    } catch (e) {
      console.error('Chat error:', e);
      toast.error('Erreur de communication avec l\'assistant');
    } finally {
      setIsLoading(false);
    }
  }, [messages, parseFilterUpdates]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;
    streamChat(input.trim());
  };

  // Apply filter update to parent
  const handleApplyFilters = useCallback((filterUpdate: FilterUpdate) => {
    const update: Partial<LinkedInFiltersState> = {};

    if (filterUpdate.keywords) {
      update.keywords = filterUpdate.keywords;
    }

    if (filterUpdate.role?.length) {
      update.role = filterUpdate.role.map(r => ({
        keywords: r.keywords,
        priority: r.priority as 'MUST_HAVE' | 'DOESNT_HAVE',
        scope: r.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST',
      }));
    }

    if (filterUpdate.seniority?.length) {
      update.seniority = filterUpdate.seniority;
    }

    if (filterUpdate.calculated_experience_min !== undefined) {
      update.calculated_experience_min = filterUpdate.calculated_experience_min;
    }

    if (filterUpdate.calculated_experience_max !== undefined) {
      update.calculated_experience_max = filterUpdate.calculated_experience_max;
    }

    if (filterUpdate.location_within_area !== undefined) {
      update.location_within_area = filterUpdate.location_within_area;
    }

    if (filterUpdate.company_keywords?.length) {
      update.company_keywords = filterUpdate.company_keywords.map(c => ({
        keywords: c.keywords,
        priority: c.priority as 'CAN_HAVE' | 'MUST_HAVE' | 'DOESNT_HAVE',
        scope: c.scope as 'CURRENT' | 'PAST' | 'CURRENT_OR_PAST' | 'PAST_NOT_CURRENT',
      }));
    }

    if (filterUpdate.open_to_work !== undefined) {
      update.open_to_work = filterUpdate.open_to_work;
    }

    onApplyFilters(update);
    toast.success('Filtres appliqués !');
  }, [onApplyFilters]);

  // Render a single message
  const renderMessage = (message: Message, index: number) => {
    const isUser = message.role === 'user';

    return (
      <div
        key={index}
        className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-3`}
      >
        <div
          className={`max-w-[85%] rounded-2xl px-4 py-2.5 ${
            isUser
              ? 'bg-[#0077B5] text-white'
              : 'bg-gray-100 text-gray-800'
          }`}
        >
          <div className="prose prose-sm max-w-none">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="m-0 text-sm leading-relaxed">{children}</p>,
                ul: ({ children }) => <ul className="my-1 ml-4 list-disc">{children}</ul>,
                li: ({ children }) => <li className="text-sm">{children}</li>,
              }}
            >
              {message.content}
            </ReactMarkdown>
          </div>

          {/* Filter update preview */}
          {message.filterUpdate && (
            <div className="mt-3 p-3 bg-white/90 rounded-xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-purple-500" />
                <span className="text-xs font-medium text-gray-700">Filtres proposés</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {message.filterUpdate.keywords && (
                  <span className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                    Keywords: {message.filterUpdate.keywords.slice(0, 30)}...
                  </span>
                )}
                {message.filterUpdate.role?.[0] && (
                  <span className="text-[10px] px-2 py-1 bg-green-100 text-green-700 rounded-full">
                    Rôle: {message.filterUpdate.role[0].keywords.slice(0, 30)}...
                  </span>
                )}
                {message.filterUpdate.seniority?.length && (
                  <span className="text-[10px] px-2 py-1 bg-orange-100 text-orange-700 rounded-full">
                    Séniorité: {message.filterUpdate.seniority.length} niveaux
                  </span>
                )}
                {(message.filterUpdate.calculated_experience_min !== undefined || 
                  message.filterUpdate.calculated_experience_max !== undefined) && (
                  <span className="text-[10px] px-2 py-1 bg-purple-100 text-purple-700 rounded-full">
                    XP: {message.filterUpdate.calculated_experience_min ?? '?'}-{message.filterUpdate.calculated_experience_max ?? '?'} ans
                  </span>
                )}
                {message.filterUpdate.location_keywords?.length && (
                  <span className="text-[10px] px-2 py-1 bg-amber-100 text-amber-700 rounded-full">
                    📍 {message.filterUpdate.location_keywords.join(', ')}
                  </span>
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  onClick={() => handleApplyFilters(message.filterUpdate!)}
                  className="h-7 text-xs bg-green-600 hover:bg-green-700 text-white gap-1"
                >
                  <Check className="w-3 h-3" />
                  Appliquer
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setInput('Modifie les filtres: ');
                    inputRef.current?.focus();
                  }}
                  className="h-7 text-xs gap-1"
                >
                  <X className="w-3 h-3" />
                  Modifier
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 bg-gradient-to-r from-purple-50 to-indigo-50 border-purple-200 hover:border-purple-300 text-purple-700"
        >
          <MessageSquare className="w-4 h-4" />
          <span className="hidden sm:inline">Assistant IA</span>
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-[500px] h-[600px] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 pb-2 border-b">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-purple-500 to-indigo-600 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            Assistant Filtres IA
          </DialogTitle>
        </DialogHeader>

        {/* Messages area */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-1">
            {messages.map((msg, i) => renderMessage(msg, i))}
            {isLoading && messages[messages.length - 1]?.role === 'user' && (
              <div className="flex justify-start mb-3">
                <div className="bg-gray-100 rounded-2xl px-4 py-3">
                  <Loader2 className="w-4 h-4 animate-spin text-gray-500" />
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input area */}
        <form onSubmit={handleSubmit} className="p-4 pt-2 border-t bg-gray-50">
          <div className="flex gap-2">
            <Input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Décris le profil recherché..."
              disabled={isLoading}
              className="flex-1 h-10 bg-white"
            />
            <Button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="h-10 px-4 bg-[#0077B5] hover:bg-[#005E93]"
            >
              {isLoading ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};
