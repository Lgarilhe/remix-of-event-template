import React from 'react';
import { Job } from '@/pages/JobSpace';
import { JobCard } from './JobCard';

interface JobListProps {
  jobs: Job[];
}

export const JobList: React.FC<JobListProps> = ({ jobs }) => {
  if (jobs.length === 0) {
    return (
      <div className="bg-white border border-black p-12 text-center">
        <p className="text-[#1A1A1A]/60 text-lg">
          Aucun poste ne correspond à vos critères
        </p>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      {jobs.map(job => (
        <JobCard key={job.id} job={job} />
      ))}
    </div>
  );
};
