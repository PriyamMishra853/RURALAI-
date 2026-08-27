/** @type {import('tailwindcss').Config} */

/**
 * Design tokens — Indian government medical service.
 *
 * Reference points are NHA/ABDM and MoHFW digital services, not a startup
 * landing page. Three rules the palette enforces:
 *
 *  1. `gov` navy is the institutional voice. It carries chrome, headers and
 *     primary actions. It is never used to mean "safe" or "urgent".
 *  2. The risk ramp (green → amber → orange → red) is RESERVED. Those four
 *     colours mean exactly one thing in this product — a triage tier — and are
 *     never used decoratively. A green button that does not mean "low risk" is
 *     a hazard on a clinical screen.
 *  3. Every colour is a CSS variable so light and dark are one definition, not
 *     two divergent palettes that drift apart.
 */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        // --- Institutional ---
        gov: {
          50:  'rgb(var(--gov-50) / <alpha-value>)',
          100: 'rgb(var(--gov-100) / <alpha-value>)',
          200: 'rgb(var(--gov-200) / <alpha-value>)',
          300: 'rgb(var(--gov-300) / <alpha-value>)',
          400: 'rgb(var(--gov-400) / <alpha-value>)',
          500: 'rgb(var(--gov-500) / <alpha-value>)',
          600: 'rgb(var(--gov-600) / <alpha-value>)',
          700: 'rgb(var(--gov-700) / <alpha-value>)',
          800: 'rgb(var(--gov-800) / <alpha-value>)',
          900: 'rgb(var(--gov-900) / <alpha-value>)',
          950: 'rgb(var(--gov-950) / <alpha-value>)'
        },
        // Ashoka saffron, used sparingly for state identity only.
        saffron: {
          400: 'rgb(var(--saffron-400) / <alpha-value>)',
          500: 'rgb(var(--saffron-500) / <alpha-value>)',
          600: 'rgb(var(--saffron-600) / <alpha-value>)'
        },

        // --- Surfaces (swap wholesale between themes) ---
        surface: {
          DEFAULT: 'rgb(var(--surface) / <alpha-value>)',
          raised:  'rgb(var(--surface-raised) / <alpha-value>)',
          sunken:  'rgb(var(--surface-sunken) / <alpha-value>)',
          overlay: 'rgb(var(--surface-overlay) / <alpha-value>)'
        },
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          muted:   'rgb(var(--ink-muted) / <alpha-value>)',
          subtle:  'rgb(var(--ink-subtle) / <alpha-value>)',
          inverse: 'rgb(var(--ink-inverse) / <alpha-value>)'
        },
        line: {
          DEFAULT: 'rgb(var(--line) / <alpha-value>)',
          strong:  'rgb(var(--line-strong) / <alpha-value>)'
        },

        // --- Triage ramp. Reserved. ---
        tier: {
          low:       'rgb(var(--tier-low) / <alpha-value>)',
          lowBg:     'rgb(var(--tier-low-bg) / <alpha-value>)',
          moderate:  'rgb(var(--tier-moderate) / <alpha-value>)',
          moderateBg:'rgb(var(--tier-moderate-bg) / <alpha-value>)',
          high:      'rgb(var(--tier-high) / <alpha-value>)',
          highBg:    'rgb(var(--tier-high-bg) / <alpha-value>)',
          emergency: 'rgb(var(--tier-emergency) / <alpha-value>)',
          emergencyBg:'rgb(var(--tier-emergency-bg) / <alpha-value>)'
        }
      },

      fontFamily: {
        // Noto has real Devanagari coverage. Village-facing text renders Hindi,
        // and most display faces simply do not carry those glyphs.
        sans: ['"Noto Sans"', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'],
        display: ['"Noto Serif"', '"Noto Serif Devanagari"', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace']
      },

      borderRadius: {
        // Government services read as formal. Softer than a bank, sharper than
        // a consumer app.
        card: '0.625rem',
        field: '0.5rem'
      },

      boxShadow: {
        card: 'var(--shadow-card)',
        raised: 'var(--shadow-raised)',
        overlay: 'var(--shadow-overlay)'
      },

      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' }
        },
        'pulse-danger': {
          '0%, 100%': { boxShadow: '0 0 0 0 rgb(var(--tier-emergency) / 0.45)' },
          '50%': { boxShadow: '0 0 0 12px rgb(var(--tier-emergency) / 0)' }
        },
        shimmer: {
          '100%': { transform: 'translateX(100%)' }
        }
      },
      animation: {
        'fade-up': 'fade-up 0.35s cubic-bezier(0.22, 1, 0.36, 1) both',
        'pulse-danger': 'pulse-danger 1.8s ease-out infinite',
        shimmer: 'shimmer 1.6s infinite'
      }
    }
  },
  plugins: []
};
