import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export function useFavoriteJobs(userId: string | undefined) {
  const [favorites, setFavorites] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  // Fetch user's favorites
  useEffect(() => {
    if (!userId) {
      setFavorites(new Set());
      return;
    }

    const fetchFavorites = async () => {
      setLoading(true);
      try {
        const { data, error } = await supabase
          .from('job_favorites')
          .select('job_id')
          .eq('user_id', userId);

        if (error) throw error;
        
        setFavorites(new Set(data?.map(f => f.job_id) || []));
      } catch (err) {
        console.error('Error fetching favorites:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchFavorites();
  }, [userId]);

  const toggleFavorite = useCallback(async (jobId: string) => {
    if (!userId) {
      toast({
        title: "Connexion requise",
        description: "Connectez-vous pour sauvegarder des favoris",
        variant: "destructive",
      });
      return;
    }

    const isFavorite = favorites.has(jobId);

    // Optimistic update
    setFavorites(prev => {
      const newSet = new Set(prev);
      if (isFavorite) {
        newSet.delete(jobId);
      } else {
        newSet.add(jobId);
      }
      return newSet;
    });

    try {
      if (isFavorite) {
        // Remove from favorites
        const { error } = await supabase
          .from('job_favorites')
          .delete()
          .eq('user_id', userId)
          .eq('job_id', jobId);

        if (error) throw error;

        toast({
          title: "Retiré des favoris",
          description: "Ce poste a été retiré de vos favoris",
        });
      } else {
        // Add to favorites
        const { error } = await supabase
          .from('job_favorites')
          .insert({ user_id: userId, job_id: jobId });

        if (error) throw error;

        toast({
          title: "Ajouté aux favoris",
          description: "Ce poste a été ajouté à vos favoris",
        });
      }
    } catch (err) {
      console.error('Error toggling favorite:', err);
      
      // Revert optimistic update
      setFavorites(prev => {
        const newSet = new Set(prev);
        if (isFavorite) {
          newSet.add(jobId);
        } else {
          newSet.delete(jobId);
        }
        return newSet;
      });

      toast({
        title: "Erreur",
        description: "Impossible de modifier les favoris",
        variant: "destructive",
      });
    }
  }, [userId, favorites, toast]);

  const isFavorite = useCallback((jobId: string) => {
    return favorites.has(jobId);
  }, [favorites]);

  return {
    favorites,
    loading,
    toggleFavorite,
    isFavorite,
    favoritesCount: favorites.size,
  };
}
