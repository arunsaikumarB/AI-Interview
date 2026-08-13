import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        display: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        heading: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        surface: {
          DEFAULT: "hsl(var(--surface))",
          elevated: "hsl(var(--surface-elevated))",
          hover: "hsl(var(--surface-hover))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        primary: {
          DEFAULT: "hsl(var(--primary))",
          hover: "hsl(var(--primary-hover))",
          muted: "hsl(var(--primary-muted) / 0.14)",
          foreground: "hsl(var(--primary-foreground))",
        },
        ai: {
          DEFAULT: "hsl(var(--ai))",
          muted: "hsl(var(--ai-muted) / 0.12)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          muted: "hsl(var(--accent-muted) / 0.12)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        success: {
          DEFAULT: "hsl(var(--success))",
          muted: "hsl(var(--success) / 0.12)",
        },
        warning: {
          DEFAULT: "hsl(var(--warning))",
          muted: "hsl(var(--warning) / 0.12)",
        },
        danger: {
          DEFAULT: "hsl(var(--danger))",
          muted: "hsl(var(--danger) / 0.12)",
        },
        info: "hsl(var(--info))",
        border: "hsl(var(--border))",
        "border-strong": "hsl(var(--border-strong))",
        input: "hsl(var(--input-border))",
        "input-background": "hsl(var(--input-background))",
        ring: "hsl(var(--focus-ring))",
        sidebar: "hsl(var(--sidebar))",
        chart: {
          grid: "hsl(var(--chart-grid))",
          axis: "hsl(var(--chart-axis))",
          primary: "hsl(var(--chart-primary))",
          secondary: "hsl(var(--chart-secondary))",
          ai: "hsl(var(--chart-ai))",
        },
        icon: {
          DEFAULT: "hsl(var(--icon-primary))",
          secondary: "hsl(var(--icon-secondary))",
          muted: "hsl(var(--icon-muted))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "var(--radius-control)",
        sm: "calc(var(--radius-control) - 2px)",
        xl: "var(--radius-card)",
        "2xl": "1.5rem",
      },
      boxShadow: {
        glow: "none",
        panel: "0 10px 28px rgba(0, 0, 0, 0.18)",
      },
      transitionDuration: {
        ui: "160ms",
      },
      keyframes: {
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        shimmer: "shimmer 1.4s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
