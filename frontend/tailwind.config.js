/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
      },
      colors: {
        obsidian: "#0A0809",
        crimson: {
          glow: "#8C1420",
          deep: "#3D080E",
          cta: "#E84C3D",
          ctaHover: "#D43D2E",
        },
      },
    },
  },
  plugins: [],
};
