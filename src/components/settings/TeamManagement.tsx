import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Slider } from '@/components/ui/slider';
import {
  Briefcase, Sliders, ChevronDown, ChevronUp, X, Plus, Save, Loader2,
  Mail, MessageSquare, Search, Eye, Gauge,
} from 'lucide-react';
import { useJobAssignments } from '@/hooks/useJobAssignments';
import { useMemberQuotas, DEFAULT_QUOTAS } from '@/hooks/useMemberQuotas';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { OrganizationMember } from '@/hooks/useOrganization';
import { cn } from '@/lib/utils';

interface TeamManagementProps {
  members: OrganizationMember[];
  getDisplayName: (userId: string) => string;
  isAdmin: boolean;
}

const QUOTA_FIELDS = [
  { key: 'max_inmails_per_day' as const, label: 'InMails', icon: Mail, max: 200, color: 'bg-brutal-accent' },
  { key: 'max_messages_per_day' as const, label: 'Messages', icon: MessageSquare, max: 500, color: 'bg-foreground' },
  { key: 'max_searches_per_day' as const, label: 'Recherches', icon: Search, max: 500, color: 'bg-foreground' },
  { key: 'max_profile_visits_per_day' as const, label: 'Visites profils', icon: Eye, max: 1000, color: 'bg-foreground' },
];

export const TeamManagement: React.FC<TeamManagementProps> = ({
  members,
  getDisplayName,
  isAdmin,
}) => {
  const [expandedMember, setExpandedMember] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const { assignments, assign, unassign, isAssigning } = useJobAssignments();
  const { upsertQuota, isSaving, getQuotaForUser } = useMemberQuotas();
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
    <div className="border border-foreground bg-background">
      {/* Header bar */}
      <div className="bg-foreground text-background px-4 py-2.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Gauge className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wider">Assignations & Quotas</span>
        </div>
        <span className="text-[10px] uppercase tracking-wider opacity-70">{members.length} membre{members.length > 1 ? 's' : ''}</span>
      </div>

      <div className="divide-y divide-border">
        {members.map((member) => {
          const isExpanded = expandedMember === member.user_id;
          const memberJobs = getMemberAssignments(member.user_id);
          const memberQuota = getQuotaForUser(member.user_id);
          const isEditingQ = !!editingQuotas[member.user_id];

          return (
            <div key={member.id}>
              {/* Member row */}
              <button
                onClick={() => setExpandedMember(isExpanded ? null : member.user_id)}
                className={cn(
                  "w-full flex items-center justify-between px-4 py-3 transition-colors group",
                  isExpanded ? "bg-muted" : "hover:bg-muted/50"
                )}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 bg-foreground text-background flex items-center justify-center shrink-0 text-xs font-bold uppercase">
                    {getDisplayName(member.user_id).charAt(0)}
                  </div>
                  <div className="text-left min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{getDisplayName(member.user_id)}</p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      {memberJobs.length > 0 ? (
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
                          {memberJobs.length} poste{memberJobs.length > 1 ? 's' : ''}
                        </span>
                      ) : (
                        <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide italic">
                          Aucun poste
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <ChevronDown className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform duration-200",
                  isExpanded && "rotate-180"
                )} />
              </button>

              {/* Expanded panel */}
              {isExpanded && (
                <div className="bg-muted/30 border-t border-border">
                  {/* Postes section */}
                  <div className="px-4 py-4">
                    <div className="flex items-center gap-2 mb-3">
                      <Briefcase className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Postes assignés</span>
                    </div>

                    {memberJobs.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-3">
                        {memberJobs.map(a => (
                          <span
                            key={a.id}
                            className="inline-flex items-center gap-1 px-2.5 py-1 bg-foreground text-background text-[11px] font-medium"
                          >
                            {a.job_title || a.job_id}
                            <button
                              onClick={() => unassign(a.id)}
                              className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
                            >
                              <X className="w-3 h-3" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2">
                      <Select value={selectedJobId} onValueChange={setSelectedJobId}>
                        <SelectTrigger className="h-8 text-xs flex-1 rounded-none border-foreground">
                          <SelectValue placeholder="Sélectionner un poste…" />
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
                      <button
                        onClick={() => handleAssignJob(member)}
                        disabled={!selectedJobId || isAssigning}
                        className={cn(
                          "h-8 px-3 flex items-center gap-1 text-xs font-medium uppercase tracking-wide border border-foreground transition-colors",
                          selectedJobId
                            ? "bg-brutal-accent text-foreground hover:opacity-90"
                            : "bg-muted text-muted-foreground cursor-not-allowed"
                        )}
                      >
                        {isAssigning ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />}
                        Assigner
                      </button>
                    </div>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-border" />

                  {/* Quotas section */}
                  <div className="px-4 py-4">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <Sliders className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Quotas journaliers</span>
                      </div>
                      {!isEditingQ && (
                        <button
                          onClick={() => startEditingQuotas(member.user_id)}
                          className="text-[10px] uppercase tracking-wide text-muted-foreground hover:text-foreground border-b border-dotted border-muted-foreground hover:border-foreground transition-colors"
                        >
                          Modifier
                        </button>
                      )}
                    </div>

                    <div className="space-y-3">
                      {QUOTA_FIELDS.map(({ key, label, icon: Icon, max }) => {
                        const value = isEditingQ
                          ? (editingQuotas[member.user_id]?.[key] ?? 0)
                          : (memberQuota?.[key] ?? DEFAULT_QUOTAS[key]);
                        const pct = Math.min(100, (value / max) * 100);

                        return (
                          <div key={key}>
                            <div className="flex items-center justify-between mb-1">
                              <div className="flex items-center gap-1.5">
                                <Icon className="w-3 h-3 text-muted-foreground" />
                                <span className="text-[11px] text-muted-foreground">{label}</span>
                              </div>
                              {isEditingQ ? (
                                <Input
                                  type="number"
                                  min={0}
                                  max={max}
                                  className="h-6 w-16 text-[11px] text-right rounded-none border-foreground px-1.5"
                                  value={value}
                                  onChange={e => setEditingQuotas(prev => ({
                                    ...prev,
                                    [member.user_id]: {
                                      ...prev[member.user_id],
                                      [key]: parseInt(e.target.value) || 0,
                                    },
                                  }))}
                                />
                              ) : (
                                <span className="text-[11px] font-bold tabular-nums">{value}</span>
                              )}
                            </div>
                            {/* Progress bar */}
                            <div className="h-1 bg-border w-full">
                              <div
                                className={cn(
                                  "h-full transition-all duration-300",
                                  pct >= 80 ? "bg-brutal-accent" : "bg-foreground/40"
                                )}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>

                    {isEditingQ && (
                      <div className="flex gap-2 mt-4 pt-3 border-t border-border">
                        <button
                          onClick={() => handleSaveQuotas(member.user_id)}
                          disabled={isSaving}
                          className="h-8 px-4 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide bg-foreground text-background hover:opacity-90 transition-opacity"
                        >
                          {isSaving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                          Sauvegarder
                        </button>
                        <button
                          onClick={() => setEditingQuotas(prev => {
                            const next = { ...prev };
                            delete next[member.user_id];
                            return next;
                          })}
                          className="h-8 px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground border border-border hover:border-foreground transition-colors"
                        >
                          Annuler
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
