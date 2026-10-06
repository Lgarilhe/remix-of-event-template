import React, { useId, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useOrganization, ORG_ALREADY_EXISTS } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { updateOrganization } from '@/lib/organizationUpdate';
import { cn } from '@/lib/utils';
import { ORG_TYPE_LABEL, type OrgType } from '../onboardingMeta';
import { FillIn } from '../parts/FillIn';
import { SceneHeading } from '../parts/SceneHeading';
import { SecondWorkspaceDialog } from '../SecondWorkspaceDialog';

interface Choice {
  value: OrgType;
  title: string;
  line: string;
}

const CHOICES: Choice[] = [
  { value: 'enterprise', title: 'Ma propre entreprise', line: 'Vos postes internes, avec ou sans cabinets externes.' },
  { value: 'agency', title: 'Un cabinet, pour des clients', line: 'Une équipe, plusieurs clients, un portail à leur montrer.' },
  { value: 'freelance', title: 'Moi seul, pour des clients', line: 'Missions RPO, au succès ou en chasse.' },
];

const COPY: Record<OrgType, { lead: string; examples: string[]; hint: string }> = {
  enterprise: {
    lead: "Nom de votre entreprise",
    examples: ['Atelier Nova', 'Maison Lambert', 'Kestrel Énergie', 'Studio Vega'],
    hint: 'Konekt cherche sa fiche (logo, site, postes ouverts) pendant que vous répondez à la suite.',
  },
  agency: {
    lead: 'Nom de votre cabinet',
    examples: ['Cabinet Lambert', 'Nova Recrutement', 'Atelier des Talents'],
    hint: "C'est le nom qui apparaît en haut de la barre latérale. Vous pourrez le changer dans les Paramètres.",
  },
  freelance: {
    lead: 'Votre nom, ou celui de votre activité',
    examples: ['Camille Durand', 'Durand Recrutement', 'Atelier Lambert'],
    hint: "C'est le nom qui apparaît en haut de la barre latérale. Vous pourrez le changer dans les Paramètres.",
  },
};

const slugOf = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

interface Props {
  minutes: number;
  firstName: string;
  onFirstNameChange: (value: string) => void;
  /** Écrit le prénom sur le profil (non bloquant) avant la création de l'espace. */
  onSaveFirstName: () => Promise<void>;
  orgType: OrgType | null;
  onOrgTypeChange: (type: OrgType) => void;
  orgName: string;
  onOrgNameChange: (value: string) => void;
  /** Espace déjà créé par ce tunnel (retour arrière ou reprise) : on corrige son nom, on ne le recrée pas. */
  createdOrgId: string | null;
  /** Second espace demandé explicitement (`?new=1`) : pas de confirmation. */
  allowSecondWorkspace: boolean;
  onCreated: (data: { orgId: string; name: string }) => void;
}

/**
 * Une seule première question, en trois lignes : le prénom (il signe les
 * messages que Konekt rédige), pour qui vous recrutez, et le nom de l'espace.
 * L'espace est créé à la validation, la fiche de la société part ensuite en
 * arrière-plan.
 */
export const SceneYou: React.FC<Props> = ({
  minutes,
  firstName,
  onFirstNameChange,
  onSaveFirstName,
  orgType,
  onOrgTypeChange,
  orgName,
  onOrgNameChange,
  createdOrgId,
  allowSecondWorkspace,
  onCreated,
}) => {
  const [busy, setBusy] = useState(false);
  const [confirmSecondOpen, setConfirmSecondOpen] = useState(false);
  const { createOrganization, refetchOrganization } = useOrganization();
  const firstNameId = useId();
  const orgNameId = useId();
  const typeLabelId = useId();
  const name = orgName.trim();
  const ready = firstName.trim().length >= 2 && !!orgType && name.length >= 2;
  const copy = orgType ? COPY[orgType] : null;

  const submit = async (confirmSecond = false) => {
    if (!ready || !orgType || busy) return;
    setBusy(true);
    try {
      await onSaveFirstName();
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
      console.error('[SceneYou] création impossible :', err);
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
      <SceneHeading title="Montons votre premier recrutement.">
        <p>
          {minutes} minutes suffisent pour poser un vrai poste et voir arriver vos premiers candidats. Rien à préparer : Konekt vous pose les questions dans
          l'ordre.
        </p>
      </SceneHeading>

      <div className="space-y-6">
        <div className="space-y-1.5">
          <FillIn
            id={firstNameId}
            lead="Votre prénom"
            value={firstName}
            onChange={onFirstNameChange}
            onSubmit={() => void submit()}
            placeholder="Votre prénom"
            maxLength={40}
            autoComplete="given-name"
            autoFocus
            selectOnFocus
          />
          <p className="text-xs text-muted-foreground">Ce prénom signe les messages que Konekt rédige pour vous.</p>
        </div>

        <div className="space-y-2">
          <p id={typeLabelId} className="text-sm font-medium text-foreground">
            Vous recrutez pour qui ?
          </p>
          <div role="radiogroup" aria-labelledby={typeLabelId} className="space-y-2">
            {CHOICES.map((c) => {
              const picked = orgType === c.value;
              return (
                <Button
                  key={c.value}
                  variant="outline"
                  role="radio"
                  aria-checked={picked}
                  // Un espace créé garde son type : il se corrige ensuite depuis les Paramètres.
                  disabled={!!createdOrgId && !picked}
                  onClick={() => onOrgTypeChange(c.value)}
                  className={cn('h-auto w-full items-center justify-between gap-3 whitespace-normal rounded-xl p-3 text-left font-normal', picked && 'border-foreground bg-accent')}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{c.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{c.line}</span>
                  </span>
                  <span className="hidden shrink-0 text-2xs text-muted-foreground sm:block">{ORG_TYPE_LABEL[c.value]}</span>
                </Button>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">Un seul choix, modifiable plus tard. Konekt adapte ses écrans et ses quotas à votre façon de travailler.</p>
        </div>

        {copy && (
          <div className="space-y-1.5">
            <FillIn
              id={orgNameId}
              lead={copy.lead}
              value={orgName}
              onChange={onOrgNameChange}
              onSubmit={() => void submit()}
              examples={copy.examples}
              maxLength={80}
              disabled={busy}
            />
            <p className="text-xs text-muted-foreground">{copy.hint}</p>
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button variant="primary" size="lg" onClick={() => void submit()} disabled={!ready} loading={busy} className="min-h-11 md:min-h-0">
          {busy ? "Création de l'espace…" : createdOrgId ? 'Continuer' : "Créer l'espace"}
        </Button>
      </div>

      <SecondWorkspaceDialog open={confirmSecondOpen} onOpenChange={setConfirmSecondOpen} onConfirm={() => void submit(true)} />
    </div>
  );
};
