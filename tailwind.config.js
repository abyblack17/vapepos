/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Syne"', 'sans-serif'],
        body:    ['"DM Sans"', 'sans-serif'],
        mono:    ['"DM Mono"', 'monospace'],
      },
      colors: {
        'neon-green':  '#00e5a0',
        'neon-blue':   '#00c4e8',
        'neon-purple': '#8b5cf6',
        'brand-amber': '#f59e0b',
        'brand-danger': '#ef4444',
      },
      boxShadow: {
        neon: '0 0 20px rgba(0,229,160,0.15)',
        card: '0 4px 24px rgba(0,0,0,0.4)',
      },
    },
  },
  plugins: [],
}
