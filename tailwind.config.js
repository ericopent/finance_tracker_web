/** @type {import('tailwindcss').Config} */
// Tokens house-style GAP, espelhados do App Master (frontend/tailwind.config.js).
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        gap: {
          blue: '#00A2FF',
          navy: '#0a1628',
          navy2: '#1a2d4a',
          red: '#e74c3c',
          green: '#27ae60',
          bg: '#f4f7fa',
          surface: '#ffffff',
          border: '#e5eaf0',
          text: '#0a1628',
          muted: '#64748b',
          soft: '#f6f9fc',
        },
      },
      fontFamily: {
        gap: ["'Mulish Variable'", "'Inter Variable'", "'Segoe UI'", 'Tahoma', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
