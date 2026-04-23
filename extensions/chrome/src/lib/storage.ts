/**
 * Wrapper typé sur chrome.storage.local pour stocker token + préférences.
 */

import { STORAGE_KEYS } from './config';

export interface UserInfo {
  email?: string;
  organization_name?: string;
  cached_at: string;
}

export const storage = {
  async getToken(): Promise<string | null> {
    const { [STORAGE_KEYS.TOKEN]: token } = await chrome.storage.local.get(STORAGE_KEYS.TOKEN);
    return typeof token === 'string' && token ? token : null;
  },

  async setToken(token: string): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.TOKEN]: token });
  },

  async clearToken(): Promise<void> {
    await chrome.storage.local.remove(STORAGE_KEYS.TOKEN);
  },

  async getUserInfo(): Promise<UserInfo | null> {
    const { [STORAGE_KEYS.USER_INFO]: info } = await chrome.storage.local.get(STORAGE_KEYS.USER_INFO);
    return info && typeof info === 'object' ? (info as UserInfo) : null;
  },

  async setUserInfo(info: UserInfo): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.USER_INFO]: info });
  },

  async getLastReconnectAt(): Promise<number | null> {
    const { [STORAGE_KEYS.LAST_RECONNECT_AT]: ts } = await chrome.storage.local.get(STORAGE_KEYS.LAST_RECONNECT_AT);
    return typeof ts === 'number' ? ts : null;
  },

  async setLastReconnectAt(ts: number): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.LAST_RECONNECT_AT]: ts });
  },

  async getPipelineOverlayEnabled(): Promise<boolean> {
    const { [STORAGE_KEYS.PIPELINE_OVERLAY_ENABLED]: enabled } = await chrome.storage.local.get(STORAGE_KEYS.PIPELINE_OVERLAY_ENABLED);
    return enabled !== false; // default true
  },

  async setPipelineOverlayEnabled(enabled: boolean): Promise<void> {
    await chrome.storage.local.set({ [STORAGE_KEYS.PIPELINE_OVERLAY_ENABLED]: enabled });
  },
};
