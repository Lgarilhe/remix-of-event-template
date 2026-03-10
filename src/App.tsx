import React, { useEffect, useState, lazy, Suspense } from "react";
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

import NotFound from "./pages/NotFound";

// Lazy-loaded pages
const SkalrLanding = lazy(() => import("./pages/SkalrLanding"));
const Admin = lazy(() => import("./pages/Admin"));
const Candidates = lazy(() => import("./pages/Candidates"));
const Outreach = lazy(() => import("./pages/Outreach"));
const ATS = lazy(() => import("./pages/ATS"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Qualification = lazy(() => import("./pages/Qualification"));
const CandidatePortal = lazy(() => import("./pages/CandidatePortal"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const Settings = lazy(() => import("./pages/Settings"));
const Prospection = lazy(() => import("./pages/Prospection"));

const PUBLIC_ROUTES = ['/', '/auth', '/portal'];

const AppContent = () => {
  const [sessionExpired, setSessionExpired] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const locationRef = React.useRef(location.pathname);
  
  // Keep ref in sync without re-subscribing the listener
  useEffect(() => {
    locationRef.current = location.pathname;
  }, [location.pathname]);

  // Single stable auth listener — never re-subscribes
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      console.log('[App] Auth event:', event, '| has session:', !!session);
      
      if (event === 'SIGNED_OUT' || (event === 'TOKEN_REFRESHED' && !session)) {
        const currentPath = locationRef.current;
        const isPublicRoute = PUBLIC_ROUTES.some(route => 
          currentPath === route || currentPath.startsWith(route + '/')
        );
        
        if (!isPublicRoute && currentPath !== '/auth') {
          setSessionExpired(true);
        }
      } else if (event === 'SIGNED_IN' || (event === 'TOKEN_REFRESHED' && session)) {
        setSessionExpired(false);
      }
    });

    return () => subscription.unsubscribe();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      <Suspense fallback={<div className="min-h-screen bg-background flex items-center justify-center"><div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" /></div>}>
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
      </Suspense>
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
