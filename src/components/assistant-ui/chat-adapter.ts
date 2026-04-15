/**
 * Skalr Chat Adapter for assistant-ui
 * Bridges the search-agent-chat edge function SSE stream to assistant-ui's ChatModelAdapter.
 */
import type { ChatModelAdapter, ChatModelRunOptions } from "@assistant-ui/react";
import { supabase } from "@/integrations/supabase/client";

interface SkalrChatAdapterConfig {
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

export function createSkalrChatAdapter(config: SkalrChatAdapterConfig): ChatModelAdapter {
  return {
    async *run({ messages, abortSignal }: ChatModelRunOptions) {
      // Build the user message from the last message
      const lastMessage = messages[messages.length - 1];
      if (!lastMessage || lastMessage.role !== "user") return;

      const userText = lastMessage.content
        .filter((p): p is { type: "text"; text: string } => p.type === "text")
        .map((p) => p.text)
        .join("\n");

      if (!userText.trim()) return;

      // Auto-create conversation if needed
      let conversationId = config.getConversationId();
      if (!conversationId) {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) throw new Error("Not authenticated");

        const { data: conv, error } = await supabase
          .from("agent_conversations")
          .insert({
            created_by: user.id,
            organization_id: config.organizationId || null,
            status: "active",
          })
          .select("id")
          .single();

        if (error || !conv) throw new Error("Failed to create conversation");
        conversationId = conv.id;
        config.setConversationId(conversationId);
      }

      // Build request body
      const body: Record<string, unknown> = {
        conversation_id: conversationId,
        message: userText,
        context_mode: config.contextMode || null,
        brief_context: config.briefContext || null,
        project_id: config.projectId || null,
      };

      if (config.modelOverride) {
        body.model_id = config.modelOverride;
      }

      const token = config.getAccessToken();
      const response = await fetch(
        `${config.supabaseUrl}/functions/v1/search-agent-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            apikey: config.apiKey,
          },
          body: JSON.stringify(body),
          signal: abortSignal,
        }
      );

      if (!response.ok) {
        const errText = await response.text().catch(() => "Unknown error");
        throw new Error(`Chat API error ${response.status}: ${errText}`);
      }

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";
      let thinkingContent = "";
      let inThinking = false;

      try {
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

              // Done event
              if (event.done) continue;

              // Thinking delta
              if (event.choices?.[0]?.delta?.thinking) {
                const chunk = event.choices[0].delta.thinking;
                thinkingContent += chunk;
                if (!inThinking) {
                  inThinking = true;
                }
                // Yield reasoning status updates
                yield {
                  status: { type: "running" as const },
                };
                continue;
              }

              // Content delta
              if (event.choices?.[0]?.delta?.content) {
                const chunk = event.choices[0].delta.content;
                // Filter out technical tags
                if (chunk.includes("[SEARCH_PLAN]") || chunk.includes("[/SEARCH_PLAN]") ||
                    chunk.includes("[AGENT_ACTION]") || chunk.includes("[/AGENT_ACTION]")) {
                  continue;
                }
                fullContent += chunk;

                // Yield content
                yield {
                  content: [{ type: "text" as const, text: fullContent }],
                };
              }

              // Tool use events
              if (event.choices?.[0]?.delta?.tool_calls) {
                // Tool calls are handled by the edge function internally
                continue;
              }
            } catch {
              // Skip malformed JSON
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      // Final yield with complete content
      if (fullContent) {
        // Clean up technical markers from final content
        const cleanContent = fullContent
          .replace(/\[SEARCH_PLAN\][\s\S]*?\[\/SEARCH_PLAN\]/g, "")
          .replace(/\[AGENT_ACTION\][\s\S]*?\[\/AGENT_ACTION\]/g, "")
          .trim();

        yield {
          content: [{ type: "text" as const, text: cleanContent }],
          status: { type: "complete" as const, reason: "stop" as const },
        };
      }
    },
  };
}
