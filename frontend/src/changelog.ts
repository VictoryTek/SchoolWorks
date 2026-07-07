export interface ChangelogEntry {
  version: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.3.1',
    changes: [
      'Added priority permissions for Technology and Maintenance Work Orders (Admin, Tech Assistants, County-Wide Maintenance, School Maintenance, Maintenance Director, Technology Director)',
      'Added priority change history to Work Orders',
      'Replaced supervisor/worker/delegate dropdowns with a staff-only searchable picker on Edit Location',
      'Work Orders list now defaults to Technology or Maintenance based on your role',
      'Purchase Orders list now defaults to "Pending My Approval" for Director of Schools approvers',
      'Tech Assistants now only see their own Purchase Order requests, not all requests at their location',
    ],
  },
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
