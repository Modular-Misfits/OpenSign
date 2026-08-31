/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {}
  },
  plugins: [
    require("daisyui"),
    function ({ addUtilities, addVariant }) {
      // ✅ Variants that match html[data-theme="..."] (or any ancestor with data-theme)
      addVariant("opensigncss", '[data-theme="opensigncss"] &');
      addVariant("opensigndark", '[data-theme="opensigndark"] &');

      addUtilities({
        // Prevent iOS long-press popup
        ".touch-callout-none": {
          "-webkit-touch-callout": "none"
        },
        // VS Code-style disabled button for all themes
        ".op-btn-vscode-disabled": {
          "background-color": "#3C3C3C !important",
          color: "#CCCCCC !important",
          "border-color": "#565656 !important",
          cursor: "not-allowed !important",
          opacity: "1 !important",
          "&:hover": {
            "background-color": "#3C3C3C !important",
            color: "#CCCCCC !important",
            "border-color": "#565656 !important",
            transform: "none !important"
          }
        },
        // Dark mode icon improvements using DaisyUI theme detection
        '[data-theme="opensigndark"] .icon-improved': {
          color: "#CCCCCC !important"
        },
        '[data-theme="opensigndark"] .icon-muted': {
          color: "#999999 !important"
        },
        '[data-theme="opensigndark"] .icon-disabled': {
          color: "#858585 !important"
        },
        // Gray text improvements for dark mode
        '[data-theme="opensigndark"] .text-gray-500': {
          color: "#CCCCCC !important"
        },
        '[data-theme="opensigndark"] .text-gray-400': {
          color: "#999999 !important"
        },
        '[data-theme="opensigndark"] .text-gray-600': {
          color: "#CCCCCC !important"
        },
        // CSS variable utilities that work with arbitrary values
        ".icon-themed": {
          color: "var(--icon-color)"
        },
        ".icon-themed-muted": {
          color: "var(--icon-color-muted)"
        },
        ".icon-themed-disabled": {
          color: "var(--icon-color-disabled)"
        },
        ".btn-themed-disabled": {
          "background-color": "var(--btn-disabled-bg)",
          color: "var(--btn-disabled-color)",
          "border-color": "var(--btn-disabled-border)",
          cursor: "not-allowed",
          "&:hover": {
            "background-color": "var(--btn-disabled-bg)",
            color: "var(--btn-disabled-color)",
            "border-color": "var(--btn-disabled-border)",
            transform: "none"
          }
        }
      });
    }
  ],
  daisyui: {
    // themes: true,
    themes: [
      {
        opensigndark: {
          primary: "#45BFC2", // Modular Misfits cyber teal
          "primary-content": "#080808",

          secondary: "#265573", // Structural blue
          "secondary-content": "#E0E6EB",

          accent: "#D64640", // Misfit red
          "accent-content": "#FFFFFF",

          neutral: "#153854", // Deep navy controls
          "neutral-content": "#E0E6EB",

          "base-100": "#0F1B29", // Glass-panel surface
          "base-200": "#040810", // App background
          "base-300": "#111C2E", // Elevated panels
          "base-content": "#E0E6EB", // Silver text

          info: "#5D8499", // Slate blue status
          success: "#22C55E", // Optional: for completed docs or alerts
          warning: "#D9A441",
          error: "#D64640",

          "--rounded-btn": "0.5rem",
          "--tab-border": "2px",
          "--tab-radius": "0.75rem",

          // Custom CSS variables for icon and button states
          "--icon-color": "#C8D8EA",
          "--icon-color-muted": "#8DA4C0",
          "--icon-color-disabled": "#5D8499",
          "--btn-disabled-bg": "#153854",
          "--btn-disabled-color": "#8DA4C0",
          "--btn-disabled-border": "#265573",

          // Optional polish
          "--navbar-padding": "0.8rem",
          "--border-color": "#265573", // Card/table separation
          "--tooltip-color": "#153854"
        }
      },
      {
        opensigncss: {
          primary: "#257A7D",
          "primary-content": "#FFFFFF",
          secondary: "#DCE7EF",
          "secondary-content": "#0F2A40",
          accent: "#D64640",
          "accent-content": "#FFFFFF",
          neutral: "#E8ECF0",
          "neutral-content": "#0F2A40",
          "base-100": "#F4F6F8",
          "base-200": "#E8ECF0",
          "base-300": "#DCE7EF",
          "base-content": "#0F2A40",
          info: "#5D8499",
          "info-content": "#FFFFFF",
          success: "#1A7F62",
          "success-content": "#FFFFFF",
          warning: "#9A6700",
          "warning-content": "#FFFFFF",
          error: "#B8302A",
          "error-content": "#FFFFFF",
          "--rounded-btn": "0.5rem",
          "--tab-border": "2px",
          "--tab-radius": "0.75rem"
        }
      }
    ],
    prefix: "op-"
  }
};
