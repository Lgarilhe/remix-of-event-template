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
import { withPreviewAccessToken } from '@/lib/previewToken';

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
    navigate(withPreviewAccessToken('/auth'), { 
      state: { from: location.pathname, sessionExpired: true } 
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="mx-auto mb-2 grid h-10 w-10 place-items-center rounded-lg bg-muted text-foreground-secondary">
            <LogIn className="h-5 w-5" aria-hidden="true" />
          </div>
          <AlertDialogTitle className="text-center">
            Session expirée
          </AlertDialogTitle>
          <AlertDialogDescription className="text-center">
            Votre session a expiré pour des raisons de sécurité.
            Reconnectez-vous : vous reviendrez sur cette page.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="sm:justify-center">
          <AlertDialogAction onClick={handleLogin} className="px-8">
            Se reconnecter
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
};
