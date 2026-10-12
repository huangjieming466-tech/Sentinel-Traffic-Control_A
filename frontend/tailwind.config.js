/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        hud: {
          bg: '#020617',
          panel: 'rgba(8, 16, 32, 0.85)',
          border: '#0e7490',
          cyan: '#22d3ee',
          'cyan-dim': '#0891b2',
          'cyan-glow': 'rgba(34, 211, 238, 0.4)',
          red: '#ef4444',
          'red-glow': 'rgba(239, 68, 68, 0.5)',
          yellow: '#facc15',
          'yellow-glow': 'rgba(250, 204, 21, 0.5)',
          green: '#22c55e',
          'green-glow': 'rgba(34, 197, 94, 0.5)',
          text: '#a5f3fc',
          'text-dim': '#67e8f9',
          'text-muted': '#155e75',
        }
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Consolas', 'monospace'],
      },
      animation: {
        'scan': 'scan 4s linear infinite',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'blink': 'blink 1s ease-in-out infinite',
        'flicker': 'flicker 0.15s infinite',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        blink: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.3' },
        },
        flicker: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.95' },
        },
      },
      boxShadow: {
        'cyan-glow': '0 0 20px rgba(34, 211, 238, 0.3), inset 0 0 20px rgba(34, 211, 238, 0.05)',
        'red-glow': '0 0 30px rgba(239, 68, 68, 0.6), 0 0 60px rgba(239, 68, 68, 0.3)',
        'yellow-glow': '0 0 30px rgba(250, 204, 21, 0.6), 0 0 60px rgba(250, 204, 21, 0.3)',
        'green-glow': '0 0 30px rgba(34, 197, 94, 0.6), 0 0 60px rgba(34, 197, 94, 0.3)',
      }
    },
  },
  plugins: [],
}
