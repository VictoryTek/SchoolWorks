# Mobile UI Changes — Batch 2 Spec

## Current State Analysis

After the Batch 1 mobile fixes (15 files), the following pages still have mobile layout issues:
- Tab bars that overflow on narrow screens (no native `<select>` fallback)
- Wide data tables with no mobile card alternative
- Hard `maxWidth` constraints that waste screen real estate on mobile

All affected files are frontend-only. No backend, Prisma schema, migration, or auth changes required.

## Problem Definition

Seven files need surgical mobile-first fixes following the same pattern established in Batch 1:
- `isMobile ? (<mobile JSX>) : (<desktop JSX>)` branching
- Native `<select>` replaces `<Tabs>` on mobile
- Card list replaces `<Table>` on mobile for data-heavy pages
- Remove maxWidth constraints on full-width listing pages

## Implementation Plan

### 1. `frontend/src/pages/admin/AdminSettings.tsx`

**Issue:** 6-tab `<Tabs>` bar (General / Requisitions & POs / Fiscal Year / Jobs / Email Queue / Backup) with no mobile fallback.

**Fix (lines 301–317):**
- `useIsMobile` is already imported (line 61) but not called in `AdminSettings`.
- Add `const isMobile = useIsMobile();` after the `activeTab` state declaration.
- Replace the `<Box sx={{ borderBottom... }}>...<Tabs>...</Tabs></Box>` block with:
  ```tsx
  {isMobile ? (
    <Box sx={{ mb: 3 }}>
      <select
        value={activeTab}
        onChange={(e) => {
          const v = Number(e.target.value);
          setActiveTab(v);
          navigate({ hash: TAB_HASHES[v] }, { replace: true });
        }}
        className="form-select"
        style={{ width: '100%' }}
      >
        <option value={0}>General</option>
        <option value={1}>Requisitions &amp; POs</option>
        <option value={2}>Fiscal Year</option>
        <option value={3}>Jobs</option>
        <option value={4}>Email Queue</option>
        <option value={5}>Backup</option>
      </select>
    </Box>
  ) : (
    <Box sx={{ borderBottom: 1, borderColor: 'divider', mb: 3 }}>
      <Tabs variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile ...>
        ...
      </Tabs>
    </Box>
  )}
  ```

---

### 2. `frontend/src/pages/ReferenceDataManagement.tsx`

**Issue:** 8-tab `<Tabs>` bar (Brands / Vendors / Categories / Models / Funding Sources / Locations / Rooms / WO Categories) with no mobile fallback.

**Fix (lines 1343–1361):**
- `useIsMobile` is already imported (line 42) but not called in the main `ReferenceDataManagement` component.
- Add `const isMobile = useIsMobile();` after the `searchParams` / `tab` declarations.
- Replace the `<Box sx={{ borderBottom... }}>...<Tabs>...</Tabs></Box>` block with an isMobile branch:
  - Mobile: `<Box sx={{ mb: 2 }}><select value={tab} onChange={(e) => setSearchParams({ tab: TAB_NAMES[Number(e.target.value)] })}>` with 8 options.
  - Desktop: existing `<Tabs>` unchanged.

---

### 3. `frontend/src/pages/admin/AdminEmailQueueTab.tsx`

**Issue:** 9-column table (Recipients / Subject / Status / Context / Attempts / Last Error / Created / Sent / Actions) with no mobile alternative.

**Fix:**
- Add `import { useIsMobile } from '@/hooks/useResponsive';`
- Add `const isMobile = useIsMobile();` at top of component.
- Replace the `{!listLoading && !listError && listData && (<>TableContainer ... Pagination</>)}` block with a conditional:
  - Mobile card per email item: recipient + status chip on top line; subject below; context + attempts + last error as small text; created/sent dates; Retry icon button if `status === 'failed'`.
  - Desktop: existing `TableContainer` unchanged.
- `TablePagination` stays outside both branches (always rendered).

---

### 4. `frontend/src/pages/Transportation/index.tsx`

**Issue:** Two tables without mobile card alternatives:
- Level 1 view: "Recent Fuel Entries" (Date / Unit / Location / Amount / Mileage) — max 5 rows.
- Level 2+ view: "DOT Physical Alerts" (Driver / Expiration Date / Status) — variable rows.

**Fix:**
- Add `import { useIsMobile } from '@/hooks/useResponsive';`
- Add `const isMobile = useIsMobile();` in `TransportationDashboardPage`.
- Level 1 fuel table: wrap `TableContainer` with `{isMobile ? (<compact card list>) : (<TableContainer>)}`.
  - Mobile card: date + unit number on first line, location on second, amount + mileage on third.
- Level 2+ DOT table: wrap `TableContainer` with `{isMobile ? (<compact card list>) : (<TableContainer>)}`.
  - Mobile card: driver name + status chip + expiry date per row, each as a `Paper variant="outlined"` line.

---

### 5. `frontend/src/pages/DeviceManagement/UserCheckoutHistoryPage.tsx`

**Issue:** `maxWidth: 1200, mx: 'auto'` on outer `Box` prevents full-width use on mobile.

**Fix (line 111):**
- Change `<Box sx={{ p: { xs: 1, sm: 3 }, maxWidth: 1200, mx: 'auto' }}>` → `<Box sx={{ p: { xs: 1, sm: 3 } }}>`.

---

### 6. `frontend/src/pages/DeviceManagement/DeviceDetailPage.tsx`

**Issue:** `maxWidth: 1200, mx: 'auto'` on outer `Box`.

**Fix (line 229):**
- Change `<Box sx={{ p: { xs: 1, sm: 3 }, maxWidth: 1200, mx: 'auto' }}>` → `<Box sx={{ p: { xs: 1, sm: 3 } }}>`.

---

### 7. `frontend/src/pages/DeviceManagement/BulkCheckoutPage.tsx`

**Issue:** `maxWidth: 1400, mx: 'auto'` on outer `Box` of a wizard that should fill the screen.

**Fix (line 197):**
- Change `<Box sx={{ p: { xs: 2, sm: 3 }, maxWidth: 1400, mx: 'auto' }}>` → `<Box sx={{ p: { xs: 2, sm: 3 } }}>`.

---

## Out of Scope

- `admin/AdminBackupTab.tsx` — already has adequate `display: { xs: 'none', sm: 'table-cell' }` handling with inline sub-caption for size/date on mobile. No change needed.
- `admin/ProvisioningPage.tsx` — part of in-progress provisioning work; separate commit.
- All maxWidth values ≤ 900 — these are narrow wizard/form flows where a width cap is intentional.

## Dependencies

No new dependencies. Pattern copies Batch 1 (`useIsMobile`, native `<select>`, MUI `Paper`/`Chip` already imported in affected files or added where needed).

## Risks & Mitigations

- AdminSettings tab hash sync: select onChange manually calls `navigate({ hash: TAB_HASHES[v] })` to preserve deep-linking. Verified against the existing `handleTabChange` logic.
- ReferenceDataManagement uses search-param tab routing: select onChange calls `setSearchParams({ tab: TAB_NAMES[v] })` — same mechanism as the existing `handleTabChange`.
- AdminEmailQueueTab pagination: `TablePagination` is kept outside the mobile/desktop branch so it renders in both views.
