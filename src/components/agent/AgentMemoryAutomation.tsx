import { useEffect, useRef, useState } from 'react';
import { Brain, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useAgentMemoryAutomation } from '@/hooks/useAgentMemories';
import { Button } from '@/components/ui/button';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { Spinner } from '@/components/ui/spinner';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  variant?: 'settings' | 'invitation';
  enabled?: boolean;
  onManage?: () => void;
}

/** Remount local confirmation/error state whenever its private workspace changes. */
export function AgentMemoryAutomation(props: Props) {
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  if (!organizationId || !user) return null;
  return <MemoryAutomationSetting key={`${organizationId}:${user.id}`} {...props} />;
}

function MemoryAutomationSetting({ variant = 'settings', enabled = true, onManage }: Props) {
  const automation = useAgentMemoryAutomation(enabled);
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const consentTitleRef = useRef<HTMLHeadingElement>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const setMode = async (mode: 'manual' | 'automatic', expectedVersion: number, dismissSuggestion = false) => {
    setError(null);
    try {
      await automation.setMode(mode, expectedVersion, dismissSuggestion);
      if (!alive.current) return;
      setConfirmVersion(null);
      if (!dismissSuggestion) toast.success(mode === 'automatic' ? 'Mémoire automatique activée pour vous' : 'Validation manuelle rétablie');
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : 'Le mode de mémoire n’a pas pu être enregistré.');
    }
  };

  if (!enabled) return null;
  if (automation.isPending) return variant === 'settings' ? <Spinner label="Chargement du mode de mémoire" /> : null;
  if (automation.isError || !automation.data) return variant === 'settings'
    ? <ErrorBox title="Le mode de mémoire n’a pas pu être chargé." onRetry={() => void automation.refetch()} /> : null;
  const { data } = automation;
  if (variant === 'invitation' && data.mode === 'manual' && !data.can_suggest) return null;

  const errorMessage = error && <div role="alert" className="text-xs text-danger">{error}
    <Button type="button" size="sm" variant="link" className="min-h-11 sm:min-h-0" disabled={automation.isSaving} onClick={async () => {
      const next = await automation.refetch();
      if (confirmVersion !== null && next.data) setConfirmVersion(next.data.version);
    }}>Recharger le mode</Button>
  </div>;

  return (
    <section aria-label="Mode de mémoire" className={variant === 'invitation'
      ? 'space-y-2'
      : 'rounded-lg border border-border p-3 space-y-3'}>
      {variant === 'invitation' && data.mode === 'automatic' ? (
        <Button type="button" size="sm" variant="ghost" className="h-auto min-h-11 text-xs sm:min-h-9" onClick={onManage}>
          <Brain aria-hidden="true" className="h-3.5 w-3.5" />Mémoire automatique · Gérer
        </Button>
      ) : (
        <>
          <h3 className="text-sm font-semibold">{variant === 'invitation' ? 'Mémoriser vos préférences de communication ?' : 'Mode de mémoire'}</h3>
          <p className="text-xs text-muted-foreground">{variant === 'invitation'
            ? 'Après vos confirmations, vous pouvez autoriser l’ajout automatique de certaines préférences personnelles.'
            : data.mode === 'automatic' ? 'Mémoire automatique activée pour vous dans cet espace.' : 'Validation manuelle : chaque proposition attend votre confirmation.'}</p>
          {variant === 'settings' && <>
            <p className="text-xs text-muted-foreground">L’automatisation concerne uniquement votre langue de réponse (français ou anglais), la longueur des réponses et leur format (listes ou paragraphes). Les critères de recrutement et les règles de mission ou d’organisation demandent toujours une confirmation.</p>
            <p className="text-xs text-muted-foreground">Ce choix est personnel à cet espace. Revenir au mode manuel arrête les prochains ajouts automatiques ; les mémoires déjà ajoutées restent actives et peuvent être désactivées ci-dessous.</p>
          </>}
          <div className="flex flex-wrap gap-2">
            {data.mode === 'manual' ? <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-0" disabled={automation.isSaving}
              onClick={() => { setError(null); setConfirmVersion(data.version); }}>Activer la mémoire automatique</Button>
              : <Button type="button" size="sm" variant="outline" className="min-h-11 sm:min-h-0" disabled={automation.isSaving} aria-busy={automation.isSaving}
                onClick={() => void setMode('manual', data.version)}>
                {automation.isSaving && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}Revenir à la validation manuelle
              </Button>}
            {variant === 'invitation' && <Button type="button" size="sm" variant="ghost" className="min-h-11 sm:min-h-0" disabled={automation.isSaving}
              onClick={() => void setMode('manual', data.version, true)}>Plus tard</Button>}
          </div>
          {errorMessage}
        </>
      )}
      <AlertDialog open={confirmVersion !== null} onOpenChange={(open) => { if (!open && !automation.isSaving) setConfirmVersion(null); }}>
        <AlertDialogContent className="max-h-[85dvh] overflow-y-auto" onOpenAutoFocus={(event) => {
          event.preventDefault();
          consentTitleRef.current?.focus();
        }}>
          <AlertDialogHeader>
            <AlertDialogTitle ref={consentTitleRef} tabIndex={-1}>Activer la mémoire automatique ?</AlertDialogTitle>
            <AlertDialogDescription>L’assistant pourra garder vos préférences explicites de communication : français ou anglais, réponses courtes ou détaillées, listes ou paragraphes. Ces mémoires restent personnelles à cet espace.</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-sm text-muted-foreground">Les critères de recrutement et les règles de mission ou d’organisation continuent à demander votre confirmation. Vous pourrez revenir à la validation manuelle à tout moment.</p>
          {errorMessage}
          <AlertDialogFooter>
            <AlertDialogCancel className="min-h-11 sm:min-h-0" disabled={automation.isSaving}>Annuler</AlertDialogCancel>
            <AlertDialogAction className="min-h-11 sm:min-h-0" disabled={automation.isSaving} aria-busy={automation.isSaving} onClick={(event) => {
              event.preventDefault();
              if (confirmVersion !== null) void setMode('automatic', confirmVersion);
            }}>
              {automation.isSaving && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}Activer pour moi dans cet espace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
