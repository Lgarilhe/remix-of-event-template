import { useCallback } from 'react';
import { useCopilot, CopilotProfile, CopilotJob } from '@/contexts/CopilotContext';

/**
 * Hook to interact with Copilot from any component
 * Provides simplified methods for common actions
 */
export function useCopilotActions() {
  const {
    open,
    close,
    toggle,
    sendMessage,
    setSelectedProfiles,
    setActiveJob,
    setCurrentFilters,
    isOpen,
    currentPage,
    activeJob,
    selectedProfiles,
  } = useCopilot();

  /**
   * Open Copilot with a pre-filled message
   */
  const askCopilot = useCallback(async (question: string) => {
    if (!isOpen) {
      open();
    }
    // Small delay to ensure panel is open before sending
    await new Promise(resolve => setTimeout(resolve, 100));
    await sendMessage(question);
  }, [isOpen, open, sendMessage]);

  /**
   * Ask Copilot to generate a message for selected profiles
   */
  const generateMessage = useCallback(async (profiles?: CopilotProfile[]) => {
    if (profiles) {
      setSelectedProfiles(profiles);
    }
    const count = profiles?.length || selectedProfiles.length;
    await askCopilot(`Rédige un message d'approche pour ${count > 1 ? 'ces profils' : 'ce profil'}`);
  }, [askCopilot, setSelectedProfiles, selectedProfiles]);

  /**
   * Ask Copilot to configure filters for a job
   */
  const configureFilters = useCallback(async (job?: CopilotJob) => {
    if (job) {
      setActiveJob(job);
    }
    const jobTitle = job?.title || activeJob?.title || 'le job actif';
    await askCopilot(`Configure les filtres LinkedIn pour ${jobTitle}`);
  }, [askCopilot, setActiveJob, activeJob]);

  /**
   * Ask Copilot to score profiles against a job
   */
  const scoreProfiles = useCallback(async (profiles?: CopilotProfile[], job?: CopilotJob) => {
    if (profiles) {
      setSelectedProfiles(profiles);
    }
    if (job) {
      setActiveJob(job);
    }
    const count = profiles?.length || selectedProfiles.length;
    await askCopilot(`Évalue ${count > 1 ? 'ces profils' : 'ce profil'} pour le job`);
  }, [askCopilot, setSelectedProfiles, setActiveJob, selectedProfiles]);

  /**
   * Ask Copilot to add profiles to pipeline
   */
  const addToPipeline = useCallback(async (profiles?: CopilotProfile[], job?: CopilotJob) => {
    if (profiles) {
      setSelectedProfiles(profiles);
    }
    if (job) {
      setActiveJob(job);
    }
    const count = profiles?.length || selectedProfiles.length;
    await askCopilot(`Ajoute ${count > 1 ? 'ces profils' : 'ce profil'} au pipeline`);
  }, [askCopilot, setSelectedProfiles, setActiveJob, selectedProfiles]);

  /**
   * Update the current filters in Copilot context
   */
  const updateFiltersContext = useCallback((filters: any) => {
    setCurrentFilters(filters);
  }, [setCurrentFilters]);

  /**
   * Update the selected profiles in Copilot context
   */
  const updateProfilesContext = useCallback((profiles: CopilotProfile[]) => {
    setSelectedProfiles(profiles);
  }, [setSelectedProfiles]);

  /**
   * Update the active job in Copilot context
   */
  const updateJobContext = useCallback((job: CopilotJob | null) => {
    setActiveJob(job);
  }, [setActiveJob]);

  return {
    // Panel controls
    open,
    close,
    toggle,
    isOpen,
    
    // High-level actions
    askCopilot,
    generateMessage,
    configureFilters,
    scoreProfiles,
    addToPipeline,
    
    // Context updates
    updateFiltersContext,
    updateProfilesContext,
    updateJobContext,
    
    // Current state
    currentPage,
    activeJob,
    selectedProfiles,
  };
}
