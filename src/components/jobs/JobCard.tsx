import React, { useState } from 'react';
import { Job } from '@/pages/JobSpace';
import { MapPin, Building2, Briefcase, Euro, ChevronDown, ChevronUp, ExternalLink, Send } from 'lucide-react';
import { ApplicationModal } from './ApplicationModal';

interface JobCardProps {
  job: Job;
}

export const JobCard: React.FC<JobCardProps> = ({ job }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isApplicationOpen, setIsApplicationOpen] = useState(false);

  // Handle contractType as string or array
  const displayContractType = Array.isArray(job.contractType) 
    ? job.contractType.join(', ') 
    : job.contractType;

  const formatSalary = (min: number, max: number) => {
    if (!min && !max) return null;
    if (min && max) return `${min}k€ - ${max}k€`;
    if (min) return `À partir de ${min}k€`;
    return `Jusqu'à ${max}k€`;
  };

  const getStatusColor = (status: string) => {
    switch (status?.toLowerCase()) {
      case 'ouvert':
      case 'open':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'en cours':
      case 'in progress':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'fermé':
      case 'closed':
        return 'bg-gray-100 text-gray-800 border-gray-200';
      case 'urgent':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  const getPriorityIndicator = (priority: string) => {
    switch (priority?.toLowerCase()) {
      case 'haute':
      case 'high':
        return <span className="w-2 h-2 rounded-full bg-red-500" />;
      case 'moyenne':
      case 'medium':
        return <span className="w-2 h-2 rounded-full bg-yellow-500" />;
      case 'basse':
      case 'low':
        return <span className="w-2 h-2 rounded-full bg-green-500" />;
      default:
        return null;
    }
  };

  const salary = formatSalary(job.salaryMin, job.salaryMax);

  return (
    <div className="bg-white border border-black hover:shadow-lg transition-shadow">
      {/* Main content */}
      <div 
        className="p-6 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-start justify-between gap-4">
          {/* Left side */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2">
              {getPriorityIndicator(job.priority)}
              <h3 className="text-xl font-medium text-[#1A1A1A] truncate">
                {job.title || 'Poste sans titre'}
              </h3>
            </div>

            <div className="flex flex-wrap items-center gap-4 text-sm text-[#1A1A1A]/60">
              {job.client?.name && (
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-4 h-4" />
                  {job.client.name}
                </span>
              )}
              {job.location && (
                <span className="flex items-center gap-1.5">
                  <MapPin className="w-4 h-4" />
                  {job.location}
                </span>
              )}
              {displayContractType && (
                <span className="flex items-center gap-1.5">
                  <Briefcase className="w-4 h-4" />
                  {displayContractType}
                </span>
              )}
              {salary && (
                <span className="flex items-center gap-1.5">
                  <Euro className="w-4 h-4" />
                  {salary}
                </span>
              )}
            </div>
          </div>

          {/* Right side */}
          <div className="flex items-center gap-3">
            {job.status && (
              <span className={`px-3 py-1 text-xs font-medium uppercase tracking-wide border ${getStatusColor(job.status)}`}>
                {job.status}
              </span>
            )}
            <button className="p-2 text-[#1A1A1A]/40 hover:text-[#1A1A1A] transition-colors">
              {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Tags */}
        <div className="flex flex-wrap gap-2 mt-4">
          {job.seniority && (
            <span className="px-2 py-1 bg-[#F5F5F5] text-[#1A1A1A] text-xs">
              {job.seniority}
            </span>
          )}
          {job.remote && (
            <span className="px-2 py-1 bg-[#FA76FF]/10 text-[#FA76FF] text-xs font-medium">
              {job.remote}
            </span>
          )}
          {job.skills?.slice(0, 3).map(skill => (
            <span key={skill} className="px-2 py-1 bg-[#1A1A1A]/5 text-[#1A1A1A]/70 text-xs">
              {skill}
            </span>
          ))}
          {job.skills?.length > 3 && (
            <span className="px-2 py-1 text-[#1A1A1A]/40 text-xs">
              +{job.skills.length - 3}
            </span>
          )}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-[#1A1A1A]/10 p-6 bg-[#FAFAFA]">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Description */}
            {job.description && (
              <div className="md:col-span-2">
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-3">
                  Description du poste
                </h4>
                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap leading-relaxed">
                  {job.description}
                </p>
              </div>
            )}

            {/* Requirements */}
            {job.requirements && (
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-3">
                  Pré-requis
                </h4>
                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">
                  {job.requirements}
                </p>
              </div>
            )}

            {/* Interview Process */}
            {job.interviewProcess && (
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-3">
                  Process d'entretien
                </h4>
                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">
                  {job.interviewProcess}
                </p>
              </div>
            )}

            {/* Advantages */}
            {job.advantages && (
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-3">
                  Avantages
                </h4>
                <p className="text-sm text-[#1A1A1A] whitespace-pre-wrap">
                  {job.advantages}
                </p>
              </div>
            )}

            {/* Team Info */}
            {job.teamInfo && (
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-3">
                  L'équipe
                </h4>
                <p className="text-sm text-[#1A1A1A]">
                  {job.teamInfo}
                </p>
              </div>
            )}

            {/* Company details */}
            {job.client && (
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-3">
                  Entreprise
                </h4>
                <div className="space-y-2">
                  <p className="font-medium text-[#1A1A1A]">{job.client.name}</p>
                  {job.client.sector && (
                    <p className="text-sm text-[#1A1A1A]/60">Secteur: {job.client.sector}</p>
                  )}
                  {job.client.size && (
                    <p className="text-sm text-[#1A1A1A]/60">Taille: {job.client.size}</p>
                  )}
                  <div className="flex gap-3 mt-3">
                    {job.client.website && (
                      <a 
                        href={job.client.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-[#FA76FF] hover:underline"
                      >
                        Site web <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {job.client.linkedin && (
                      <a 
                        href={job.client.linkedin}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-sm text-[#FA76FF] hover:underline"
                      >
                        LinkedIn <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* All skills */}
            {job.skills?.length > 0 && (
              <div>
                <h4 className="text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-3">
                  Compétences requises
                </h4>
                <div className="flex flex-wrap gap-2">
                  {job.skills.map(skill => (
                    <span key={skill} className="px-3 py-1.5 bg-white border border-[#1A1A1A]/10 text-[#1A1A1A] text-sm">
                      {skill}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Action button */}
          <div className="mt-6 pt-6 border-t border-[#1A1A1A]/10">
            <button 
              onClick={(e) => {
                e.stopPropagation();
                setIsApplicationOpen(true);
              }}
              className="px-6 py-3 bg-[#1A1A1A] text-white text-sm font-medium uppercase tracking-wide hover:bg-[#1A1A1A]/90 transition-colors flex items-center gap-2"
            >
              <Send className="w-4 h-4" />
              Postuler
            </button>
          </div>
        </div>
      )}

      {/* Application Modal */}
      <ApplicationModal 
        job={job}
        isOpen={isApplicationOpen}
        onClose={() => setIsApplicationOpen(false)}
      />
    </div>
  );
};
