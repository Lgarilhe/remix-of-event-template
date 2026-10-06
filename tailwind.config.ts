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
  			// brand : l'accent bleu-vert unique, rationné (focus, sélection, signaux, progression).
  			// purple, pink, blue, cyan, green : ancienne palette Skalr, à ne plus employer.
  			// purple est rabattu sur l'accent : ses anciens usages prennent le bleu-vert.
  			brand: {
  				DEFAULT: 'hsl(var(--brand))',
  				foreground: 'hsl(var(--brand-foreground))',
  				hover: 'hsl(var(--brand-hover))',
  				press: 'hsl(var(--brand-press))',
  				solid: 'hsl(var(--brand-solid))',
  				'solid-foreground': 'hsl(var(--brand-solid-foreground))',
  				purple: 'hsl(var(--brand))',
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
  			// Surfaces (cartes, menus, dialogues) : 16 px, comme Qonto. Les contrôles restent à 8 px.
  			xl: 'calc(var(--radius) + 8px)',
  			lg: 'var(--radius)',
  			md: 'calc(var(--radius) - 2px)',
  			sm: 'calc(var(--radius) - 4px)'
  		},
  		// Paliers du design simplifié (docs/design/01-direction.md, § 3) : rien
  		// sous 12 px, corps à 14 px (sm), texte de liste et de lecture à 15 px (md),
  		// titre de page à 28 px (title). 3xs et 2xs valent tous deux 12 px.
  		// Bannit l'usage de text-[Npx] arbitraires.
  		fontSize: {
  			'3xs': ['0.75rem', { lineHeight: '1rem' }], // 12px / 16px
  			'2xs': ['0.75rem', { lineHeight: '1rem' }], // 12px / 16px
  			xs: ['0.8125rem', { lineHeight: '1.125rem' }], // 13px / 18px
  			sm: ['0.875rem', { lineHeight: '1.25rem' }], // 14px / 20px
  			md: ['0.9375rem', { lineHeight: '1.375rem' }], // 15px / 22px
  			title: ['1.75rem', { lineHeight: '2.25rem', letterSpacing: '-0.01em' }], // 28px / 36px
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
  			// Icônes qui attendent (src/components/ui/animated-icons.tsx) : chaque boucle
  			// finit sur la pose fixe de l'icône, celle qui reste en mouvement réduit.
  			'typing-dot': {
  				'0%, 60%, 100%': { transform: 'translateY(0)', opacity: '0.45' },
  				'30%': { transform: 'translateY(-2.5px)', opacity: '1' }
  			},
  			'hourglass-flip': {
  				'0%, 42%': { transform: 'rotate(0deg)' },
  				'50%, 92%': { transform: 'rotate(180deg)' },
  				'100%': { transform: 'rotate(360deg)' }
  			},
  			'alarm-ring': {
  				'0%, 70%, 100%': { transform: 'rotate(0deg)' },
  				'74%': { transform: 'rotate(-14deg)' },
  				'78%': { transform: 'rotate(12deg)' },
  				'82%': { transform: 'rotate(-9deg)' },
  				'86%': { transform: 'rotate(7deg)' },
  				'90%': { transform: 'rotate(-3deg)' }
  			},
  			twinkle: {
  				'0%, 72%, 100%': { transform: 'scale(1)' },
  				'80%': { transform: 'scale(0.72)' },
  				'90%': { transform: 'scale(1.12)' }
  			},
  			// Pièces d'une illustration (src/components/ui/illustration.tsx) : l'état de
  			// départ vient des variables --illu-*, la place est l'état du dessin fixe, la
  			// sortie d'une boucle vaut l'état de départ sauf --illu-x2, --illu-y2, --illu-r2.
  			'illu-enter': {
  				from: {
  					opacity: 'var(--illu-o, 0)',
  					transform: 'translate(var(--illu-x, 0), var(--illu-y, 0)) rotate(var(--illu-r, 0deg)) scale(var(--illu-s, 1))'
  				},
  				to: {
  					opacity: '1',
  					transform: 'none'
  				}
  			},
  			// Entrée, pause à sa place, sortie.
  			'illu-loop': {
  				'0%': {
  					opacity: 'var(--illu-o, 0)',
  					transform: 'translate(var(--illu-x, 0), var(--illu-y, 0)) rotate(var(--illu-r, 0deg)) scale(var(--illu-s, 1))'
  				},
  				'20%, 80%': {
  					opacity: '1',
  					transform: 'none'
  				},
  				'100%': {
  					opacity: 'var(--illu-o, 0)',
  					transform: 'translate(var(--illu-x2, var(--illu-x, 0)), var(--illu-y2, var(--illu-y, 0))) rotate(var(--illu-r2, var(--illu-r, 0deg))) scale(var(--illu-s, 1))'
  				}
  			},
  			// Passage continu, sans pause.
  			'illu-drift': {
  				'0%': {
  					opacity: 'var(--illu-o, 0)',
  					transform: 'translate(var(--illu-x, 0), var(--illu-y, 0))'
  				},
  				'50%': {
  					opacity: '1',
  					transform: 'none'
  				},
  				'100%': {
  					opacity: 'var(--illu-o, 0)',
  					transform: 'translate(var(--illu-x2, var(--illu-x, 0)), var(--illu-y2, var(--illu-y, 0)))'
  				}
  			},
  			// Tracé de gauche à droite, pause, effacement.
  			'illu-draw': {
  				'0%': {
  					clipPath: 'inset(0 100% 0 0)',
  					opacity: '1'
  				},
  				'20%, 80%': {
  					clipPath: 'inset(0 var(--illu-draw-to, 0%) 0 0)',
  					opacity: '1'
  				},
  				'100%': {
  					clipPath: 'inset(0 var(--illu-draw-to, 0%) 0 0)',
  					opacity: '0'
  				}
  			},
  			'illu-float': {
  				'0%, 100%': {
  					transform: 'translateY(0)'
  				},
  				'50%': {
  					transform: 'translateY(-3%)'
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
  			// Illustrations : entrée jouée une fois, puis boucles (décision du propriétaire, 29/09).
  			// fill both : état de départ pendant l'attente, place finale après une entrée.
  			'illu-enter': 'illu-enter var(--illu-duration, 700ms) var(--illu-ease, cubic-bezier(0.22, 1, 0.36, 1)) var(--illu-delay, 0ms) both',
  			'illu-loop': 'illu-loop var(--illu-duration, 3600ms) var(--illu-ease, cubic-bezier(0.22, 1, 0.36, 1)) var(--illu-delay, 0ms) infinite both',
  			'illu-drift': 'illu-drift var(--illu-duration, 3200ms) var(--illu-ease, cubic-bezier(0.45, 0, 0.55, 1)) var(--illu-delay, 0ms) infinite both',
  			'illu-draw': 'illu-draw var(--illu-duration, 3600ms) var(--illu-ease, cubic-bezier(0.22, 1, 0.36, 1)) var(--illu-delay, 0ms) infinite both',
  			'illu-settle': 'illu-enter var(--illu-duration, 500ms) var(--illu-ease, cubic-bezier(0.22, 1, 0.36, 1)) var(--illu-delay, 0ms) both, illu-float 4s cubic-bezier(0.45, 0, 0.55, 1) var(--illu-duration, 500ms) infinite',
  			// Icônes qui attendent (docs/design/01-direction.md, § 7).
  			'typing-dot': 'typing-dot 1.4s ease-in-out infinite',
  			'hourglass-flip': 'hourglass-flip 4.2s cubic-bezier(0.45, 0, 0.55, 1) infinite',
  			'alarm-ring': 'alarm-ring 3.2s ease-in-out infinite',
  			twinkle: 'twinkle 3.6s ease-in-out infinite',
  			'ping-slow': 'ping 2.2s cubic-bezier(0, 0, 0.2, 1) infinite',
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
