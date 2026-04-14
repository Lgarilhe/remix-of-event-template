import type { ChatModelAdapter } from "@assistant-ui/react";

export interface SkalrChatAdapterOptions {
  supabaseUrl: string;
  accessToken: string;
  apiKey: string;
  conversationId: string;
  modelOverride?: string | null;
  contextMode?: string | null;
  briefContext?: Record<string, unknown> | null;
  projectId?: string | null;
  accountId?: string | null;
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

      const response = await fetch(
        `${options.supabaseUrl}/functions/v1/search-agent-chat`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${options.accessToken}`,
            apikey: options.apiKey,
          },
          body: JSON.stringify({
            conversation_id: options.conversationId,
            message: text,
            _ai_model: options.modelOverride || undefined,
            _ai_action: "agent_search_calibration",
            context_mode: options.contextMode || undefined,
            brief_context: options.briefContext || undefined,
            project_id: options.projectId || undefined,
            account_id: options.accountId || undefined,
          }),
          signal: abortSignal,
        },
      );

      if (!response.ok) {
        throw new Error(`search-agent-chat failed: ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error("No response body");

      const decoder = new TextDecoder();
      let fullText = "";
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

            // Handle text content (skip thinking for now)
            const contentText = event.choices?.[0]?.delta?.content;
            if (contentText) {
              fullText += contentText;
              yield {
                content: [{ type: "text" as const, text: fullText }],
              };
            }
          } catch {
            // skip malformed JSON lines
          }
        }
      }
    },
  };
}
