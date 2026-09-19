/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#111827",
          700: "#374151",
          500: "#6B7280",
        },
        indigo: {
          50: "#EEF2FF",
          100: "#E0E7FF",
          500: "#5B5FEF",
          600: "#4C4FE0",
          700: "#3F3FC4",
        },
      },
      fontFamily: {
        sans: ["Inter", "Hind Siliguri", "system-ui", "sans-serif"],
        bengali: ["Hind Siliguri", "Inter", "system-ui", "sans-serif"],
        bijoy: ["SutonnyMJ", "sans-serif"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(17, 24, 39, 0.04), 0 8px 24px -8px rgba(17, 24, 39, 0.08)",
      },
      keyframes: {
        "fade-in": { "0%": { opacity: 0 }, "100%": { opacity: 1 } },
        "slide-up": {
          "0%": { opacity: 0, transform: "translateY(8px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.2s ease-out",
        "slide-up": "slide-up 0.25s ease-out",
      },
    },
  },
  plugins: [],
}

