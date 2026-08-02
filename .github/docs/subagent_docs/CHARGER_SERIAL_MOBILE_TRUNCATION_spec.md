# Spec: Fix charger serial number overflow on mobile Active Checkouts

## Current state analysis (verified against this repo)

- `frontend/src/pages/DeviceManagement/CheckoutPage.tsx:42` — `import type { DeviceAssignment, DeviceAssignmentUser } from '../../types/deviceAssignment.types';` (exact match to source record).
- `frontend/src/pages/DeviceManagement/CheckoutPage.tsx:184-192` — the `charger` column definition:
  ```tsx
  {
    key:    'charger',
    label:  'Charger',
    render: (r) => {
      const serial = r.chargerAssignment?.charger.serialNumber;
      return serial
        ? <span style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{serial}</span>
        : <span>—</span>;
    },
  },
  ```
- `frontend/src/pages/DeviceManagement/CheckoutPage.tsx:49` — `const isMobile = useIsMobile();` already exists and is already used for other branches on this page (line 280 `{isMobile ? (`), confirming the value is already available for reuse — no new media-query hook needed.
- Search filter at line 258-259 matches against the raw `r.chargerAssignment?.charger.serialNumber` data value, not any rendered/truncated string — confirms truncating the display will not affect search.
- `ResponsiveTable`/mobile card grid layout (`global.css` `.mobile-card__details`) is unmodified by this fix and not touched.

## Problem

`ResponsiveTable` renders each row as a `MobileCard` below 768px, laying detail fields out in a two-column grid (~160px per value at 390px viewport). The Charger column's `whiteSpace: 'nowrap'` inline style forces a full ~23-character serial (e.g. `8SSA10R16922C2TJ4140L1A`) onto one line, overflowing the card. Real serials share a long common prefix and differ only in their trailing characters, so any truncation must preserve the tail, not the head.

## Solution

Show only the last 10 characters of the serial on mobile (`isMobile === true`), prefixed with an ellipsis, with the full serial available via a `title` attribute. Desktop is untouched — full serial, unchanged rendering.

## Implementation steps

1. Above the `CheckoutPage` component in `frontend/src/pages/DeviceManagement/CheckoutPage.tsx` (after the `DeviceAssignment`/`DeviceAssignmentUser` type import at line 42), add a module-local constant and helper — not a shared util, since there is exactly one call site:
   ```tsx
   // Charger serials share a long common prefix — the trailing characters are what
   // distinguish one charger from another, so mobile shows only the tail.
   const CHARGER_SERIAL_TAIL_CHARS = 10;

   function chargerSerialDisplay(serial: string, truncate: boolean): string {
     return truncate && serial.length > CHARGER_SERIAL_TAIL_CHARS
       ? `…${serial.slice(-CHARGER_SERIAL_TAIL_CHARS)}`
       : serial;
   }
   ```
2. Update the `charger` column's `render` (lines 184-192) to pass the serial through the helper, gated on `isMobile`, with a `title` attribute holding the full serial:
   ```tsx
   {
     key:    'charger',
     label:  'Charger',
     render: (r) => {
       const serial = r.chargerAssignment?.charger.serialNumber;
       return serial
         ? (
           <span title={serial} style={{ fontFamily: 'monospace', whiteSpace: 'nowrap' }}>
             {chargerSerialDisplay(serial, isMobile)}
           </span>
         )
         : <span>—</span>;
     },
   },
   ```

## Dependencies

None.

## Configuration changes

None.

## Risks and mitigations

- **Risk:** truncation hides search-relevant characters. **Mitigation:** confirmed the search filter (line 258-259) reads the raw data value, not the rendered string — unaffected.
- **Risk:** desktop regression. **Mitigation:** `truncate` param is `isMobile`, which is `false` on desktop, so `chargerSerialDisplay` returns the serial verbatim — byte-identical to current desktop behavior.
- **Blast radius:** one column's `render` function plus one new module-local constant/helper in one file. No other pages that render charger serials (QuickCheckPage, BulkCheckinPage, DeviceDetailPage, InvoiceDetailPage) are touched — the reported bug was specific to Active Checkouts.
