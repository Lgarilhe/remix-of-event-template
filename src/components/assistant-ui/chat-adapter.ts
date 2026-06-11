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

      // Parts ordonnées : le texte s'accumule dans la DERNIÈRE part text ;
      // un event tool_status "running" (boucle d'outils backend) insère une
      // part tool-call (rendue par les tool UIs enregistrées ou le Fallback
      // de thread.tsx) et rouvre une nouvelle part text pour la suite.
      const orderedParts: any[] = [];
      let lastTextPart: { type: 'text'; text: string } | null = null;
      const snapshot = () => {
        const parts: any[] = [];
        if (thinkingAccumulated) parts.push({ type: 'reasoning' as const, text: thinkingAccumulated });
        parts.push(...orderedParts);
        return parts;
      };

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

            // Progression des outils (boucle backend) : chip inline dans le fil
            const ts = parsed.tool_status;
            if (ts && ts.id) {
              if (ts.state === 'running') {
                orderedParts.push({
                  type: 'tool-call' as const,
                  toolCallId: ts.id,
                  toolName: ts.name || 'tool',
                  args: {},
                  argsText: '{}',
                });
                lastTextPart = null;
              } else if (ts.state === 'done') {
                const part = orderedParts.find(
                  (p) => p.type === 'tool-call' && p.toolCallId === ts.id
                );
                if (part) part.result = { outcome: ts.outcome ?? 'ok' };
              }
              yield { content: snapshot() };
              continue;
            }

            const thinkingText = parsed.choices?.[0]?.delta?.thinking;
            if (thinkingText) {
              thinkingAccumulated += thinkingText;
              isThinking = true;
              yield { content: snapshot() };
              continue;
            }

            const text = parsed.choices?.[0]?.delta?.content;
            if (text) {
              if (isThinking) isThinking = false;
              accumulated += text;
              if (!lastTextPart) {
                lastTextPart = { type: 'text' as const, text: '' };
                orderedParts.push(lastTextPart);
              }
              lastTextPart.text += text;
              yield { content: snapshot() };
            }
          } catch {
            // Ignore parse errors
          }
        }

        if (done) break;
      }

      const finalParts: any[] = snapshot();
      if (!accumulated && !thinkingAccumulated && orderedParts.length === 0) {
        // Stream s'est fermé sans aucun texte, reasoning ni tool : cas où
        // l'agent s'est bloqué sans rien produire. Avant 2026-05-20 ce
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
