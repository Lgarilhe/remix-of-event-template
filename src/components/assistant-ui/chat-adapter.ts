import type { ChatModelAdapter, ChatModelRunOptions } from '@assistant-ui/react';

interface SkalrAdapterConfig {
  supabaseUrl: string;
  /**
   * Returns the active conversation id, creating one if none exists yet.
   * Le backend sait désormais créer la conversation si l'id est absent
   * (create-path P0.4) et renvoie l'id en 1er event SSE — mais le client web
   * continue de créer côté RLS pour avoir l'id tout de suite (historique,
   * bandeau d'approbation realtime).
   */
  ensureConversationId: () => Promise<string>;
  getAccessToken: () => string;
  /** Fresh passive app-location context at send time (page/mission/tab/candidate) */
  getAppContext?: () => unknown;
  /**
   * Fresh effective context mode at send time. Takes precedence over the
   * static `contextMode` — used to derive the mode from the active mission
   * tab (brief/process/outreach) without recreating the runtime on navigation.
   */
  getContextMode?: () => string | null;
  /**
   * Fichiers joints en attente dans le composer (P1.2). Lus à l'envoi :
   * chaque fichier est envoyé à `ingest-user-file` (extraction + indexation
   * knowledge lake), et son texte est injecté dans le message pour que
   * l'agent le voie immédiatement. `consumePendingFiles` vide les chips UI.
   */
  getPendingFiles?: () => File[];
  consumePendingFiles?: () => void;
  apiKey: string;
  modelOverride?: string | null;
  contextMode?: string | null;
  briefContext?: Record<string, unknown> | null;
  projectId?: string | null;
  accountId?: string | null;
  organizationId?: string;
}

/** File → base64 (sans le préfixe data:) */
async function fileToBase64(file: File): Promise<string> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Envoie les fichiers joints à ingest-user-file et construit les blocs
 * [FICHIER JOINT] à injecter dans le message. Fail-soft par fichier : un
 * échec d'extraction devient une note visible par l'agent (pas un throw).
 */
async function ingestPendingFiles(config: SkalrAdapterConfig, files: File[]): Promise<string> {
  let blocks = '';
  for (const file of files.slice(0, 5)) {
    try {
      const resp = await fetch(`${config.supabaseUrl}/functions/v1/ingest-user-file`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.getAccessToken()}`,
          apikey: config.apiKey,
        },
        body: JSON.stringify({
          organization_id: config.organizationId,
          filename: file.name,
          mime_type: file.type || undefined,
          content_base64: await fileToBase64(file),
          project_id: config.projectId || undefined,
        }),
      });
      const data = await resp.json().catch(() => null);
      if (resp.ok && data?.success && data.extracted_text) {
        blocks += `\n\n[FICHIER JOINT : ${file.name}]\n${String(data.extracted_text).slice(0, 8000)}\n[/FICHIER JOINT]`;
        if (data.lake_indexed) {
          blocks += `\n(Ce document est aussi indexé dans la base de connaissances — retrouvable plus tard via la recherche sémantique.)`;
        }
      } else {
        blocks += `\n\n[FICHIER JOINT : ${file.name} — lecture impossible : ${data?.error || `erreur ${resp.status}`}]`;
      }
    } catch (e) {
      blocks += `\n\n[FICHIER JOINT : ${file.name} — lecture impossible : ${e instanceof Error ? e.message : 'erreur réseau'}]`;
    }
  }
  return blocks;
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

      const pendingFiles = config.getPendingFiles?.() ?? [];
      if (!userContent.trim() && pendingFiles.length === 0) return;

      // The backend rejects requests without a conversation_id (400) and has
      // no create-on-the-fly path. Guarantee the row exists first.
      const conversationId = await config.ensureConversationId();
      if (!conversationId) throw new Error('Conversation introuvable');

      // Fichiers joints (P1.2) : extraction + indexation lake AVANT l'envoi,
      // le texte extrait est injecté à la suite du message utilisateur.
      let messageWithFiles = userContent;
      if (pendingFiles.length > 0) {
        messageWithFiles += await ingestPendingFiles(config, pendingFiles);
        config.consumePendingFiles?.();
      }

      const appContext = config.getAppContext?.() ?? undefined;
      const contextMode = config.getContextMode ? config.getContextMode() : (config.contextMode || null);

      const resp = await fetch(`${config.supabaseUrl}/functions/v1/search-agent-chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.getAccessToken()}`,
          apikey: config.apiKey,
        },
        body: JSON.stringify({
          conversation_id: conversationId,
          message: messageWithFiles,
          _ai_model: config.modelOverride || undefined,
          // Le sourcing garde son action historique (calibration) ; les autres
          // modes (libre/brief/process/outreach) sont facturés en agent_chat.
          _ai_action: contextMode === 'sourcing' ? 'agent_search_calibration' : 'agent_chat',
          context_mode: contextMode || undefined,
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
