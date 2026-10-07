import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { History, ArrowLeft, Brain, SquarePen, X, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ModelPicker } from '@/components/ai/ModelPicker';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import { RESERVED_BUILTIN_CONNECTORS, connectorLabel } from '@/lib/assistantConnectors';
import type { AgentConversation } from '@/types/agentChat';
import { AgentToolApprovalCard } from './AgentToolApprovalCard';
import { AgentBackgroundTasksBar } from './AgentBackgroundTasksBar';
import { AgentMemoryProposals } from './AgentMemoryProposals';
import { AgentMemoryDialog } from './AgentMemoryDialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { isUsableNotionConnection, useNotionMcpStatus } from '@/hooks/useNotionMcpStatus';
import { useEmailConnectorStatus, type EmailConnectorProvider } from '@/hooks/useEmailConnectorStatus';

interface AgentChatPanelProps {
  onClose?: () => void;
  contextMode?: 'brief' | 'process' | 'sourcing' | 'outreach' | null;
  briefContext?: Record<string, unknown> | null;
  initialMessage?: string | null;
  autoJob?: Job | null;
  projectId?: string | null;
  accountId?: string | null;
}

/** Bouton icône de l'en-tête : nom accessible et infobulle, 44 px sur téléphone. */
const HeaderIconButton: React.FC<{ label: string; onClick: () => void; children: React.ReactNode }> = ({
  label,
  onClick,
  children,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        onClick={onClick}
        aria-label={label}
        className="shrink-0 max-md:h-11 max-md:w-11"
      >
        {children}
      </Button>
    </TooltipTrigger>
    <TooltipContent side="bottom">{label}</TooltipContent>
  </Tooltip>
);

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

function emailConnectorLabel(provider: EmailConnectorProvider): string {
  if (provider === 'gmail') return 'Gmail';
  if (provider === 'outlook') return 'Outlook';
  return 'E-mail';
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
  const [memoryOpen, setMemoryOpen] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
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
  // A resumed conversation keeps its own mission, even after navigating elsewhere.
  const conversationMemoryContext = useQuery({
    queryKey: ['agent-memory', 'conversation', organizationId, user?.id, conversationId],
    queryFn: async () => {
      if (!conversationId) return null;
      const { data, error } = await supabase.from('agent_conversations')
        .select('project_id, job_title').eq('id', conversationId).eq('organization_id', organizationId).single();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(organizationId && user && conversationId),
  });
  const memoryProjectId = conversationId
    ? conversationMemoryContext.data?.project_id ?? null
    : projectId ?? appContext.missionId;
  const notionStatusQuery = useNotionMcpStatus(organizationId, user?.id);
  const emailStatusQuery = useEmailConnectorStatus(organizationId, user?.id);
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
  const emailConnection = emailStatusQuery.data?.connection ?? null;
  const emailConnected = emailConnection?.connected === true;
  const emailProvider = emailConnection?.provider ?? 'email';
  const connectorOptions = useMemo<ChatConnectorOption[]>(() => {
    const disabled = new Set(disabledConnectors);
    return [
      {
        name: 'notion',
        label: 'Notion',
        kind: 'notion',
        connected: notionConnected,
        enabled: notionConnected && !disabled.has('notion'),
        manageHref: '/settings/account/connections#applications',
        status: notionStatusQuery.isLoading
          ? 'checking'
          : notionStatusQuery.isError
            ? 'unavailable'
            : notionConnected
              ? 'connected'
              : 'disconnected',
      },
      {
        name: 'email',
        label: emailConnectorLabel(emailProvider),
        kind: emailProvider,
        description: emailConnection?.emailAddress,
        connected: emailConnected,
        enabled: emailConnected && !disabled.has('email'),
        status: emailStatusQuery.isLoading
          ? 'checking'
          : emailStatusQuery.isError
            ? 'unavailable'
            : emailConnected
              ? 'connected'
              : 'disconnected',
        manageHref: '/settings/account/connections#email',
      },
      ...organizationMcpServers
        .filter((server) => !RESERVED_BUILTIN_CONNECTORS.has(server.name.toLowerCase()))
        .map((server) => ({
          name: server.name,
          label: connectorLabel(server.name),
          kind: 'mcp' as const,
          connected: server.enabled,
          enabled: server.enabled && !disabled.has(server.name),
          status: server.enabled ? 'connected' as const : 'disconnected' as const,
        })),
    ];
  }, [
    disabledConnectors,
    emailConnected,
    emailConnection?.emailAddress,
    emailProvider,
    emailStatusQuery.isError,
    emailStatusQuery.isLoading,
    notionConnected,
    notionStatusQuery.isError,
    notionStatusQuery.isLoading,
    organizationMcpServers,
  ]);
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
    if (!user || !organizationId) throw new Error('Organisation introuvable. Reconnectez-vous.');
    const job = selectedJob ?? autoJob ?? null;
    const { data, error } = await supabase
      .from('agent_conversations')
      .insert({
        organization_id: organizationId,
        created_by: user.id,
        job_id: job?.id || null,
        job_title: job?.title || null,
        // Mission d'origine (Copilot ouvert depuis une mission ou une recherche) :
        // rattache la conversation à son projet.
        project_id: projectId || appContextRef.current.missionId || null,
        status: 'calibrating',
      })
      .select()
      .single();
    if (error || !data) throw new Error(error?.message || 'Création de conversation impossible');
    conversationIdRef.current = data.id;
    setConversationId(data.id);
    setShowList(false);
    return data.id;
  }, [organizationId, selectedJob, autoJob, projectId, setConversationId]);

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
  // startNewConversation (barre latérale) bumpe aussi le nonce avec un
  // conversationId nul : fil vide, sans poste choisi, comme handleNewConversation.
  const handledNonceRef = useRef(openRequestNonce);
  useEffect(() => {
    if (openRequestNonce !== handledNonceRef.current) {
      handledNonceRef.current = openRequestNonce;
      setShowList(false);
      if (!conversationId) setSelectedJob(null);
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
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 bg-background">
          <HeaderIconButton label="Revenir à la conversation" onClick={() => setShowList(false)}>
            <ArrowLeft aria-hidden="true" />
          </HeaderIconButton>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-semibold truncate text-foreground">Conversations</h3>
            <p className="text-2xs text-muted-foreground">Historique de l'assistant</p>
          </div>
          {onClose && (
            <HeaderIconButton label="Fermer l'assistant" onClick={onClose}>
              <X aria-hidden="true" />
            </HeaderIconButton>
          )}
        </div>

        {/* New conversation */}
        <div className="px-4 pt-4 pb-2 shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleNewConversation()}
            className="h-auto w-full justify-start gap-2.5 rounded-xl bg-card px-4 py-3 text-left"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground" aria-hidden="true">
              <SquarePen />
            </span>
            <span className="text-sm font-semibold text-foreground">Nouvelle conversation</span>
          </Button>
        </div>

        {/* Recent conversations */}
        <div className="flex-1 overflow-hidden flex flex-col">
          <AgentConversationsList onSelect={handleSelectConversation} listConversations={listConversations} />
        </div>

        {/* Page complète des agents (/agents n'avait aucun lien entrant) */}
        <div className="px-4 py-3 border-t border-border shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              onClose?.();
              void queryClient.invalidateQueries({ queryKey: ['agent-conversations'] });
              navigate('/agents');
            }}
            className="h-auto w-full justify-between px-2 py-2 text-xs max-md:min-h-11"
          >
            <span>Toutes les conversations</span>
            <ChevronRight aria-hidden="true" />
          </Button>
        </div>
      </div>
    );
  }

  // ── Chat view — assistant-ui is the sole runtime ──
  return (
    <div className="flex flex-col h-full bg-background relative animate-slide-in-right">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 bg-background">
        <HeaderIconButton label="Historique des conversations" onClick={() => setShowList(true)}>
          <History aria-hidden="true" />
        </HeaderIconButton>
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold truncate text-foreground">
            {effectiveContextMode === 'sourcing' ? 'Assistant · Sourcing'
              : effectiveContextMode === 'brief' ? 'Assistant · Brief'
              : effectiveContextMode === 'process' ? 'Assistant · Process'
              : effectiveContextMode === 'outreach' ? 'Assistant · Outreach'
              : 'Assistant'}
          </h3>
          <p className="text-2xs text-muted-foreground">
            {effectiveContextMode ? 'Mode contextuel' : 'Conversation libre'}
          </p>
        </div>
        <HeaderIconButton label="Nouvelle conversation" onClick={() => handleNewConversation()}>
          <SquarePen aria-hidden="true" />
        </HeaderIconButton>
        <HeaderIconButton label="Mémoire de l’assistant" onClick={() => setMemoryOpen(true)}>
          <Brain aria-hidden="true" />
        </HeaderIconButton>
        {/* Fermeture. Le tiroir masque la croix native du Sheet
            (`[&>button]:hidden` dans AgentDrawer), et sur mobile il occupe
            toute la largeur : sans ce bouton il n'y a ni zone extérieure à
            toucher ni touche Échap, donc aucun moyen de sortir. La vue
            « Conversations » a le sien depuis toujours, celle-ci l'avait
            oublié. */}
        {onClose && (
          <HeaderIconButton label="Fermer l'assistant" onClick={onClose}>
            <X aria-hidden="true" />
          </HeaderIconButton>
        )}
      </div>

      <AgentMemoryDialog open={memoryOpen} onOpenChange={setMemoryOpen} projectId={memoryProjectId}
        projectTitle={conversationMemoryContext.data?.job_title ?? appContext.missionTitle}
        contextLoading={Boolean(conversationId && conversationMemoryContext.isPending)}
        contextError={Boolean(conversationId && conversationMemoryContext.isError)}
        onRetryContext={() => void conversationMemoryContext.refetch()} />

      <AgentMemoryProposals conversationId={conversationId} />

      {/* Tool approval banner — Sprint 1 (RAG_AGENT_AUDIT.md §8) */}
      <AgentToolApprovalCard conversationId={conversationId} />

      {/* Tâches de fond en cours (scoring en masse) — progression temps réel */}
      <AgentBackgroundTasksBar />

      {/* Thread — keyed by seedKey so it remounts (fresh seeded runtime)
          on history-select / restore, but NOT on model/context change. */}
      {seeding ? (
        <div className="flex-1 flex items-center justify-center">
          <Spinner label="Chargement de la conversation" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-hidden">
        <ChatThread
          key={seedKey}
          adapter={adapter}
          initialMessages={initialMessages}
          contextMode={effectiveContextMode}
          filesBridge={filesBridge}
          toolsSlot={
            <ConnectorMenu
              connectors={connectorOptions}
              loading={notionStatusQuery.isLoading || emailStatusQuery.isLoading || mcpServersLoading}
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
        </div>
      )}
    </div>
  );
};
