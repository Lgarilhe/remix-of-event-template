/**
 * Connecteurs de l'assistant : règles communes au menu du chat (AgentChatPanel)
 * et à la liste « Applications connectées » des Paramètres (AssistantConnectorsCard).
 */

/** Noms tenus par les connexions personnelles : un serveur d'organisation ne peut pas les prendre. */
export const RESERVED_BUILTIN_CONNECTORS = new Set(['notion', 'email', 'gmail', 'outlook']);

/** Nom affiché d'un serveur d'organisation : « wiki-interne » devient « Wiki Interne ». */
export function connectorLabel(name: string): string {
  return name
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
