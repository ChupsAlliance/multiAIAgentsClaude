/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'vs-bg':       'rgb(var(--vs-bg) / <alpha-value>)',
        'vs-sidebar':  'rgb(var(--vs-sidebar) / <alpha-value>)',
        'vs-panel':    'rgb(var(--vs-panel) / <alpha-value>)',
        'vs-border':   'rgb(var(--vs-border) / <alpha-value>)',
        'vs-text':     'rgb(var(--vs-text) / <alpha-value>)',
        'vs-muted':    'rgb(var(--vs-muted) / <alpha-value>)',
        'vs-comment':  'rgb(var(--vs-comment) / <alpha-value>)',
        'vs-keyword':  'rgb(var(--vs-keyword) / <alpha-value>)',
        'vs-string':   'rgb(var(--vs-string) / <alpha-value>)',
        'vs-number':   'rgb(var(--vs-number) / <alpha-value>)',
        'vs-fn':       'rgb(var(--vs-fn) / <alpha-value>)',
        'vs-type':     'rgb(var(--vs-type) / <alpha-value>)',
        'vs-accent':   'rgb(var(--vs-accent) / <alpha-value>)',
        'vs-accent2':  'rgb(var(--vs-accent2) / <alpha-value>)',
        'vs-green':    'rgb(var(--vs-green) / <alpha-value>)',
        'vs-yellow':   'rgb(var(--vs-yellow) / <alpha-value>)',
        'vs-red':      'rgb(var(--vs-red) / <alpha-value>)',
        'vs-orange':   'rgb(var(--vs-orange) / <alpha-value>)',
        'vs-heading':  'rgb(var(--vs-heading) / <alpha-value>)',
        'vs-overlay':  'rgb(var(--vs-overlay) / <alpha-value>)',
      },
      fontFamily: {
        mono: ['JetBrains Mono', 'Cascadia Code', 'Consolas', 'monospace'],
        sans: ['Inter', 'Segoe UI', 'system-ui', 'sans-serif'],
      },
      animation: {
        'fade-in': 'fadeIn 0.3s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
        'pulse-soft': 'pulseSoft 2s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to:   { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          from: { opacity: '0', transform: 'translateX(-8px)' },
          to:   { opacity: '1', transform: 'translateX(0)' },
        },
        pulseSoft: {
          '0%, 100%': { opacity: '1' },
          '50%':      { opacity: '0.5' },
        },
      },
    },
  },
  plugins: [],
}
