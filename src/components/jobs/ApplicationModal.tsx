import React, { useState } from 'react';
import { X, Loader2, Send, CheckCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Job } from '@/pages/JobSpace';
import { toast } from '@/hooks/use-toast';

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
      const { data, error } = await supabase.functions.invoke('submit-application', {
        body: {
          jobId: job.id,
          jobTitle: job.title || 'Sans titre',
          clientName: job.client?.name || 'Client inconnu',
          ...formData
        }
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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-white w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto border border-black">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-black p-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-medium text-[#1A1A1A]">Postuler</h2>
            <p className="text-sm text-[#1A1A1A]/60 mt-0.5">
              {job.title || 'Sans titre'} {job.client?.name && `• ${job.client.name}`}
            </p>
          </div>
          <button 
            onClick={onClose}
            className="p-2 hover:bg-[#F5F5F5] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        {isSuccess ? (
          <div className="p-8 text-center">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h3 className="text-xl font-medium text-[#1A1A1A]">Candidature envoyée !</h3>
            <p className="text-[#1A1A1A]/60 mt-2">
              Nous avons bien reçu votre candidature et reviendrons vers vous rapidement.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-6 space-y-4">
            {/* Name */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-1.5">
                Nom complet *
              </label>
              <input
                type="text"
                name="name"
                required
                value={formData.name}
                onChange={handleChange}
                placeholder="Jean Dupont"
                className="w-full px-4 py-2.5 border border-[#1A1A1A]/20 focus:border-[#1A1A1A] focus:outline-none transition-colors"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-1.5">
                Email *
              </label>
              <input
                type="email"
                name="email"
                required
                value={formData.email}
                onChange={handleChange}
                placeholder="jean.dupont@email.com"
                className="w-full px-4 py-2.5 border border-[#1A1A1A]/20 focus:border-[#1A1A1A] focus:outline-none transition-colors"
              />
            </div>

            {/* Phone */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-1.5">
                Téléphone
              </label>
              <input
                type="tel"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                placeholder="+33 6 12 34 56 78"
                className="w-full px-4 py-2.5 border border-[#1A1A1A]/20 focus:border-[#1A1A1A] focus:outline-none transition-colors"
              />
            </div>

            {/* LinkedIn */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-1.5">
                Profil LinkedIn
              </label>
              <input
                type="url"
                name="linkedin"
                value={formData.linkedin}
                onChange={handleChange}
                placeholder="https://linkedin.com/in/jeandupont"
                className="w-full px-4 py-2.5 border border-[#1A1A1A]/20 focus:border-[#1A1A1A] focus:outline-none transition-colors"
              />
            </div>

            {/* CV URL */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-1.5">
                Lien vers votre CV
              </label>
              <input
                type="url"
                name="cvUrl"
                value={formData.cvUrl}
                onChange={handleChange}
                placeholder="https://drive.google.com/..."
                className="w-full px-4 py-2.5 border border-[#1A1A1A]/20 focus:border-[#1A1A1A] focus:outline-none transition-colors"
              />
              <p className="text-[10px] text-[#1A1A1A]/40 mt-1">
                Google Drive, Dropbox, ou autre lien public
              </p>
            </div>

            {/* Message */}
            <div>
              <label className="block text-[11px] font-medium uppercase tracking-wide text-[#1A1A1A]/60 mb-1.5">
                Message de motivation
              </label>
              <textarea
                name="message"
                value={formData.message}
                onChange={handleChange}
                rows={4}
                placeholder="Présentez-vous brièvement et expliquez votre motivation pour ce poste..."
                className="w-full px-4 py-2.5 border border-[#1A1A1A]/20 focus:border-[#1A1A1A] focus:outline-none transition-colors resize-none"
              />
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 bg-[#1A1A1A] text-white text-sm font-medium uppercase tracking-wide hover:bg-[#1A1A1A]/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
      </div>
    </div>
  );
};
