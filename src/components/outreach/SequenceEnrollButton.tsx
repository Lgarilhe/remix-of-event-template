import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { 
  GitBranch, 
  ChevronDown, 
  Loader2,
  Plus,
  Users,
} from 'lucide-react';
import { toast } from 'sonner';
import { LinkedInProfile } from './types';
import { SequenceEnrollModal } from './SequenceEnrollModal';

interface SequenceOption {
  id: string;
  name: string;
  steps: any[];
  is_active: boolean;
}

interface SequenceEnrollButtonProps {
  selectedProfiles: LinkedInProfile[];
  accountId: string;
  selectedJob?: {
    id: string;
    title: string;
  } | null;
  onSuccess?: () => void;
  onCreateSequence?: () => void;
}

export const SequenceEnrollButton: React.FC<SequenceEnrollButtonProps> = ({
  selectedProfiles,
  accountId,
  selectedJob,
  onSuccess,
  onCreateSequence,
}) => {
  const [sequences, setSequences] = useState<SequenceOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSequence, setSelectedSequence] = useState<SequenceOption | null>(null);
  const [showEnrollModal, setShowEnrollModal] = useState(false);

  const fetchSequences = async () => {
    setLoading(true);
    try {
      const { data: seqData, error: seqError } = await supabase
        .from('outreach_sequences')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });

      if (seqError) throw seqError;

      // Fetch steps for each sequence
      const sequenceIds = seqData?.map(s => s.id) || [];
      const { data: stepsData } = await supabase
        .from('sequence_steps')
        .select('*')
        .in('sequence_id', sequenceIds)
        .order('step_order', { ascending: true });

      const enriched: SequenceOption[] = (seqData || []).map(seq => ({
        ...seq,
        steps: stepsData?.filter(s => s.sequence_id === seq.id) || [],
      }));

      setSequences(enriched);
    } catch (err) {
      console.error('Error fetching sequences:', err);
      toast.error('Erreur lors du chargement des séquences');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSequence = (sequence: SequenceOption) => {
    setSelectedSequence(sequence);
    setShowEnrollModal(true);
  };

  const handleEnrollSuccess = () => {
    setShowEnrollModal(false);
    setSelectedSequence(null);
    onSuccess?.();
  };

  if (selectedProfiles.length === 0) {
    return null;
  }

  return (
    <>
      <DropdownMenu onOpenChange={(open) => open && fetchSequences()}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="border-green-600 text-green-600 hover:bg-green-50"
          >
            <GitBranch className="w-3.5 h-3.5 mr-1.5" />
            Séquence ({selectedProfiles.length})
            <ChevronDown className="w-3.5 h-3.5 ml-1" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-white w-64">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            </div>
          ) : sequences.length === 0 ? (
            <div className="p-4 text-center">
              <p className="text-sm text-muted-foreground mb-3">
                Aucune séquence active
              </p>
              {onCreateSequence && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    onCreateSequence();
                  }}
                  className="w-full"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Créer une séquence
                </Button>
              )}
            </div>
          ) : (
            <>
              <div className="px-2 py-1.5 text-xs font-medium text-muted-foreground">
                Inscrire {selectedProfiles.length} candidat(s) dans:
              </div>
              <DropdownMenuSeparator />
              {sequences.map((seq) => (
                <DropdownMenuItem
                  key={seq.id}
                  onClick={() => handleSelectSequence(seq)}
                  className="cursor-pointer"
                >
                  <div className="flex items-center justify-between w-full">
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-green-600" />
                      <span className="font-medium">{seq.name}</span>
                    </div>
                    <Badge variant="secondary" className="text-xs">
                      {seq.steps.length} étapes
                    </Badge>
                  </div>
                </DropdownMenuItem>
              ))}
              {onCreateSequence && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={onCreateSequence}
                    className="cursor-pointer text-muted-foreground"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Nouvelle séquence
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Enroll Modal */}
      {selectedSequence && (
        <SequenceEnrollModal
          isOpen={showEnrollModal}
          onClose={() => {
            setShowEnrollModal(false);
            setSelectedSequence(null);
          }}
          sequence={selectedSequence}
          profiles={selectedProfiles}
          accountId={accountId}
          job={selectedJob}
          onSuccess={handleEnrollSuccess}
        />
      )}
    </>
  );
};
