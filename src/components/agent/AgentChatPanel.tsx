import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { History, Bot, ArrowLeft, SquarePen, X } from 'lucide-react';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { AgentConversationsList } from './AgentConversationsList';
import { Job } from '@/types/jobs';
import { useAgent } from '@/contexts/AgentContext';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { supabase } from '@/integrations/supabase/client';
import { useLocalRuntime, AssistantRuntimeProvider, type ChatModelAdapter, type ThreadMessageLike } from '@assistant-ui/react';
import { createSkalrChatAdapter } from '@/components/assistant-ui/chat-adapter';
import { SkalrThread } from '@/components/assistant-ui/thread';
import { SearchCandidatesToolUI, EnrichCompanyToolUI, WebSearchToolUI } from '@/components/assistant-ui/tool-uis';
import { ConnectorMenu, type ChatConnectorOption } from '@/components/assistant-ui/connector-menu';
import type { AgentConversation } from '@/types/agentChat';
import { AgentToolApprovalCard } from './AgentToolApprovalCard';
import { AgentBackgroundTasksBar } from './AgentBackgroundTasksBar';
import { useQuery } from '@tanstack/react-query';
import { isUsableNotionConnection, useNotionMcpStatus } from '@/hooks/useNotionMcpStatus';

interface AgentChatPanelProps {
  onClose?: () => void;
  contextMode?: 'brief' | 'process' | 'sourcing' | 'outreach' | null;
  briefContext?: Record<string, unknown> | null;
  initialMessage?: string | null;
  autoJob?: Job | null;
  projectId?: string | null;
  accountId?: string | null;
}

/**
 * Owns the assistant-ui runtime. Isolated in its own component so it can be
 * REMOUNTED (via `key`) when the conversation changes — `useLocalRuntime`
 * only reads `initialMessages` once at creation, so re-seeding the thread
 * from `agent_messages` (history click / restore on reopen) requires a fresh
 * runtime. A model/context change does NOT change the key → no remount, the
 * in-flight stream is preserved.
 */
const ChatThread: React.FC<{
  adapter: ChatModelAdapter;
  initialMessages: readonly ThreadMessageLike[];
  contextMode?: 'brief' | 'process' | 'sourcing' | 'outreach' | null;
  modelSlot: React.ReactNode;
  toolsSlot: React.ReactNode;
  filesBridge?: React.MutableRefObject<{ files: File[]; clear: () => void }>;
}> = ({ adapter, initialMessages, contextMode, modelSlot, toolsSlot, filesBridge }) => {
  const runtime = useLocalRuntime(adapter, { initialMessages });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <SkalrThread contextMode={contextMode} modelSlot={modelSlot} toolsSlot={toolsSlot} filesBridge={filesBridge} />
      <SearchCandidatesToolUI />
      <EnrichCompanyToolUI />
      <WebSearchToolUI />
    </AssistantRuntimeProvider>
  );
};

const CONNECTOR_PREFERENCES_KEY = 'konekt:assistant:disabled-connectors:v2';
const CONNECTOR_NAME_RE = /^[a-z0-9][a-z0-9_-]{1,39}$/;

type ConnectorPreferences = Record<string, string[]>;

function loadConnectorPreferences(): ConnectorPreferences {
  if (typeof window === 'undefined') return {};
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CONNECTOR_PREFERENCES_KEY) || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).map(([scope, names]) => [
        scope,
        Array.isArray(names)
          ? [...new Set(names.filter((name): name is string => typeof name === 'string' && CONNECTOR_NAME_RE.test(name)))].slice(0, 50)
          : [],
      ]),
    );
  } catch {
    return {};
  }
}

function connectorLabel(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export const AgentChatPanel: React.FC<AgentChatPanelProps> = ({
  onClose,
  contextMode,
  briefContext,
  initialMessage,
  autoJob,
  projectId,
  accountId,
}) => {
  // conversationId lives in AgentContext (NOT local state): the Copilot panel
  // unmounts when the Sheet closes, so local state would be lost on reopen.
  // The context survives above the Sheet → reopening resumes the conversation.
  const { appContext, initialMessage: agentCtxMessage, conversationId, setConversationId, openRequestNonce } = useAgent();
  // Notion-AI-style: land directly in the chat. History/new conversation is
  // reachable from the header control, not a launcher screen.
  const [showList, setShowList] = useState(false);
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  // History rehydration: a fresh runtime is keyed by `seedKey` and seeded with
  // `initialMessages` fetched from agent_messages. `seeding` gates the thread
  // so we don't flash the welcome screen before history loads.
  const [initialMessages, setInitialMessages] = useState<readonly ThreadMessageLike[]>([]);
  const [seedKey, setSeedKey] = useState(0);
  // Start in "seeding" if a conversation is already active (panel reopened):
  // shows the loader straight away instead of flashing the empty welcome.
  const [seeding, setSeeding] = useState<boolean>(Boolean(conversationId));

  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const notionStatusQuery = useNotionMcpStatus(organizationId, user?.id);
  const { data: organizationMcpServers = [], isLoading: mcpServersLoading } = useQuery({
    // Keep this cache separate from AgentConnectorsSettings, whose rows have a
    // different (full management) shape.
    queryKey: ['assistant-chat-mcp-servers', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_mcp_servers')
        .select('name, enabled')
        .eq('organization_id', organizationId)
        .eq('enabled', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(organizationId),
    staleTime: 0,
  });
  const [connectorPreferences, setConnectorPreferences] = useState<ConnectorPreferences>(loadConnectorPreferences);
  const connectorPreferenceScope = user?.id && organizationId ? `${user.id}:${organizationId}` : null;

  const disabledConnectors = useMemo(
    () => (connectorPreferenceScope ? connectorPreferences[connectorPreferenceScope] ?? [] : []),
    [connectorPreferenceScope, connectorPreferences],
  );

  const setConnectorEnabled = useCallback((name: string, enabled: boolean) => {
    if (!connectorPreferenceScope || !CONNECTOR_NAME_RE.test(name)) return;
    setConnectorPreferences((previous) => {
      const current = previous[connectorPreferenceScope] ?? [];
      const nextForScope = enabled
        ? current.filter((connectorName) => connectorName !== name)
        : [...new Set([name, ...current])].slice(0, 50);
      const next = { ...previous, [connectorPreferenceScope]: nextForScope };
      try {
        window.localStorage.setItem(CONNECTOR_PREFERENCES_KEY, JSON.stringify(next));
      } catch {
        // Preference remains active for this browser session.
      }
      return next;
    });
  }, [connectorPreferenceScope]);

  const notionConnected = isUsableNotionConnection(notionStatusQuery.data?.connection);
  const connectorOptions = useMemo<ChatConnectorOption[]>(() => {
    const disabled = new Set(disabledConnectors);
    return [
      {
        name: 'notion',
        label: 'Notion',
        kind: 'notion',
        connected: notionConnected,
        enabled: notionConnected && !disabled.has('notion'),
        status: notionStatusQuery.isLoading
          ? 'checking'
          : notionStatusQuery.isError
            ? 'unavailable'
            : notionConnected
              ? 'connected'
              : 'disconnected',
      },
      ...organizationMcpServers
        .filter((server) => server.name !== 'notion')
        .map((server) => ({
          name: server.name,
          label: connectorLabel(server.name),
          kind: 'mcp' as const,
          connected: server.enabled,
          enabled: server.enabled && !disabled.has(server.name),
          status: server.enabled ? 'connected' as const : 'disconnected' as const,
        })),
    ];
  }, [disabledConnectors, notionConnected, notionStatusQuery.isError, notionStatusQuery.isLoading, organizationMcpServers]);
  const enabledConnectorNames = useMemo(
    () => connectorOptions
      .filter((connector) => connector.connected && connector.enabled)
      .map((connector) => connector.name),
    [connectorOptions],
  );
  const enabledConnectorNamesRef = useRef(enabledConnectorNames);
  enabledConnectorNamesRef.current = enabledConnectorNames;

  // Keep access token fresh
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setAccessToken(session?.access_token || null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setAccessToken(session?.access_token || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Refs for adapter (avoids recreating runtime on every state change)
  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const accessTokenRef = useRef(accessToken);
  accessTokenRef.current = accessToken;

  // Passive app-location context — read fresh at send time via a ref so the
  // runtime is NOT recreated on every navigation (would reset the chat).
  const appContextRef = useRef(appContext);
  appContextRef.current = appContext;

  // Mode contextuel dérivé de l'onglet mission actif (P0.1 audit 2026-07-14) :
  // ouvrir le Copilot (FAB/Cmd+K) sur l'onglet brief/process/outreach d'une
  // mission active le mode correspondant sans bouton dédié. Le sourcing reste
  // déclenché explicitement (openContextualAgent, flow calibration).
  const derivedTabMode: 'brief' | 'process' | 'outreach' | null =
    !contextMode &&
    appContext.missionId &&
    (appContext.missionTab === 'brief' || appContext.missionTab === 'process' || appContext.missionTab === 'outreach')
      ? appContext.missionTab
      : null;
  const effectiveContextMode = contextMode ?? derivedTabMode;
  // Lu au moment de l'envoi (ref) : la navigation entre onglets ne recrée pas
  // le runtime, mais le message suivant part avec le mode de l'onglet courant.
  const effectiveContextModeRef = useRef(effectiveContextMode);
  effectiveContextModeRef.current = effectiveContextMode;

  // Pont fichiers joints (P1.2) : le composer (SkalrThread) publie ses
  // fichiers ici ; l'adaptateur les lit à l'envoi puis vide les chips.
  const filesBridge = useRef<{ files: File[]; clear: () => void }>({ files: [], clear: () => {} });

  // Lazily ensure a conversation row exists before the first message.
  // The backend 400s without a conversation_id and has no create path, so
  // we create it client-side (RLS-scoped) — same insert as useAgentChat.
  const ensureConversationId = useCallback(async (): Promise<string> => {
    if (conversationIdRef.current) return conversationIdRef.current;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user || !organizationId) throw new Error('Organisation introuvable. Reconnecte-toi.');
    const job = selectedJob ?? autoJob ?? null;
    const { data, error } = await supabase
      .from('agent_conversations')
      .insert({
        organization_id: organizationId,
        created_by: user.id,
        job_id: job?.id || null,
        job_title: job?.title || null,
        status: 'calibrating',
      })
      .select()
      .single();
    if (error || !data) throw new Error(error?.message || 'Création de conversation impossible');
    conversationIdRef.current = data.id;
    setConversationId(data.id);
    setShowList(false);
    return data.id;
  }, [organizationId, selectedJob, autoJob, setConversationId]);

  const adapter = useMemo(
    () =>
      createSkalrChatAdapter({
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        ensureConversationId,
        getAccessToken: () => accessTokenRef.current || '',
        getAppContext: () => appContextRef.current,
        getContextMode: () => effectiveContextModeRef.current ?? null,
        getPendingFiles: () => filesBridge.current.files,
        consumePendingFiles: () => filesBridge.current.clear(),
        getEnabledConnectors: () => enabledConnectorNamesRef.current,
        apiKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        modelOverride: selectedModel,
        contextMode,
        briefContext,
        projectId,
        accountId,
        organizationId: organizationId || undefined,
      }),
    [ensureConversationId, selectedModel, contextMode, briefContext, projectId, accountId, organizationId],
  );

  // Fetch a conversation's messages from agent_messages (RLS-scoped) and
  // remount the runtime seeded with them. id=null → fresh empty chat.
  const seedFrom = useCallback(async (id: string | null) => {
    if (!id) {
      setInitialMessages([]);
      setSeeding(false);
      setSeedKey((k) => k + 1);
      return;
    }
    setSeeding(true);
    try {
      const { data } = await supabase
        .from('agent_messages')
        .select('role, content, created_at')
        .eq('conversation_id', id)
        .order('created_at', { ascending: true });
      const msgs: ThreadMessageLike[] = (data || [])
        .filter(
          (r) =>
            (r.role === 'user' || r.role === 'assistant') &&
            typeof r.content === 'string' &&
            r.content.trim().length > 0,
        )
        .map((r) => ({ role: r.role as 'user' | 'assistant', content: r.content as string }));
      setInitialMessages(msgs);
    } catch {
      setInitialMessages([]);
    }
    setSeedKey((k) => k + 1);
    setSeeding(false);
  }, []);

  // Restore on (re)mount: the panel unmounts when the Sheet closes, so on
  // reopen we rehydrate the conversation that's still in context. Mount-only
  // on purpose — the lazy id-create on first message must NOT reseed (it would
  // remount mid-stream and drop the in-flight answer).
  useEffect(() => {
    if (conversationId) seedFrom(conversationId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Reprise explicite (openConversation depuis /agents ou ailleurs) : le nonce
  // bump force le re-seed même si le panel est déjà monté. Le create-path lazy
  // (ensureConversationId) ne touche pas au nonce → pas de reseed mid-stream.
  const handledNonceRef = useRef(openRequestNonce);
  useEffect(() => {
    if (openRequestNonce !== handledNonceRef.current) {
      handledNonceRef.current = openRequestNonce;
      setShowList(false);
      seedFrom(conversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRequestNonce]);

  // List conversations for history
  const listConversations = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return [];
    const { data } = await supabase
      .from('agent_conversations')
      .select('*')
      .eq('created_by', user.id)
      .is('archived_at', null)
      .order('updated_at', { ascending: false })
      .limit(20);
    return (data || []) as unknown as AgentConversation[];
  }, []);

  const handleNewConversation = useCallback(async (job?: Job | null) => {
    // Clear conversation — the adapter auto-creates on first message — and
    // remount a fresh empty runtime.
    setConversationId(null);
    setSelectedJob(job || null);
    setShowList(false);
    seedFrom(null);
  }, [setConversationId, seedFrom]);

  const handleSelectConversation = useCallback((conv: AgentConversation) => {
    setConversationId(conv.id);
    setShowList(false);
    seedFrom(conv.id);
  }, [setConversationId, seedFrom]);

  // Handle initial message from AgentContext
  const effectiveInitialMessage = initialMessage ?? agentCtxMessage;
  const initialMessageHandledRef = useRef<string | null>(null);

  useEffect(() => {
    if (effectiveInitialMessage && effectiveInitialMessage !== initialMessageHandledRef.current) {
      initialMessageHandledRef.current = effectiveInitialMessage;
      setShowList(false);
      // The message will be typed by the user or sent via suggestion
    }
  }, [effectiveInitialMessage]);

  // ── History view (Notion/Claude-style: back · new chat · recent list) ──
  if (showList) {
    return (
      <div className="flex flex-col h-full bg-background animate-slide-in-left">
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 shrink-0 bg-background/80 backdrop-blur-sm">
          <button
            onClick={() => setShowList(false)}
            title="Retour au chat"
            className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
          >
            <ArrowLeft className="w-4 h-4 text-foreground" />
          </button>
          <AnimatedOrb size={24} speed={4} />
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate text-foreground">Conversations</h3>
            <p className="text-[11px] text-muted-foreground">Historique du Copilot</p>
          </div>
          {onClose && (
            <button
              onClick={onClose}
              title="Fermer"
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* New conversation */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <button
            onClick={() => handleNewConversation()}
            className="flex w-full items-center gap-2.5 rounded-2xl border border-border bg-card/40 px-4 py-3 text-left transition-all hover:border-primary/40 hover:bg-accent active:scale-[0.99]"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <SquarePen className="h-4 w-4" />
            </span>
            <span className="text-[13px] font-semibold text-foreground">Nouvelle conversation</span>
          </button>
        </div>

        {/* Recent conversations */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <AgentConversationsList onSelect={handleSelectConversation} listConversations={listConversations} />
        </div>
      </div>
    );
  }

  // ── Chat view — assistant-ui is the sole runtime ──
  return (
    <div className="flex flex-col h-full bg-background relative animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 shrink-0 bg-background/80 backdrop-blur-sm">
        <button
          onClick={() => setShowList(true)}
          title="Historique des conversations"
          className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors"
        >
          <History className="w-4 h-4 text-foreground" />
        </button>
        <AnimatedOrb size={24} speed={4}>
          <Bot className="w-3 h-3 text-foreground/70" />
        </AnimatedOrb>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate text-foreground">
            {effectiveContextMode === 'sourcing' ? 'Sourcing Assistant'
              : effectiveContextMode === 'brief' ? 'Brief Assistant'
              : effectiveContextMode === 'process' ? 'Process Assistant'
              : effectiveContextMode === 'outreach' ? 'Outreach Assistant'
              : 'Copilot IA'}
          </h3>
          <p className="text-[11px] text-muted-foreground">
            {effectiveContextMode ? 'Mode contextuel' : 'Conversation libre'}
          </p>
        </div>
        <button
          onClick={() => handleNewConversation()}
          title="Nouvelle conversation"
          className="h-8 w-8 rounded-lg flex items-center justify-center hover:bg-muted transition-colors shrink-0"
        >
          <SquarePen className="w-4 h-4 text-foreground" />
        </button>
      </div>

      {/* Tool approval banner — Sprint 1 (RAG_AGENT_AUDIT.md §8) */}
      <AgentToolApprovalCard conversationId={conversationId} />

      {/* Tâches de fond en cours (scoring en masse) — progression temps réel */}
      <AgentBackgroundTasksBar />

      {/* Thread — keyed by seedKey so it remounts (fresh seeded runtime)
          on history-select / restore, but NOT on model/context change. */}
      {seeding ? (
        <div className="flex-1 flex items-center justify-center">
          <AnimatedOrb size={32} speed={3} />
        </div>
      ) : (
        <ChatThread
          key={seedKey}
          adapter={adapter}
          initialMessages={initialMessages}
          contextMode={effectiveContextMode}
          filesBridge={filesBridge}
          toolsSlot={
            <ConnectorMenu
              connectors={connectorOptions}
              loading={notionStatusQuery.isLoading || mcpServersLoading}
              onToggle={setConnectorEnabled}
            />
          }
          modelSlot={
            <ModelPicker
              actionId={effectiveContextMode === 'sourcing' ? 'agent_search_calibration' : 'agent_chat'}
              value={selectedModel}
              onChange={setSelectedModel}
              compact
            />
          }
        />
      )}
    </div>
  );
};
