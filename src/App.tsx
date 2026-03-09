import { useEffect, useState } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { SessionExpiredDialog } from "@/components/SessionExpiredDialog";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { OrganizationGuard } from "@/components/OrganizationGuard";
import { LinkedInAccountsProvider } from "@/contexts/LinkedInAccountsContext";
import { supabase } from "@/integrations/supabase/client";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import SkalrLanding from "./pages/SkalrLanding";
import Candidates from "./pages/Candidates";
import Outreach from "./pages/Outreach";
import ATS from "./pages/ATS";
import Dashboard from "./pages/Dashboard";
import Qualification from "./pages/Qualification";
import NotFound from "./pages/NotFound";
import CandidatePortal from "./pages/CandidatePortal";
import Onboarding from "./pages/Onboarding";
import Settings from "./pages/Settings";

const PUBLIC_ROUTES = ['/', '/auth', '/portal'];

const AppContent = () => {
  const [sessionExpired, setSessionExpired] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[App] Auth event:', event);
      
      if (event === 'SIGNED_OUT') {
        const isPublicRoute = PUBLIC_ROUTES.some(route => 
          location.pathname === route || location.pathname.startsWith(route + '/')
        );
        
        if (!isPublicRoute && location.pathname !== '/auth') {
          setSessionExpired(true);
        }
      } else if (event === 'SIGNED_IN') {
        setSessionExpired(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [location.pathname]);

  const handleSessionExpiredClose = (open: boolean) => {
    setSessionExpired(open);
    if (!open) {
      navigate('/auth', { state: { from: location.pathname } });
    }
  };

  return (
    <>
      <Toaster />
      <Sonner />
      <Routes>
        <Route path="/" element={<SkalrLanding />} />
        <Route path="/auth" element={<Auth />} />
        <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />
        <Route path="/admin" element={<ProtectedRoute><Admin /></ProtectedRoute>} />
        <Route path="/candidates" element={<ProtectedRoute><OrganizationGuard><Candidates /></OrganizationGuard></ProtectedRoute>} />
        <Route path="/outreach" element={<ProtectedRoute><OrganizationGuard><Outreach /></OrganizationGuard></ProtectedRoute>} />
        <Route path="/ats" element={<ProtectedRoute><OrganizationGuard><ATS /></OrganizationGuard></ProtectedRoute>} />
        <Route path="/dashboard" element={<ProtectedRoute><OrganizationGuard><Dashboard /></OrganizationGuard></ProtectedRoute>} />
        <Route path="/qualification/:id" element={<ProtectedRoute><OrganizationGuard><Qualification /></OrganizationGuard></ProtectedRoute>} />
        <Route path="/settings" element={<ProtectedRoute><OrganizationGuard><Settings /></OrganizationGuard></ProtectedRoute>} />
        <Route path="/portal/:token" element={<CandidatePortal />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <SessionExpiredDialog 
        open={sessionExpired} 
        onOpenChange={handleSessionExpiredClose} 
      />
    </>
  );
};

const App = () => {
  return (
    <TooltipProvider>
      <LinkedInAccountsProvider>
        <AppContent />
      </LinkedInAccountsProvider>
    </TooltipProvider>
  );
};

export default App;
