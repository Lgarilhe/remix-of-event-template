import { useState } from 'react';
import { useOrganization, useOrganizationMembers } from '@/hooks/useOrganization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Building2, Users, Crown, Shield, User, Trash2, ArrowLeft, Plug, Check, Loader2, Pencil, UserCircle } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { IntegrationsSettings } from '@/components/settings/IntegrationsSettings';
import { InviteMemberForm } from '@/components/settings/InviteMemberForm';
import { PendingInvitations } from '@/components/settings/PendingInvitations';
import { TeamManagement } from '@/components/settings/TeamManagement';
import { MyLinkedInAccount } from '@/components/settings/MyLinkedInAccount';
import { toast } from 'sonner';

const roleIcons = {
  owner: Crown,
  admin: Shield,
  member: User,
};

const roleLabels = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
};

const Settings = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { organization, organizationId, isOwner, isAdmin } = useOrganization();
  const { members, isLoading, pendingInvitations, inviteMember, isInviting, cancelInvitation, updateRole, removeMember } = useOrganizationMembers(organizationId);

  const [editingName, setEditingName] = useState(false);
  const [newName, setNewName] = useState('');
  const [savingName, setSavingName] = useState(false);

  const { data: memberProfiles = [] } = useQuery({
    queryKey: ['member-profiles', members.map(m => m.user_id)],
    queryFn: async () => {
      if (!members.length) return [];
      const userIds = members.map(m => m.user_id);
      const { data } = await supabase
        .from('profiles')
        .select('user_id, display_name')
        .in('user_id', userIds);
      return data || [];
    },
    enabled: members.length > 0,
  });

  const getDisplayName = (userId: string) => {
    const profile = memberProfiles.find(p => p.user_id === userId);
    return profile?.display_name || userId.slice(0, 8) + '...';
  };

  const handleSaveName = async () => {
    if (!organizationId || !newName.trim()) return;
    setSavingName(true);
    try {
      const { error } = await supabase
        .from('organizations')
        .update({ name: newName.trim() })
        .eq('id', organizationId);
      if (error) throw error;
      toast.success('Nom mis à jour');
      setEditingName(false);
    } catch {
      toast.error('Erreur lors de la mise à jour');
    } finally {
      setSavingName(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-8">
        <button
          onClick={() => navigate(-1)}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>

        <h1 className="text-2xl font-semibold text-foreground mb-6">Paramètres</h1>

        <Tabs defaultValue={searchParams.get('tab') === 'integrations' && isAdmin ? 'integrations' : searchParams.get('tab') === 'account' ? 'account' : 'general'} className="space-y-6">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="general" className="gap-2">
              <Building2 className="w-4 h-4" />
              Général
            </TabsTrigger>
            <TabsTrigger value="account" className="gap-2">
              <UserCircle className="w-4 h-4" />
              Mon compte
            </TabsTrigger>
            <TabsTrigger value="team" className="gap-2">
              <Users className="w-4 h-4" />
              Équipe
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="integrations" className="gap-2">
                <Plug className="w-4 h-4" />
                Intégrations
              </TabsTrigger>
            )}
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Building2 className="w-5 h-5" />
                  Organisation
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
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
                      {isOwner && (
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
                <div>
                  <label className="text-sm text-muted-foreground">Identifiant</label>
                  <p className="text-foreground font-mono text-sm">{organization?.slug}</p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Team Tab */}
          <TabsContent value="team">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Users className="w-5 h-5" />
                  Équipe
                  <Badge variant="secondary" className="ml-auto">{members.length} membre{members.length > 1 ? 's' : ''}</Badge>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="flex justify-center py-8">
                    <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
                  </div>
                ) : (
                  <div className="space-y-3">
                    {members.map((member) => {
                      const RoleIcon = roleIcons[member.role as keyof typeof roleIcons] || User;
                      return (
                        <div key={member.id} className="flex items-center justify-between py-3 border-b border-border last:border-0">
                          <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-muted rounded-full flex items-center justify-center">
                              <RoleIcon className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="text-sm font-medium text-foreground">{getDisplayName(member.user_id)}</p>
                              <p className="text-xs text-muted-foreground">{roleLabels[member.role as keyof typeof roleLabels]}</p>
                            </div>
                          </div>

                          {isOwner && member.role !== 'owner' && (
                            <div className="flex items-center gap-2">
                              <Select
                                value={member.role}
                                onValueChange={(value) => updateRole({ memberId: member.id, role: value })}
                              >
                                <SelectTrigger className="w-28 h-8 text-xs">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="admin">Admin</SelectItem>
                                  <SelectItem value="member">Membre</SelectItem>
                                </SelectContent>
                              </Select>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-destructive hover:text-destructive"
                                onClick={() => removeMember(member.id)}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                <PendingInvitations
                  invitations={pendingInvitations}
                  onCancel={cancelInvitation}
                  canManage={isAdmin}
                />

                {isAdmin && (
                  <InviteMemberForm
                    onInvite={(email, role) => inviteMember({ email, role })}
                    isLoading={isInviting}
                  />
                )}
              </CardContent>
            </Card>

            {isAdmin && (
              <TeamManagement
                members={members}
                getDisplayName={getDisplayName}
                isAdmin={isAdmin}
              />
            )}
          </TabsContent>

          {/* Integrations Tab */}
          {isAdmin && (
            <TabsContent value="integrations">
              <IntegrationsSettings />
            </TabsContent>
          )}
        </Tabs>
      </div>
    </div>
  );
};

export default Settings;
