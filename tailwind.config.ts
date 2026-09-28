import type { Config } from "tailwindcss";

export default {
  // Le thème sombre est celui de :root, le clair ajoute .light sur <html>
  // (main.tsx, AppSidebar, NavigationPalette). La variante dark: vaut donc hors
  // de .light ; avec ["class"], elle attendait une classe .dark jamais posée.
  darkMode: ["variant", "&:not(.light *)"],
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
  		// Une seule famille d'interface (docs/design/01-direction.md, § 3).
  		// display et serif sont des alias dépréciés : ils rendent la police
  		// d'interface pour que les écrans pas encore repris restent homogènes.
  		fontFamily: {
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
				'Instrument Sans',
				'ui-sans-serif',
				'system-ui',
				'sans-serif'
			],
			serif: [
				'Instrument Sans',
				'ui-sans-serif',
				'system-ui',
				'sans-serif'
			],
			// Police de marque : titres des pages publiques seulement.
			brand: [
				'Bricolage Grotesque',
				'Instrument Sans',
				'system-ui',
				'sans-serif'
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
  			// Filets : teinte et opacité séparées pour que border-border/40 reste valide en sombre.
  			border: {
  				DEFAULT: 'hsl(var(--border-hsl) / calc(var(--border-alpha) * <alpha-value>))',
  				strong: 'hsl(var(--border-strong-hsl) / calc(var(--border-strong-alpha) * <alpha-value>))'
  			},
  			input: 'hsl(var(--input-hsl) / calc(var(--input-alpha) * <alpha-value>))',
  			ring: 'hsl(var(--ring))',
  			background: 'hsl(var(--background))',
  			foreground: {
  				DEFAULT: 'hsl(var(--foreground))',
  				secondary: 'hsl(var(--foreground-secondary))'
  			},
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
  			// Erreur d'état (texte, icône, filet), distincte de l'aplat destructif.
  			danger: {
  				DEFAULT: 'hsl(var(--danger))',
  				muted: 'hsl(var(--danger-muted))'
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
  				border: 'hsl(var(--sidebar-border-hsl) / calc(var(--sidebar-border-alpha) * <alpha-value>))',
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
  			// brand : l'accent indigo unique, rationné (focus, sélection, signaux, progression).
  			// purple, pink, blue, cyan, green : ancienne palette Skalr, à ne plus employer.
  			brand: {
  				DEFAULT: 'hsl(var(--brand))',
  				foreground: 'hsl(var(--brand-foreground))',
  				hover: 'hsl(var(--brand-hover))',
  				press: 'hsl(var(--brand-press))',
  				solid: 'hsl(var(--brand-solid))',
  				'solid-foreground': 'hsl(var(--brand-solid-foreground))',
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
  		// Six paliers (docs/design/01-direction.md, § 3). sm vaut 13 px, le corps
  		// des maquettes ; md (14 px) sert aux titres de carte et au texte de lecture.
  		// Bannit l'usage de text-[Npx] arbitraires.
  		fontSize: {
  			'3xs': ['0.625rem', { lineHeight: '0.875rem' }], // 10px / 14px
  			'2xs': ['0.6875rem', { lineHeight: '0.9375rem' }], // 11px / 15px
  			sm: ['0.8125rem', { lineHeight: '1.25rem' }], // 13px / 20px
  			md: ['0.875rem', { lineHeight: '1.25rem' }], // 14px / 20px
  		},
  		// Calques nommés : l'ordre reprend les valeurs en place (dialogues à 9998-9999).
  		zIndex: {
  			sticky: '20',
  			overlay: '9998',
  			modal: '9999',
  			popover: '10000',
  			toast: '10050',
  		},
  		transitionTimingFunction: {
  			emphasized: 'cubic-bezier(0.22, 1, 0.36, 1)',
  		},
  		// text-destructive rend la couleur danger : en sombre, aucun rouge ne peut
  		// à la fois se lire sur le fond et porter du texte blanc (01-direction.md, § 2).
  		textColor: {
  			destructive: {
  				DEFAULT: 'hsl(var(--danger))',
  				foreground: 'hsl(var(--destructive-foreground))'
  			},
  			// text-accent et border-accent ont toujours été écrits pour dire « couleur de
  			// marque » (statut en cours, profil à contacter, sélection) : ils rendent
  			// l'indigo. bg-accent reste le gris de survol de shadcn.
  			accent: {
  				DEFAULT: 'hsl(var(--brand))',
  				foreground: 'hsl(var(--accent-foreground))'
  			}
  		},
  		borderColor: {
  			accent: {
  				DEFAULT: 'hsl(var(--brand))',
  				foreground: 'hsl(var(--accent-foreground))'
  			}
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
