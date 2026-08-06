export interface ReleaseHighlight {
  icon: string;
  title: string;
  body: string;
}

export interface ChangelogEntry {
  version: string;
  changes: string[];
  highlights?: ReleaseHighlight[];
}

export const CHANGELOG: ChangelogEntry[] = [
  {
    version: '1.7.5',
    highlights: [
      {
        icon: '📱',
        title: 'Collapsible work order cards on mobile',
        body: 'Work order cards on the mobile Work Orders list are now collapsible — tap a card to reveal its full details. Collapsed, it still shows the work order number, status, room, and who submitted it.',
      },
      {
        icon: '🛠️',
        title: 'Work order actions moved into Comments & Activity',
        body: 'Update Status, Change Priority, Assign To, and Request Input no longer open a popup — pick one right under the comment box in Comments & Activity, and the same box doubles as its notes or message. Much less back-and-forth on mobile. Update Status now requires a note on every change, not just when closing. Assign To and Request Input also now only list staff who can actually take the ticket: Admins and Technology Assistants for Technology tickets, or County-Wide Maintenance, School Maintenance, and the Maintenance Director for Maintenance tickets.',
      },
    ],
    changes: [
      'Work order cards on the mobile Work Orders list are now collapsible — tap a card to reveal its full details; collapsed, it still shows the work order number, status, room, and who submitted it.',
      'Update Status, Change Priority, Assign To, and Request Input on a work order are now handled inline under Comments & Activity instead of popup dialogs — pick an action and the comment box doubles as its notes/message field.',
      'Update Status now requires a note (Actions Taken) on every status change, not just when closing.',
      'Removed the Internal Note toggle from work order comments — no longer needed.',
      'Closing a work order now takes you straight to the Open list instead of leaving you on the ticket you just closed.',
      "Assign To and Request Input on work orders now only list appropriate staff instead of every staff member in the district: Admins and Technology Assistants for Technology tickets, or County-Wide Maintenance, School Maintenance, and the Maintenance Director for Maintenance tickets.",
      'Fixed outlined buttons (Update Status, Reopen, and others) rendering with a near-black border instead of blue in dark mode.',
      'Fixed devices checked into a room via Room Check Out not showing up on My Equipment for staff assigned to that room, unless it happened to be their primary room.',
      'Fixed Checked-Out Carts (view and manage) being reachable by staff outside Device Management — it now requires Device Management access like every other page under that section.',
      'Departments that have rooms now show all active staff.',
      'The Create Incident wizard now links a device and a user at the same time instead of forcing a choice between them, and reliably pulls in a prefilled device on the first load.',
      'The Device Exchange step of the Create Incident wizard no longer asks for a Condition on Return or Return Notes when checking in the broken device — it\'s already known to be damaged — and no longer has a Skip check-in option; check-in now happens automatically when an active checkout is on record.',
      'Fixed Total Incidents showing 0 on a user\'s checkout history page when they had device-related incidents on record — it was only counting incidents not tied to a device, which is correct for the Create Incident wizard\'s 3-strike consultation warning but wrong for a general total.',
      'Replaced the Type column on the Incidents page with a User column showing the linked user, now that an incident can be linked to both a device and a user at once.',
      'Renamed the Incidents page\'s Device / User column to just Device, now that the linked user has its own column.',
      'Fixed the Create Incident wizard\'s Date of Damage saving as the day before what was picked in most US timezones, caused by the date being parsed as UTC midnight instead of local time.',
      'Fixed the Create Incident button on Active Checkouts prefilling Date of Damage with the device\'s original checkout date instead of today\'s date.',
    ],
  },
  {
    version: '1.7.1',
    changes: [
      'Bulk Device Checkout now shows a "Device Not Found" popup when a scanned barcode doesn\'t match any device, instead of adding a fake "Unknown device" entry to the checkout list.',
      'Admin Jobs page now shows the server\'s actual error message (e.g. rate-limit or validation failures) instead of a generic "Request failed with status code" message.',
      'Fixed newly (and some previously) provisioned student accounts being blocked from enrolling devices with a "Legal Age Group Requirement" sign-in error, by correctly granting minor consent during account provisioning.',
      'Removed due date from cartcheckout and quick checkout, since it was never actually used for anything.',
      'Fixed when searching for a device in the Active Checkouts list, the search results were not being displayed correctly and the list was not updating to show the matching devices.',
      'Fixed inventory table text overflow on each row when the device name is too long, causing the text to spill out of the cell and overlap with other content.',
    ],
  },
  {
    version: '1.7.0',
    highlights: [
      {
        icon: '📦',
        title: 'Edit checked-out carts & checkouts',
        body: 'Update the location, name, tag, due date, notes, or staff assignment on a checked-out cart or an active checkout — no more full return/recheckout cycle just to fix a mistake.',
      },
      {
        icon: '🚌',
        title: 'Smarter Field Trip Request form',
        body: 'The Grade dropdown now only shows grades relevant to the selected school, both Subject Area and Grade support "Other," and there\'s a new question for special program/club trips.',
      },
      {
        icon: '🌙',
        title: 'Dark mode polish',
        body: 'Fixed several tables and cards — including the Checked-Out Carts device list — plus the login page logo and overall color scheme, rendering unreadable or broken in dark mode.',
      },
      {
        icon: '🔄',
        title: 'Synergy CSV Export',
        body: 'A new scheduled Admin Job exports staff and student UPNs to the Synergy SIS share so Synergy can pull them back in automatically.',
      },
      {
        icon: '🆕',
        title: "What's New popup",
        body: "You're looking at it — SchoolWorks now shows a quick summary of what changed after a feature update. Turn it off anytime by checking the \"Do not show again\" box, or from the Notifications setting under the bell icon in the header.",
      },
      {
        icon: '🙋',
        title: 'Request Input on work orders',
        body: 'Pull a colleague into a work order for a second opinion without reassigning it — they\'re notified and gain access, and their reply notifies you back.',
      },
      {
        icon: '⏳',
        title: 'Long Term work order status',
        body: 'A new status and list category for projects that can\'t be completed quickly, so they stop cluttering the Open list — with an optional notification to the submitter when it\'s used.',
      },
    ],
    changes: [
      'Checked-out carts can now be edited: update the location, name, tag number, due date, or notes, or reassign which staff member the cart is checked out to — changing the location or staff reassigns every device still checked out under that cart.',
      "Added the ability to add a device to a cart that's already checked out — it's checked out immediately to the cart's current assignee.",
      "Added a per-device Return action inside a checked-out cart's device list, so one device can be returned without returning the whole cart.",
      'Active Checkouts can now be edited: update the location, condition, or notes on a device that\'s still checked out.',
      'Added the ability to assign or replace a charger for a device from the Active Checkouts page.',
      'Added back permission to the librarians for cart assignment.',
      'Added a "Is this trip for a special program or club?" question to the Field Trip Request form, right after Number of Students — check the box to enter the program or club name.',
      "The Field Trip Request Grade dropdown now only shows grades relevant to the selected School/Building (e.g. Obion County Middle School shows 6th-8th Grade only, Obion County Central High School shows High School only).",
      'Added an "Other" option to the Field Trip Request Subject Area dropdown (for both high schools) and to the Grade dropdown for elementary schools and Obion County Middle School.',
      'Fixed the Checked-Out Carts expanded device table, plus three other surfaces, rendering unreadable near-white text on a near-white background in dark mode.',
      'Added a scheduled "Synergy CSV Export" Admin Job that exports active staff and student employeeId-to-UPN mappings to SynergyStaff.csv and SynergyStudents.csv on the Synergy SIS share, which Synergy reads back in to update the SIS.',
      'Added a "What\'s New" popup that summarizes what changed after a feature or major update; patch releases stay silent. Opt out anytime from Settings > Notifications.',
      'The Work Orders list now highlights the View button in amber with a "New comment" tooltip when a work order you submitted or are assigned to has a comment you haven\'t seen yet.',
      'Fixed the charger serial number running off the edge of the card on the Active Checkouts page on mobile — it now shows just the last few characters, which is what actually distinguishes one charger from another.',
      'Added a "Long Term" work order status and list category for projects that can\'t be completed quickly, with its own badge color and an optional notification to the submitter when a work order is set to Long Term.',
      'On Hold can now be set from any work order status, not just In Progress.',
      'Added a status key to the Update Status dialog explaining what In Progress, On Hold, and Long Term mean.',
      'Added "Request Input" on the work order detail page — pull in a colleague for a second opinion without reassigning the work order. They\'re emailed and see it in a new panel at the top of their Work Orders list until they dismiss it, and their reply notifies you.',
      'The Work Orders list can now be sorted by location, category, or status (ascending or descending) in addition to the default newest-first order, including on mobile. Room numbers now sort in natural numeric order everywhere in the app instead of alphabetically (e.g. Room 9 before Room 10).',
      'Fixed the login page logo rendering in a solid white box in dark mode, and gave the login page a general dark-mode polish so the card reads as raised instead of sunken and the sign-in button is clearly the primary action.',
      'Replace generic error message in admin job logs with the actual error message, so you can see what went wrong without having to check the server logs.',
    ],
  },
  {
    version: '1.6.3',
    changes: [
      'Removed the "Not Listed" option from the Purchase Order Department/Program/School/District Office picker — it had no supervisor to route to, which blocked approval. Add missing departments/programs on the Locations & Supervisors admin page instead.',
      'Fixed the New Requisition page in dark mode: the vendor and ship-to address info boxes no longer render as solid white, and the Department/Program/School/District Office dropdown no longer shows a visible mismatch between its section headers and the items below them.',
      'Fixed the My Equipment table squeezing cell text onto one character per line at narrow window widths.',
      'Fixed the page not scrolling back to the top after selecting a different item from the sidebar menu.',
      'Work order submitters are now emailed (and pushed) when their work order is closed.',
      'Fixed the Tank label overlapping the placeholder text on the Log Fuel Entry page.',
      'Fixed the Technology/Maintenance request icons being invisible in dark mode on the New Work Order page.',
      'Fixed the back-to-top button never appearing when scrolling down a long page.',
      'Added Company Name to the user Provisioning process, so that the user\'s Microsoft Entra account is created with the correct company name.',
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
