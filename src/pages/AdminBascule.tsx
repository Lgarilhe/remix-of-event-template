import { useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { PageLayout } from '@/components/layout/PageLayout';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ACCESS_ERROR, CONFIRM_WORD, DENIED, PAGE } from '@/components/settings/admin/basculeCopy';
import {
  ApplyStep,
  PreviewStep,
  ReadinessStep,
  RollbackDialog,
  RollbackStatus,
} from '@/components/settings/admin/BasculePanel';
import { useBascule } from '@/components/settings/admin/useBascule';

/**
 * Bascule de la connexion (/settings/admin/bascule).
 *
 * Page cachée : aucune entrée de navigation, absente du registre des Paramètres. Elle répond à
 * « la nouvelle connexion est-elle bien branchée ? » : vérifier, simuler la conversion des comptes,
 * convertir (confirmation BASCULER), annuler un lot. Un utilisateur qui n'est pas administrateur de
 * la plateforme voit « Accès réservé » (le serveur répond 403, aucun toast).
 */

const AdminBascule = () => {
  const bascule = useBascule();
  // Lot dont l'annulation attend une confirmation.
  const [rollbackFor, setRollbackFor] = useState<string | null>(null);
  const { access } = bascule;

  const head = (
    <Helmet>
      <title>{PAGE.seoTitle} | Konekt</title>
      <meta name="robots" content="noindex, nofollow" />
    </Helmet>
  );

  if (access === 'checking') {
    return (
      <PageLayout maxWidth="md">
        {head}
        <div role="status" aria-label={PAGE.checking} className="space-y-4">
          <Skeleton className="h-9 w-72" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </PageLayout>
    );
  }

  if (access === 'denied') {
    return (
      <PageLayout maxWidth="md">
        {head}
        <PageHeader title={PAGE.title} />
        <EmptyState
          icon={Lock}
          title={DENIED.title}
          description={DENIED.body}
          headingLevel={2}
          action={
            <Button asChild variant="default">
              <Link to="/dashboard">{DENIED.back}</Link>
            </Button>
          }
        />
      </PageLayout>
    );
  }

  if (access !== 'granted') {
    return (
      <PageLayout maxWidth="md">
        {head}
        <PageHeader title={PAGE.title} />
        <ErrorBox title={ACCESS_ERROR.title} detail={access.error.message} onRetry={bascule.verifyAccess} />
      </PageLayout>
    );
  }

  const rolledBackBatch = bascule.rollback.phase === 'done' ? bascule.rollbackTarget : null;
  // Une conversion et une annulation ne se lancent pas en même temps (le serveur les met aussi en file).
  const busy = bascule.apply.phase === 'loading' || bascule.rollback.phase === 'loading';

  return (
    <PageLayout maxWidth="md">
      {head}
      <PageHeader title={PAGE.title} subtitle={PAGE.subtitle} />
      <div className="space-y-6">
        <ReadinessStep step={bascule.readiness} onRun={bascule.runReadiness} />
        <PreviewStep step={bascule.preview} busy={busy} onRun={bascule.runPreview} onRollback={setRollbackFor} />
        <ApplyStep
          step={bascule.apply}
          preview={bascule.preview}
          readiness={bascule.readiness}
          rolledBackBatch={rolledBackBatch}
          busy={busy}
          onApply={(allowUnmapped) => {
            // La conversion part avec l'empreinte de la simulation montrée : le serveur refuse si les comptes ont changé.
            const fingerprint = bascule.preview.phase === 'done' ? bascule.preview.value.planFingerprint : '';
            void bascule.runApply(CONFIRM_WORD, allowUnmapped, fingerprint);
          }}
          onRollback={setRollbackFor}
        />
        <RollbackStatus step={bascule.rollback} batchId={bascule.rollbackTarget} />
      </div>
      <RollbackDialog
        batchId={rollbackFor}
        onClose={() => setRollbackFor(null)}
        onConfirm={(batchId) => {
          setRollbackFor(null);
          void bascule.runRollback(batchId);
        }}
      />
    </PageLayout>
  );
};

export default AdminBascule;
