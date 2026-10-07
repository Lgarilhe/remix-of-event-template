import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization, type Organization } from '@/hooks/useOrganization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { OrgLogoEditor } from '@/components/settings/OrgLogoEditor';
import { OrgTypeSetting } from '@/components/settings/OrgTypeSetting';
import { IntegrationsSettings } from '@/components/settings/IntegrationsSettings';
import { updateOrganization } from '@/lib/organizationUpdate';
import { SettingsAnchor } from './SettingsAnchor';

/**
 * Mon organisation › Général : identité de l'organisation (logo, nom, type) et outils reliés.
 * Code déplacé depuis l'ancien onglet « Général » de Settings.tsx, sans changement de
 * comportement. Le slug de l'organisation n'est plus affiché : retrait du lot 3.
 * Revue design (lot 12) : titres de carte en casse de phrase, un seul verbe
 * « Enregistrer », libellés reliés à leur champ, titre « Outils reliés » sur l'ancre #outils.
 */
export function GeneralSection() {
  const { organization, organizationId, isAdmin, refetchOrganization } = useOrganization();
  const queryClient = useQueryClient();

  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const handleSaveName = async () => {
    if (!organizationId || !newName.trim()) return;
    setSavingName(true);
    try {
      const row = await updateOrganization(organizationId, { name: newName.trim() });
      // La carte, la barre latérale et le menu lisent ['active-organization']
      // (10 min, pas de rechargement au focus). La ligne écrite va directement
      // dans ce cache : un rechargement raté ne lève pas d'erreur et gardait
      // l'ancien nom après le toast de succès. Le rechargement suit, sans attente.
      queryClient.setQueriesData<{ organization: Organization } | null>(
        { queryKey: ['active-organization'] },
        (old) => (old?.organization?.id === row.id ? { ...old, organization: { ...old.organization, ...row } } : old),
      );
      void refetchOrganization();
      toast.success('Nom enregistré');
      setEditingName(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Le nom n’a pas pu être enregistré.');
    } finally {
      setSavingName(false);
    }
  };
  return (
    <>
      <SettingsAnchor id="organisation">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm font-semibold">
              <Building2 className="h-4 w-4" aria-hidden="true" />
              Organisation
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Logo */}
            {organizationId && (
              <OrgLogoEditor
                organizationId={organizationId}
                logoUrl={organization?.logo_url ?? null}
                website={organization?.website ?? null}
                orgName={organization?.name || ''}
                canEdit={isAdmin}
              />
            )}

            <div className="space-y-4 border-t border-border pt-4">
              <div>
                <label htmlFor={editingName ? 'org-name' : undefined} className="text-sm text-muted-foreground">Nom</label>
                {editingName ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Input
                      id="org-name"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      className="max-w-xs max-md:h-11"
                      autoFocus
                      onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                    />
                    <Button
                      variant="primary"
                      size="sm"
                      className="max-md:h-11"
                      onClick={handleSaveName}
                      loading={savingName}
                      disabled={!newName.trim()}
                    >
                      Enregistrer
                    </Button>
                    <Button size="sm" variant="ghost" className="max-md:h-11" onClick={() => setEditingName(false)}>
                      Annuler
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{organization?.name}</p>
                    {isAdmin && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-xs"
                            className="max-md:h-11 max-md:w-11"
                            onClick={() => { setNewName(organization?.name || ''); setEditingName(true); }}
                            aria-label="Modifier le nom de l’organisation"
                          >
                            <Pencil aria-hidden="true" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Modifier le nom</TooltipContent>
                      </Tooltip>
                    )}
                  </div>
                )}
              </div>
              <OrgTypeSetting />
            </div>
          </CardContent>
        </Card>
      </SettingsAnchor>

      <SettingsAnchor id="outils">
        <section aria-labelledby="outils-titre" className="space-y-3">
          <div>
            <h3 id="outils-titre" className="text-sm font-semibold text-foreground">Outils reliés</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Les comptes et services que l’organisation relie à Konekt.
            </p>
          </div>
          <IntegrationsSettings />
        </section>
      </SettingsAnchor>
    </>
  );
}
