/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      boxShadow: {
        industrial: '0 20px 50px rgba(0,0,0,0.35)'
      }
    }
  },
  plugins: []
}