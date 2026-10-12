import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: "#2F5BFF", dark: "#1E44E6", light: "#C9D5FF" },
        paper: "#F7F8FC",
        mist: "#EBEEF6",
        ink: { DEFAULT: "#0B0B12", soft: "#5A5D6E" },
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        display: ["'Inter Tight'", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
