module.exports = {
  content: [
    './*.php',
    './functions.php'
  ],
  darkMode: 'class',
  safelist: [
    'bg-cover',
    'bg-center',
    'bg-white/30',
    'dark:bg-darkCard/30',
    'backdrop-blur-md',
    'font-sans',
    'font-serif',
    'text-teal',
    'border-teal',
    'dark:border-teal',
    'opacity-0',
    'opacity-100',
    'pointer-events-none',
    'pointer-events-auto',
    'translate-y-0',
    'translate-y-5',
    'translate-x-full',
    'invisible',
    'visible'
  ],
  theme: {
    extend: {
      colors: {
        teal: '#00d2ff',
        darkBg: '#121418',
        darkCard: '#1a1d24'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        playfair: ['"Playfair Display"', 'serif']
      },
      boxShadow: {
        glow: '0 0 20px rgba(0, 210, 255, 0.15)'
      }
    }
  },
  plugins: [
    require('@tailwindcss/typography')
  ]
};
