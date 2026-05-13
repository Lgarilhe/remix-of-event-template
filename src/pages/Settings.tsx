import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { useOrganization, useOrganizationMembers } from '@/hooks/useOrganization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Building2, Users, Crown, Shield, User, Trash2, Plug, Check, Loader2, Pencil,
  UserCircle, CreditCard, Sparkles, UserCog, MessageSquare, Bookmark, Briefcase, Store,
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useQuery } from '@tanstack/react-query';
import { SEOHead } from '@/components/SEOHead';
import { IntegrationsSettings } from '@/components/settings/IntegrationsSettings';
import { InviteMemberForm } from '@/components/settings/InviteMemberForm';
import { PendingInvitations } from '@/components/settings/PendingInvitations';
import { TeamManagement } from '@/components/settings/TeamManagement';
import { MyLinkedInAccount } from '@/components/settings/MyLinkedInAccount';
import { ExtensionTokens } from '@/components/settings/ExtensionTokens';
import { MyWhatsAppAccount } from '@/components/settings/MyWhatsAppAccount';
import { MyEmailAccount } from '@/components/settings/MyEmailAccount';
import { EmailSignatures } from '@/components/settings/EmailSignatures';
import { BillingSettings } from '@/components/settings/BillingSettings';
import { AICreditsSettings } from '@/components/settings/AICreditsSettings';
import { MessageTemplatesSettings } from '@/components/settings/MessageTemplatesSettings';
import { OrgLogoEditor } from '@/components/settings/OrgLogoEditor';
import { ConnectorSettings } from '@/components/settings/ConnectorSettings';
import { AgencySettings } from '@/components/settings/AgencySettings';
import { MarketplaceActivation } from '@/components/settings/MarketplaceActivation';
import { PedigreePresetsSettings } from '@/components/settings/PedigreePresetsSettings';
import { toast } from 'sonner';
import { BrutalLoader } from '@/components/ui/brutal-loader';


const roleIcons = {
  owner: Crown,
  admin: Shield,
  member: User,
  collaborator: UserCog,
};

const roleLabels = {
  owner: 'Propriétaire',
  admin: 'Admin',
  member: 'Membre',
  collaborator: 'Collaborateur',
};

const Settings = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const { organization, organizationId, isOwner, isAdmin, isCollaborator, isAgency } = useOrganization();
  const { members, isLoading, pendingInvitations, inviteMember, isInviting, resendInvitation, isResendingInvitation, cancelInvitation, updateRole, removeMember } = useOrganizationMembers(organizationId);

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

  const [activeTab, _setActiveTab] = useState(() => {
    const tab = searchParams.get('tab');
    if (tab === 'credits') return 'credits';
    if (tab === 'billing' && isAdmin) return 'billing';
    if (tab === 'integrations' && isAdmin) return 'integrations';
    if (tab === 'account') return 'account';
    if (tab === 'templates') return 'templates';
    if (tab === 'connectors' && !isCollaborator) return 'connectors';
    if (tab === 'team' && !isCollaborator) return 'team';
    if (tab === 'presets' && !isCollaborator) return 'presets';
    if (tab === 'agency' && isAgency) return 'agency';
    if (tab === 'marketplace') return 'marketplace';
    return 'general';
  });

  // Sync activeTab → URL pour bookmark / partage de lien direct
  const setActiveTab = useCallback(
    (next: string) => {
      _setActiveTab(next);
      const params = new URLSearchParams(searchParams);
      if (next === 'general') params.delete('tab');
      else params.set('tab', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  // Tabs groupés par section pour aérer la navigation (pattern Linear/Vercel)
  const tabGroups = [
    {
      label: 'Workspace',
      items: [
        { value: 'general', label: 'Général', icon: Building2 },
        ...(!isCollaborator ? [{ value: 'presets', label: 'Presets clients', icon: Bookmark }] : []),
        { value: 'templates', label: 'Templates', icon: MessageSquare },
      ],
    },
    {
      label: 'Compte & accès',
      items: [
        { value: 'account', label: 'Mon compte', icon: UserCircle },
        ...(!isCollaborator ? [{ value: 'team', label: 'Équipe', icon: Users }] : []),
        ...(!isCollaborator ? [{ value: 'connectors', label: 'Connecteurs', icon: Plug }] : []),
        ...(isAdmin ? [{ value: 'integrations', label: 'Intégrations', icon: Plug }] : []),
      ],
    },
    {
      label: 'Facturation',
      items: [
        ...(isAdmin ? [{ value: 'billing', label: 'Abonnement', icon: CreditCard }] : []),
        { value: 'credits', label: 'Crédits IA', icon: Sparkles },
      ],
    },
    {
      label: 'Plus',
      items: [
        ...(isAgency ? [{ value: 'agency', label: 'Agence', icon: Briefcase }] : []),
        { value: 'marketplace', label: 'Marketplace', icon: Store },
      ],
    },
  ].filter(g => g.items.length > 0);

  // Flat list pour navigation clavier
  const tabs = tabGroups.flatMap(g => g.items);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Paramètres | Konekt"
        description="Gérez les paramètres de votre organisation"
      />

      <div className="py-6 pb-8">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-4">Paramètres</h1>

          {/* Layout : sidebar groupée (lg+) avec indicateur animé framer-motion
              qui glisse entre les onglets (layoutId="settings-active-pill"),
              ou tabs horizontales scrollables (mobile/tablet). Pattern Linear/
              Vercel/Cal.com — clean, premium, accessible. */}
          <div className="flex flex-col lg:flex-row lg:gap-10">
            <nav
              role="tablist"
              aria-label="Sections des paramètres"
              className={cn(
                'lg:w-60 lg:shrink-0 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto',
                'mb-4 lg:mb-0 pb-2 lg:pb-1',
                'border-b border-border lg:border-b-0',
                'overflow-x-auto lg:overflow-x-visible no-scrollbar',
              )}
              onKeyDown={(e) => {
                const navKeys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
                if (!navKeys.includes(e.key)) return;
                e.preventDefault();
                const currentIdx = tabs.findIndex(t => t.value === activeTab);
                let nextIdx = currentIdx;
                if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') nextIdx = (currentIdx - 1 + tabs.length) % tabs.length;
                else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') nextIdx = (currentIdx + 1) % tabs.length;
                else if (e.key === 'Home') nextIdx = 0;
                else if (e.key === 'End') nextIdx = tabs.length - 1;
                setActiveTab(tabs[nextIdx].value);
                const target = e.currentTarget.querySelector<HTMLButtonElement>(`[data-tab-value="${tabs[nextIdx].value}"]`);
                target?.focus();
              }}
            >
              {/* Mobile : tous les onglets en row, pas de groupes (manque de
                  place pour des labels de section + tabs). Desktop : sections. */}
              <div className="flex lg:hidden gap-1 px-1">
                {tabs.map(tab => {
                  const isActive = activeTab === tab.value;
                  const Icon = tab.icon;
                  return (
                    <button
                      key={tab.value}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      aria-controls={`settings-panel-${tab.value}`}
                      id={`settings-tab-${tab.value}-mobile`}
                      data-tab-value={tab.value}
                      tabIndex={isActive ? 0 : -1}
                      onClick={() => setActiveTab(tab.value)}
                      className={cn(
                        'flex items-center gap-1.5 px-3 h-8 rounded-full text-xs font-medium whitespace-nowrap transition-colors shrink-0',
                        isActive
                          ? 'bg-foreground text-background'
                          : 'text-foreground/70 hover:bg-muted'
                      )}
                    >
                      <Icon className="w-3.5 h-3.5 shrink-0" />
                      <span>{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Desktop : sections groupées avec indicateur animé glissant */}
              <div className="hidden lg:flex lg:flex-col gap-6">
                {tabGroups.map((group, gi) => (
                  <div key={group.label} className="flex flex-col gap-0.5">
                    <p className="text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/70 px-3 mb-1.5">
                      {group.label}
                    </p>
                    {group.items.map(tab => {
                      const isActive = activeTab === tab.value;
                      const Icon = tab.icon;
                      return (
                        <button
                          key={tab.value}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          aria-controls={`settings-panel-${tab.value}`}
                          id={`settings-tab-${tab.value}`}
                          data-tab-value={tab.value}
                          tabIndex={isActive ? 0 : -1}
                          onClick={() => setActiveTab(tab.value)}
                          className={cn(
                            'group relative flex items-center gap-2.5 px-3 h-9 rounded-lg text-sm font-medium transition-colors',
                            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                            isActive
                              ? 'text-background'
                              : 'text-foreground/70 hover:text-foreground hover:bg-muted/60'
                          )}
                        >
                          {/* Indicateur animé qui glisse entre les onglets */}
                          {isActive && (
                            <motion.span
                              layoutId="settings-active-pill"
                              className="absolute inset-0 bg-foreground rounded-lg shadow-sm"
                              transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                            />
                          )}
                          <Icon
                            className={cn(
                              'relative w-4 h-4 shrink-0 transition-colors',
                              isActive
                                ? 'text-background'
                                : 'text-muted-foreground group-hover:text-foreground',
                            )}
                          />
                          <span className="relative">{tab.label}</span>
                        </button>
                      );
                    })}
                    {/* Séparateur entre groupes (sauf le dernier) */}
                    {gi < tabGroups.length - 1 && (
                      <div className="mt-3 -mx-1 border-t border-border/60" aria-hidden="true" />
                    )}
                  </div>
                ))}
              </div>
            </nav>

            {/* Tab content */}
            <div
              role="tabpanel"
              id={`settings-panel-${activeTab}`}
              aria-labelledby={`settings-tab-${activeTab}`}
              tabIndex={0}
              className="flex-1 min-w-0 max-w-3xl space-y-6 focus:outline-none"
            >
            {activeTab === 'general' && (
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
                      isOwner={isOwner}
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
                  </div>
                </CardContent>
              </Card>
            )}

            {activeTab === 'account' && (
              <div className="space-y-6">
                <MyLinkedInAccount />
                <ExtensionTokens />
                <MyEmailAccount />
                <EmailSignatures />
                <MyWhatsAppAccount />
              </div>
            )}

            {activeTab === 'team' && (
              <>
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
                      <Users className="w-4 h-4" />
                      Équipe
                      <Badge variant="secondary" className="ml-auto text-xs">{members.length} membre{members.length > 1 ? 's' : ''}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {isLoading ? (
                      <div className="flex justify-center py-8">
                        <BrutalLoader compact />
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
                                      <SelectItem value="collaborator">Collaborateur</SelectItem>
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
                      onResend={async (email, role) => { await resendInvitation({ email, role }); }}
                      canManage={isAdmin}
                      isResending={isResendingInvitation}
                    />

                    {isAdmin && !isCollaborator && (
                      <InviteMemberForm
                        onInvite={async (email, role) => { await inviteMember({ email, role }); }}
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
              </>
            )}

            {activeTab === 'billing' && isAdmin && (
              <BillingSettings />
            )}

            {activeTab === 'credits' && (
              <AICreditsSettings />
            )}

            {activeTab === 'templates' && (
              <MessageTemplatesSettings />
            )}

            {activeTab === 'connectors' && (
              <ConnectorSettings />
            )}

            {activeTab === 'presets' && !isCollaborator && (
              <PedigreePresetsSettings />
            )}

            {activeTab === 'integrations' && isAdmin && (
              <IntegrationsSettings />
            )}
            {activeTab === 'agency' && isAgency && (
              <AgencySettings />
            )}
            {activeTab === 'marketplace' && (
              <MarketplaceActivation />
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Settings;
