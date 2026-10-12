import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        clay: { DEFAULT: "#D4683F", dark: "#B4532E", light: "#F2C9B4" },
        cream: "#FBF6EE",
        sand: "#EFE5D6",
        ink: { DEFAULT: "#1B1714", soft: "#5B524B" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["Fraunces", "ui-serif", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
