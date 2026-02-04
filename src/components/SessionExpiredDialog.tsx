import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { LogIn } from 'lucide-react';

interface SessionExpiredDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const SessionExpiredDialog: React.FC<SessionExpiredDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogin = () => {
    onOpenChange(false);
    navigate('/auth', { 
      state: { from: location.pathname, sessionExpired: true } 
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="mx-auto w-12 h-12 rounded-full bg-amber-100 flex items-center justify-center mb-2">
            <LogIn className="w-6 h-6 text-amber-600" />
          </div>
          <AlertDialogTitle className="text-center">
            Session expirée
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Votre session a expiré pour des raisons de sécurité. 
            Veuillez vous reconnecter pour continuer à utiliser l'application.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogAction 
            onClick={handleLogin}
            className="bg-blue-600 hover:bg-blue-700 text-white px-8"
          >
            Se reconnecter
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
