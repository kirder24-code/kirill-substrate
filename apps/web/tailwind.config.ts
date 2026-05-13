import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#f5f7fb",
        foreground: "#0f172a",
        card: "#ffffff",
        border: "#dbe1ea",
        primary: "#0a66c2",
        muted: "#64748b"
      },
      boxShadow: {
        panel: "0 12px 32px rgba(15, 23, 42, 0.06)"
      },
      borderRadius: {
        xl: "1rem"
      }
    }
  },
  plugins: []
} satisfies Config;

