/**
 * Service Worker — Background script de l'extension Konekt.
 *
 * Responsabilités :
 *  - Exposer une API de capture cookie LinkedIn (chrome.cookies API)
 *  - Router les messages depuis content scripts / popup
 *  - Garder un cache léger pour le pipeline status (évite refetch trop fréquent)
 */

import { konektApi } from '../lib/konekt-api';
import { storage } from '../lib/storage';
import type { PipelineStatusEntry } from '../lib/konekt-api';

// ─── Message types ────────────────────────────────────────────────────────────

export type Message =
  | { type: 'CAPTURE_LINKEDIN_COOKIE' }
  | { type: 'RECONNECT_LINKEDIN'; reconnect_account_id?: string }
  | { type: 'GET_PIPELINE_STATUS'; urls: string[] }
  | { type: 'QUICK_ADD_CANDIDATE'; payload: { linkedin_url: string; name?: string; headline?: string; job_id?: string; note?: string } }
  | { type: 'PING' };

export type MessageResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

// ─── Handlers ────────────────────────────────────────────────────────────────

/**
 * Capture le cookie li_at depuis le domaine LinkedIn.
 * Capte aussi li_a (Sales Nav) si présent — utile pour comptes premium.
 */
async function captureLinkedInCookie(): Promise<{
  li_at: string;
  li_a?: string;
  user_agent: string;
} | null> {
  // li_at = cookie classic LinkedIn
  const liAtCookie = await chrome.cookies.get({
    url: 'https://www.linkedin.com',
    name: 'li_at',
  });

  if (!liAtCookie?.value) return null;

  // li_a = cookie Sales Navigator (premium)
  const liACookie = await chrome.cookies.get({
    url: 'https://www.linkedin.com',
    name: 'li_a',
  });

  // user_agent : on demande au content script de nous le donner via un message
  // (le SW n'a pas accès direct au navigator d'une page). Fallback : UA Chrome stable.
  const userAgent = await getUserAgentFromAnyTab() || defaultUserAgent();

  return {
    li_at: liAtCookie.value,
    li_a: liACookie?.value || undefined,
    user_agent: userAgent,
  };
}

async function getUserAgentFromAnyTab(): Promise<string | null> {
  try {
    const tabs = await chrome.tabs.query({ url: 'https://*.linkedin.com/*' });
    if (tabs.length === 0) return null;
    const tabId = tabs[0].id;
    if (!tabId) return null;
    const result = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => navigator.userAgent,
    });
    return (result?.[0]?.result as string) || null;
  } catch {
    return null;
  }
}

function defaultUserAgent(): string {
  return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

async function handleReconnect(reconnectAccountId?: string): Promise<MessageResponse> {
  const captured = await captureLinkedInCookie();
  if (!captured) {
    return {
      ok: false,
      error: 'Cookie li_at LinkedIn introuvable — êtes-vous connecté à linkedin.com dans ce navigateur ?',
    };
  }

  const { data, error } = await konektApi.reconnectLinkedIn({
    access_token: captured.li_at,
    user_agent: captured.user_agent,
    reconnect_account_id: reconnectAccountId,
  });

  if (error || !data?.success) {
    return { ok: false, error: data?.error || error || 'Erreur de reconnexion' };
  }

  await storage.setLastReconnectAt(Date.now());
  return { ok: true, data: { account_id: data.account_id } };
}

// ─── Pipeline status cache ───────────────────────────────────────────────────

interface CacheEntry {
  data: PipelineStatusEntry;
  cachedAt: number;
}
const CACHE_TTL_MS = 5 * 60 * 1000; // 5min
const pipelineStatusCache = new Map<string, CacheEntry>();

async function handleGetPipelineStatus(urls: string[]): Promise<MessageResponse> {
  const now = Date.now();
  const result: Record<string, PipelineStatusEntry> = {};
  const toFetch: string[] = [];

  for (const url of urls) {
    const cached = pipelineStatusCache.get(url);
    if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
      result[url] = cached.data;
    } else {
      toFetch.push(url);
    }
  }

  if (toFetch.length > 0) {
    const { data, error } = await konektApi.pipelineStatus(toFetch);
    if (error) {
      // Pas bloquant : on retourne ce qu'on a en cache
      console.warn('[sw] pipeline status fetch failed:', error);
    } else if (data?.success) {
      for (const [url, entry] of Object.entries(data.statuses)) {
        pipelineStatusCache.set(url, { data: entry, cachedAt: now });
        result[url] = entry;
      }
    }
  }

  return { ok: true, data: { statuses: result } };
}

async function handleQuickAdd(payload: {
  linkedin_url: string;
  name?: string;
  headline?: string;
  job_id?: string;
  note?: string;
}): Promise<MessageResponse> {
  const { data, error } = await konektApi.quickAdd(payload);
  if (error || !data?.success) {
    return { ok: false, error: error || 'Erreur lors de l\'ajout' };
  }
  // Invalide le cache pipeline pour cette URL
  pipelineStatusCache.delete(payload.linkedin_url);
  return { ok: true, data };
}

// ─── Message router ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  // sendResponse est synchrone par défaut. Retour true = on répondra plus tard (async).
  (async () => {
    try {
      switch (message.type) {
        case 'PING':
          sendResponse({ ok: true, data: { pong: true } });
          break;

        case 'CAPTURE_LINKEDIN_COOKIE': {
          const captured = await captureLinkedInCookie();
          sendResponse(captured
            ? { ok: true, data: captured }
            : { ok: false, error: 'Cookie LinkedIn introuvable' }
          );
          break;
        }

        case 'RECONNECT_LINKEDIN':
          sendResponse(await handleReconnect(message.reconnect_account_id));
          break;

        case 'GET_PIPELINE_STATUS':
          sendResponse(await handleGetPipelineStatus(message.urls));
          break;

        case 'QUICK_ADD_CANDIDATE':
          sendResponse(await handleQuickAdd(message.payload));
          break;

        default:
          sendResponse({ ok: false, error: 'Type de message inconnu' });
      }
    } catch (e: any) {
      sendResponse({ ok: false, error: e?.message || 'Erreur SW' });
    }
  })();
  return true; // = réponse async
});

console.log('[Konekt SW] Service worker started');
