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
  const [hasFetched, setHasFetched] = useState(false);

  const fetchSequences = async (force = false) => {
    if (hasFetched && !force) return; // Use cache unless forced
    setLoading(true);
    try {
      // Single query: fetch sequences with step count only (not all step data)
      const { data: seqData, error: seqError } = await supabase
        .from('outreach_sequences')
        .select('id, name, is_active, created_at')
        .eq('is_active', true)
        .order('created_at', { ascending: false })
        .limit(20);

      if (seqError) throw seqError;

      // For the dropdown, we just need id + name + step count — steps are loaded when user picks one
      const enriched: SequenceOption[] = (seqData || []).map(seq => ({
        ...seq,
        steps: [], // Steps loaded lazily when sequence is selected
      }));

      setSequences(enriched);
      setHasFetched(true);
    } catch (err) {
      console.error('Error fetching sequences:', err);
      toast.error('Erreur lors du chargement des séquences');
    } finally {
      setLoading(false);
    }
  };

  const handleSelectSequence = async (sequence: SequenceOption) => {
    // Lazy-load steps only when the user actually picks a sequence
    if (sequence.steps.length === 0) {
      try {
        const { data: stepsData } = await supabase
          .from('sequence_steps')
          .select('*')
          .eq('sequence_id', sequence.id)
          .order('step_order', { ascending: true });

        sequence = { ...sequence, steps: stepsData || [] };
      } catch (err) {
        console.error('Error fetching steps:', err);
      }
    }
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
            className="border-green-600 text-green-600 hover:bg-success/10 px-2 h-7 gap-1 text-xs uppercase tracking-wider font-bold rounded-lg shrink-0"
          >
            <GitBranch className="w-3 h-3 shrink-0" />
            Séq.
            <ChevronDown className="w-2.5 h-2.5 shrink-0" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="bg-card w-64 z-[9999]">
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
