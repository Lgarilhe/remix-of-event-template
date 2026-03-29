import { useState, useCallback } from 'react';

const STORAGE_KEY = 'konekt_ai_model_default';

/**
 * Hook to manage the organization's default AI model preference.
 * Stores in localStorage for now (no DB column yet).
 * Returns null = auto-routing (recommended).
 */
export const useModelPreference = () => {
  const [modelId, setModelIdState] = useState<string | null>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || null;
    } catch {
      return null;
    }
  });

  const setModelId = useCallback((id: string | null) => {
    setModelIdState(id);
    try {
      if (id) {
        localStorage.setItem(STORAGE_KEY, id);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      // localStorage not available
    }
  }, []);

  return { modelId, setModelId };
};
