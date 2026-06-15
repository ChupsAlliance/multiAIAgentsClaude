/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        'vs-bg':       '#1e1e1e',
        'vs-sidebar':  '#252526',
        'vs-panel':    '#2d2d2d',
        'vs-border':   '#3e3e42',
        'vs-text':     '#d4d4d4',
        'vs-muted':    '#858585',
        'vs-comment':  '#6a9955',
        'vs-keyword':  '#569cd6',
        'vs-string':   '#ce9178',
        'vs-number':   '#b5cea8',
        'vs-fn':       '#dcdcaa',
        'vs-type':     '#4ec9b0',
        'vs-accent':   '#007acc',
        'vs-accent2':  '#0098ff',
        'vs-green':    '#4ec9b0',
        'vs-yellow':   '#dcdcaa',
        'vs-red':      '#f44747',
        'vs-orange':   '#ce9178',
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
