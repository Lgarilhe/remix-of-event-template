/**
 * Client API Konekt pour l'extension. Utilisé par le SW + popup + content scripts.
 * Auth via X-Konekt-Extension-Token header (stocké dans chrome.storage.local).
 */

import { ENDPOINTS } from './config';
import { storage } from './storage';

interface FetchOptions {
  method?: 'GET' | 'POST';
  body?: Record<string, unknown>;
  timeoutMs?: number;
}

async function fetchWithToken<T = unknown>(
  url: string,
  options: FetchOptions = {},
): Promise<{ data: T | null; error: string | null }> {
  const token = await storage.getToken();
  if (!token) {
    return { data: null, error: 'Aucun token configuré — ouvrez l\'extension pour vous connecter' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15000);

  try {
    const response = await fetch(url, {
      method: options.method ?? 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Konekt-Extension-Token': token,
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
    });

    const text = await response.text();
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* keep null */ }

    if (!response.ok) {
      const errMsg = (json as any)?.error || `HTTP ${response.status}`;
      // Si 401, on supprime le token (probablement révoqué)
      if (response.status === 401) {
        await storage.clearToken();
      }
      return { data: null, error: errMsg };
    }

    return { data: json as T, error: null };
  } catch (e: any) {
    if (e?.name === 'AbortError') {
      return { data: null, error: 'Timeout (15s)' };
    }
    return { data: null, error: e?.message || 'Erreur réseau' };
  } finally {
    clearTimeout(timer);
  }
}

export const konektApi = {
  /**
   * Reconnecte le compte LinkedIn via le cookie capturé.
   * Si reconnect_account_id fourni, utilise l'endpoint Unipile reconnect (préserve account_id).
   */
  async reconnectLinkedIn(params: {
    access_token: string;
    user_agent: string;
    reconnect_account_id?: string;
  }): Promise<{ data: { success: boolean; account_id?: string; error?: string } | null; error: string | null }> {
    return fetchWithToken(ENDPOINTS.RECONNECT_LINKEDIN, {
      body: {
        action: 'connect_cookie',
        ...params,
      },
    });
  },

  /**
   * Récupère le statut pipeline pour un batch de URLs LinkedIn.
   */
  async pipelineStatus(urls: string[]): Promise<{
    data: { success: boolean; statuses: Record<string, PipelineStatusEntry>; total_known: number } | null;
    error: string | null;
  }> {
    return fetchWithToken(ENDPOINTS.PIPELINE_STATUS, {
      body: { urls },
      timeoutMs: 8000,
    });
  },

  /**
   * Ajoute un profil au pipeline d'une mission (ou pool global si pas de jobId).
   */
  async quickAdd(params: {
    linkedin_url: string;
    name?: string;
    headline?: string;
    job_id?: string;
    note?: string;
  }): Promise<{ data: { success: boolean; candidate_id: string; already_in_pipeline: boolean } | null; error: string | null }> {
    return fetchWithToken(ENDPOINTS.QUICK_ADD, { body: params });
  },

  /**
   * Vérifie que le token est toujours valide en faisant un list().
   */
  async checkToken(): Promise<boolean> {
    const { data, error } = await fetchWithToken(ENDPOINTS.TOKEN_LIST, {
      body: { action: 'list' },
      timeoutMs: 5000,
    });
    return !error && (data as any)?.success === true;
  },
};

export interface PipelineStatusEntry {
  status: 'discovered' | 'scored' | 'messaged' | 'replied' | 'shortlisted' | 'dismissed';
  pipeline_stage: string | null;
  score: number | null;
  recommendation: string | null;
  mission_title: string | null;
}
