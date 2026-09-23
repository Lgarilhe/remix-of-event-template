import { useEffect, useState, type ComponentType } from 'react';
import { useLocation } from 'react-router-dom';
import { Link2, PenLine, History, Building2, Users, CreditCard, Bot, type LucideIcon } from 'lucide-react';
import { EXTENSION_REVEAL_STORAGE_KEY, SETTINGS_PATHS, SETTINGS_DOOR, type SettingsDoor, type SettingsSectionId } from '@/lib/settingsRoutes';
import { MyLinkedInAccount } from '@/components/settings/MyLinkedInAccount';
import { MyEmailAccount } from '@/components/settings/MyEmailAccount';
import { NotionConnectionCard } from '@/components/settings/NotionConnectionCard';
import { ExtensionTokens } from '@/components/settings/ExtensionTokens';
import { UserContextCard, OrgContextCard } from '@/components/settings/AiContextSettings';
import { MessageTemplatesSettings } from '@/components/settings/MessageTemplatesSettings';
import { EmailSignatures } from '@/components/settings/EmailSignatures';
import { AgentActionsSettings } from '@/components/settings/AgentActionsSettings';
import { AgentPoliciesSettings } from '@/components/settings/AgentPoliciesSettings';
import { AgentConnectorsSettings } from '@/components/settings/AgentConnectorsSettings';
import { PedigreePresetsSettings } from '@/components/settings/PedigreePresetsSettings';
import { BillingSettings } from '@/components/settings/BillingSettings';
import { AICreditsSettings } from '@/components/settings/AICreditsSettings';
import { SettingsAnchor } from './SettingsAnchor';
import { GeneralSection } from './GeneralSection';
import { TeamSection } from './TeamSection';

/**
 * Registre unique des rubriques des Paramètres : il nourrit à la fois les routes
 * descendantes et la navigation de la coquille (src/pages/Settings.tsx).
 * Toutes les rubriques restent dans le morceau Settings chargé à la demande.
 */

const readExtensionMemo = () => {
  try {
    return sessionStorage.getItem(EXTENSION_REVEAL_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
};

function ConnectionsSection() {
  const location = useLocation();
  // Lu une fois à l'arrivée : #extension (liens du front), state.revealExtension
  // (ancien ?tab=account : extension installée, notifications LinkedIn en base),
  // ou mémo de session (même arrivée, après un détour par /auth).
  const [revealExtension] = useState(
    () => location.hash === '#extension'
      || (location.state as { revealExtension?: boolean } | null)?.revealExtension === true
      || readExtensionMemo(),
  );
  // Mémo consommé après le montage, jamais dans l'initialiseur : en développement,
  // StrictMode l'appelle deux fois et le second appel ne le trouverait plus.
  useEffect(() => {
    try {
      sessionStorage.removeItem(EXTENSION_REVEAL_STORAGE_KEY);
    } catch {
      // stockage indisponible : rien à effacer
    }
  }, []);
  return (
    <>
      <SettingsAnchor id="linkedin"><MyLinkedInAccount /></SettingsAnchor>
      <SettingsAnchor id="email"><MyEmailAccount /></SettingsAnchor>
      <SettingsAnchor id="notion"><NotionConnectionCard /></SettingsAnchor>
      <SettingsAnchor id="extension"><ExtensionTokens revealWhenEmpty={revealExtension} /></SettingsAnchor>
    </>
  );
}
const WritingSection = () => (
  <>
    <SettingsAnchor id="style"><UserContextCard /></SettingsAnchor>
    <SettingsAnchor id="modeles"><MessageTemplatesSettings /></SettingsAnchor>
    <SettingsAnchor id="signatures"><EmailSignatures /></SettingsAnchor>
  </>
);
const BillingSection = () => (
  <>
    <SettingsAnchor id="formule"><BillingSettings /></SettingsAnchor>
    <SettingsAnchor id="credits"><AICreditsSettings /></SettingsAnchor>
  </>
);
const AssistantSection = () => (
  <>
    <SettingsAnchor id="consignes"><OrgContextCard /></SettingsAnchor>
    <SettingsAnchor id="resume"><AgentPoliciesSettings /></SettingsAnchor>
    <SettingsAnchor id="icp"><PedigreePresetsSettings /></SettingsAnchor>
    <SettingsAnchor id="connecteurs"><AgentConnectorsSettings /></SettingsAnchor>
  </>
);

export interface SettingsSection {
  id: SettingsSectionId;
  door: SettingsDoor;
  /** Chemin relatif à /settings (ex. 'account/connections'), pour les <Route> descendantes. */
  path: string;
  label: string;
  intro: string;
  icon: LucideIcon;
  Component: ComponentType;
  /** Ligne ajoutée sous « gérés par » quand un membre ouvre la rubrique. */
  managedNote?: string;
}
const rel = (id: SettingsSectionId) => SETTINGS_PATHS[id].slice('/settings/'.length);
const s = (id: SettingsSectionId, label: string, intro: string, icon: LucideIcon, Component: ComponentType, managedNote?: string): SettingsSection =>
  ({ id, door: SETTINGS_DOOR[id], path: rel(id), label, intro, icon, Component, managedNote });

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  s('connections', 'Connexions', 'Les comptes que Konekt utilise en votre nom.', Link2, ConnectionsSection),
  s('writing', 'Rédaction', 'Comment l’assistant écrit pour vous, et vos textes prêts à l’emploi.', PenLine, WritingSection),
  // Provisoire : part dans /agents (vue Journal) au lot 9.
  s('journal', 'Journal de l’assistant', 'Ce que l’assistant a proposé et fait, et ce qui attend votre accord.', History, AgentActionsSettings),
  s('general', 'Général', 'L’identité de l’organisation et ses outils reliés.', Building2, GeneralSection),
  s('team', 'Équipe', 'Qui travaille avec vous, et avec quels droits.', Users, TeamSection),
  s('billing', 'Abonnement et crédits', 'Votre formule, vos crédits et ce que vous consommez.', CreditCard, BillingSection,
    'Seul un administrateur peut ajouter des crédits ou changer de formule.'),
  s('assistant', 'Règles de l’assistant', 'Ce que l’assistant fait pour toute l’organisation.', Bot, AssistantSection),
];
