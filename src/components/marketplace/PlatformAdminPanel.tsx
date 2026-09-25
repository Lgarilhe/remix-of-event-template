/**
 * PlatformAdminPanel : « Administration du cercle », visible des seuls
 * identifiants listés dans KONEKT_PLATFORM_ADMIN_USER_IDS (edge function
 * marketplace-admin, action whoami). Valide ou suspend une organisation.
 */

import React, { useId, useState } from 'react';
import { Inbox, RefreshCw } from 'lucide-react';
import { usePlatformAdmin, type PlatformPartner } from '@/hooks/useMarketplace';
import { EmptyState } from '@/components/layout/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { orgTypeLabel, formatDate } from './huntLabels';
import { ErrorBox } from './ErrorBox';
import { RowsSkeleton } from './MarketplaceSkeleton';

const PARTNER_STATUS: Record<string, { label: string; variant: 'muted' | 'warning' | 'success' | 'danger' }> = {
  inactive: { label: 'Inactif', variant: 'muted' },
  pending_validation: { label: 'En attente', variant: 'warning' },
  active: { label: 'Actif', variant: 'success' },
  suspended: { label: 'Suspendu', variant: 'danger' },
};

type PendingAction = { kind: 'validate' | 'suspend'; partner: PlatformPartner } | null;

export const PlatformAdminPanel: React.FC = () => {
  const { isPlatformAdmin, isLoading, isError, errorText, partners, refresh, validate, suspend, isMutating } = usePlatformAdmin();
  const [pending, setPending] = useState<PendingAction>(null);
  const titleId = useId();

  if (!isPlatformAdmin) return null;

  const confirm = async () => {
    if (!pending) return;
    const { kind, partner } = pending;
    setPending(null);
    try {
      if (kind === 'validate') await validate(partner.organization_id);
      else await suspend(partner.organization_id);
    } catch {
      // Erreur déjà affichée par le hook
    }
  };

  return (
    <section aria-labelledby={titleId} className="mt-12 border-t border-border pt-8">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={titleId} className="text-md font-semibold text-foreground">Administration du cercle</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Demandes d'adhésion des cabinets et indépendants. Visible de l'équipe Konekt seulement.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { refresh().catch(() => undefined); }} disabled={isLoading} className="min-h-11 md:min-h-0">
          <RefreshCw aria-hidden="true" />
          Actualiser la liste
        </Button>
      </div>

      {isLoading ? (
        <RowsSkeleton label="Chargement des demandes" />
      ) : isError ? (
        <ErrorBox
          title="Impossible de charger les demandes."
          detail={errorText}
          onRetry={() => { refresh().catch(() => undefined); }}
        />
      ) : partners.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={Inbox}
          title="Aucune demande pour le moment"
          description="Les demandes des cabinets et des indépendants apparaîtront ici."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Organisation</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Demandeur</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Statut</TableHead>
                <TableHead className="text-right">Membres</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((p) => {
                const status = PARTNER_STATUS[p.status] ?? { label: p.status, variant: 'muted' as const };
                const name = p.organization_name || 'cette organisation';
                return (
                  <TableRow key={p.organization_id}>
                    <TableCell className="text-sm font-medium">{p.organization_name || p.organization_id}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{orgTypeLabel(p.org_type)}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{p.requested_by_name || ''}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDate(p.requested_at)}
                      {p.status === 'active' && p.validated_at ? ` (validé le ${formatDate(p.validated_at)})` : ''}
                    </TableCell>
                    <TableCell>
                      <Badge variant={status.variant}>{status.label}</Badge>
                    </TableCell>
                    <TableCell className="text-right text-sm tabular-nums">{p.member_count}</TableCell>
                    <TableCell className="text-right">
                      <div className="inline-flex items-center gap-2">
                        {p.status !== 'active' && (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setPending({ kind: 'validate', partner: p })}
                            disabled={isMutating}
                            aria-label={`Valider ${name}`}
                            className="min-h-11 md:min-h-0"
                          >
                            Valider
                          </Button>
                        )}
                        {p.status !== 'suspended' && (
                          <Button
                            variant="outline"
                            size="xs"
                            onClick={() => setPending({ kind: 'suspend', partner: p })}
                            disabled={isMutating}
                            aria-label={`Suspendre ${name}`}
                            className="min-h-11 md:min-h-0"
                          >
                            Suspendre
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <AlertDialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pending?.kind === 'validate' ? 'Valider ce partenaire ?' : 'Suspendre ce partenaire ?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pending?.kind === 'validate'
                ? `Tous les membres de « ${pending.partner.organization_name || 'cette organisation'} » verront les missions ouvertes et pourront postuler. Les propriétaires et administrateurs recevront une notification.`
                : `Les membres de « ${pending?.partner.organization_name || 'cette organisation'} » ne verront plus les missions ouvertes. Les collaborations en cours ne sont pas modifiées.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className={pending?.kind === 'suspend' ? 'bg-destructive text-destructive-foreground hover:bg-destructive/90' : undefined}
              onClick={confirm}
            >
              {pending?.kind === 'validate' ? 'Valider le partenaire' : 'Suspendre le partenaire'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default PlatformAdminPanel;
