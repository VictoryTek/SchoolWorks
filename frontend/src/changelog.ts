export interface ChangelogEntry {
  version: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.3.0',
    changes: [
      'Added a changelog tooltip to the sidebar version number',
      'Added device rename via serial lookup and bulk Excel upload (Intune)',
      'Added approval notes in Notes section and PDF (Purchase Orders)',
      'Added school-only Ship To dropdown to PO request',
      'Added per-category asset tag requirement toggle (Work Orders)',
      'Added district phone number to PO PDF Bill To',
    ],
  },
  {
    version: '1.2.0',
    changes: [
    'Added district phone number to PO PDF Bill To',
    ],
  },
];
