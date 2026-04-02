import React, { useState } from 'react';
import { Loader2, Send, CheckCircle } from 'lucide-react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { Job } from '@/types/jobs';
import { toast } from '@/hooks/use-toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';

interface ApplicationModalProps {
  job: Job;
  isOpen: boolean;
  onClose: () => void;
}

export const ApplicationModal: React.FC<ApplicationModalProps> = ({ job, isOpen, onClose }) => {
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    phone: '',
    linkedin: '',
    message: '',
    cvUrl: '',
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      const { data, error } = await invokeEdgeFunction<{ success?: boolean }>('submit-application', {
        jobId: job.id,
        jobTitle: job.title || 'Sans titre',
        clientName: job.client?.name || 'Client inconnu',
        ...formData
      });

      if (error) throw error;

      if (data.success) {
        setIsSuccess(true);
        toast({
          title: "Candidature envoyée !",
          description: "Votre candidature a été transmise avec succès.",
        });
        setTimeout(() => {
          onClose();
          setIsSuccess(false);
          setFormData({
            name: '',
            email: '',
            phone: '',
            linkedin: '',
            message: '',
            cvUrl: '',
          });
        }, 2000);
      } else {
        throw new Error(data.error || 'Erreur lors de l\'envoi');
      }
    } catch (err: any) {
      console.error('Error submitting application:', err);
      toast({
        title: "Erreur",
        description: err.message || "Une erreur est survenue lors de l'envoi de votre candidature.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg p-0 gap-0">
        {/* Header */}
        <DialogHeader className="sticky top-0 bg-background border-b p-4">
          <DialogTitle className="text-lg font-medium">Postuler</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground mt-0.5">
            {job.title || 'Sans titre'} {job.client?.name && `• ${job.client.name}`}
          </DialogDescription>
        </DialogHeader>

        {/* Content */}
        {isSuccess ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-16 h-16 text-success mx-auto mb-4" />
            <h3 className="text-xl font-medium">Candidature envoyée !</h3>
            <p className="text-muted-foreground mt-2">
              Nous avons bien reçu votre candidature et reviendrons vers vous rapidement.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            <div>
              <label htmlFor="app-name" className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Nom complet *
              </label>
              <input
                id="app-name"
                type="text"
                name="name"
                required
                value={formData.name}
                onChange={handleChange}
                placeholder="Jean Dupont"
                className="w-full px-4 py-2.5 border border-input bg-background focus:border-foreground focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="app-email" className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Email *
              </label>
              <input
                id="app-email"
                type="email"
                name="email"
                required
                value={formData.email}
                onChange={handleChange}
                placeholder="jean.dupont@email.com"
                className="w-full px-4 py-2.5 border border-input bg-background focus:border-foreground focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="app-phone" className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Téléphone
              </label>
              <input
                id="app-phone"
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+33 6 12 34 56 78"
                className="w-full px-4 py-2.5 border border-input bg-background focus:border-foreground focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="app-linkedin" className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Profil LinkedIn
              </label>
              <input
                id="app-linkedin"
                type="url"
                name="linkedin"
                value={formData.linkedin}
                onChange={handleChange}
                placeholder="https://linkedin.com/in/jeandupont"
                className="w-full px-4 py-2.5 border border-input bg-background focus:border-foreground focus:outline-none transition-colors"
              />
            </div>

            <div>
              <label htmlFor="app-cv" className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Lien vers votre CV
              </label>
              <input
                id="app-cv"
                type="url"
                name="cvUrl"
                value={formData.cvUrl}
                onChange={handleChange}
                placeholder="https://drive.google.com/..."
                className="w-full px-4 py-2.5 border border-input bg-background focus:border-foreground focus:outline-none transition-colors"
              />
              <p className="text-xs text-muted-foreground/60 mt-1">
                Google Drive, Dropbox, ou autre lien public
              </p>
            </div>

            <div>
              <label htmlFor="app-message" className="block text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1.5">
                Message de motivation
              </label>
              <textarea
                id="app-message"
                name="message"
                value={formData.message}
                onChange={handleChange}
                rows={4}
                placeholder="Présentez-vous brièvement et expliquez votre motivation pour ce poste..."
                className="w-full px-4 py-2.5 border border-input bg-background focus:border-foreground focus:outline-none transition-colors resize-none"
              />
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-primary text-primary-foreground text-sm font-medium uppercase tracking-wide hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Envoi en cours...
                </>
              ) : (
                <>
                  <Send className="w-4 h-4" />
                  Envoyer ma candidature
                </>
              )}
            </button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
};
