export interface ChangelogEntry {
  version: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.4.1',
    changes: [
      'Fixed the Trip Date on Transportation Requests showing one day earlier than what was submitted',
      'Fixed the inventory search so that all users except certain roles (e.g., ALL_Students) can find items correctly',
      'Fixed email notifications for transportation requests to correctly display the trip date in UTC'
    ],
  },
  {
    version: '1.4.0',
    changes: [
      'Repair tickets now automatically close or advance the linked incident when resolved, instead of requiring a trip back through the incident wizard',
      'Incident detail page now shows a targeted next action instead of always reopening the full incident wizard',
      'Retired the old duplicate Incidents pages under Device Management — photo upload and Create Invoice now live on the one incident page',
      'Checkout now blocks a device that is still out for repair and offers a one-click "Mark Returned" fix before continuing, on the scan, bulk checkout, and Quick Check pages',
      'Merged the "Sent to Vendor" and "In Repair" repair ticket statuses into one step',
      'Incident Workflow Progress now accurately reflects the linked repair ticket\'s real status and no longer shows "Invoiced" as done unless an invoice actually exists',
      'Reordered the incident workflow steps to match real-world order: Damage Reported, Device Exchanged, Sent to Repair, Repair Completed, Invoice, Closed',
      'Added a Repair Tickets link to the sidebar under Incidents; removed the redundant Repair Tickets box from the incident detail page',
      'Photo upload on incidents is now a clearly labeled button instead of a plain drop zone',
      'Fixed the repair ticket status stepper not showing a checkmark once a ticket is marked Returned',
      'Repair Tickets can now be searched by asset tag, device name, or vendor across all tickets, not just the current page',
      'Add Reports page to view and generate various reports for incidents and work orders',
    ],
  },
  {
    version: '1.3.1',
    changes: [
      'Added priority permissions for Technology and Maintenance Work Orders (Admin, Tech Assistants, County-Wide Maintenance, School Maintenance, Maintenance Director, Technology Director)',
      'Added priority change history to Work Orders',
      'Replaced supervisor/worker/delegate dropdowns with a staff-only searchable picker on Edit Location',
      'Work Orders list now defaults to Technology or Maintenance based on your role',
      'Purchase Orders list now defaults to "Pending My Approval" for Director of Schools approvers',
      'Tech Assistants now only see their own Purchase Order requests, not all requests at their location',
      'Added when a Category that does not require an asset tag is selected, the Asset Tag field is hidden on the Work Order form',
      'Fixed Maintenance Work Orders not showing up in the list for Maintenance Director and County-Wide Maintenance roles',
      'Added assigned role to header desktop mode and in PWA under the user info to clarify which role is currently being used for the logged-in user',
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
