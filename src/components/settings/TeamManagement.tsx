import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Briefcase, Sliders, Users, ChevronDown, ChevronUp, Trash2, Plus, Save, Loader2 } from 'lucide-react';
import { useJobAssignments } from '@/hooks/useJobAssignments';
import { useMemberQuotas, DEFAULT_QUOTAS } from '@/hooks/useMemberQuotas';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { OrganizationMember } from '@/hooks/useOrganization';

interface TeamManagementProps {
  members: OrganizationMember[];
  getDisplayName: (userId: string) => string;
  isAdmin: boolean;
}

export const TeamManagement: React.FC<TeamManagementProps> = ({
  members,
  getDisplayName,
  isAdmin,
}) => {
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const { assignments, assign, unassign, isAssigning } = useJobAssignments();
  const { quotas, upsertQuota, isSaving, getQuotaForUser } = useMemberQuotas();
  const { data: jobs = [] } = useNotionJobs();

  const [editingQuotas, setEditingQuotas] = useState<Record<string, typeof DEFAULT_QUOTAS>>({});

  const getMemberAssignments = (userId: string) =>
    assignments.filter(a => a.user_id === userId);

  const handleAssignJob = (member: OrganizationMember) => {
    if (!selectedJobId) return;
    const job = jobs.find(j => j.id === selectedJobId);
    assign({
      memberId: member.id,
      userId: member.user_id,
      jobId: selectedJobId,
      jobTitle: job?.title || selectedJobId,
    });
    setSelectedJobId('');
  };

  const startEditingQuotas = (userId: string) => {
    const existing = getQuotaForUser(userId);
    setEditingQuotas(prev => ({
      ...prev,
      [userId]: {
        max_inmails_per_day: existing?.max_inmails_per_day ?? DEFAULT_QUOTAS.max_inmails_per_day,
        max_messages_per_day: existing?.max_messages_per_day ?? DEFAULT_QUOTAS.max_messages_per_day,
        max_searches_per_day: existing?.max_searches_per_day ?? DEFAULT_QUOTAS.max_searches_per_day,
        max_profile_visits_per_day: existing?.max_profile_visits_per_day ?? DEFAULT_QUOTAS.max_profile_visits_per_day,
      },
    }));
  };

  const handleSaveQuotas = (userId: string) => {
    const q = editingQuotas[userId];
    if (!q) return;
    upsertQuota({ userId, quotas: q });
    setEditingQuotas(prev => {
      const next = { ...prev };
      delete next[userId];
      return next;
    });
  };

  if (!isAdmin) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Sliders className="w-5 h-5" />
          Gestion avancée
          <Badge variant="secondary" className="ml-auto text-xs">Assignations & Quotas</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {members.map((member) => {
          const isExpanded = expandedMember === member.user_id;
          const memberJobs = getMemberAssignments(member.user_id);
          const memberQuota = getQuotaForUser(member.user_id);
          const isEditingQ = !!editingQuotas[member.user_id];

          return (
            <div key={member.id} className="border border-border rounded-md">
              <button
                onClick={() => setExpandedMember(isExpanded ? null : member.user_id)}
                className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium text-sm">{getDisplayName(member.user_id)}</span>
                  <Badge variant="outline" className="text-xs">{memberJobs.length} poste(s)</Badge>
                </div>
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {isExpanded && (
                <div className="p-3 pt-0 space-y-4">
                  {/* Job Assignments */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                      <Briefcase className="w-3.5 h-3.5" />
                      Postes assignés
                    </h4>
                    {memberJobs.length === 0 ? (
                      <p className="text-xs text-muted-foreground italic">Aucun poste assigné</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5 mb-2">
                        {memberJobs.map(a => (
                          <Badge key={a.id} variant="secondary" className="gap-1 text-xs">
                            {a.job_title || a.job_id}
                            <button onClick={() => unassign(a.id)} className="ml-1 hover:text-destructive">
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </Badge>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                        <SelectTrigger className="h-8 text-xs flex-1">
                          <SelectValue placeholder="Ajouter un poste…" />
                        </SelectTrigger>
                        <SelectContent>
                          {jobs
                            .filter(j => !memberJobs.some(a => a.job_id === j.id))
                            .map(j => (
                              <SelectItem key={j.id} value={j.id} className="text-xs">
                                {j.title}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        className="h-8 gap-1"
                        onClick={() => handleAssignJob(member)}
                        disabled={!selectedJobId || isAssigning}
                      >
                        {isAssigning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        Assigner
                      </Button>
                    </div>
                  </div>

                  {/* Quotas */}
                  <div>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2 flex items-center gap-1">
                      <Sliders className="w-3.5 h-3.5" />
                      Quotas journaliers
                    </h4>
                    {!isEditingQ ? (
                      <div className="space-y-1">
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <span className="text-muted-foreground">InMails/jour</span>
                          <span className="font-medium">{memberQuota?.max_inmails_per_day ?? DEFAULT_QUOTAS.max_inmails_per_day}</span>
                          <span className="text-muted-foreground">Messages/jour</span>
                          <span className="font-medium">{memberQuota?.max_messages_per_day ?? DEFAULT_QUOTAS.max_messages_per_day}</span>
                          <span className="text-muted-foreground">Recherches/jour</span>
                          <span className="font-medium">{memberQuota?.max_searches_per_day ?? DEFAULT_QUOTAS.max_searches_per_day}</span>
                          <span className="text-muted-foreground">Visites profils/jour</span>
                          <span className="font-medium">{memberQuota?.max_profile_visits_per_day ?? DEFAULT_QUOTAS.max_profile_visits_per_day}</span>
                        </div>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs mt-2"
                          onClick={() => startEditingQuotas(member.user_id)}
                        >
                          Modifier les quotas
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {([
                          ['max_inmails_per_day', 'InMails/jour'],
                          ['max_messages_per_day', 'Messages/jour'],
                          ['max_searches_per_day', 'Recherches/jour'],
                          ['max_profile_visits_per_day', 'Visites profils/jour'],
                        ] as const).map(([key, label]) => (
                          <div key={key} className="flex items-center gap-2">
                            <label className="text-xs text-muted-foreground w-32">{label}</label>
                            <Input
                              type="number"
                              min={0}
                              className="h-7 text-xs w-20"
                              value={editingQuotas[member.user_id]?.[key] ?? 0}
                              onChange={e => setEditingQuotas(prev => ({
                                ...prev,
                                [member.user_id]: {
                                  ...prev[member.user_id],
                                  [key]: parseInt(e.target.value) || 0,
                                },
                              }))}
                            />
                          </div>
                        ))}
                        <div className="flex gap-2 mt-2">
                          <Button
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => handleSaveQuotas(member.user_id)}
                            disabled={isSaving}
                          >
                            {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                            Sauvegarder
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setEditingQuotas(prev => {
                              const next = { ...prev };
                              delete next[member.user_id];
                              return next;
                            })}
                          >
                            Annuler
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
};
