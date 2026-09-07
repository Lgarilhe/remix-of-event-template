/**
 * PlatformAdminPanel : « Administration du cercle », visible des seuls
 * identifiants listés dans KONEKT_PLATFORM_ADMIN_USER_IDS (edge function
 * marketplace-admin, action whoami). Valide ou suspend une organisation.
 */

import React, { useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { usePlatformAdmin, type PlatformPartner } from '@/hooks/useMarketplace';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { orgTypeLabel, formatDate } from './huntLabels';

const PARTNER_STATUS_LABELS: Record<string, string> = {
  inactive: 'Inactif',
  pending_validation: 'En attente',
  active: 'Actif',
  suspended: 'Suspendu',
};

type PendingAction = { kind: 'validate' | 'suspend'; partner: PlatformPartner } | null;

export const PlatformAdminPanel: React.FC = () => {
  const { isPlatformAdmin, isLoading, partners, refresh, validate, suspend, isMutating } = usePlatformAdmin();
  const [pending, setPending] = useState<PendingAction>(null);

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
    <section className="mt-12 pt-8 border-t border-border">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Administration du cercle</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Demandes d'adhésion des cabinets et indépendants. Visible de l'équipe Konekt seulement.
          </p>
        </div>
        <button
          type="button"
          onClick={() => { refresh().catch(() => undefined); }}
          disabled={isLoading}
          className="h-8 px-3 border border-border text-xs font-medium uppercase tracking-wider inline-flex items-center gap-1.5 hover:bg-muted"
        >
          <RefreshCw className="w-3 h-3" /> Actualiser
        </button>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : partners.length === 0 ? (
        <p className="text-xs text-muted-foreground border border-dashed border-border p-6 text-center">
          Aucune demande pour le moment.
        </p>
      ) : (
        <div className="border border-border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] uppercase tracking-wider">Organisation</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Type</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Demandeur</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Date</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider">Statut</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-right">Membres</TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {partners.map((p) => (
                <TableRow key={p.organization_id}>
                  <TableCell className="text-sm font-medium">{p.organization_name || p.organization_id}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{orgTypeLabel(p.org_type)}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{p.requested_by_name || ''}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(p.requested_at)}
                    {p.status === 'active' && p.validated_at ? ` (validé le ${formatDate(p.validated_at)})` : ''}
                  </TableCell>
                  <TableCell>
                    <span className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border border-border text-muted-foreground">
                      {PARTNER_STATUS_LABELS[p.status] ?? p.status}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-right tabular-nums">{p.member_count}</TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex items-center gap-2">
                      {p.status !== 'active' && (
                        <button
                          type="button"
                          onClick={() => setPending({ kind: 'validate', partner: p })}
                          disabled={isMutating}
                          className="h-7 px-3 border border-border text-[11px] font-medium uppercase tracking-wider bg-foreground text-background disabled:opacity-50"
                        >
                          Valider
                        </button>
                      )}
                      {p.status !== 'suspended' && (
                        <button
                          type="button"
                          onClick={() => setPending({ kind: 'suspend', partner: p })}
                          disabled={isMutating}
                          className="h-7 px-3 border border-border text-[11px] font-medium uppercase tracking-wider hover:bg-muted disabled:opacity-50"
                        >
                          Suspendre
                        </button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
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
              {pending?.kind === 'validate' ? 'Valider' : 'Suspendre'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
};

export default PlatformAdminPanel;
