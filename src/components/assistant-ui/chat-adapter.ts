import type { ChatModelAdapter, ChatModelRunOptions } from '@assistant-ui/react';

interface SkalrAdapterConfig {
  supabaseUrl: string;
  getConversationId: () => string;
  setConversationId: (id: string) => void;
  getAccessToken: () => string;
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

      let conversationId = config.getConversationId();

      // Auto-create conversation if needed
      if (!conversationId) {
        const resp = await fetch(`${config.supabaseUrl}/functions/v1/search-agent-chat`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${config.getAccessToken()}`,
            apikey: config.apiKey,
          },
          body: JSON.stringify({
            message: userContent,
            create_conversation: true,
            organization_id: config.organizationId,
            _ai_model: config.modelOverride || undefined,
            _ai_action: 'agent_search_calibration',
            context_mode: config.contextMode || undefined,
            brief_context: config.briefContext || undefined,
            project_id: config.projectId || undefined,
            account_id: config.accountId || undefined,
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

              // Capture conversation_id from first event
              if (parsed.conversation_id && !conversationId) {
                conversationId = parsed.conversation_id;
                config.setConversationId(conversationId);
              }
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
        return;
      }

      // Existing conversation — stream
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
