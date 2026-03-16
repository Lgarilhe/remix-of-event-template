import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { Menu, X, Bell } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { User } from '@supabase/supabase-js';
import { AuthSheet } from './AuthSheet';
import { NotificationDropdown } from './NotificationDropdown';


type FaceState = 'idle' | 'wink' | 'surprise' | 'happy' | 'look-left' | 'look-right';

const EXPRESSIONS: { state: FaceState; duration: number }[] = [
  { state: 'wink', duration: 400 },
  { state: 'look-left', duration: 600 },
  { state: 'look-right', duration: 600 },
  { state: 'surprise', duration: 500 },
  { state: 'happy', duration: 700 },
  { state: 'wink', duration: 400 },
];

const NavLogo: React.FC = () => {
  const [face, setFace] = useState<FaceState>('idle');
  const indexRef = useRef(0);

  useEffect(() => {
    const interval = setInterval(() => {
      const expr = EXPRESSIONS[indexRef.current % EXPRESSIONS.length];
      setFace(expr.state);
      setTimeout(() => setFace('idle'), expr.duration);
      indexRef.current++;
    }, 3500);
    return () => clearInterval(interval);
  }, []);

  // Eye positions based on look direction
  const eyeOffsetX = face === 'look-left' ? -0.6 : face === 'look-right' ? 0.6 : 0;
  const eyeOffsetY = face === 'surprise' ? -0.15 : 0;

  // Eye sizes
  const eyeRx = face === 'surprise' ? 0.75 : 0.65;
  const eyeRy = face === 'surprise' ? 0.9 : 0.75;

  // Left eye
  const leftEye = (
    <ellipse cx={4.45 + eyeOffsetX} cy={5.34 + eyeOffsetY} rx={eyeRx} ry={eyeRy} fill="currentColor">
      <animate attributeName="cx" dur="0.15s" fill="freeze" />
    </ellipse>
  );

  // Right eye (winks)
  const rightEye = face === 'wink'
    ? <line x1="8.9" y1="5.34" x2="10.2" y2="5.34" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    : (
      <ellipse cx={9.55 + eyeOffsetX} cy={5.34 + eyeOffsetY} rx={eyeRx} ry={eyeRy} fill="currentColor">
        <animate attributeName="cx" dur="0.15s" fill="freeze" />
      </ellipse>
    );

  // Mouth variations
  let mouth: React.ReactNode;
  if (face === 'surprise') {
    mouth = <ellipse cx="7.5" cy="10" rx="1" ry="1.1" fill="currentColor" />;
  } else if (face === 'happy') {
    mouth = <path d="M4.5 8.8 Q7.5 12 10.5 8.8" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" />;
  } else {
    mouth = <path d="M5.5 9.2 Q7.5 10.6 10 9" stroke="currentColor" strokeWidth="1" strokeLinecap="round" fill="none" />;
  }

  // Eyebrows for surprise
  const eyebrows = face === 'surprise' ? (
    <>
      <line x1="3.3" y1="3.4" x2="5.6" y2="3.6" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
      <line x1="8.4" y1="3.6" x2="10.7" y2="3.4" stroke="currentColor" strokeWidth="0.8" strokeLinecap="round" />
    </>
  ) : null;

  return (
    <div className="bg-foreground text-background h-[34px] w-[34px] border border-foreground flex items-center justify-center cursor-pointer"
      onClick={() => {
        const rand = EXPRESSIONS[Math.floor(Math.random() * EXPRESSIONS.length)];
        setFace(rand.state);
        setTimeout(() => setFace('idle'), rand.duration);
      }}
    >
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 14 14" className="w-4 h-4" style={{ transition: 'transform 0.2s', transform: face === 'surprise' ? 'scale(1.1)' : 'scale(1)' }}>
        <circle cx="7" cy="7" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.1" />
        {eyebrows}
        {leftEye}
        {rightEye}
        {mouth}
      </svg>
    </div>
  );
};

export const Navbar: React.FC = () => {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isCollapsed, setIsCollapsed] = useState(false);
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
      <NavLogo />

      {/* Desktop Navigation */}
      <div className="hidden md:flex items-center h-[34px] flex-1">
        {user ? (
          <>
            <Link
              to="/dashboard"
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">DASHBOARD</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <Link
              to="/outreach" 
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">OUTREACH</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <Link
              to="/prospection" 
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">PROSPECTION</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <Link 
              to="/ats" 
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">ATS</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            <Link 
              to="/settings" 
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">SETTINGS</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </Link>
            {/* Spacer */}
            <div className="flex-1" />
            {/* Right group: notifications + sign out */}
            <NotificationDropdown />
            <button 
              onClick={async () => {
                await supabase.auth.signOut();
              }}
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border-l-0 border border-foreground leading-none group"
            >
              <span className="relative z-10">SIGN OUT</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </button>
          </>
        ) : (
          <>
            <div className="flex-1" />
            <button 
              onClick={() => setIsAuthOpen(true)}
              className="relative overflow-hidden glass text-foreground h-[34px] px-3 flex items-center text-[11px] font-medium uppercase border border-l-0 border-foreground leading-none group"
            >
              <span className="relative z-10">SIGN IN</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
            </button>
          </>
        )}
      </div>

      {/* Mobile Navigation - Full Screen */}
      {isMobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-[3000] flex flex-col animate-in slide-in-from-top duration-300 glass-strong">
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
          <div className="flex-1 flex flex-col">
            {user ? (
              <>
                <Link
                  to="/dashboard"
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.15s', animationFillMode: 'both' }}
                >
                  DASHBOARD
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
                  to="/prospection" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center bg-background text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.32s', animationFillMode: 'both' }}
                >
                  PROSPECTION
                </Link>
                <Link 
                  to="/ats" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center bg-background text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.35s', animationFillMode: 'both' }}
                >
                  ATS
                </Link>
                <Link 
                  to="/settings" 
                  onClick={() => setIsMobileMenuOpen(false)}
                  className="flex-1 flex items-center justify-center bg-background text-foreground text-[17px] font-medium uppercase border-b border-foreground tracking-[-0.34px] animate-fade-in"
                  style={{ animationDelay: '0.4s', animationFillMode: 'both' }}
                >
                  SETTINGS
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
      
      {/* Mobile: Notification + Menu */}
      <div className="md:hidden flex items-center">
        {user && <NotificationDropdown />}
        <button 
          onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
          className="relative overflow-hidden glass text-foreground h-[34px] px-3 border border-l-0 border-foreground flex items-center justify-center text-[11px] font-medium uppercase leading-none group"
        >
          <span className="relative z-10">MENU</span>
          <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
        </button>
      </div>
      </div>
    </nav>
    
    <AuthSheet isOpen={isAuthOpen} onClose={() => { setIsAuthOpen(false); setPendingRoute(null); }} />
    </>,
    document.body
  );
};
