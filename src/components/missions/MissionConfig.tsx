import React from 'react';
import { SourcingProject, useSourcingProjects } from '@/hooks/useSourcingProjects';
import { MissionHuntMode } from './MissionHuntMode';
import { MissionClientPortal } from './MissionClientPortal';
import { useOrganization } from '@/hooks/useOrganization';
import { Settings } from 'lucide-react';

interface MissionConfigProps {
  project: SourcingProject;
  readOnly?: boolean;
}

const EditField = ({ label, value, field, projectId }: {
  label: string; value: string | null; field: string; projectId: string;
}) => {
  const { updateProject } = useSourcingProjects();
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <input
        defaultValue={value || ''}
        onBlur={(e) => updateProject({ id: projectId, [field]: e.target.value || null } as any)}
        className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 focus:outline-none transition-colors"
      />
    </div>
  );
};

export const MissionConfig: React.FC<MissionConfigProps> = ({ project, readOnly = false }) => {
  const { updateProject } = useSourcingProjects();
  const { isAgency } = useOrganization();

  return (
    <div className="space-y-6">
      {readOnly && (
        <div className="px-4 py-2.5 rounded-md border border-border bg-muted/50">
          <span className="text-xs font-medium text-muted-foreground">
            👁️ Lecture seule
          </span>
        </div>
      )}

      {/* Mission info */}
      <div className="rounded-lg border border-border bg-card p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-5">
          <Settings className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-bold text-foreground">
            Infos mission
          </h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <EditField label="Nom de la mission" value={project.name} field="name" projectId={project.id} />
          {isAgency && <EditField label="Client" value={project.client_name} field="client_name" projectId={project.id} />}
          <EditField label="Lien Calendly" value={project.calendly_link} field="calendly_link" projectId={project.id} />
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">Statut</label>
            <select
              defaultValue={project.status}
              onChange={(e) => updateProject({ id: project.id, status: e.target.value as SourcingProject['status'] })}
              className="w-full h-9 px-3 text-sm rounded-md border border-border bg-background text-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 focus:outline-none transition-colors"
            >
              <option value="active">Actif</option>
              <option value="paused">En pause</option>
              <option value="completed">Terminé</option>
              <option value="archived">Archivé</option>
            </select>
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Notes internes</label>
          <textarea
            defaultValue={project.notes || ''}
            onBlur={(e) => updateProject({ id: project.id, notes: e.target.value })}
            placeholder="Notes internes sur cette mission..."
            className="w-full min-h-[80px] px-3 py-2 text-sm rounded-md border border-border bg-background text-foreground resize-y placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary/20 focus:outline-none transition-colors"
          />
        </div>
      </div>

      {/* Hunt mode */}
      {!readOnly && <MissionHuntMode project={project} />}

      {/* Client portal */}
      {!readOnly && <MissionClientPortal project={project} />}
    </div>
  );
};
