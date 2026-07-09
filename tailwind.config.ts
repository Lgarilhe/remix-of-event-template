import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
  	container: {
  		center: true,
  		padding: '2rem',
  		screens: {
  			'2xl': '1400px'
  		}
  	},
  	extend: {
  		fontFamily: {
			brand: [
				'Bricolage Grotesque',
				'Outfit',
				'system-ui',
				'sans-serif'
			],
			sans: [
				'Instrument Sans',
				'ui-sans-serif',
				'system-ui',
				'-apple-system',
				'BlinkMacSystemFont',
				'Segoe UI',
				'Roboto',
				'Helvetica Neue',
				'Arial',
				'Noto Sans',
				'sans-serif'
			],
			display: [
				'Outfit',
				'ui-sans-serif',
				'system-ui',
				'sans-serif'
			],
			serif: [
				'Instrument Serif',
				'Georgia',
				'Cambria',
				'Times New Roman',
				'Times',
				'serif'
			],
  			mono: [
  				'Space Mono',
  				'ui-monospace',
  				'SFMono-Regular',
  				'Menlo',
  				'Monaco',
  				'Consolas',
  				'Liberation Mono',
  				'Courier New',
  				'monospace'
  			]
  		},
  		colors: {
  			border: 'hsl(var(--border))',
  			input: 'hsl(var(--input))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: 'hsl(var(--foreground))',
  			primary: {
  				DEFAULT: 'hsl(var(--primary))',
  				foreground: 'hsl(var(--primary-foreground))'
  			},
  			secondary: {
  				DEFAULT: 'hsl(var(--secondary))',
  				foreground: 'hsl(var(--secondary-foreground))'
  			},
  			destructive: {
  				DEFAULT: 'hsl(var(--destructive))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			muted: {
  				DEFAULT: 'hsl(var(--muted))',
  				foreground: 'hsl(var(--muted-foreground))'
  			},
  			accent: {
  				DEFAULT: 'hsl(var(--accent))',
  				foreground: 'hsl(var(--accent-foreground))'
  			},
  			popover: {
  				DEFAULT: 'hsl(var(--popover))',
  				foreground: 'hsl(var(--popover-foreground))'
  			},
  			card: {
  				DEFAULT: 'hsl(var(--card))',
  				foreground: 'hsl(var(--card-foreground))'
  			},
  			sidebar: {
  				DEFAULT: 'hsl(var(--sidebar-background))',
  				foreground: 'hsl(var(--sidebar-foreground))',
  				primary: 'hsl(var(--sidebar-primary))',
  				'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
  				accent: 'hsl(var(--sidebar-accent))',
  				'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
  				border: 'hsl(var(--sidebar-border))',
  				ring: 'hsl(var(--sidebar-ring))'
  			},
  			success: {
  				DEFAULT: 'hsl(var(--status-success))',
  				foreground: 'hsl(var(--status-success-foreground))',
  				muted: 'hsl(var(--status-success-muted))',
  			},
  			warning: {
  				DEFAULT: 'hsl(var(--status-warning))',
  				foreground: 'hsl(var(--status-warning-foreground))',
  				muted: 'hsl(var(--status-warning-muted))',
  			},
  			info: {
  				DEFAULT: 'hsl(var(--status-info))',
  				foreground: 'hsl(var(--status-info-foreground))',
  				muted: 'hsl(var(--status-info-muted))',
  			},
  			brand: {
  				purple: 'hsl(var(--skalr-purple))',
  				pink: 'hsl(var(--skalr-pink))',
  				blue: 'hsl(var(--skalr-blue))',
  				cyan: 'hsl(var(--skalr-cyan))',
  				green: 'hsl(var(--skalr-green))',
  			},
  			linkedin: {
  				DEFAULT: 'hsl(var(--brand-linkedin))',
  				hover: 'hsl(var(--brand-linkedin-hover))',
  			},
  			whatsapp: {
  				DEFAULT: 'hsl(var(--brand-whatsapp))',
  			}
  		},
  		borderRadius: {
  			'2xl': 'calc(var(--radius) + 12px)',
  			xl: 'calc(var(--radius) + 4px)',
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		fontSize: {
  			// Étend l'échelle Tailwind pour avoir des paliers entre 10 et 12px,
  			// nécessaires pour les eyebrow labels, badges, kbd shortcuts.
  			// Bannit l'usage de text-[Npx] arbitraires (8px / 9.5px / 10.5px / 11.5px).
  			'3xs': ['0.625rem', { lineHeight: '0.875rem' }], // 10px / 14px
  			'2xs': ['0.6875rem', { lineHeight: '0.9375rem' }], // 11px / 15px
  		},
  		keyframes: {
  			'accordion-down': {
  				from: {
  					height: '0'
  				},
  				to: {
  					height: 'var(--radix-accordion-content-height)'
  				}
  			},
  			'accordion-up': {
  				from: {
  					height: 'var(--radix-accordion-content-height)'
  				},
  				to: {
  					height: '0'
  				}
  			},
  			'zoom-in': {
  				'0%': {
  					transform: 'scale(1.05)'
  				},
  				'100%': {
  					transform: 'scale(1)'
  				}
  			},
  			'fade-zoom-in': {
  				'0%': {
  					opacity: '0',
  					transform: 'scale(1.1)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'scale(1)'
  				}
  			},
  			'fade-in': {
  				'0%': {
  					opacity: '0',
  					transform: 'translateY(10px)'
  				},
  				'100%': {
  					opacity: '1',
  					transform: 'translateY(0)'
  				}
  			},
  			'slide-in-right': {
  				'0%': {
  					transform: 'translateX(30px)',
  					opacity: '0'
  				},
  				'100%': {
  					transform: 'translateX(0)',
  					opacity: '1'
  				}
  			},
  			'slide-in-left': {
  				'0%': {
  					transform: 'translateX(-30px)',
  					opacity: '0'
  				},
  				'100%': {
  					transform: 'translateX(0)',
  					opacity: '1'
  				}
  			},
  			'scroll-left': {
  				'0%': {
  					transform: 'translate3d(0, 0, 0)'
  				},
  				'100%': {
  					transform: 'translate3d(-50%, 0, 0)'
  				}
  			},
  			scan: {
  				'0%': {
  					top: '0%',
  					opacity: '0.3'
  				},
  				'50%': {
  					top: '100%',
  					opacity: '1'
  				},
  				'100%': {
  					top: '0%',
  					opacity: '0.3'
  				}
  			},
  			shimmer: {
  				'0%': {
  					transform: 'translateX(-100%)'
  				},
  				'100%': {
  					transform: 'translateX(100%)'
  				}
  			},
  		},
  		animation: {
  			'accordion-down': 'accordion-down 0.2s ease-out',
  			'accordion-up': 'accordion-up 0.2s ease-out',
  			'fade-zoom-in': 'fade-zoom-in 1s ease-out',
  			'fade-in': 'fade-in 0.6s ease-out forwards',
  			'slide-in-right': 'slide-in-right 0.25s ease-out',
  			'slide-in-left': 'slide-in-left 0.25s ease-out',
  			'scroll-left': 'scroll-left 40s linear infinite',
  			'scroll-left-fast': 'scroll-left 110s linear infinite',
  		},
  		boxShadow: {
  			'2xs': 'var(--shadow-2xs)',
  			xs: 'var(--shadow-xs)',
  			sm: 'var(--shadow-sm)',
  			md: 'var(--shadow-md)',
  			lg: 'var(--shadow-lg)',
  			xl: 'var(--shadow-xl)',
  			'2xl': 'var(--shadow-2xl)'
  		}
  	}
  },
  plugins: [require("tailwindcss-animate"), require("@tailwindcss/typography")],
} satisfies Config;
