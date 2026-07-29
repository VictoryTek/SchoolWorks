export interface ChangelogEntry {
  version: string;
  changes: string[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.6.3',
    changes: [
      'Removed the "Not Listed" option from the Purchase Order Department/Program/School/District Office picker — it had no supervisor to route to, which blocked approval. Add missing departments/programs on the Locations & Supervisors admin page instead.',
      'Fixed the New Requisition page in dark mode: the vendor and ship-to address info boxes no longer render as solid white, and the Department/Program/School/District Office dropdown no longer shows a visible mismatch between its section headers and the items below them.',
    ],
  },
  {
    version: '1.6.2',
    changes: [
      'Fixed Librarians not being able to see or search for students on the Device Management checkout pages.',
      'Fixed the DM Dashboard to only show the stats for the user that is logged in, instead of showing the stats for all assigned devices.',
      'Fixed Create Incident on Active Checkouts not reliably filling in the device tag number or linked user.',
      'Added a chip card to view open workorders',
      'Fixed dashboard reflow module card grid by container width, not viewport',
      "Added comment requirement when changing a work order's status to 'Closed' or 'Resolved'.",
      'Added a back to top button to the bottome right of the screen for easier navigation on long pages.',
      'Admins are now emailed (and pushed) a reminder if Maintenance Mode is still on 3 hours after they enabled it.',
      'Fixed the Inventory Management mobile Refresh button being undersized and visually disconnected from the search/filter row.',
      'Added an Email Notifications toggle under Settings > Notifications, letting you opt out of notification emails independently of push.',
      'Fixed tables stop mid-with horizontal scroll on TesponsiveTables list',
      'Librarians no longer have access to Intune Actions, DM Reports, Component Prices, Cart Assignment, Checked-Out Carts, and Room Check Out under Device Management.',
    ],
  },
  {
    version: '1.6.1',
    changes: [
      'Fixed Sync Staff Users and Sync Student Users not deactivating accounts that were disabled in Microsoft Entra.',
      'Fixed student Grade not appearing on the Users page after syncing.',
      'Fixed the staff/student directory sync failing for an account when Microsoft 365 reissues a new account ID for the same person (e.g. after an account is deleted and recreated).',
      'Fixed the SIS import occasionally creating a second Entra account for an employee instead of recognizing the account it already created.',
      "Consolidated the Intune Device Actions tabs so that Scan / Search by Name and the BitLocker recovery key are now on the same tab, and the BitLocker recovery key is easier to read.",
      'Fixed ssl certificate not renewing automatically, causing the app to be inaccessible until manually renewed.',
      'Change health check to point to 127.0.0.1 instead of localhost to avoid issues with some DNS configurations.',
    ],
  },
  {
    version: '1.6.0',
    changes: [
      'Added charger assignment to Bulk Checkout and Quick Check, allowing users to assign chargers to multiple devices at once.',
      'Bulk Checkout and Quick Check now ask "Will a charger be assigned to these devices?" with clear Yes/No buttons instead of a checkbox, making the charger assignment step easier to notice.',
      'Added Room Check Out under Device Management: select a school and room, then scan or type each device\'s tag number to check it into that room. Unrecognized tags can be added to inventory on the spot.',
      'Added MVR Records under Fleet Management: track each driver\'s Motor Vehicle Record pull date, with the expiration date auto-filled one year out and editable reminder emails before renewal is due.',
      'Added the ability to serach for charger by serial number in active checkouts'
    ],
  },
  {
    version: '1.5.2',
    changes: [
      'Fixed the Inventory Management Refresh button not matching the style of the Import, Export, and Add Item buttons next to it.',
      'The header notification bell now shows whether push notifications are actually enabled on this device instead of always looking the same.',
      'Fixed the mobile header overflowing and pushing the Logout button off-screen.',
    ],
  },
  {
    version: '1.5.1',
    changes: [
      'Technology Assistants can now manage room assignments for the school(s) they support.',
      'Room Assignments: clicking anywhere on a room\'s card now opens its assignment dialog, not just the "Manage Assignments" button.',
      'Fixed Room Assignments pagination reverting to page 1 immediately after selecting a different page.',
    ],
  },
  {
    version: '1.5.0',
    changes: [
      'Added native push notifications — install SchoolWorks as an app and opt in from Settings > Notifications to get a device notification for approvals, assignments, and more, even when the app isn\'t open. Email notifications are unaffected and always continue to be sent.',
      'Removed the redundant "Resolved" work order status — resolved tickets are now simply marked Closed.',
      'Reordered the Intune Device Actions tabs so Scan / Search by Name opens first, and made the revealed BitLocker recovery key easier to read.',
      'Credit: Jordan Howell for this release.',
    ],
  },
  {
    version: '1.4.4',
    changes: [
      'Work Order status and priority chips now use distinct colors so a chip\'s color always tells you which one it is at a glance.',
      'Fixed Inventory Audit item rows, the resolve dialog, and the "added" count being unreadable in dark mode.',
      'Fixed the Intune Test Mode toggle label breaking apart letter-by-letter on mobile.',
      'Fixed the Work Orders "All Schools" location filter reverting to your home school after pressing Back from a work order.',
      'Fixed a gray outline appearing around the mobile navigation menu in dark mode.',
      
    ],
  },
  {
    version: '1.4.3',
    changes: [
      'Assistant Directors approving an overnight field trip now see an on-screen reminder (and receive an email) that the trip requires Board approval and must be submitted for the next Board meeting.',
      'The Director of Schools must now acknowledge that an overnight field trip request has Board approval before they can approve it.',
      'Added a daily limit of 8 field trips requiring a district bus/driver, due to the ongoing driver shortage. Dates at the limit remain bookable if the requester acknowledges they are arranging their own transportation.',
      'Fixed so that all back buttons navigate to the previous page instead of going back to the bginning page of the list view.',
      'Added Discription field to the work order form for Technology and Maintenance work orders, allowing users to provide additional details about the issue or request.',
      'Fixed Purchase Order PDF export to correctly display all line items, including those with long descriptions that previously caused formatting issues.',
      'Fixed gradient background on the sidebar to display correctly in dark mode, ensuring better visibility and aesthetics for users who prefer the dark theme.',

    ],
  },
  {
    version: '1.4.2',
    changes: [
      'Field trips can now span multiple days without being marked "overnight" — Trip End Date is now independent of the overnight safety-precautions requirement, and the dashboard availability calendar, list/detail/approval views, PDF export, and email notifications all show the full date range',
      'Purchase order requisitions now require a Department before they can be submitted.',
      'Added support for "Not Listed" departments, allowing users to manually enter a department, program, or funding source along with a ship-to address if the desired location is not in the list.',
      'Set the default location for Technology Assistants based on their supervised locations, if available',
      'Added support for reporting tag numbers for items not in inventory, allowing users to manually enter a tag or serial number when the item is not found in the inventory.',
      'Add Approval History tab to the Field Trip Approvals page, allowing users to view their past approvals.',
      'Fixed the back button on the Field Trip Detail page to correctly navigate to the previous page instead of always going to the field trips list.',
      'Added support for dark mode throughout the application, allowing users to switch between light and dark themes based on their preference or system settings.'
    ],
  },
  {
    version: '1.4.1',
    changes: [
      'Fixed the Trip Date on Transportation Requests showing one day earlier than what was submitted',
      'Fixed the inventory search so that all users except certain roles (e.g., ALL_Students) can find items correctly',
      'Fixed email notifications for transportation requests to correctly display the trip date in UTC',
      'Fixed Maintenance Director not being correctly identified as an approver for purchase orders',
      'Made it so all supervisors default to pending approval tab first',
      'Fixed Pending My Approval showing incorrect POs for supervisors',
      'Added support for marking items as "Not in Inventory" for Technology work orders',
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
