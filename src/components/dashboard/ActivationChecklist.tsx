/**
 * ActivationChecklist — carte « Bien démarrer » du dashboard (refonte
 * onboarding 06/07/2026).
 *
 * Remplace les 7 écrans retirés de l'onboarding par une activation progressive :
 * chaque item est dérivé de l'état RÉEL de la base (compte connecté ? mission
 * créée ? signature existante ?) — rien à sauvegarder, reprise automatique,
 * jamais bloquant. Seuls les réglages réellement consommés par des features y
 * figurent (audit du 06/07 : LinkedIn, email, mission, équipe, contexte IA,
 * signature, ICP société, profil recruteur).
 *
 * Les items « Affiner Konekt » sont pré-rédigés en 1 clic depuis
 * l'enrichissement société (organizations.enrichment_snapshot) et le profil.
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, ChevronRight, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useOrganization, useOrganizationMembers } from '@/hooks/useOrganization';
import { useEmailSignatures } from '@/hooks/useEmailSignatures';
import { usePedigreePresets } from '@/hooks/usePedigreePresets';
import { useOrgAiContext } from '@/hooks/useAiContext';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { buildAiContextDraft, buildSignatureHtml, type EnrichmentSnapshot } from '@/lib/activationDrafts';
import type { DashboardConnections } from '@/hooks/useDashboardConnections';
import { toast } from 'sonner';

interface Props {
  connections: DashboardConnections;
  projectsCount: number;
}

interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  hint?: string;
  onClick: () => void;
  /** Item « pré-rédigé » : le clic génère le brouillon avant d'ouvrir Réglages. */
  generated?: boolean;
}

const dismissKey = (orgId: string) => `konekt:activation-dismissed:${orgId}`;

/**
 * Wrapper : le gate dismissed/org est évalué AVANT de monter le composant
 * porteur des hooks de fetch — un utilisateur qui a masqué la checklist ne
 * paie plus les ~6 requêtes à chaque visite du dashboard.
 */
export const ActivationChecklist: React.FC<Props> = (props) => {
  const { organizationId } = useOrganization();
  const [dismissed, setDismissed] = useState(() =>
    organizationId ? localStorage.getItem(dismissKey(organizationId)) === '1' : false
  );

  if (!organizationId || dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(dismissKey(organizationId), '1');
    setDismissed(true);
  };

  return <ActivationChecklistInner {...props} onDismiss={handleDismiss} />;
};

const ActivationChecklistInner: React.FC<Props & { onDismiss: () => void }> = ({ connections, projectsCount, onDismiss }) => {
  const navigate = useNavigate();
  const { organization, organizationId, isOwner } = useOrganization();
  const { members } = useOrganizationMembers(organizationId);
  const { signatures, isLoading: signaturesLoading, createSignature } = useEmailSignatures();
  const { presets, loading: presetsLoading } = usePedigreePresets();
  const { aiContext, isLoading: aiContextLoading, save: saveAiContext } = useOrgAiContext();
  const { profile, displayName, isLoading: profileLoading } = useCurrentProfile();
  const profileExtra = profile;

  const snapshot = ((organization as any)?.enrichment_snapshot ?? null) as EnrichmentSnapshot | null;
  const aiContextFilled = !!(aiContext.tone || aiContext.specialty || aiContext.free_text || aiContext.do.length || aiContext.dont.length);

  const handleGenerateAiContext = () => {
    if (isOwner && !aiContextFilled) {
      const draft = buildAiContextDraft(snapshot, organization?.name || '');
      saveAiContext(draft);
      toast.success('Brouillon de contexte IA généré — relisez et ajustez.');
    }
    navigate('/settings?tab=ai-context');
  };

  const handleGenerateSignature = () => {
    if (!signatures.length) {
      const content = buildSignatureHtml({
        displayName,
        jobTitle: profileExtra?.job_title,
        orgName: organization?.name,
        website: (organization as any)?.website || snapshot?.websiteUrl || null,
      });
      createSignature.mutate(
        { name: 'Signature par défaut', content, is_default: true },
        { onSettled: () => navigate('/settings?tab=account') },
      );
    } else {
      navigate('/settings?tab=account');
    }
  };

  const items: ChecklistItem[] = [
    { key: 'workspace', label: 'Créer votre espace', done: true, onClick: () => {} },
    {
      key: 'linkedin',
      label: 'Connecter LinkedIn',
      hint: 'le moteur du sourcing',
      done: connections.linkedin.status === 'connected',
      onClick: () => navigate('/settings?tab=connectors'),
    },
    {
      key: 'email',
      label: "Connecter votre email d'envoi",
      hint: 'requis pour les séquences email',
      done: connections.email.status === 'connected',
      onClick: () => navigate('/settings?tab=connectors'),
    },
    {
      key: 'mission',
      label: 'Créer votre première mission',
      done: projectsCount > 0,
      onClick: () => navigate('/missions'),
    },
    {
      key: 'team',
      label: 'Inviter votre équipe',
      done: members.length > 1,
      onClick: () => navigate('/settings?tab=team'),
    },
    {
      key: 'ai-context',
      label: 'Contexte IA (voix de marque)',
      hint: 'améliore tous les messages générés',
      done: aiContextFilled,
      generated: !aiContextFilled && !!snapshot && isOwner,
      onClick: handleGenerateAiContext,
    },
    {
      key: 'signature',
      label: 'Signature email',
      done: signatures.length > 0,
      generated: signatures.length === 0,
      onClick: handleGenerateSignature,
    },
    {
      key: 'icp',
      label: 'Votre premier ICP société',
      hint: 'calibre le scoring des candidats',
      done: presets.length > 0,
      onClick: () => navigate('/settings?tab=presets'),
    },
    {
      key: 'profile',
      label: 'Profil recruteur (poste, bio)',
      hint: 'alimente vos signatures et messages',
      done: !!(profileExtra?.job_title || profileExtra?.recruiter_bio),
      onClick: () => navigate('/settings?tab=account'),
    },
  ];

  const doneCount = items.filter((i) => i.done).length;
  const allDone = doneCount === items.length;
  const isLoading = connections.isLoading || signaturesLoading || presetsLoading || aiContextLoading || profileLoading;

  if (allDone || isLoading) return null;

  const coreItems = items.slice(0, 5);
  const refineItems = items.slice(5);

  return (
    <div className="border border-border bg-card mb-6">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold">Bien démarrer</span>
          <span className="text-xs font-mono text-muted-foreground tabular-nums">{doneCount}/{items.length}</span>
          <div className="hidden sm:block w-28 h-1.5 bg-muted overflow-hidden">
            <div
              className="h-full bg-foreground transition-all"
              style={{ width: `${Math.round((doneCount / items.length) * 100)}%` }}
            />
          </div>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Masquer la checklist"
          className="text-muted-foreground hover:text-foreground p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2">
        <ul className="p-2">
          {coreItems.map((item) => (
            <ChecklistRow key={item.key} item={item} />
          ))}
        </ul>
        <ul className="p-2 border-t md:border-t-0 md:border-l border-border">
          <li className="px-2 pb-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            Affiner Konekt — pré-rédigé en 1 clic
          </li>
          {refineItems.map((item) => (
            <ChecklistRow key={item.key} item={item} />
          ))}
        </ul>
      </div>
    </div>
  );
};

const ChecklistRow: React.FC<{ item: ChecklistItem }> = ({ item }) => (
  <li>
    <button
      onClick={item.onClick}
      disabled={item.done}
      className={cn(
        'w-full flex items-center gap-2.5 px-2 py-2 text-left text-sm group',
        item.done ? 'cursor-default' : 'hover:bg-accent/40 transition-colors',
      )}
    >
      <span
        className={cn(
          'w-[18px] h-[18px] border flex items-center justify-center shrink-0',
          item.done ? 'bg-foreground border-foreground text-background' : 'border-border',
        )}
      >
        {item.done && <Check className="w-3 h-3" />}
      </span>
      <span className={cn('flex-1 min-w-0 truncate', item.done && 'text-muted-foreground line-through')}>
        {item.label}
      </span>
      {!item.done && item.generated && (
        <span className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground shrink-0">
          <Sparkles className="w-3 h-3" /> brouillon
        </span>
      )}
      {!item.done && item.hint && !item.generated && (
        <span className="hidden lg:block text-[11px] text-muted-foreground shrink-0">{item.hint}</span>
      )}
      {!item.done && (
        <ChevronRight className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
      )}
    </button>
  </li>
);
