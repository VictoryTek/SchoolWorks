import { createTheme } from '@mui/material/styles';

declare module '@mui/material/styles' {
  interface Palette {
    statusOpen: Palette['primary'];
    statusInProgress: Palette['primary'];
    statusOnHold: Palette['primary'];
    statusLongTerm: Palette['primary'];
    statusClosed: Palette['primary'];
    priorityLow: Palette['primary'];
    priorityMedium: Palette['primary'];
    priorityHigh: Palette['primary'];
    priorityUrgent: Palette['primary'];
  }
  interface PaletteOptions {
    statusOpen?: PaletteOptions['primary'];
    statusInProgress?: PaletteOptions['primary'];
    statusOnHold?: PaletteOptions['primary'];
    statusLongTerm?: PaletteOptions['primary'];
    statusClosed?: PaletteOptions['primary'];
    priorityLow?: PaletteOptions['primary'];
    priorityMedium?: PaletteOptions['primary'];
    priorityHigh?: PaletteOptions['primary'];
    priorityUrgent?: PaletteOptions['primary'];
  }
}

declare module '@mui/material/Chip' {
  interface ChipPropsColorOverrides {
    statusOpen: true;
    statusInProgress: true;
    statusOnHold: true;
    statusLongTerm: true;
    statusClosed: true;
    priorityLow: true;
    priorityMedium: true;
    priorityHigh: true;
    priorityUrgent: true;
  }
}

export const theme = createTheme({
  cssVariables: {
    colorSchemeSelector: 'class',
  },
  colorSchemes: {
    light: {
      palette: {
        primary: {
          main: '#3b82f6',
          dark: '#2563eb',
        },
        statusOpen: { main: '#2563eb', contrastText: '#ffffff' },
        statusInProgress: { main: '#7c3aed', contrastText: '#ffffff' },
        statusOnHold: { main: '#475569', contrastText: '#ffffff' },
        statusLongTerm: { main: '#0d9488', contrastText: '#ffffff' },
        statusClosed: { main: '#334155', contrastText: '#ffffff' },
        priorityLow: { main: '#15803d', contrastText: '#ffffff' },
        priorityMedium: { main: '#a16207', contrastText: '#ffffff' },
        priorityHigh: { main: '#c2410c', contrastText: '#ffffff' },
        priorityUrgent: { main: '#dc2626', contrastText: '#ffffff' },
      },
    },
    dark: {
      palette: {
        primary: {
          main: '#60a5fa',
          dark: '#3b82f6',
        },
        statusOpen: { main: '#60a5fa', contrastText: 'rgba(0, 0, 0, 0.87)' },
        statusInProgress: { main: '#a78bfa', contrastText: 'rgba(0, 0, 0, 0.87)' },
        statusOnHold: { main: '#94a3b8', contrastText: 'rgba(0, 0, 0, 0.87)' },
        statusLongTerm: { main: '#5eead4', contrastText: 'rgba(0, 0, 0, 0.87)' },
        statusClosed: { main: '#cbd5e1', contrastText: 'rgba(0, 0, 0, 0.87)' },
        priorityLow: { main: '#4ade80', contrastText: 'rgba(0, 0, 0, 0.87)' },
        priorityMedium: { main: '#fbbf24', contrastText: 'rgba(0, 0, 0, 0.87)' },
        priorityHigh: { main: '#fb923c', contrastText: 'rgba(0, 0, 0, 0.87)' },
        priorityUrgent: { main: '#f87171', contrastText: 'rgba(0, 0, 0, 0.87)' },
      },
    },
  },
  components: {
    // Dark mode gives elevated Paper surfaces (Menus, Popovers, Dialogs, Cards) a
    // light overlay wash on top of background.paper. Sticky ListSubheader rows
    // paint their own flat background.paper instead, so grouped Select menus
    // (e.g. the Purchase Order location picker) show a visible seam between
    // header and item rows. Flattening the overlay keeps every elevated surface
    // a consistent, flat background.paper.
    MuiPaper: {
      styleOverrides: {
        root: ({ theme }) => [
          theme.applyStyles('dark', { backgroundImage: 'none' }),
        ],
      },
    },
    // Outlined buttons default to a border at ~50% opacity of their color.
    // Over this theme's dark navy surfaces, a light color like dark mode's
    // primary blue (#60a5fa) at that opacity desaturates enough to read as
    // near-black instead of blue. Full-opacity border in dark mode only —
    // respects whatever `color` prop is set (primary, error, etc.), it's
    // just no longer diluted.
    MuiButton: {
      styleOverrides: {
        outlined: ({ theme }) => [
          theme.applyStyles('dark', { borderColor: 'currentColor' }),
        ],
      },
    },
  },
});
