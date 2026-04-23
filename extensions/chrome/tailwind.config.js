/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{ts,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: 'hsl(var(--accent))',
        border: 'hsl(var(--border))',
        info: 'hsl(var(--info))',
        success: 'hsl(var(--success))',
        destructive: 'hsl(var(--destructive))',
        warning: 'hsl(var(--warning))',
      },
    },
  },
  plugins: [],
};
