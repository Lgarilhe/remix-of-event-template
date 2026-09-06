import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Settings } from 'lucide-react';

interface EmptyLinkedInAccountStateProps {
  message?: string;
}

/**
 * Shared empty state shown when no LinkedIn account is connected.
 * Used by MissionSourcing and MissionOutreach.
 */
export const EmptyLinkedInAccountState: React.FC<EmptyLinkedInAccountStateProps> = ({
  message = 'Pour continuer, connectez d\'abord un compte LinkedIn.',
}) => {
  const navigate = useNavigate();
  return (
    <div className="bg-background border border-border p-6 sm:p-8">
      <div className="flex flex-col py-12">
        <div className="w-12 h-12 border border-border flex items-center justify-center mb-4">
          <Users className="w-5 h-5 text-muted-foreground" />
        </div>
        <h2 className="text-sm font-bold uppercase tracking-wider mb-2">
          Connectez votre compte LinkedIn
        </h2>
        <p className="text-xs text-muted-foreground max-w-md mb-6">
          {message}
        </p>
        <button
          onClick={() => navigate('/settings?tab=account')}
          className="relative overflow-hidden h-9 px-6 bg-background text-foreground border border-border text-xs font-medium uppercase tracking-wider group"
        >
          <span className="relative z-10 flex items-center gap-2">
            <Settings className="w-3.5 h-3.5" />
            Aller dans les paramètres
          </span>
        </button>
      </div>
    </div>
  );
};
