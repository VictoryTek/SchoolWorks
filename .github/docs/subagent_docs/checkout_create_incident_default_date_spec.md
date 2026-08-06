# "Create Incident" from Active Checkouts Defaults to Checkout Date Instead of Today — Spec

## Current State Analysis

Per user screenshot: opening the Create Incident wizard from the "Create Incident" row action on
the Active Checkouts page (`CheckoutPage.tsx`) prefills "Date of Damage" with a stale past date
instead of today's date.

`CheckoutPage.tsx` has two separate places that navigate to `/incidents/new` with a `damageDate`
query param:
1. The row action button (`to={... &damageDate=${r.checkoutAt.slice(0, 10)}}`) — prefills the
   **checkout date** of that assignment. This is what the user's screenshot is showing (07/30/2026,
   an old checkout date, instead of today, 08/05/2026). The device may have been checked out weeks
   ago; the damage being reported now has no necessary relationship to that date, and defaulting to
   it silently plants a wrong date the tech has to notice and correct.
2. The check-in flow's "flag as damaged" path (inside the `CheckinForm` `onSuccess` callback) —
   already correctly defaults to **today** via `new Date().toISOString().slice(0, 10)`, though this
   has the same UTC-vs-local bug just fixed elsewhere in [[incident-wizard-damage-date-utc-bug]]
   (computes "today" in UTC, which can be a day off near midnight in US timezones).

## Problem Definition
The row-action "Create Incident" prefill should default `damageDate` to **today**, like the
check-in flow already (almost) does — not the checkout date, which has no bearing on when the
damage was actually noticed/reported. While fixing this, both call sites' "today" computation
should use the same timezone-safe technique already applied to the wizard's own date picker.

## Proposed Solution

`frontend/src/pages/DeviceManagement/CheckoutPage.tsx`:
- Add a small module-level `todayLocal()` helper (local `getFullYear()`/`getMonth()`/`getDate()`
  components — same technique as the fix in [[incident-wizard-damage-date-utc-bug]] and the
  existing precedent in `TransportationReportsPage.tsx`), mirroring the file's existing
  module-level helper style (`chargerSerialDisplay`).
- Row action link: replace `r.checkoutAt.slice(0, 10)` with `todayLocal()`.
- Check-in flow prefill: replace `new Date().toISOString().slice(0, 10)` with `todayLocal()` (same
  intent — today — now timezone-safe).

## Implementation Steps
1. Add `todayLocal()` to `CheckoutPage.tsx`.
2. Replace both `damageDate` prefill expressions with `todayLocal()`.
3. Add a changelog entry.

## Dependencies
None.

## Risks & Mitigations
- **Risk:** none — the tech can still change the prefilled date on the wizard's own Date of Damage
  field if the damage was actually noticed on a different day; this only changes the *default*.

## Files to Modify
- `frontend/src/pages/DeviceManagement/CheckoutPage.tsx`
- `frontend/src/changelog.ts`
