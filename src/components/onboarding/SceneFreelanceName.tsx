import React, { useEffect, useId, useState } from 'react';
import { ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useOrganization, ORG_ALREADY_EXISTS } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { updateOrganization } from '@/lib/organizationUpdate';
import { SecondWorkspaceDialog } from './SecondWorkspaceDialog';
import type { OnboardingCompanyData } from '@/pages/Onboarding';

interface Props {
  /** Espace déjà créé par ce tunnel (reprise après rechargement ou retour arrière). */
  createdOrgId: string | null;
  /** true = second espace explicitement demandé (`?new=1`) : pas de confirmation */
  allowSecondWorkspace?: boolean;
  onComplete: (data: OnboardingCompanyData) => void;
}

const generateSlug = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30);

/**
 * Scène « société » d'un indépendant : il n'y a rien à rechercher, on demande
 * seulement le nom sous lequel il travaille. L'espace est créé ici, comme pour
 * une entreprise ou un cabinet.
 */
export const SceneFreelanceName: React.FC<Props> = ({ createdOrgId, allowSecondWorkspace = false, onComplete }) => {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmSecondOpen, setConfirmSecondOpen] = useState(false);
  const { createOrganization, refetchOrganization } = useOrganization();
  const inputId = useId();
  const hintId = useId();

  // Nom du compte en valeur de départ, à confirmer ou corriger.
  useEffect(() => {
    let cancelled = false;
    void supabase.auth.getUser().then(({ data: { user } }) => {
      if (cancelled || !user) return;
      const meta = user.user_metadata?.full_name as string | undefined;
      const fallback = user.email?.split('@')[0];
      setName((current) => current || meta || fallback || '');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const trimmed = name.trim();

  const handleSubmit = async (confirmSecond = false) => {
    if (trimmed.length < 2 || busy) return;
    setBusy(true);
    try {
      let orgId = createdOrgId;
      if (orgId) {
        // Retour arrière : l'espace existe, on corrige seulement son nom.
        await updateOrganization(orgId, { name: trimmed });
      } else {
        try {
          const org = await createOrganization({
            name: trimmed,
            slug: `${generateSlug(trimmed) || 'espace'}-${Date.now().toString(36)}`,
            orgType: 'freelance',
            confirmSecond: confirmSecond || allowSecondWorkspace,
          });
          orgId = org.id;
        } catch (createErr) {
          if ((createErr as { code?: string })?.code !== ORG_ALREADY_EXISTS) throw createErr;
          // Espace déjà créé par ce tunnel sans que l'id soit connu (réponse
          // perdue après l'INSERT) : on le reprend s'il est de cet utilisateur
          // et de type indépendant, sinon on demande confirmation.
          const { data: fresh } = await refetchOrganization();
          const { data: { user } } = await supabase.auth.getUser();
          const own = fresh?.organization as { id: string; created_by: string; org_type?: string | null } | undefined;
          if (user && own && own.created_by === user.id && own.org_type === 'freelance') {
            orgId = own.id;
            await updateOrganization(orgId, { name: trimmed });
          } else {
            setConfirmSecondOpen(true);
            return;
          }
        }
      }
      onComplete({ orgId, name: trimmed, domain: null, linkedinUrl: null, careersUrl: null });
    } catch (err) {
      console.error('[SceneFreelanceName] Création impossible :', err);
      const msg = (err as Error)?.message ?? '';
      if (/duplicate key|organizations_slug_key/.test(msg)) {
        toast.error("Votre espace n'a pas pu être créé. Réessayez.");
      } else if (createdOrgId) {
        toast.error("Le nom n'a pas pu être enregistré. Vérifiez votre connexion puis réessayez.");
      }
      // Autre échec de création : la mutation l'a déjà signalé (onError).
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full flex-col gap-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-foreground">Sous quel nom travaillez-vous ?</h1>
        <p className="mt-2 max-w-md text-md text-foreground-secondary">
          Ce nom identifie votre espace Konekt. Vous pourrez le modifier plus tard dans les Paramètres.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor={inputId}>Nom de votre activité</Label>
        <Input
          id={inputId}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void handleSubmit();
            }
          }}
          aria-describedby={hintId}
          placeholder="Par exemple Camille Durand ou Atelier Nova"
          autoFocus
          className="h-11 md:h-10"
        />
        <p id={hintId} className="text-xs text-muted-foreground">
          Votre nom, ou celui de votre structure.
        </p>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          variant="primary"
          onClick={() => void handleSubmit()}
          disabled={trimmed.length < 2}
          loading={busy}
          className="min-h-11 md:min-h-0"
        >
          {busy ? "Création de l'espace…" : 'Continuer'}
          {!busy && <ArrowRight aria-hidden="true" />}
        </Button>
      </div>

      <SecondWorkspaceDialog
        open={confirmSecondOpen}
        onOpenChange={setConfirmSecondOpen}
        onConfirm={() => void handleSubmit(true)}
      />
    </div>
  );
};
