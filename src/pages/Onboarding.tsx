import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { updateOrganization } from '@/lib/organizationUpdate';
import { InvitationBanner } from '@/components/InvitationBanner';
import { Spinner } from '@/components/ui/spinner';
import { OnboardingShell, type SummaryRow } from '@/components/onboarding/OnboardingShell';
import { SceneOrganization } from '@/components/onboarding/SceneOrganization';
import { SceneFreelanceName } from '@/components/onboarding/SceneFreelanceName';
import { SceneLinkedIn } from '@/components/onboarding/SceneLinkedIn';
import { SceneOrgType } from '@/components/onboarding/SceneOrgType';
import { SceneOrgDetails, TEAM_SIZES, FREELANCE_MODES, type OrgDetailsData } from '@/components/onboarding/SceneOrgDetails';
import { SceneSpecializations } from '@/components/onboarding/SceneSpecializations';
import { SceneLaunch } from '@/components/onboarding/SceneLaunch';
import {
  FLOWS,
  DEFAULT_FLOW,
  type OrgType,
  type SceneKey,
} from '@/components/onboarding/onboardingMeta';
import {
  loadOnboardingProgress,
  saveOnboardingProgress,
  clearOnboardingProgress,
} from '@/components/onboarding/onboardingStorage';

const ORG_TYPE_LABELS: Record<OrgType, string> = {
  enterprise: 'Entreprise',
  agency: 'Cabinet',
  freelance: 'Indépendant',
};

export interface OnboardingCompanyData {
  /** Id de l'organisation créée (le hook `useOrganization` n'est pas encore rafraîchi à ce moment). */
  orgId: string | null;
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  careersUrl: string | null;
}

const Onboarding = () => {
  const [restored] = useState(loadOnboardingProgress);

  const [orgType, setOrgType] = useState<OrgType | null>(restored?.orgType ?? null);
  const [step, setStep] = useState(() => {
    if (!restored?.orgType) return 0;
    const flow = FLOWS[restored.orgType];
    // Repli : la progression est reprise sur la scène persistée ; si cette scène
    // n'existe plus (tunnel raccourci), on repart de la première scène.
    const idx = restored.scene ? flow.indexOf(restored.scene) : -1;
    return idx >= 0 ? idx : 0;
  });
  const [orgCreated, setOrgCreated] = useState(false);
  // Nom saisi à la scène société, affiché dans la fiche de gauche
  const [orgName, setOrgName] = useState<string | null>(null);
  // Verrou anti double clic sur l'écriture des réponses (équipe, volume, secteurs)
  const savingRef = useRef(false);
  // Id de l'espace créé dans CE tunnel. `orgCreated` ne convient pas comme
  // garde : il passe à true dès l'entrée pour un collaborateur venu via `?new=1`.
  // Sauvegardé avec la progression : après un rechargement, on reprend cet
  // espace au lieu d'échouer sur « déjà membre » ou d'en créer un second.
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(restored?.createdOrgId ?? null);
  const tunnelStartedRef = useRef(false);
  const [completedScenes, setCompletedScenes] = useState<Set<SceneKey>>(
    () => new Set(restored?.completed ?? [])
  );
  const [orgDetailsData, setOrgDetailsData] = useState<OrgDetailsData | null>(restored?.orgDetails ?? null);
  const [specializations, setSpecializations] = useState<string[]>(restored?.specializations ?? []);

  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { organization, isLoading: isOrgLoading } = useOrganization();
  const { accounts } = useLinkedInAccounts();
  // F3 : `?new=1` = création d'un second espace demandée explicitement
  // (accueil collaborateur dans Auth.tsx). Sans ce flag, un utilisateur qui a
  // déjà un espace est renvoyé au dashboard (voir avant le `return`).
  const isExplicitNewWorkspace = new URLSearchParams(location.search).get('new') === '1';

  const flow = useMemo(() => (orgType ? FLOWS[orgType] : DEFAULT_FLOW), [orgType]);
  const currentScene = flow[step] ?? 'orgtype';

  const linkedInConnected = accounts.some(
    (a: any) => a.type !== 'WHATSAPP' && a.provider !== 'WHATSAPP'
  );

  // ─── Persistance de la progression ───
  useEffect(() => {
    saveOnboardingProgress({
      step,
      scene: flow[step] ?? null,
      orgType,
      orgDetails: orgDetailsData,
      specializations,
      completed: Array.from(completedScenes),
      createdOrgId,
    });
  }, [step, flow, orgType, orgDetailsData, specializations, completedScenes, createdOrgId]);

  useEffect(() => {
    if (organization && !orgCreated) {
      setOrgCreated(true);
    }
  }, [organization, orgCreated]);

  const markCompleted = useCallback((scene: SceneKey) => {
    setCompletedScenes((prev) => {
      if (prev.has(scene)) return prev;
      const next = new Set(prev);
      next.add(scene);
      return next;
    });
  }, []);

  const goNext = useCallback(() => {
    setStep((s) => Math.min(s + 1, flow.length - 1));
  }, [flow.length]);

  const goBack = useCallback(() => {
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const completeAndNext = useCallback(
    (scene: SceneKey) => {
      markCompleted(scene);
      goNext();
    },
    [markCompleted, goNext]
  );

  // ─── Handlers ───
  const handleOrgTypeSelected = useCallback(
    (type: OrgType) => {
      setOrgType(type);
      markCompleted('orgtype');
      setStep(FLOWS[type].indexOf('orgtype') + 1);
    },
    [markCompleted]
  );

  // Écrit sur l'organisation les réponses de l'équipe et des secteurs. Rend
  // false (et le dit) si l'écriture échoue : pas d'avancée sans enregistrement.
  const saveProfile = useCallback(
    async (details: OrgDetailsData | null, specs: string[]): Promise<boolean> => {
      const orgId = createdOrgId ?? organization?.id ?? null;
      if (!orgId || !details) return true; // rien à écrire, ou espace pas encore lisible : la reprise réécrira
      if (savingRef.current) return false; // double clic pendant l'écriture
      savingRef.current = true;
      try {
        await updateOrganization(orgId, {
          team_size: details.teamSize,
          annual_hires: details.annualHires ?? null,
          ...(details.freelanceMode ? { freelance_mode: details.freelanceMode } : {}),
          ...(specs.length > 0 ? { specializations: specs } : {}),
        });
        return true;
      } catch (err) {
        console.error('[Onboarding] profile update failed:', err);
        toast.error("Vos réponses n'ont pas pu être enregistrées. Vérifiez votre connexion puis réessayez.");
        return false;
      } finally {
        savingRef.current = false;
      }
    },
    [createdOrgId, organization?.id]
  );

  const handleOrgDetailsSubmitted = useCallback(
    async (data: OrgDetailsData) => {
      setOrgDetailsData(data);
      if (!(await saveProfile(data, specializations))) return;
      completeAndNext('orgdetails');
    },
    [saveProfile, specializations, completeAndNext]
  );

  const handleSpecializationsSubmitted = useCallback(
    async (specs: string[]) => {
      setSpecializations(specs);
      if (!(await saveProfile(orgDetailsData, specs))) return;
      completeAndNext('specializations');
    },
    [saveProfile, orgDetailsData, completeAndNext]
  );

  const handleOrgCreated = useCallback(
    (data: OnboardingCompanyData) => {
      setOrgCreated(true);
      setOrgName(data.name);
      if (data.orgId) setCreatedOrgId(data.orgId);
      markCompleted('org');
      // org_type est écrit dans l'INSERT (SceneOrganization → createOrganization) :
      // plus d'UPDATE séparé ici, donc plus d'espace sans type.
      goNext();
    },
    [markCompleted, goNext]
  );

  const handleLinkedInNext = useCallback(
    (connected: boolean) => {
      if (connected) markCompleted('linkedin');
      goNext();
    },
    [markCompleted, goNext]
  );

  const handleFinish = useCallback(
    async (destination: 'mission' | 'dashboard') => {
      clearOnboardingProgress();
      await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      await queryClient.refetchQueries({ queryKey: ['active-organization'] });
      // Une organisation qui vient d'être créée n'a aucune mission : on ouvre
      // directement la création (ProjectsListV2 honore ?create=brief).
      navigate(destination === 'mission' ? '/missions?create=brief' : '/dashboard', { replace: true });
    },
    [navigate, queryClient]
  );

  // ─── Fiche « Votre espace » (colonne de gauche) ───
  const summary = useMemo<SummaryRow[]>(() => {
    const isFreelance = orgType === 'freelance';
    const teamLabel = isFreelance
      ? FREELANCE_MODES.find((m) => m.value === orgDetailsData?.freelanceMode)?.label
      : TEAM_SIZES.find((t) => t.value === orgDetailsData?.teamSize)?.label;
    const specsDone = completedScenes.has('specializations');
    const linkedInPassed = completedScenes.has('linkedin') || currentScene === 'launch';
    const active = (scene: SceneKey) => currentScene === scene;
    return [
      {
        key: 'type',
        label: 'Profil',
        value: orgType ? ORG_TYPE_LABELS[orgType] : null,
        active: active('orgtype'),
      },
      {
        key: 'org',
        label: isFreelance ? 'Activité' : 'Société',
        value: orgName ?? organization?.name ?? null,
        active: active('org'),
      },
      {
        key: 'team',
        label: isFreelance ? 'Mode' : 'Équipe',
        value: completedScenes.has('orgdetails') ? (teamLabel ?? null) : null,
        active: active('orgdetails'),
      },
      {
        key: 'specs',
        label: 'Secteurs',
        value: !specsDone ? null : specializations.length > 0 ? `${specializations.length} choisi${specializations.length > 1 ? 's' : ''}` : 'Non précisé',
        muted: specsDone && specializations.length === 0,
        active: active('specializations'),
      },
      {
        key: 'linkedin',
        label: 'LinkedIn',
        value: linkedInConnected ? 'Connecté' : linkedInPassed ? 'À connecter plus tard' : null,
        ok: linkedInConnected,
        muted: !linkedInConnected,
        active: active('linkedin'),
      },
    ];
  }, [orgType, orgName, organization?.name, orgDetailsData, completedScenes, specializations, linkedInConnected, currentScene]);

  // F3 : un utilisateur qui a déjà un espace et arrive à l'ENTRÉE du tunnel
  // (step 0, pas de progression en cours) sans `?new=1` n'a rien à faire ici →
  // dashboard. `step === 0` est sans effet de bord : toute création d'org dans
  // le tunnel a lieu à un step > 0 (scènes `org` / `specializations`), donc un
  // utilisateur en cours d'onboarding n'est jamais renvoyé.
  // Un utilisateur qui est déjà entré dans le tunnel (step > 0 à un moment,
  // y compris après rechargement avec progression restaurée) et revient au
  // premier écran ne doit pas être éjecté : son org vient peut-être d'être créée.
  useEffect(() => {
    if (step > 0) tunnelStartedRef.current = true;
  }, [step]);
  if (step === 0 && !isExplicitNewWorkspace && !tunnelStartedRef.current) {
    if (isOrgLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Spinner size="lg" label="Chargement de votre espace" />
        </div>
      );
    }
    if (organization) {
      return <Navigate to={withPreviewAccessToken('/dashboard')} replace />;
    }
  }

  return (
    <OnboardingShell flow={flow} stepIndex={step} summary={summary}>
      <div className="w-full max-w-lg mx-auto mb-4 empty:mb-0">
        <InvitationBanner />
      </div>

      <div className="w-full min-h-80">
        {/* Changement de scène : un fondu d'entrée de 200 ms, rien d'autre (01-direction.md, § 7). */}
        <motion.div
          key={step}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.2, ease: 'easeOut' }}
          className="w-full"
        >
          {currentScene === 'orgtype' && <SceneOrgType onSelect={handleOrgTypeSelected} initial={orgType} />}
          {currentScene === 'org' && orgType === 'freelance' && (
            <SceneFreelanceName
              createdOrgId={createdOrgId}
              allowSecondWorkspace={isExplicitNewWorkspace}
              onComplete={handleOrgCreated}
            />
          )}
          {currentScene === 'org' && orgType && orgType !== 'freelance' && (
            <SceneOrganization orgType={orgType} onComplete={handleOrgCreated} onBack={goBack} allowSecondWorkspace={isExplicitNewWorkspace} />
          )}
          {/* Pas de retour : la scène précédente vient de créer l'espace de travail */}
          {currentScene === 'orgdetails' && orgType && (
            <SceneOrgDetails orgType={orgType} initial={orgDetailsData} onSubmit={handleOrgDetailsSubmitted} />
          )}
          {currentScene === 'specializations' && (
            <SceneSpecializations
              onSubmit={handleSpecializationsSubmitted}
              onSkip={() => handleSpecializationsSubmitted([])}
              onBack={goBack}
              savedSpecializations={specializations}
            />
          )}
          {currentScene === 'linkedin' && <SceneLinkedIn onNext={handleLinkedInNext} onBack={goBack} />}
          {currentScene === 'launch' && (
            <SceneLaunch
              orgName={orgName ?? organization?.name}
              linkedInConnected={linkedInConnected}
              onFinish={() => handleFinish('mission')}
              onSkip={() => handleFinish('dashboard')}
            />
          )}
        </motion.div>
      </div>
    </OnboardingShell>
  );
};

export default Onboarding;
