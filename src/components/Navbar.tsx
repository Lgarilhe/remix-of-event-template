import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { AuthSheet } from './AuthSheet';
export const Navbar: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(true);
  const navigate = useNavigate();
  const [pendingRoute, setPendingRoute] = useState<string | null>(null);
  const lastScrollY = useRef(0);

  // Auto-hide on scroll down, show on scroll up
  useEffect(() => {
    const handleScroll = () => {
      const currentY = window.scrollY;
      if (currentY > 80 && currentY > lastScrollY.current) {
        setIsCollapsed(true);
      } else if (currentY < lastScrollY.current) {
        setIsCollapsed(false);
      }
      lastScrollY.current = currentY;
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (user && pendingRoute) {
      navigate(pendingRoute);
      setPendingRoute(null);
      setIsAuthOpen(false);
    }
  }, [user, pendingRoute, navigate]);

  return createPortal(
    <>
      {/* Hover zone to bring navbar back */}
      {isCollapsed && (
        <div
          className="fixed top-0 left-0 right-0 h-6 z-[1999]"
          onMouseEnter={() => setIsCollapsed(false)}
        />
      )}
      <nav
        className={`fixed left-0 right-0 z-[2000] transition-all duration-300 ease-in-out ${
          isCollapsed ? '-top-12 opacity-0 pointer-events-none' : 'top-4 opacity-100'
        }`}
      >
      <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8 flex items-center gap-0">
      {/* Logo */}
      <div className="bg-foreground text-background h-[34px] w-[34px] border border-foreground flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 14 14" className="w-4 h-4">
          <g id="smiley-smirk">
            <path id="Subtract" fill="currentColor" stroke="currentColor" strokeWidth="0.5" fillRule="evenodd" d="M1.83645 1.83645C3.06046 0.612432 4.82797 0 7 0s3.9395 0.612432 5.1636 1.83645C13.3876 3.06046 14 4.82797 14 7s-0.6124 3.9395 -1.8364 5.1636C10.9395 13.3876 9.17203 14 7 14s-3.93954 -0.6124 -5.16355 -1.8364C0.612432 10.9395 0 9.17203 0 7s0.612432 -3.93954 1.83645 -5.16355ZM5.0769 4.98816c0 -0.34518 -0.27982 -0.625 -0.625 -0.625 -0.34517 0 -0.625 0.27982 -0.625 0.625v0.7c0 0.34518 0.27983 0.625 0.625 0.625 0.34518 0 0.625 -0.27982 0.625 -0.625v-0.7Zm5.0962 0c0 -0.34518 -0.27983 -0.625 -0.625 -0.625 -0.34518 0 -0.625 0.27982 -0.625 0.625v0.7c0 0.34518 0.27982 0.625 0.625 0.625 0.34517 0 0.625 -0.27982 0.625 -0.625v-0.7Zm0.1787 2.42929c0.3217 0.12505 0.4812 0.48724 0.3561 0.80897 -0.2805 0.72182 -0.75537 1.29603 -1.40641 1.68306 -0.64416 0.38292 -1.4264 0.56282 -2.30149 0.56282 -0.34518 0 -0.625 -0.2798 -0.625 -0.62501 0 -0.34518 0.27982 -0.625 0.625 -0.625 0.7083 0 1.25628 -0.14564 1.66273 -0.38728 0.39956 -0.23753 0.69571 -0.58697 0.88012 -1.06143 0.12505 -0.32173 0.48725 -0.48117 0.80895 -0.35613Z" clipRule="evenodd"></path>
          </g>
        </svg>
      </div>

      {/* Desktop Navigation */}
      <div className="hidden md:flex items-center h-[34px]">
        {user ? (
          <>
            <Link
              to="/candidates" 
              className="relative overflow-hidden bg-background text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">CANDIDATS</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <Link 
              to="/outreach" 
              className="relative overflow-hidden bg-background text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">OUTREACH</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <Link 
              to="/ats" 
              className="relative overflow-hidden bg-background text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">ATS</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <button 
              onClick={async () => {
                await supabase.auth.signOut();
              }}
              className="relative overflow-hidden bg-background text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">SIGN OUT</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </button>
          </>
        ) : (
          <button 
            onClick={() => setIsAuthOpen(true)}
            className="relative overflow-hidden bg-background text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border border-l-0 border-foreground leading-none group"
          >
            <span className="relative z-10">SIGN IN</span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
          </button>
        )}
      </div>

      {/* Mobile Navigation - Full Screen */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[3000] flex flex-col animate-in slide-in-from-top duration-300">
          {/* Close header */}
          <div className="bg-foreground flex items-center justify-center py-16 animate-in fade-in duration-500">
            <button
              onClick={() => setIsMobileMenuOpen(false)}
              className="text-background text-[11px] font-medium uppercase tracking-wider"
            >
              CLOSE
            </button>
          </div>
          
          {/* Menu items */}
          <div className="flex-1 flex flex-col bg-background">
            {user ? (
              <>
                <Link
                  to="/candidates" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.2s', animationFillMode: 'both' }}
                >
                  CANDIDATS
                </Link>
                <Link 
                  to="/outreach" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center bg-background text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.3s', animationFillMode: 'both' }}
                >
                  OUTREACH
                </Link>
                <Link 
                  to="/ats" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center bg-background text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.35s', animationFillMode: 'both' }}
                >
                  ATS
                </Link>
                <button 
                  onClick={async () => {
                    await supabase.auth.signOut();
                    setIsMobileMenuOpen(false);
                  }}
                  className="flex-1 flex items-center justify-center text-foreground text-[17px] font-medium uppercase tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.4s', animationFillMode: 'both' }}
                >
                  SIGN OUT
                </button>
              </>
            ) : (
              <button 
                onClick={() => {
                  setIsAuthOpen(true);
                  setIsMobileMenuOpen(false);
                }}
                className="flex-1 flex items-center justify-center text-foreground text-[17px] font-medium uppercase tracking-[-0.34px] animate-fade-in"
                style={{ animationDelay: '0.1s', animationFillMode: 'both' }}
              >
                SIGN IN
              </button>
            )}
          </div>
        </div>
      )}
      
      {/* Menu Button - Mobile Only */}
      <button 
        onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
        className="md:hidden relative overflow-hidden bg-background text-foreground h-[34px] px-3 border border-l-0 border-foreground flex items-center justify-center text-[11px] font-medium uppercase leading-none group"
      >
        <span className="relative z-10">MENU</span>
        <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
      </button>
      </div>
    </nav>
    
    <AuthSheet isOpen={isAuthOpen} onClose={() => { setIsAuthOpen(false); setPendingRoute(null); }} />
    </>,
    document.body
  );
};
