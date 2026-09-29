import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { motion } from 'framer-motion';
import { useOrganization, ORG_ALREADY_EXISTS } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { updateOrganization } from '@/lib/organizationUpdate';
import type { OrgType } from '../onboardingMeta';
import { FillIn } from '../parts/FillIn';
import { NavRow } from '../parts/NavRow';
import { SceneHeading } from '../parts/SceneHeading';
import { SecondWorkspaceDialog } from '../SecondWorkspaceDialog';
import { SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';

interface Props {
  orgType: OrgType;
  value: string;
  onChange: (value: string) => void;
  /** Espace déjà créé par ce tunnel (retour arrière ou reprise) : on corrige son nom, on ne le recrée pas. */
  createdOrgId: string | null;
  /** Second espace demandé explicitement (`?new=1`) : pas de confirmation. */
  allowSecondWorkspace: boolean;
  onCreated: (data: { orgId: string; name: string }) => void;
  onBack: () => void;
}

const COPY: Record<OrgType, { lead: string; placeholder: string; examples: string[]; hint: string }> = {
  enterprise: {
    lead: "Mon entreprise s'appelle",
    placeholder: 'le nom de votre entreprise',
    examples: ['Atelier Nova', 'Maison Lambert', 'Kestrel Énergie', 'Studio Vega'],
    hint: 'Konekt cherche sa fiche (logo, site, postes ouverts) pendant que vous répondez à la suite.',
  },
  agency: {
    lead: "Mon cabinet s'appelle",
    placeholder: 'le nom de votre cabinet',
    examples: ['Cabinet Lambert', 'Nova Recrutement', 'Atelier des Talents'],
    hint: "C'est le nom qui apparaît en haut de la barre latérale. Vous pourrez le changer dans les Paramètres.",
  },
  freelance: {
    lead: 'Je travaille sous le nom de',
    placeholder: 'votre nom ou celui de votre activité',
    examples: ['Camille Durand', 'Durand Recrutement', 'Atelier Lambert'],
    hint: "C'est le nom qui apparaît en haut de la barre latérale. Vous pourrez le changer dans les Paramètres.",
  },
};

const slugOf = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

/**
 * Le nom de l'espace : la phrase à trous, puis la création. La fiche de la
 * société part en arrière-plan une fois l'espace créé, elle n'a pas à être
 * attendue ici.
 */
export const SceneStructure: React.FC<Props> = ({ orgType, value, onChange, createdOrgId, allowSecondWorkspace, onCreated, onBack }) => {
  const [busy, setBusy] = useState(false);
  const [confirmSecondOpen, setConfirmSecondOpen] = useState(false);
  const { createOrganization, refetchOrganization } = useOrganization();
  const inputId = useId();
  const d = useDelay();
  const copy = COPY[orgType];
  const name = value.trim();

  const submit = async (confirmSecond = false) => {
    if (name.length < 2 || busy) return;
    setBusy(true);
    try {
      let orgId = createdOrgId;
      if (orgId) {
        await updateOrganization(orgId, { name });
      } else {
        try {
          const org = await createOrganization({
            name,
            // Entreprise et cabinet : un identifiant stable, qui révèle un espace déjà créé pour la même société.
            // Indépendant : un suffixe, deux personnes peuvent porter le même nom.
            slug: orgType === 'freelance' ? `${slugOf(name) || 'espace'}-${Date.now().toString(36)}` : slugOf(name),
            orgType,
            confirmSecond: confirmSecond || allowSecondWorkspace,
          });
          orgId = org.id;
        } catch (createErr) {
          if ((createErr as { code?: string })?.code !== ORG_ALREADY_EXISTS) throw createErr;
          // Espace déjà créé par ce tunnel sans que l'id soit connu (réponse perdue après l'INSERT) :
          // on le reprend s'il est de cet utilisateur et du même type, sinon on demande confirmation.
          const { data: fresh } = await refetchOrganization();
          const { data: { user } } = await supabase.auth.getUser();
          const own = fresh?.organization as { id: string; created_by: string; org_type?: string | null } | undefined;
          if (user && own && own.created_by === user.id && own.org_type === orgType) {
            orgId = own.id;
            await updateOrganization(orgId, { name });
          } else {
            setConfirmSecondOpen(true);
            return;
          }
        }
      }
      onCreated({ orgId, name });
    } catch (err) {
      console.error('[SceneStructure] création impossible :', err);
      const message = (err as Error)?.message ?? '';
      if (/duplicate key|organizations_slug_key/.test(message)) {
        toast.error(
          orgType === 'freelance'
            ? "Votre espace n'a pas pu être créé. Réessayez."
            : 'Un espace Konekt existe déjà pour ce nom. Demandez à son administrateur de vous inviter.',
        );
      } else if (createdOrgId) {
        toast.error("Le nom n'a pas pu être enregistré. Vérifiez votre connexion puis réessayez.");
      }
      // Autre échec de création : la mutation l'a déjà signalé (onError).
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <SceneHeading eyebrow="Votre espace" title="Donnons un nom à votre espace." accent={['nom']}>
        <p>Il sert de dossier à vos missions et à vos candidats.</p>
      </SceneHeading>

      <motion.div initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ ...SPRING_SOFT, delay: d(0.6) }} className="space-y-3">
        <FillIn
          id={inputId}
          lead={copy.lead}
          label="nom de l'espace"
          value={value}
          onChange={onChange}
          onSubmit={() => void submit()}
          placeholder={copy.placeholder}
          examples={copy.examples}
          maxLength={80}
          disabled={busy}
          autoFocus
        />
        <p className="text-xs text-muted-foreground">{copy.hint}</p>
      </motion.div>

      <NavRow onBack={createdOrgId ? undefined : onBack} onNext={() => void submit()} nextDisabled={name.length < 2} loading={busy} nextLabel={busy ? "Création de l'espace…" : createdOrgId ? 'Continuer' : "Créer l'espace"} />

      <SecondWorkspaceDialog open={confirmSecondOpen} onOpenChange={setConfirmSecondOpen} onConfirm={() => void submit(true)} />
    </div>
  );
};
