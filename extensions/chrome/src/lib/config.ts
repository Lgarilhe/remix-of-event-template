/**
 * Configuration de l'extension Konekt.
 * Hardcodé en dur pour la prod — à override via build mode si on veut un build dev/staging.
 */

export const KONEKT_API_BASE = 'https://crckfywoyjxkawathdff.supabase.co/functions/v1';
export const KONEKT_APP_URL = 'https://konekt-app-navy.vercel.app';

export const STORAGE_KEYS = {
  TOKEN: 'konekt_extension_token',
  USER_INFO: 'konekt_user_info',
  LAST_RECONNECT_AT: 'konekt_last_reconnect_at',
  PIPELINE_OVERLAY_ENABLED: 'konekt_pipeline_overlay_enabled',
} as const;

/**
 * Endpoints exposés par les edge functions Supabase pour l'extension.
 */
export const ENDPOINTS = {
  RECONNECT_LINKEDIN: `${KONEKT_API_BASE}/unipile-accounts`,
  PIPELINE_STATUS: `${KONEKT_API_BASE}/extension-pipeline-status`,
  QUICK_ADD: `${KONEKT_API_BASE}/extension-quick-add`,
  TOKEN_LIST: `${KONEKT_API_BASE}/extension-token`,
} as const;
