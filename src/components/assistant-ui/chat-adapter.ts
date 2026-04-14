import type { ChatModelAdapter } from "@assistant-ui/react";
import { supabase } from "@/integrations/supabase/client";
import { getActiveMentions, clearActiveMentions } from "@/components/agent/MentionComposer";

export interface SkalrChatAdapterOptions {
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
  organizationId?: string | null;
}

/** Strip [OPTIONS] [...] [/OPTIONS] blocks from streamed text (profile blocks are kept for UI rendering) */
function stripOptionsTags(text: string): string {
  return text.replace(/\[OPTIONS\][\s\S]*?\[\/OPTIONS\]/g, "").trim();
}

export function createSkalrChatAdapter(
  options: SkalrChatAdapterOptions,
): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }) {
      const lastUserMessage = messages[messages.length - 1];
      const text =
        lastUserMessage?.content
          ?.filter(
            (p): p is { type: "text"; text: string } => p.type === "text",
          )
          .map((p) => p.text)
          .join("") || "";

      // Capture active @mentions immediately, before any async work
      const mentions = getActiveMentions().map((m) => ({
        id: m.id,
        type: m.type,
        label: m.label,
      }));
      // Clear after snapshotting so they don't carry to next message
      requestAnimationFrame(() => clearActiveMentions());

      // Auto-create conversation if none exists
      let conversationId = options.getConversationId();
      if (!conversationId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !options.organizationId) {
          throw new Error("Not authenticated");
        }

        const { data, error } = await supabase
          .from("agent_conversations")
          .insert({
            organization_id: options.organizationId,
            created_by: user.id,
            status: "calibrating",
          })
          .select("id")
          .single();

        if (error || !data) {
          throw new Error("Failed to create conversation");
        }

        conversationId = data.id;
        options.setConversationId(conversationId);
      }

      const accessToken = options.getAccessToken();
      if (!accessToken) {
        throw new Error("No access token");
      }

      const response = await fetch(
        `${options.supabaseUrl}/functions/v1/search-agent-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
            apikey: options.apiKey,
          },
          body: JSON.stringify({
            conversation_id: conversationId,
            message: text,
            _ai_model: options.modelOverride || undefined,
            _ai_action: "agent_search_calibration",
            context_mode: options.contextMode || undefined,
            brief_context: options.briefContext || undefined,
            project_id: options.projectId || undefined,
            account_id: options.accountId || undefined,
            mentions: mentions.length > 0 ? mentions : undefined,
          }),
          signal: abortSignal,
        },
      );

      if (!response.ok) {
        const errText = await response.text().catch(() => "");
        throw new Error(`search-agent-chat failed: ${response.status} ${errText}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullText = "";
      let fullThinking = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === "[DONE]") continue;

          try {
            const event = JSON.parse(jsonStr);

            // Server-side done confirmation event
            if (event.done === true) continue;

            // Handle thinking/reasoning deltas
            const thinkingText = event.choices?.[0]?.delta?.thinking;
            if (thinkingText) {
              fullThinking += thinkingText;
              const parts: Array<{ type: "reasoning"; text: string } | { type: "text"; text: string }> = [
                { type: "reasoning" as const, text: fullThinking },
              ];
              if (fullText) {
                parts.push({ type: "text" as const, text: stripOptionsTags(fullText) });
              }
              yield { content: parts };
            }

            // Handle text content
            const contentText = event.choices?.[0]?.delta?.content;
            if (contentText) {
              fullText += contentText;
              // Strip [OPTIONS] blocks before yielding to the UI
              const cleanText = stripOptionsTags(fullText);
              const parts: Array<{ type: "reasoning"; text: string } | { type: "text"; text: string }> = [];
              if (fullThinking) {
                parts.push({ type: "reasoning" as const, text: fullThinking });
              }
              parts.push({ type: "text" as const, text: cleanText });
              yield { content: parts };
            }
          } catch {
            // skip malformed JSON lines
          }
        }
      }
    },
  };
}
