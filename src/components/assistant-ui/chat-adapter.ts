import type { ChatModelAdapter, ChatModelRunOptions } from '@assistant-ui/react';

interface SkalrAdapterConfig {
  supabaseUrl: string;
  /**
   * Returns the active conversation id, creating one if none exists yet.
   * The backend has no create-on-the-fly path — the row MUST exist before
   * the first message, so creation happens client-side (RLS-scoped insert).
   */
  ensureConversationId: () => Promise<string>;
  getAccessToken: () => string;
  /** Fresh passive app-location context at send time (page/mission/tab/candidate) */
  getAppContext?: () => unknown;
  apiKey: string;
  modelOverride?: string | null;
  contextMode?: string | null;
  briefContext?: Record<string, unknown> | null;
  projectId?: string | null;
  accountId?: string | null;
  organizationId?: string;
}

export function createSkalrChatAdapter(config: SkalrAdapterConfig): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }: ChatModelRunOptions) {
      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
      const userContent = lastUserMsg
        ? lastUserMsg.content
            .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
            .map(p => p.text)
            .join('\n')
        : '';

      if (!userContent.trim()) return;

      // The backend rejects requests without a conversation_id (400) and has
      // no create-on-the-fly path. Guarantee the row exists first.
      const conversationId = await config.ensureConversationId();
      if (!conversationId) throw new Error('Conversation introuvable');

      const appContext = config.getAppContext?.() ?? undefined;

      const resp = await fetch(`${config.supabaseUrl}/functions/v1/search-agent-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.getAccessToken()}`,
          apikey: config.apiKey,
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: userContent,
          _ai_model: config.modelOverride || undefined,
          _ai_action: 'agent_search_calibration',
          context_mode: config.contextMode || undefined,
          brief_context: config.briefContext || undefined,
          project_id: config.projectId || undefined,
          account_id: config.accountId || undefined,
          app_context: appContext,
        }),
        signal: abortSignal,
      });

      if (!resp.ok) throw new Error(`Edge function error: ${resp.status}`);

      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let accumulated = '';
      let thinkingAccumulated = '';
      let isThinking = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          const data = line.slice(6).trim();
          if (data === '[DONE]') continue;
          try {
            const parsed = JSON.parse(data);
            if (parsed.done === true) continue;

            const thinkingText = parsed.choices?.[0]?.delta?.thinking;
            if (thinkingText) {
              thinkingAccumulated += thinkingText;
              isThinking = true;
              yield {
                content: [
                  { type: 'reasoning' as const, text: thinkingAccumulated },
                ],
              };
              continue;
            }

            const text = parsed.choices?.[0]?.delta?.content;
            if (text) {
              if (isThinking) isThinking = false;
              accumulated += text;
              const parts: any[] = [];
              if (thinkingAccumulated) {
                parts.push({ type: 'reasoning' as const, text: thinkingAccumulated });
              }
              parts.push({ type: 'text' as const, text: accumulated });
              yield { content: parts };
            }
          } catch {
            // Ignore parse errors
          }
        }
      }

      const finalParts: any[] = [];
      if (thinkingAccumulated) {
        finalParts.push({ type: 'reasoning' as const, text: thinkingAccumulated });
      }
      finalParts.push({ type: 'text' as const, text: accumulated || '…' });
      yield { content: finalParts };
    },
  };
}
