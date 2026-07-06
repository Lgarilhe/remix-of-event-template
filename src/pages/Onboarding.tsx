import { useState, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams, Navigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { InvitationBanner } from '@/components/InvitationBanner';
import { OnboardingLayout } from '@/components/onboarding/OnboardingLayout';
import { SceneOrgType } from '@/components/onboarding/SceneOrgType';
import { SceneCompany } from '@/components/onboarding/SceneCompany';
import { SceneIntegrations } from '@/components/onboarding/SceneIntegrations';
import { SceneExpressSettings } from '@/components/onboarding/SceneExpressSettings';
import { SceneIcp } from '@/components/onboarding/SceneIcp';
import { SceneTemplates } from '@/components/onboarding/SceneTemplates';
import { Check } from 'lucide-react';

/**
 * Onboarding — refonte 06/07/2026 : 3 écrans max, < 2 minutes.
 *
 *   enterprise/agency : profil (+ découverte optionnelle) → société → LinkedIn
 *   freelance         : profil (+ découverte optionnelle) → LinkedIn (org auto)
 *
 * Tout le reste (audit marque employeur, profil recruteur, équipe, contexte IA,
 * signature, ICP) vit dans la checklist d'activation du dashboard — état dérivé
 * de la DB, jamais bloquant. L'enrichissement société tourne en arrière-plan
 * (enrich-company + organization_id → organizations.enrichment_snapshot).
 */

export interface OnboardingCompanyData {
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  careersUrl: string | null;
  /** Choix de désambiguïsation fait à l'écran société (id Apollo ou '__none__') —
   *  propagé au run d'enrichissement complet en arrière-plan. */
  apolloId?: string | null;
  /** Infos du quick match, utilisées par l'écran « Réglages express »
   *  (brouillon de contexte IA) sans attendre l'enrichissement complet. */
  industry?: string | null;
  size?: string | null;
  location?: string | null;
  description?: string | null;
}

type OrgType = 'enterprise' | 'agency' | 'freelance';

type SceneKey = 'orgtype' | 'company' | 'integrations' | 'express' | 'icp' | 'templates';

const FLOWS: Record<OrgType, SceneKey[]> = {
  enterprise: ['orgtype', 'company', 'integrations', 'express', 'icp', 'templates'],
  agency:     ['orgtype', 'company', 'integrations', 'express', 'icp', 'templates'],
  freelance:  ['orgtype', 'integrations', 'express', 'icp', 'templates'],
};

const DEFAULT_FLOW: SceneKey[] = FLOWS.enterprise;

const Onboarding = () => {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [orgType, setOrgType] = useState<OrgType | null>(null);
  const [discoverySource, setDiscoverySource] = useState('');
  // Org créée PENDANT cette session (≠ organizationId du hook, qui peut être
  // null juste après création ou pointer sur l'org d'un inviteur).
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(null);
  // Verrou anti double-soumission : createdOrgId (state) n'est posé qu'après
  // la fin de la création — un double-clic verrait deux fois null.
  const creatingOrgRef = useRef(false);
  // Fiche société du quick match (écran 2) — nourrit les brouillons de
  // l'écran « Réglages express » sans attendre l'enrichissement complet.
  const [companyData, setCompanyData] = useState<OnboardingCompanyData | null>(null);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const { organization, createOrganization, isLoading: orgLoading } = useOrganization();

  const flow = useMemo(() => (orgType ? FLOWS[orgType] : DEFAULT_FLOW), [orgType]);
  const currentScene = flow[step] ?? 'orgtype';
  const stepCount = flow.length;

  const wantsNewWorkspace = searchParams.get('new') === '1';

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const goNext = useCallback(() => {
    setDirection(1);
    setStep((s) => Math.min(s + 1, stepCount - 1));
  }, [stepCount]);

  // Écran 1 : type de profil (+ découverte optionnelle).
  // Freelance : l'org est créée automatiquement ici, direction LinkedIn.
  const handleOrgTypeSelected = useCallback(async (type: OrgType, discovery: string) => {
    setOrgType(type);
    setDiscoverySource(discovery);
    setDirection(1);

    if (type === 'freelance') {
      if (creatingOrgRef.current) return;
      creatingOrgRef.current = true;
      try {
        let orgId = createdOrgId;
        if (!orgId) {
          const { data: { user } } = await supabase.auth.getUser();
          const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Mon espace';
          const slug = userName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
          const org = await createOrganization({
            name: userName,
            slug: `${slug}-${Date.now().toString(36)}`,
          });
          orgId = org?.id ?? null;
          if (orgId) setCreatedOrgId(orgId);
        }
        // Toujours persister le type + la découverte, y compris quand l'org
        // existe déjà (retour arrière depuis le flow entreprise).
        if (orgId) {
          const { error } = await supabase
            .from('organizations')
            .update({ org_type: 'freelance', discovery_source: discovery || null } as any)
            .eq('id', orgId);
          if (error) console.error('[Onboarding] Failed to persist org details:', error);
        }
      } catch (err) {
        console.error('[Onboarding] Auto-create org failed:', err);
        toast.error("Impossible de créer votre espace. Vérifiez votre connexion puis réessayez.");
        return;
      } finally {
        creatingOrgRef.current = false;
      }
    }

    setStep(1);
  }, [createOrganization, createdOrgId]);

  // Écran 2 (enterprise/agency) : org créée par SceneCompany. On persiste
  // org_type/discovery_source (awaité — un builder supabase-js est lazy et
  // n'émet la requête qu'au .then()), puis on lance l'enrichissement COMPLET
  // en arrière-plan : son résultat atterrit sur organizations.enrichment_snapshot
  // (carte « postes détectés » + brouillons IA du dashboard).
  const handleCompanyCreated = useCallback(async (data: OnboardingCompanyData, newOrgId: string | null) => {
    if (newOrgId) setCreatedOrgId(newOrgId);
    setCompanyData(data);
    const companyIndex = flow.indexOf('company');

    if (newOrgId && orgType) {
      const { error } = await supabase
        .from('organizations')
        .update({ org_type: orgType, discovery_source: discoverySource || null } as any)
        .eq('id', newOrgId);
      if (error) console.error('[Onboarding] Failed to persist org details:', error);

      // Fire-and-forget : pipeline complet (~30-55 s) sans bloquer le parcours.
      // write_snapshot : opt-in explicite du write-back org (ne JAMAIS reposer
      // sur le seul organization_id, auto-injecté par invokeEdgeFunction).
      // selected_apollo_id : propage le choix de désambiguïsation de l'écran 2,
      // sinon le run de fond re-tombe sur la désambiguïsation et n'écrit rien.
      invokeEdgeFunction('enrich-company', {
        company_name: data.name,
        country: 'France',
        organization_id: newOrgId,
        write_snapshot: true,
        ...(data.apolloId ? { selected_apollo_id: data.apolloId } : {}),
      }).catch((err) => console.warn('[Onboarding] Background enrichment failed:', err));
    }

    setDirection(1);
    setStep((companyIndex >= 0 ? companyIndex : 1) + 1);
  }, [flow, orgType, discoverySource]);

  // Moment de fin : overlay animé « Votre espace est prêt » puis dashboard.
  const [finishing, setFinishing] = useState(false);
  const handleFinish = useCallback(async () => {
    setFinishing(true);
    await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
    await queryClient.refetchQueries({ queryKey: ['active-organization'] });
    setTimeout(() => navigate('/dashboard', { replace: true }), 1500);
  }, [navigate, queryClient]);

  // Barrière de chargement : tant que l'état org n'est pas résolu, AUCUNE
  // interaction possible — sinon un utilisateur qui a déjà une org pourrait
  // cliquer « freelance » pendant le chargement et créer un doublon avant que
  // la garde ci-dessous ne tire (fenêtre de course, incident déjà vu en prod).
  if (orgLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-9 h-9 rounded-full border border-border border-t-foreground animate-spin" />
      </div>
    );
  }

  // Garde anti re-onboarding : un utilisateur qui a déjà une organisation ne
  // doit pas pouvoir en recréer une par accident (doublons + perte de données
  // déjà survenus en prod). Entrée volontaire possible via ?new=1 (flow
  // collaborateur « créer mon espace »). Placée après tous les hooks (Rules of
  // Hooks) ; createdOrgId protège le parcours en cours.
  if (organization && !createdOrgId && !wantsNewWorkspace) {
    return <Navigate to="/dashboard" replace />;
  }

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? '60%' : '-60%',
      opacity: 0,
      scale: 0.97,
    }),
    center: { x: 0, opacity: 1, scale: 1 },
    exit: (dir: number) => ({
      x: dir > 0 ? '-60%' : '60%',
      opacity: 0,
      scale: 0.97,
    }),
  };

  return (
    <OnboardingLayout
      currentStep={step}
      totalSteps={stepCount}
      orgName={organization?.name}
      completedSteps={step}
      trackableSteps={stepCount}
    >
      <div className="px-4 max-w-lg mx-auto w-full mb-4">
        <InvitationBanner />
      </div>

      <div className="w-full max-w-lg relative px-1" style={{ minHeight: 340 }}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            className="w-full"
          >
            {currentScene === 'orgtype' && (
              <SceneOrgType onSelect={handleOrgTypeSelected} onBack={() => {}} />
            )}
            {currentScene === 'company' && (
              <SceneCompany onComplete={handleCompanyCreated} onBack={goBack} createdOrgId={createdOrgId} />
            )}
            {currentScene === 'integrations' && (
              <SceneIntegrations onNext={goNext} onBack={goBack} stepLabel={String(step + 1).padStart(2, '0')} />
            )}
            {currentScene === 'express' && (
              <SceneExpressSettings
                orgId={createdOrgId}
                orgName={companyData?.name || organization?.name || null}
                companyData={companyData}
                onFinish={goNext}
                onBack={goBack}
                stepLabel={String(step + 1).padStart(2, '0')}
              />
            )}
            {currentScene === 'icp' && (
              <SceneIcp orgId={createdOrgId} onNext={goNext} onBack={goBack} />
            )}
            {currentScene === 'templates' && (
              <SceneTemplates orgId={createdOrgId} onFinish={handleFinish} onBack={goBack} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Finale — succès animé avant l'arrivée sur le dashboard */}
      <AnimatePresence>
        {finishing && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-50 bg-background flex flex-col items-center justify-center gap-4"
          >
            <motion.div
              initial={{ scale: 0, rotate: -20 }}
              animate={{ scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 16, delay: 0.1 }}
              className="w-20 h-20 rounded-full bg-foreground text-background flex items-center justify-center"
            >
              <Check className="w-10 h-10" strokeWidth={3} />
            </motion.div>
            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.35 }}
              className="font-display text-2xl font-bold tracking-tight"
            >
              Votre espace est prêt.
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.55 }}
              className="text-sm text-muted-foreground"
            >
              Bienvenue sur Konekt 👋
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </OnboardingLayout>
  );
};

export default Onboarding;
