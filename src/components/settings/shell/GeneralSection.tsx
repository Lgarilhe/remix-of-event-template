import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Check, Loader2, Pencil } from 'lucide-react';
import { toast } from 'sonner';
import { useOrganization, type Organization } from '@/hooks/useOrganization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { OrgLogoEditor } from '@/components/settings/OrgLogoEditor';
import { OrgTypeSetting } from '@/components/settings/OrgTypeSetting';
import { IntegrationsSettings } from '@/components/settings/IntegrationsSettings';
import { updateOrganization } from '@/lib/organizationUpdate';
import { SettingsAnchor } from './SettingsAnchor';

/**
 * Mon organisation › Général : identité de l'organisation (logo, nom, type) et outils reliés.
 * Code déplacé depuis l'ancien onglet « Général » de Settings.tsx, sans changement de
 * comportement. Le slug de l'organisation n'est plus affiché : retrait du lot 3.
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
      toast.success('Nom mis à jour');
      setEditingName(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Le nom n’a pas pu être enregistré.');
    } finally {
      setSavingName(false);
    }
  };
  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Building2 className="w-4 h-4" />
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

          <div className="border-t border-border pt-3 space-y-3">
            <div>
              <label className="text-sm text-muted-foreground">Nom</label>
              {editingName ? (
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    className="h-9 text-sm max-w-xs"
                    autoFocus
                    onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                  />
                  <Button size="sm" className="h-9 gap-1" onClick={handleSaveName} disabled={savingName || !newName.trim()}>
                    {savingName ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Sauver
                  </Button>
                  <Button size="sm" variant="ghost" className="h-9" onClick={() => setEditingName(false)}>
                    Annuler
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <p className="text-foreground font-medium">{organization?.name}</p>
                  {isAdmin && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground"
                      onClick={() => { setNewName(organization?.name || ''); setEditingName(true); }}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              )}
            </div>
            <OrgTypeSetting />
          </div>
        </CardContent>
      </Card>

      <SettingsAnchor id="outils"><IntegrationsSettings /></SettingsAnchor>
    </>
  );
}
