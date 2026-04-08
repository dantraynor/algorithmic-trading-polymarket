import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bb: {
          bg: '#0a0a0a',
          panel: '#111111',
          border: '#2a2a2a',
          green: '#00ff41',
          red: '#ff3131',
          yellow: '#ffcc00',
          cyan: '#00e5ff',
          orange: '#ff8c00',
          purple: '#c084fc',
          text: '#e0e0e0',
          dim: '#555555',
          muted: '#333333',
        },
      },
      fontFamily: {
        mono: ['IBM Plex Mono', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;
