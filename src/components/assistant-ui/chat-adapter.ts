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
      let buffer = '';
      let accumulated = '';
      let thinkingAccumulated = '';
      let isThinking = false;

      while (true) {
        const { done, value } = await reader.read();

        // Line buffering: an SSE event can be split across two network reads,
        // so keep the trailing partial line in `buffer` between reads (same
        // pattern as the backend proxy in search-agent-chat). On the final
        // read, flush the decoder and process any last non-newline-terminated
        // `data: ` line instead of dropping it.
        buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = done ? '' : lines.pop() || '';

        for (const line of lines) {
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

        if (done) break;
      }

      const finalParts: any[] = [];
      if (thinkingAccumulated) {
        finalParts.push({ type: 'reasoning' as const, text: thinkingAccumulated });
      }
      if (accumulated) {
        finalParts.push({ type: 'text' as const, text: accumulated });
      } else if (!thinkingAccumulated) {
        // Stream s'est fermé sans aucun texte ni reasoning : cas où l'agent
        // a uniquement appelé une mutation (awaiting_approval) sans narration,
        // ou s'est bloqué dans une boucle de tool_use. Avant 2026-05-20 ce
        // fallback était le caractère "…" brut, qui s'affichait littéralement
        // comme bulle vide perdue (cf. bug remonté par Laurent).
        finalParts.push({
          type: 'text' as const,
          text: "Je n'ai pas pu formuler de réponse. Si une action attend ton approbation, elle s'affiche en bandeau au-dessus du chat. Sinon, reformule ta demande.",
        });
      }
      if (finalParts.length > 0) {
        yield { content: finalParts };
      }
    },
  };
}
