# Mobile UI Changes — Test Environment Log

Changes validated in the test environment to be applied to the live project.
Each entry includes the file, what changed, and the exact code to apply.

---

## 1. Inventory Management — Action Button Layout (Mobile)

**File:** `frontend/src/pages/InventoryManagement.tsx`

**What changed:**
On mobile, the action button bar is removed from its card wrapper and rendered
as a priority-driven column directly below the page heading. The layout is:

```
[             + Add Item             ]
[ ⬆️ Import        ] [ ⬇️ Export    ]
                                  [ 🔄 ]
```

- **Add Item** is full-width — highest-priority action, impossible to miss
- **Import / Export** share a flex row with equal width (`flex: 1`)
- **Refresh** is icon-only, right-aligned on its own row below Import/Export
- No card wrapper on mobile — buttons float directly under the heading
- Desktop layout (card + `space-between` flex row) is unchanged

**How to apply:**

In the JSX return, locate the `{/* Action Buttons */}` comment. Replace the
existing single `<div className="card mb-6">` block with a conditional that
branches on `isMobile` (the `isMobile` hook is already used in the file):

```tsx
{/* Action Buttons */}
{isMobile ? (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
    <button onClick={handleCreate} className="btn btn-primary" style={{ width: '100%' }}>
      + Add Item
    </button>
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      <button onClick={() => setImportDialogOpen(true)} className="btn btn-secondary" style={{ flex: 1 }}>
        ⬆️ Import
      </button>
      <button
        onClick={handleExport}
        className="btn btn-secondary"
        disabled={exportMutation.isPending}
        style={{ flex: 1 }}
      >
        {exportMutation.isPending ? '⏳...' : '⬇️ Export'}
      </button>
    </div>
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <button onClick={() => refetch()} className="btn btn-ghost btn-sm" title="Refresh">
        🔄
      </button>
    </div>
  </div>
) : (
  <div className="card mb-6">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem' }}>
      <button onClick={() => refetch()} className="btn btn-ghost btn-sm" title="Refresh">
        🔄 Refresh
      </button>
      <div style={{ display: 'flex', gap: '0.75rem' }}>
        <button onClick={() => setImportDialogOpen(true)} className="btn btn-secondary">
          ⬆️ Import
        </button>
        <button
          onClick={handleExport}
          className="btn btn-secondary"
          disabled={exportMutation.isPending}
        >
          {exportMutation.isPending ? '⏳ Exporting...' : '⬇️ Export Excel'}
        </button>
        <button onClick={handleCreate} className="btn btn-primary">
          + Add Item
        </button>
      </div>
    </div>
  </div>
)}
```

---

## 2. Inventory Management — Hide Stats Cards on Mobile

**File:** `frontend/src/pages/InventoryManagement.tsx`

**What changed:**
The four summary stat cards (Total Items, Active, Disposed, Total Value) are
hidden on mobile. They consumed significant vertical space before the user
could reach the inventory list, and the data is accessible by scrolling the
table on mobile anyway.

**How to apply:**

Locate the `{/* Stats Cards */}` comment. Change the condition from:

```tsx
{stats && (
```

to:

```tsx
{stats && !isMobile && (
```

No other changes to the stats block are needed.

---

## 3. Disposed Equipment — Action Button Layout (Mobile)

**File:** `frontend/src/pages/DisposedEquipment.tsx`

**What changed:**
On mobile, the action bar card is removed and replaced with a bare column
layout directly below the page heading. The layout is:

```
[             ⬇️ Export Excel          ]
                                    [ 🔄 ]
```

- **Export Excel** is full-width
- **Refresh** is icon-only, right-aligned on its own row below
- No card wrapper on mobile — buttons float directly under the heading
- Desktop layout (card + `space-between` flex row) is unchanged

**How to apply:**

Locate the `{/* Action Bar */}` comment. Replace the existing
`<div className="card mb-6">` block with:

```tsx
{/* Action Bar */}
{isMobile ? (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginBottom: '1.5rem' }}>
    <button
      onClick={handleExport}
      className="btn btn-secondary"
      disabled={exporting}
      style={{ width: '100%' }}
    >
      {exporting ? '⏳ Exporting...' : '⬇️ Export Excel'}
    </button>
    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
      <button onClick={fetchDisposedItems} className="btn btn-ghost btn-sm" title="Refresh">
        🔄
      </button>
    </div>
  </div>
) : (
  <div className="card mb-6">
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
      <button onClick={fetchDisposedItems} className="btn btn-ghost btn-sm" title="Refresh">
        🔄 Refresh
      </button>
      <button onClick={handleExport} className="btn btn-secondary" disabled={exporting}>
        {exporting ? '⏳ Exporting...' : '⬇️ Export Excel'}
      </button>
    </div>
  </div>
)}
```

Note: `isMobile` is already imported and in scope in this file via `useIsMobile()`.

---

## 4. Bulk Dispose Equipment — Combine Filter Cards on Mobile

**File:** `frontend/src/pages/BulkDeleteDisposedPage.tsx`

**What changed:**
On desktop the page has two separate filter cards — "Select Model to Dispose"
and "Office Location". On mobile these are merged into a single card with both
dropdowns stacked vertically, saving a full card's worth of vertical space.
The Clear Filters button stays at the bottom of the combined card. The
`maxWidth: '32rem'` constraint on both inputs is removed on mobile so they
fill the card width. Desktop layout (two separate cards) is unchanged.

**How to apply:**

1. Add the import at the top of the file (after the existing `useState` import line):
```tsx
import { useIsMobile } from '../hooks/useResponsive';
```

2. Add the hook inside the component body (after the last `useState` call):
```tsx
const isMobile = useIsMobile();
```

3. Locate the two filter card blocks under `{/* Primary Filter - Model Selection */}`
and `{/* Secondary Filters */}`. Replace both with:

```tsx
{/* Filters */}
{isMobile ? (
  <div className="card mb-6">
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <div>
        <label className="form-label" style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
          Select Model to Dispose{' '}
          <span style={{ color: 'var(--red-500, #ef4444)' }}>*</span>
        </label>
        <Autocomplete<EquipmentModel>
          options={models}
          getOptionLabel={(m) => m.name}
          getOptionKey={(m) => m.id}
          value={models.find((m) => m.id === selectedModelId) ?? null}
          onChange={(_e, m) => handleModelChange(m ? m.id : '')}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Search or select a model…"
              size="small"
              variant="outlined"
            />
          )}
        />
      </div>
      <div>
        <label className="form-label">Office Location</label>
        <select
          value={filters.officeLocationId}
          onChange={(e) => setFilters({ ...filters, officeLocationId: e.target.value })}
          className="form-select"
        >
          <option value="">All Locations</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>{loc.name}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleClearFilters} className="btn btn-secondary btn-sm">
          Clear Filters
        </button>
      </div>
    </div>
  </div>
) : (
  <>
    {/* Primary Filter - Model Selection */}
    <div className="card mb-6">
      <div>
        <label className="form-label" style={{ fontWeight: 600, fontSize: '0.9375rem' }}>
          Select Model to Dispose{' '}
          <span style={{ color: 'var(--red-500, #ef4444)' }}>*</span>
        </label>
        <Autocomplete<EquipmentModel>
          options={models}
          getOptionLabel={(m) => m.name}
          getOptionKey={(m) => m.id}
          value={models.find((m) => m.id === selectedModelId) ?? null}
          onChange={(_e, m) => handleModelChange(m ? m.id : '')}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          style={{ maxWidth: '32rem' }}
          renderInput={(params) => (
            <TextField
              {...params}
              placeholder="Search or select a model…"
              size="small"
              variant="outlined"
            />
          )}
        />
      </div>
    </div>

    {/* Secondary Filters */}
    <div className="card mb-6">
      <div>
        <label className="form-label">Office Location</label>
        <select
          value={filters.officeLocationId}
          onChange={(e) => setFilters({ ...filters, officeLocationId: e.target.value })}
          className="form-select"
          style={{ maxWidth: '32rem' }}
        >
          <option value="">All Locations</option>
          {locations.map((loc) => (
            <option key={loc.id} value={loc.id}>{loc.name}</option>
          ))}
        </select>
      </div>
      <div style={{ marginTop: '1rem', display: 'flex', justifyContent: 'flex-end' }}>
        <button onClick={handleClearFilters} className="btn btn-secondary btn-sm">
          Clear Filters
        </button>
      </div>
    </div>
  </>
)}
```

---

## 5. Purchase Orders — Tab Bar Replaced with Select Dropdown on Mobile

**File:** `frontend/src/pages/PurchaseOrders/PurchaseOrderList.tsx`

**What changed:**
The MUI `<Tabs variant="scrollable">` bar overflows the screen on mobile,
requiring horizontal scrolling to reach all tabs (up to 6 depending on role).
On mobile it is replaced with a full-width native `<select>` dropdown that
shows only the permission-filtered tabs. Selecting an option switches the
active tab and resets pagination, identical to clicking a tab. Desktop MUI
Tabs layout is unchanged.

**How to apply:**

Locate the `{/* ── Tabs ── */}` comment. Replace the existing `<Tabs>` block with:

```tsx
{/* ── Tabs ── */}
{isMobile ? (
  <Box sx={{ mb: 2 }}>
    <select
      value={activeTab}
      onChange={(e) => { setTab(e.target.value as TabKey); setPage(0); }}
      className="form-select"
      style={{ width: '100%' }}
    >
      {visibleTabs.map((t) => (
        <option key={t.key} value={t.key}>{t.label}</option>
      ))}
    </select>
  </Box>
) : (
  <Tabs
    value={activeTab}
    onChange={handleTabChange}
    variant="scrollable"
    scrollButtons="auto"
    allowScrollButtonsMobile
    sx={{ mb: 2 }}
  >
    {visibleTabs.map((t) => (
      <Tab key={t.key} value={t.key} label={t.label} />
    ))}
  </Tabs>
)}
```

Note: `isMobile`, `activeTab`, `visibleTabs`, `setTab`, and `setPage` are all
already in scope. No new imports required.

---

## 6. Field Trip Approvals — Tab Bar Replaced with Select Dropdown on Mobile

**File:** `frontend/src/pages/FieldTrip/FieldTripApprovalPage.tsx`

**What changed:**
The MUI `<Tabs>` bar with two tabs ("Field Trip Approvals" and "Transportation
Pending") is replaced on mobile with a full-width native `<select>` dropdown.
Selecting an option switches the active tab identically to clicking a tab.
Desktop MUI Tabs layout is unchanged.

**How to apply:**

Locate the `<Tabs>` block. Replace it with:

```tsx
{isMobile ? (
  <Box sx={{ mb: 2 }}>
    <select
      value={activeTab}
      onChange={(e) => setActiveTab(Number(e.target.value))}
      className="form-select"
      style={{ width: '100%' }}
    >
      <option value={0}>Field Trip Approvals</option>
      <option value={1}>Transportation Pending</option>
    </select>
  </Box>
) : (
  <Tabs
    value={activeTab}
    onChange={(_, v) => setActiveTab(v)}
    variant="scrollable"
    scrollButtons="auto"
    allowScrollButtonsMobile
    sx={{ mb: 2 }}
  >
    <Tab label="Field Trip Approvals" />
    <Tab label="Transportation Pending" icon={<DirectionsBusIcon fontSize="small" />} iconPosition="start" />
  </Tabs>
)}
```

Note: `isMobile` and `activeTab` are already in scope. No new imports required.
The existing mobile-specific `sx` tweaks on the `<Tabs>` block can also be
removed since the tabs are no longer rendered on mobile.

---

## 7. Device Management Dashboard — Consolidated Cards on Mobile + Button Removal

**Files:**
- `frontend/src/components/DeviceManagement/DashboardWidgets.tsx`
- `frontend/src/pages/DeviceManagement/index.tsx`

**What changed:**
Two changes to this page:

1. **Cart Assignment button removed** — the button did not belong on the
   dashboard and has been removed entirely along with its unused imports
   (`Button`, `ShoppingCartCheckoutIcon`, `useNavigate`).

2. **Mobile cards consolidated** — on mobile the 6 individual cards (3 stat
   cards + Damage Incidents + Top Damaged Models + Damage by Grade) are
   consolidated into 3 cards by grouping related sections together. The mobile
   layout is rendered as a completely separate branch from the desktop MUI Grid
   layout. Desktop is unchanged.

**Mobile before:** 6 full-width stacked cards requiring heavy scrolling.

**Mobile after:**
```
┌─────────────────────────────────────────┐
│ Active Checkouts               0        │  ← Card 1: all 3 stats as
│ ─────────────────────────────────────── │    a vertical list with
│ In Repair                      0        │    label left, value right,
│ ─────────────────────────────────────── │    separated by dividers
│ Outstanding Invoices       $0.00        │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ DAMAGE INCIDENTS — ACADEMIC YEAR        │  ← Card 2: monthly incident
│ [monthly grid]                          │    grid + top damaged models
│ ─────────────────────────────────────── │    in one card
│ TOP DAMAGED MODELS                      │
│ [model list]                            │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ DAMAGE BY GRADE — ACADEMIC YEAR         │  ← Card 3: grade bar chart
│ [bar chart]                             │    (unchanged)
└─────────────────────────────────────────┘
```

**How to apply — `index.tsx` (Cart Assignment button removal):**

Remove the `Button`, `ShoppingCartCheckoutIcon`, and `useNavigate` imports,
remove `const navigate = useNavigate();`, and replace the header `<Box>` with:

```tsx
<Box sx={{ mb: 2 }}>
  <Typography variant="h4" fontWeight={600}>
    Device Management Dashboard
  </Typography>
</Box>
```

---

**How to apply — `DashboardWidgets.tsx` (mobile consolidation):**

1. Add imports — `Divider` to the MUI import line and `useIsMobile`:
```tsx
import { Box, Card, CardContent, Chip, CircularProgress, Divider, Grid, Typography } from '@mui/material';
import { useIsMobile } from '../../hooks/useResponsive';
```

2. Add `const isMobile = useIsMobile();` inside the `DashboardWidgets` component body.

3. After the `if (!data) return null;` guard, add a mobile branch that returns
   early with the consolidated layout, then leave the existing `<Grid>` return
   as the desktop path:

```tsx
if (isMobile) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>

      {/* Card 1: All three stats as a vertical list */}
      <Card>
        <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
            <Typography variant="body1" color="text.secondary">Active Checkouts</Typography>
            <Typography variant="h6" fontWeight={700}>{data.activeCheckoutsCount}</Typography>
          </Box>
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
            <Typography variant="body1" color="text.secondary">In Repair</Typography>
            <Typography variant="h6" fontWeight={700}>{data.devicesInRepairCount}</Typography>
          </Box>
          <Divider />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 1 }}>
            <Typography variant="body1" color="text.secondary">Outstanding Invoices</Typography>
            <Typography variant="h6" fontWeight={700}>${parseFloat(data.outstandingInvoiceTotal).toFixed(2)}</Typography>
          </Box>
        </CardContent>
      </Card>

      {/* Card 2: Damage Incidents + Top Models */}
      <Card>
        <CardContent>
          <Typography variant="overline" color="text.secondary">
            Damage Incidents — Academic Year
          </Typography>
          {data.damageIncidentsThisYear.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              No incidents this academic year
            </Typography>
          ) : (
            <Box sx={{ mt: 2, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(52px, 1fr))', gap: 1 }}>
              {data.damageIncidentsThisYear.map(({ month, count }) => (
                <Box key={month} sx={{ textAlign: 'center', p: 1, borderRadius: 1, bgcolor: count > 0 ? 'error.50' : 'action.hover' }}>
                  <Typography variant="h6" fontWeight={700} color={count > 0 ? 'error.main' : 'text.primary'}>{count}</Typography>
                  <Typography variant="caption" color="text.secondary">{month.slice(5)}</Typography>
                </Box>
              ))}
            </Box>
          )}
          <Divider sx={{ my: 2 }} />
          <Typography variant="overline" color="text.secondary">Top Damaged Models</Typography>
          {data.topDamagedModels.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No data</Typography>
          ) : (
            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 1 }}>
              {data.topDamagedModels.map((m, i) => (
                <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography variant="body2">{m.brandName ? `${m.brandName} ${m.modelName}` : m.modelName}</Typography>
                  <Chip size="small" label={m.incidentCount} color="error" variant="outlined" />
                </Box>
              ))}
            </Box>
          )}
        </CardContent>
      </Card>

      {/* Card 3: Damage by Grade */}
      <Card>
        <CardContent>
          <Typography variant="overline" color="text.secondary">
            Damage by Grade — Academic Year
          </Typography>
          {gradeLoading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', mt: 2 }}><CircularProgress size={24} /></Box>
          ) : !gradeData || gradeData.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>No grade-level data this academic year</Typography>
          ) : (
            <Box sx={{ mt: 1, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {gradeData.map((row) => {
                const max = gradeData[0]?.incidentCount ?? 1;
                const pct = Math.round((row.incidentCount / max) * 100);
                return (
                  <Box key={row.gradeLevel} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2" sx={{ minWidth: 90 }}>{gradeLevelLabel(row.gradeLevel)}</Typography>
                    <Box sx={{ flex: 1, height: 12, borderRadius: 1, bgcolor: 'error.100', position: 'relative', overflow: 'hidden' }}>
                      <Box sx={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, bgcolor: 'error.main', borderRadius: 1 }} />
                    </Box>
                    <Chip size="small" label={row.incidentCount} color="error" variant="outlined" sx={{ minWidth: 32 }} />
                  </Box>
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>

    </Box>
  );
}

// ── Desktop layout (unchanged) ──────────────────────────────────────────────
return (
  // ... existing <Grid container> JSX unchanged
);
```

---

## 8. Checked-Out Carts — Card List Layout on Mobile

**File:** `frontend/src/pages/DeviceManagement/CheckedOutCartsPage.tsx`

**What changed:**
The MUI `<Table>` was unusable on mobile — even with hidden columns, the
remaining headers (Cart Tag/Name, Status, # Devices, Actions) caused severe
text wrapping. On mobile the table is replaced entirely with a card list.
Each cart renders as a `<Paper>` card showing the key info clearly. The
expanded device sub-table is also replaced with a compact list on mobile.
Desktop table layout is completely unchanged.

**Mobile card layout per cart:**
```
┌─────────────────────────────────────────┐
│ CART-001                   [Out]  [3]   │  ← tag + status chip + device count
│ Oak Hill Elementary                     │  ← location
│ John Smith                              │  ← assignee(s)
│ [Show devices (3) ▼]    [Return All]   │  ← expand toggle + action
│ ─────────────────────────────────────── │
│ ASSET-001   Chromebook 14  [Good] [Active] │  ← expanded device rows
└─────────────────────────────────────────┘
```

**How to apply:**

1. Add a `CartCard` mobile component above the existing `CartRow` component:

```tsx
function CartCard({ cart, onReturn, canReturn }: { cart: DeviceCartDetail; onReturn: (c: DeviceCartDetail) => void; canReturn: boolean }) {
  const [expanded, setExpanded] = useState(false);

  const primaryUser = cart.users?.find((u) => u.role === 'primary')?.user ?? cart.assignedToUser;
  const secondaryUsers = cart.users?.filter((u) => u.role === 'secondary').map((u) => u.user) ?? [];
  const assigneeDisplay = [
    primaryUser ? `${primaryUser.firstName ?? ''} ${primaryUser.lastName ?? ''}`.trim() : null,
    ...secondaryUsers.map((u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim()),
  ].filter(Boolean).join(', ') || '—';

  const itemCount = cart.items?.length ?? cart.itemCount;

  return (
    <Paper variant="outlined" sx={{ p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body1" fontFamily="monospace" fontWeight={700}>
          {cart.tagNumber ?? cart.name ?? cart.id.slice(0, 8)}
        </Typography>
        <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
          <CartStatusChip status={cart.status} />
          <Chip label={itemCount} size="small" variant="outlined" />
        </Box>
      </Box>
      {cart.location?.name && (
        <Typography variant="caption" color="text.secondary">{cart.location.name}</Typography>
      )}
      <Typography variant="caption" color="text.secondary">{assigneeDisplay}</Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
        <Button size="small" variant="text" onClick={() => setExpanded((v) => !v)}
          endIcon={expanded ? <KeyboardArrowUpIcon fontSize="small" /> : <KeyboardArrowDownIcon fontSize="small" />}
        >
          {expanded ? 'Hide devices' : `Show devices (${itemCount})`}
        </Button>
        {canReturn && cart.status !== 'returned' && (
          <Button size="small" variant="outlined" color="warning" onClick={() => onReturn(cart)}>
            Return All
          </Button>
        )}
      </Box>
      <Collapse in={expanded} timeout="auto" unmountOnExit>
        <DeviceSubTable items={cart.items ?? []} mobile />
      </Collapse>
    </Paper>
  );
}
```

2. Update `DeviceSubTable` to accept a `mobile` prop and render a compact list
   instead of a `<Table>` when `mobile` is true:

```tsx
function DeviceSubTable({ items, mobile }: { items: DeviceCartItemSummary[]; mobile?: boolean }) {
  // ...
  if (mobile) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, pt: 1 }}>
        {items.map((item) => {
          const eq = item.equipment;
          const condition = item.condition ?? eq.condition ?? null;
          const isAssigned = item.assignmentId !== null;
          return (
            <Box key={item.id} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', py: 0.5, borderBottom: '1px solid', borderColor: 'divider' }}>
              <Box>
                <Typography variant="body2" fontFamily="monospace" fontWeight={700}>{eq.assetTag}</Typography>
                <Typography variant="caption" color="text.secondary">{eq.name}</Typography>
              </Box>
              <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center' }}>
                {condition && <ConditionChip condition={condition} />}
                <Chip label={isAssigned ? 'Active' : 'Unassigned'} color={isAssigned ? 'success' : 'default'} size="small" variant="outlined" />
              </Box>
            </Box>
          );
        })}
      </Box>
    );
  }
  // ... existing <Table> return unchanged
}
```

3. In the main page render, replace the `<Paper variant="outlined">` table block
   with a conditional that renders `CartCard` list on mobile and the existing
   `<Table>` on desktop:

```tsx
{isMobile ? (
  <>
    {isLoading ? (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>Loading…</Typography>
    ) : displayedCarts.length === 0 ? (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>No checked-out carts found.</Typography>
    ) : (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {displayedCarts.map((cart) => (
          <CartCard key={cart.id} cart={cart} onReturn={setReturnTarget} canReturn={canReturn} />
        ))}
      </Box>
    )}
    {rawData && rawData.total > 0 && (
      <TablePagination ... />
    )}
  </>
) : (
  <Paper variant="outlined">
    {/* existing <Table> unchanged, with isMobile={false} hardcoded on CartRow */}
  </Paper>
)}
```

---

## 9. Incidents Page — Card List on Mobile + Full-Width Table on Desktop

**File:** `frontend/src/pages/incidents/IncidentsPage.tsx`

**What changed:**
Two fixes:

1. **Desktop** — the outer `Box` had `maxWidth: 1200, mx: 'auto'` constraining
   the table to a narrow centred column. Removed so the table fills the page
   width like the rest of the app.

2. **Mobile** — the table had `minWidth: 700` causing a horizontal scrollbar.
   On mobile it is replaced with a card list. Each card shows the incident
   number, workflow status chip, device/user line, type chip, intent chip, and
   damage date. Tapping a card navigates to the detail page.

**Mobile card layout per incident:**
```
┌─────────────────────────────────────────┐
│ INC-001                  [In Repair]    │  ← number + workflow chip
│ ASSET-042 — HP Chromebook 14           │  ← device or user
│ [💻 Device] [Accidental]     01/10/2025 │  ← type + intent + damage date
└─────────────────────────────────────────┘
```

**How to apply:**

**Desktop fix** — remove `maxWidth` and `mx` from the outer `Box`:
```tsx
// Before
<Box sx={{ p: { xs: 1.5, sm: 3 }, maxWidth: 1200, mx: 'auto' }}>

// After
<Box sx={{ p: { xs: 1.5, sm: 3 } }}>
```

**Mobile fix:**

1. Add import:
```tsx
import { useIsMobile } from '../../hooks/useResponsive';
```

2. Add `const isMobile = useIsMobile();` inside the component body.

3. In the render, after the `isLoading` / `isError` checks, add a mobile branch
   before the existing `<Paper>` table block:

```tsx
{isLoading ? (
  <CircularProgress />
) : isError ? (
  <Alert severity="error">Failed to load incidents.</Alert>
) : isMobile ? (
  <>
    {rows.length === 0 ? (
      <Typography variant="body2" color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        No incidents found.
      </Typography>
    ) : (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
        {rows.map((row: DamageIncident) => (
          <Paper key={row.id} variant="outlined" sx={{ p: 1.5, cursor: 'pointer' }} onClick={() => navigate(`/incidents/${row.id}`)}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="body1" fontWeight={700}>{row.incidentNumber ?? '—'}</Typography>
              <WorkflowStepChip step={row.workflowStep} />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {row.equipment
                ? `${row.equipment.assetTag} — ${row.equipment.name}`
                : row.user ? `${row.user.firstName} ${row.user.lastName}` : '—'}
            </Typography>
            <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mt: 1, flexWrap: 'wrap' }}>
              <Chip label={row.equipment ? '💻 Device' : '👤 User'} size="small" color={row.equipment ? 'info' : 'secondary'} variant="outlined" />
              <IntentChip intent={row.intent} />
              <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                {row.damageDate ? new Date(row.damageDate).toLocaleDateString() : '—'}
              </Typography>
            </Box>
          </Paper>
        ))}
      </Box>
    )}
    <TablePagination ... />
  </>
) : (
  <Paper variant="outlined">
    {/* existing <Table> unchanged */}
  </Paper>
)}
```

---

## 10. Active Checkouts Page — Full-Width Table on Desktop

**File:** `frontend/src/pages/DeviceManagement/CheckoutPage.tsx`

**What changed:**
The outer `Box` had `maxWidth: 1400, mx: 'auto'` constraining the table to a
narrow centred column on desktop. Removed so the table fills the page width.

**How to apply:**
```tsx
// Before
<Box sx={{ p: { xs: 1, sm: 3 }, maxWidth: 1400, mx: 'auto' }}>

// After
<Box sx={{ p: { xs: 1, sm: 3 } }}>
```

---

## 11. Device Management Reports — Tabs → Dropdown + Cards on Mobile

**File:** `frontend/src/pages/DeviceManagement/ReportsPage.tsx`

**What changed:**
Two separate mobile fixes:
1. The 5-tab `<Tabs>` report selector caused horizontal overflow on mobile — replaced with a native `<select>`.
2. All four report tables (Active Checkouts, Damage Summary, Repair Costs, Grade Level Summary) are replaced with card lists on mobile. Invoice Aging was already cards and is unchanged.
Desktop layout is completely unchanged throughout.

**How to apply:**

1. Add `useIsMobile` import:
```tsx
import { useIsMobile } from '../../hooks/useResponsive';
```

2. Add `const isMobile = useIsMobile();` inside the component (alongside
   `useAuthStore` calls).

3. Replace the `{/* Report selector */}` block:
```tsx
{/* Report selector */}
{isMobile ? (
  <Box sx={{ mb: 2 }}>
    <select
      value={selectedReport ?? ''}
      onChange={(e) => setSelectedReport((e.target.value as ReportType) || null)}
      className="form-select"
      style={{ width: '100%' }}
    >
      <option value="">Select a report…</option>
      <option value="active-checkouts">Active Checkouts by Campus</option>
      <option value="damage-summary">Damage Summary</option>
      <option value="repair-costs">Repair Costs by Vendor</option>
      <option value="invoice-aging">Invoice Aging</option>
      <option value="grade-level-summary">By Grade Level</option>
    </select>
  </Box>
) : (
  <Tabs
    value={selectedReport ?? false}
    onChange={(_e, val: ReportType) => setSelectedReport(val)}
    sx={{ mb: 2 }}
    variant="scrollable"
    scrollButtons="auto"
    allowScrollButtonsMobile
  >
    <Tab label="Active Checkouts by Campus" value="active-checkouts" />
    <Tab label="Damage Summary"             value="damage-summary" />
    <Tab label="Repair Costs by Vendor"     value="repair-costs" />
    <Tab label="Invoice Aging"              value="invoice-aging" />
    <Tab label="By Grade Level"             value="grade-level-summary" />
  </Tabs>
)}
```

4. For each report table, wrap with `isMobile ? (<card list>) : (<table>)`.

**Active Checkouts — mobile card per item:**
```tsx
{isMobile ? (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    {group.items.map(item => (
      <Paper key={item.id} variant="outlined" sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
          <Typography variant="body1" fontFamily="monospace" fontWeight={700}>
            {item.equipment?.assetTag ?? '—'}
          </Typography>
          {item.status === 'Checked In' ? (
            <Chip label="Checked In" color="success" size="small" />
          ) : (
            <Chip label="Checked Out" color="warning" size="small" />
          )}
        </Box>
        <Typography variant="body2" color="text.secondary">{item.equipment?.name ?? '—'}</Typography>
        {item.user && (
          <Typography variant="body2" color="text.secondary">
            {item.user.firstName} {item.user.lastName}
          </Typography>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Out: {new Date(item.checkoutAt).toLocaleDateString()}
          </Typography>
          {item.returnedAt && (
            <Typography variant="caption" color="text.secondary">
              In: {new Date(item.returnedAt).toLocaleDateString()}
            </Typography>
          )}
        </Box>
      </Paper>
    ))}
  </Box>
) : (
  // ... existing <Table> unchanged
)}
```

**Damage Summary — mobile card per row:**
```tsx
isMobile ? (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    {damageSummary.map((row, i) => (
      <Paper key={i} variant="outlined" sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box>
          <Typography variant="body2" fontWeight={600}>{row.damageType}</Typography>
          <Typography variant="caption" color="text.secondary">{row.severity}</Typography>
        </Box>
        <Chip label={row.count} size="small" variant="outlined" />
      </Paper>
    ))}
  </Box>
) : (/* table */)
```

**Repair Costs — mobile card per vendor:**
```tsx
isMobile ? (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    {repairCosts.map((row, i) => (
      <Paper key={i} variant="outlined" sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography variant="body2" fontWeight={600}>{row.vendorName}</Typography>
        <Box sx={{ textAlign: 'right' }}>
          <Typography variant="body2" fontWeight={700}>${row.totalCost.toFixed(2)}</Typography>
          <Typography variant="caption" color="text.secondary">{row.ticketCount} ticket{row.ticketCount !== 1 ? 's' : ''}</Typography>
        </Box>
      </Paper>
    ))}
  </Box>
) : (/* table */)
```

**Grade Level Summary — mobile card per grade:**
```tsx
isMobile ? (
  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
    {gradeSummary.map((row: GradeLevelSummaryItem) => (
      <Paper key={row.gradeLevel} variant="outlined" sx={{ p: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
          <Chip label={gradeLevelLabel(row.gradeLevel)} size="small" color="primary" variant="outlined" />
          <Chip label={`${row.incidentCount} incident${row.incidentCount !== 1 ? 's' : ''}`} size="small" variant="outlined" />
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
          <Box>
            <Typography variant="caption" color="text.secondary" display="block">Repair Cost</Typography>
            <Typography variant="body2" fontWeight={600}>${row.totalRepairCost}</Typography>
          </Box>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary" display="block">Outstanding</Typography>
            <Typography variant="body2" fontWeight={600}>${row.outstandingInvoiceTotal}</Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Typography variant="caption" color="text.secondary" display="block">Avg / Incident</Typography>
            <Typography variant="body2" fontWeight={600}>${row.avgCostPerIncident}</Typography>
          </Box>
        </Box>
      </Paper>
    ))}
  </Box>
) : (/* table */)
```

---

## 12. Intune Device Actions — Tabs → Dropdown on Mobile

**File:** `frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx`

**What changed:**
The 5-tab `<Tabs>` mode selector (By Device Model, Scan/Search by Name, History,
Reconciliation, BitLocker) caused horizontal overflow on mobile. On mobile it is
replaced with a native `<select>`. The `tab` state is numeric (`0–4`), so
`onChange` uses `Number(e.target.value)`. The same side-effects (`loadHistory`,
`setResults(null)`, `setIsDryRun(true)`) are preserved. Desktop `<Tabs>` unchanged.

**How to apply:**

1. Add `useIsMobile` import:
```tsx
import { useIsMobile } from '../../hooks/useResponsive';
```

2. Add `const isMobile = useIsMobile();` at the top of the component.

3. Replace the `{/* Mode tabs */}` block:
```tsx
{/* Mode tabs */}
{isMobile ? (
  <Box sx={{ mb: 2 }}>
    <select
      value={tab}
      onChange={(e) => {
        const v = Number(e.target.value) as 0 | 1 | 2 | 3 | 4;
        if (v === 1 || v === 2) setHistoryEntries(loadHistory());
        setTab(v);
        setResults(null);
        setIsDryRun(true);
      }}
      className="form-select"
      style={{ width: '100%' }}
    >
      <option value={0}>By Device Model</option>
      <option value={1}>Scan / Search by Name</option>
      <option value={2}>History</option>
      <option value={3}>Reconciliation</option>
      <option value={4}>BitLocker</option>
    </select>
  </Box>
) : (
  <Tabs
    value={tab}
    onChange={(_, v) => {
      if (v === 1 || v === 2) setHistoryEntries(loadHistory());
      setTab(v as 0 | 1 | 2 | 3 | 4);
      setResults(null);
      setIsDryRun(true);
    }}
    sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}
  >
    <Tab label="By Device Model" />
    <Tab label="Scan / Search by Name" />
    <Tab label="History" />
    <Tab label="Reconciliation" />
    <Tab label="BitLocker" />
  </Tabs>
)}
```

---

## 13. DOT Physicals — Tabs → Dropdown on Mobile

**File:** `frontend/src/pages/Transportation/DotPhysicalsPage.tsx`

**What changed:**
The 4-tab filter (All, Valid, Expiring Soon, Expired) caused horizontal overflow
on mobile. `useIsMobile` was already imported. On mobile the `<Tabs>` is replaced
with a native `<select>` inside the same `<Paper>` wrapper. The `tab` state is
`TabValue` (string union), so `onChange` casts `e.target.value as TabValue`.
Desktop `<Tabs>` is completely unchanged.

**How to apply:**

Replace the `<Paper>` opening + `<Tabs>` block:
```tsx
<Paper>
  {isMobile ? (
    <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
      <select
        value={tab}
        onChange={(e) => { setTab(e.target.value as TabValue); setPage(0); }}
        className="form-select"
        style={{ width: '100%' }}
      >
        <option value="all">All</option>
        <option value="valid">Valid</option>
        <option value="expiring_soon">Expiring Soon</option>
        <option value="expired">Expired</option>
      </select>
    </Box>
  ) : (
    <Tabs
      value={tab}
      onChange={(_, v) => { setTab(v); setPage(0); }}
      sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
      variant="scrollable"
      scrollButtons="auto"
    >
      <Tab label="All" value="all" />
      <Tab label="Valid" value="valid" />
      <Tab label="Expiring Soon" value="expiring_soon" iconPosition="end" />
      <Tab label="Expired" value="expired" />
    </Tabs>
  )}
```

---

## 14. Driver Licenses — Tabs → Dropdown on Mobile

**File:** `frontend/src/pages/Transportation/DriverLicensePage.tsx`

**What changed:**
The 4-tab filter (All, Active, Expiring Soon, Expired) caused horizontal overflow
on mobile. `useIsMobile` and `isMobile` were already in the file. On mobile the
`<Tabs>` is replaced with a native `<select>` inside the same `<Paper>` wrapper.
`TabValue` is a string union so `onChange` casts `e.target.value as TabValue`.
Desktop `<Tabs>` is completely unchanged.

**How to apply:**

Replace the `{/* Status filter tabs */}` block inside `<Paper>`:
```tsx
{isMobile ? (
  <Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>
    <select
      value={tab}
      onChange={(e) => { setTab(e.target.value as TabValue); setPage(0); }}
      className="form-select"
      style={{ width: '100%' }}
    >
      <option value="all">All</option>
      <option value="active">Active</option>
      <option value="expiring_soon">Expiring Soon</option>
      <option value="expired">Expired</option>
    </select>
  </Box>
) : (
  <Tabs
    value={tab}
    onChange={(_, v) => { setTab(v as TabValue); setPage(0); }}
    sx={{ borderBottom: '1px solid', borderColor: 'divider' }}
    variant="scrollable"
    scrollButtons="auto"
  >
    <Tab label="All"           value="all" />
    <Tab label="Active"        value="active" />
    <Tab label="Expiring Soon" value="expiring_soon" />
    <Tab label="Expired"       value="expired" />
  </Tabs>
)}
```

---

## 15. Transportation Settings — Fix Enable/Disable Label Word Wrap

**File:** `frontend/src/pages/Transportation/TransportationSettingsPage.tsx`

**What changed:**
All four `FormControlLabel` toggle switches (DOT Physical Reminders, Driver
License Notifications, Monthly Fuel Report, Gas Threshold) had their "Enabled" /
"Disabled" label text wrapping onto multiple lines on mobile due to limited
horizontal space in the card header row. Added `sx={{ whiteSpace: 'nowrap' }}`
to each `FormControlLabel` to prevent wrapping.

**How to apply:**

Add `sx={{ whiteSpace: 'nowrap' }}` to each of the four `FormControlLabel`
elements that render the enable/disable toggle:
```tsx
<FormControlLabel
  control={<Switch checked={...} onChange={...} />}
  label={enabled ? 'Enabled' : 'Disabled'}
  sx={{ whiteSpace: 'nowrap' }}
/>
```
Apply to: `dotEnabled`, `licenseEnabled`, `monthlyEnabled`, `thresholdEnabled`.

---

## Notes

- `isMobile` comes from the `useIsMobile()` hook, already imported in all
  affected files. No new imports are required for any of these changes.
- Desktop behaviour is unaffected by all changes.

---

## Apply-to-Live Prompt

> Copy and paste the following prompt to Claude to apply all 15 UI/UX changes to the live project.

---

```
Apply the following 15 mobile UI/UX changes to the project. Each change is
surgical — touch only the described code, match the existing file style, and do
not refactor anything unrelated. All changes are frontend-only. No backend, no
Prisma, no migrations, no auth changes, no seed data.

The `useIsMobile()` hook lives at `frontend/src/hooks/useResponsive.ts` and is
already imported in most of the affected files. Where noted, add the import.

---

### 1. frontend/src/pages/InventoryManagement.tsx — Mobile action button layout

On mobile, remove the card wrapper from the action buttons and render them as a
priority column directly below the heading:
- "Add Item" — full-width button
- "Import" and "Export" — side-by-side flex row, each flex:1
- "Refresh" — icon-only, right-aligned on its own row

Branch on `isMobile` (already in scope). Desktop card layout is unchanged.

---

### 2. frontend/src/pages/InventoryManagement.tsx — Hide stats cards on mobile

Change the condition that renders the four summary stat cards from:
  `{stats && (`
to:
  `{stats && !isMobile && (`

---

### 3. frontend/src/pages/DisposedEquipment.tsx — Mobile action button layout

On mobile, remove the card wrapper from the action bar and render a bare column:
- "Export Excel" — full-width button
- "Refresh" — icon-only, right-aligned on its own row below

Branch on `isMobile` (already in scope). Desktop layout unchanged.

---

### 4. frontend/src/pages/BulkDeleteDisposedPage.tsx — Combine filter cards on mobile

Add `import { useIsMobile } from '../hooks/useResponsive';` and
`const isMobile = useIsMobile();` inside the component.

On mobile, merge the two filter cards ("Select Model to Dispose" and
"Office Location") into one card with both dropdowns stacked vertically and
the Clear Filters button at the bottom. Remove the `maxWidth: '32rem'` style
from the Autocomplete and select on mobile. Desktop (two separate cards) unchanged.

---

### 5. frontend/src/pages/PurchaseOrders/PurchaseOrderList.tsx — Tabs → select on mobile

Replace the `<Tabs variant="scrollable">` block with:
- Mobile: a full-width native `<select>` iterating `visibleTabs`, with
  `onChange` calling `setTab(e.target.value as TabKey)` and `setPage(0)`.
- Desktop: existing `<Tabs>` unchanged.

`isMobile`, `activeTab`, `visibleTabs`, `setTab`, and `setPage` are already in scope.

---

### 6. frontend/src/pages/FieldTrip/FieldTripApprovalPage.tsx — Tabs → select on mobile

Replace the `<Tabs>` block (2 tabs: "Field Trip Approvals", "Transportation Pending") with:
- Mobile: full-width native `<select>` with `value={activeTab}` and
  `onChange={(e) => setActiveTab(Number(e.target.value))}`.
- Desktop: existing `<Tabs>` unchanged.

`isMobile` and `activeTab` are already in scope.

---

### 7a. frontend/src/pages/DeviceManagement/index.tsx — Remove Cart Assignment button

Remove the "Cart Assignment" Button and its unused imports (`Button`,
`ShoppingCartCheckoutIcon`, `useNavigate`) and the `const navigate` declaration.
Replace the header Box with:
```tsx
<Box sx={{ mb: 2 }}>
  <Typography variant="h4" fontWeight={600}>
    Device Management Dashboard
  </Typography>
</Box>
```

---

### 7b. frontend/src/components/DeviceManagement/DashboardWidgets.tsx — Consolidated mobile cards

Add `Divider` to the MUI imports and add:
```tsx
import { useIsMobile } from '../../hooks/useResponsive';
```
Add `const isMobile = useIsMobile();` inside the component.

After the `if (!data) return null;` guard, add an early-return mobile branch
that renders 3 consolidated cards:
- Card 1: Active Checkouts / In Repair / Outstanding Invoices as a vertical
  label-left value-right list with horizontal Dividers between rows.
- Card 2: Damage Incidents monthly grid + Top Damaged Models combined.
- Card 3: Damage by Grade bar chart (same as desktop content).

Leave the existing `<Grid container>` desktop return completely unchanged below.

---

### 8. frontend/src/pages/DeviceManagement/CheckedOutCartsPage.tsx — Card list on mobile

Add a `CartCard` component above `CartRow` that renders each cart as a
`<Paper variant="outlined">` card showing: tag (monospace bold) + status chip +
device count chip, location, assignee, expand toggle button, and Return All
button. Expanding shows a `<DeviceSubTable mobile />`.

Update `DeviceSubTable` to accept `mobile?: boolean` and render a compact
`<Box>` list (asset tag + name + condition chip + status chip per row) when
`mobile` is true.

In the main render, branch on `isMobile`:
- Mobile: card list using `CartCard` + `TablePagination`.
- Desktop: existing `<Paper><Table>` unchanged (pass `isMobile={false}` to CartRow).

---

### 9. frontend/src/pages/incidents/IncidentsPage.tsx — Cards on mobile + full-width desktop

Desktop fix: remove `maxWidth: 1200` and `mx: 'auto'` from the outer `Box`.

Mobile fix: `useIsMobile` is already imported. Add `const isMobile = useIsMobile();`.
After the `isLoading` / `isError` checks, add an `isMobile` branch that renders
a card list. Each card: incident number (bold) + WorkflowStepChip top row,
device/user line, then type chip + IntentChip + damage date. Tapping navigates
to `/incidents/${row.id}`. Desktop `<Paper><Table>` unchanged.

---

### 10. frontend/src/pages/DeviceManagement/CheckoutPage.tsx — Full-width desktop table

Remove `maxWidth: 1400` and `mx: 'auto'` from the outer `Box`:
```tsx
// Before
<Box sx={{ p: { xs: 1, sm: 3 }, maxWidth: 1400, mx: 'auto' }}>
// After
<Box sx={{ p: { xs: 1, sm: 3 } }}>
```

---

### 11. frontend/src/pages/DeviceManagement/ReportsPage.tsx — Tabs → select + cards on mobile

Add `import { useIsMobile } from '../../hooks/useResponsive';`, add
`const isMobile = useIsMobile();`, and add `Paper` to the MUI imports.

Replace the `<Tabs>` report selector with a mobile `<select>` / desktop `<Tabs>` branch.
Options: Active Checkouts by Campus, Damage Summary, Repair Costs by Vendor,
Invoice Aging, By Grade Level. `selectedReport` is a string or null; the select
`onChange` casts the value to `ReportType` or null for the empty placeholder.

For each of the four tables (Active Checkouts, Damage Summary, Repair Costs,
Grade Level Summary), add a mobile card list branch alongside the existing table:
- Active Checkouts: card per item — asset tag (monospace) + status chip,
  device name, user name, checkout/return dates.
- Damage Summary: card per row — damage type + severity label left, count chip right.
- Repair Costs: card per vendor — vendor name left, total cost (bold) +
  ticket count right.
- Grade Level Summary: card per grade — grade chip + incident count chip top,
  then 3-column row for Repair Cost / Outstanding / Avg per Incident.
Invoice Aging is already cards — leave it unchanged.

---

### 12. frontend/src/pages/DeviceManagement/IntuneDeviceActionsPage.tsx — Tabs → select on mobile

Add `import { useIsMobile } from '../../hooks/useResponsive';` and
`const isMobile = useIsMobile();`.

Replace the 5-tab `<Tabs>` block with a mobile `<select>` / desktop `<Tabs>` branch.
Options: By Device Model (0), Scan/Search by Name (1), History (2),
Reconciliation (3), BitLocker (4). `tab` is numeric; `onChange` uses
`Number(e.target.value)`. Preserve the side-effects: call `setHistoryEntries(loadHistory())`
when switching to tab 1 or 2, and always call `setResults(null)` and `setIsDryRun(true)`.

---

### 13. frontend/src/pages/Transportation/DotPhysicalsPage.tsx — Tabs → select on mobile

`useIsMobile` and `isMobile` are already in scope.

Inside the existing `<Paper>` wrapper, replace the `<Tabs>` block with a mobile
`<select>` / desktop `<Tabs>` branch. Options: All, Valid, Expiring Soon, Expired.
`tab` is `TabValue` (string union); `onChange` casts `e.target.value as TabValue`
and calls `setPage(0)`. Wrap the select in a `<Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>`.

---

### 14. frontend/src/pages/Transportation/DriverLicensePage.tsx — Tabs → select on mobile

`useIsMobile` and `isMobile` are already in scope.

Inside the existing `<Paper>` wrapper, replace the `<Tabs>` block with a mobile
`<select>` / desktop `<Tabs>` branch. Options: All, Active, Expiring Soon, Expired.
`tab` is `TabValue` (string union); `onChange` casts `e.target.value as TabValue`
and calls `setPage(0)`. Wrap the select in a `<Box sx={{ p: 1.5, borderBottom: '1px solid', borderColor: 'divider' }}>`.

---

### 15. frontend/src/pages/Transportation/TransportationSettingsPage.tsx — Fix toggle label wrapping

Add `sx={{ whiteSpace: 'nowrap' }}` to each of the four `FormControlLabel`
elements that render the enabled/disabled toggle switches (dotEnabled,
licenseEnabled, monthlyEnabled, thresholdEnabled). This prevents "Enabled" /
"Disabled" from wrapping onto multiple lines in the card header row on mobile.
```
