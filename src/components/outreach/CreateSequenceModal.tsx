import React from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { 
  Sparkles, 
  Zap, 
  Users, 
  MessageSquare,
  GitBranch,
  UserPlus,
  Mail,
  Linkedin,
  X,
} from 'lucide-react';

interface CreateSequenceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateManual: () => void;
}

export const CreateSequenceModal: React.FC<CreateSequenceModalProps> = ({
  isOpen,
  onClose,
  onCreateManual,
}) => {
  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl p-0 gap-0 bg-white overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Créer une séquence</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6">
          <div className="grid grid-cols-2 gap-6">
            {/* AI Option */}
            <div className="relative rounded-2xl border-2 border-gray-200 p-6 hover:border-blue-300 hover:shadow-md transition-all cursor-pointer group opacity-50">
              {/* Illustration */}
              <div className="h-32 mb-6 relative bg-gradient-to-br from-blue-50 to-purple-50 rounded-xl flex items-center justify-center overflow-hidden">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="relative">
                    <div className="absolute -top-6 -left-8 w-8 h-8 rounded-lg bg-white shadow-md flex items-center justify-center text-green-500 rotate-[-15deg]">
                      <MessageSquare className="w-4 h-4" />
                    </div>
                    <div className="absolute -top-4 right-[-30px] w-8 h-8 rounded-lg bg-white shadow-md flex items-center justify-center text-blue-500 rotate-[15deg]">
                      <Mail className="w-4 h-4" />
                    </div>
                    <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-600 to-purple-600 shadow-lg flex items-center justify-center">
                      <Sparkles className="w-7 h-7 text-white" />
                    </div>
                    <div className="absolute -bottom-4 left-[-30px] w-8 h-8 rounded-lg bg-white shadow-md flex items-center justify-center text-[#0077B5] rotate-[-10deg]">
                      <Linkedin className="w-4 h-4" />
                    </div>
                    <div className="absolute -bottom-6 right-[-20px] w-8 h-8 rounded-lg bg-white shadow-md flex items-center justify-center text-emerald-500 rotate-[10deg]">
                      <UserPlus className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Title */}
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-lg font-semibold text-gray-900">Créer avec IA</h3>
                <span className="px-2 py-0.5 text-xs font-medium bg-blue-100 text-blue-700 rounded-full">Bientôt</span>
              </div>

              {/* Features */}
              <ul className="space-y-3 mb-6">
                <li className="flex items-center gap-3 text-sm text-gray-600">
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                    <Zap className="w-3.5 h-3.5 text-blue-600" />
                  </div>
                  Prêt à être lancé en quelques minutes
                </li>
                <li className="flex items-center gap-3 text-sm text-gray-600">
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                    <Users className="w-3.5 h-3.5 text-blue-600" />
                  </div>
                  Générateur intelligent de prospects
                </li>
                <li className="flex items-center gap-3 text-sm text-gray-600">
                  <div className="w-6 h-6 rounded-full bg-blue-100 flex items-center justify-center">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-600" />
                  </div>
                  Un prospect, une approche personnalisée
                </li>
              </ul>

              {/* Button */}
              <Button 
                variant="outline" 
                className="w-full border-gray-200"
                disabled
              >
                Créer une séquence IA
              </Button>
            </div>

            {/* Manual Option */}
            <div 
              className="relative rounded-2xl border-2 border-gray-200 p-6 hover:border-blue-500 hover:shadow-md transition-all cursor-pointer group"
              onClick={onCreateManual}
            >
              {/* Illustration */}
              <div className="h-32 mb-6 relative bg-gradient-to-br from-gray-50 to-gray-100 rounded-xl flex items-center justify-center overflow-hidden">
                <div className="flex flex-col items-center gap-2">
                  <div className="flex items-center gap-1">
                    <div className="w-32 h-3 rounded-full bg-gray-200" />
                    <div className="w-6 h-6 rounded bg-white shadow-sm flex items-center justify-center">
                      <Linkedin className="w-3.5 h-3.5 text-[#0077B5]" />
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-28 h-3 rounded-full bg-gray-200" />
                    <div className="w-6 h-6 rounded bg-white shadow-sm" />
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-24 h-3 rounded-full bg-gray-200" />
                    <div className="w-6 h-6 rounded bg-white shadow-sm flex items-center justify-center">
                      <GitBranch className="w-3.5 h-3.5 text-gray-400" />
                    </div>
                  </div>
                </div>
              </div>

              {/* Title */}
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Créer manuellement</h3>

              {/* Features */}
              <ul className="space-y-3 mb-6">
                <li className="flex items-center gap-3 text-sm text-gray-600">
                  <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                    <UserPlus className="w-3.5 h-3.5 text-gray-600" />
                  </div>
                  Ajoutez manuellement des étapes
                </li>
                <li className="flex items-center gap-3 text-sm text-gray-600">
                  <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                    <Mail className="w-3.5 h-3.5 text-gray-600" />
                  </div>
                  Rédigez des messages avec {'{'}variables{'}'}
                </li>
                <li className="flex items-center gap-3 text-sm text-gray-600">
                  <div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center">
                    <GitBranch className="w-3.5 h-3.5 text-gray-600" />
                  </div>
                  Créez des séquences basées sur des conditions
                </li>
              </ul>

              {/* Button */}
              <Button 
                variant="outline" 
                className="w-full border-gray-200 group-hover:border-blue-500 group-hover:text-blue-600"
              >
                Créer une séquence manuelle
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
