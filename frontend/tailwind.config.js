/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        dashboard: {
          bg: '#0a0d14',
          panel: '#131826',
          border: '#1f2937',
          primary: '#3b82f6',
          active: '#10b981',
          inactive: '#ef4444',
          maintenance: '#f59e0b',
          textMain: '#e5e7eb',
          textMuted: '#9ca3af'
        }
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular']
      }
    },
  },
  plugins: [],
}
