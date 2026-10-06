// Client de la mission affiché dans l'en-tête (texte à côté du nom, logo du nom
// et du menu). Lu comme l'accueil et la liste des missions : celui du brief
// d'abord (job_details.client.name, le champ « Client » du Cadrage), sinon
// client_name. Sans cela, une mission dont le client n'est saisi que dans le
// brief montrerait les initiales de son titre ici et le client dans la liste.
import type { SourcingProject } from '@/hooks/useSourcingProjects';

export function missionClientName(project: Pick<SourcingProject, 'client_name' | 'job_details'>): string | null {
  return project.job_details?.client?.name?.trim() || project.client_name?.trim() || null;
}
