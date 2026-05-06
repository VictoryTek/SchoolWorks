# Room Assignment UX Improvement Specification

**Created:** May 6, 2026  
**Feature:** Improved UX for Room Assignments page  
**Status:** Specification - Ready for Implementation

---

## Executive Summary

The Room Assignments page (`/room-assignments`) currently displays all rooms for a selected location as a flat card grid. With locations having 50–90+ rooms each (481 total rooms across ~10 locations), users are overwhelmed by the sheer number of cards. This specification proposes a progressive-disclosure UX that filters rooms by **type**, adds **search/autocomplete**, and supports **pagination** — reducing the visible rooms from 80+ to a focused, manageable subset.

---

## 1. Current State Analysis

### 1.1 Page Overview

**File:** `frontend/src/pages/RoomAssignments/RoomAssignmentsPage.tsx`  
**Route:** `/room-assignments`  
**Access:** Admins, Principals/VPs, Primary Supervisors

### 1.2 Current Flow

1. **Location Selection** — Admin/Principal picks a location from a `<Select>` dropdown (primary supervisors auto-select their location)
2. **Room Grid** — All active rooms for that location appear simultaneously as MUI `<Card>` elements in a 3-column grid
3. **Room Cards** — Each card shows: room name, type chip, building/floor, assigned user count, and a "Manage Assignments" button
4. **Assignment Dialog** — Clicking "Manage Assignments" opens `RoomAssignmentDialog` to add/remove users

### 1.3 What's Overwhelming

| Location | Approximate Room Count |
|----------|----------------------|
| Obion County Central High School | ~85 rooms |
| Ridgemont Elementary | ~35 rooms |
| Lake Road Elementary | ~45 rooms |
| Hillcrest Elementary | ~40 rooms |
| South Fulton Middle/High School | ~35 rooms |
| South Fulton Elementary | ~30 rooms |
| District Office | ~15 rooms |
| Transportation Department | ~6 rooms |

When an admin selects "Obion County Central High School," they see **85 room cards** filling 28+ grid rows. Scrolling to find a specific room (e.g., "Room 229") requires scanning the entire wall of cards.

### 1.4 Missing Features

- No search/filter within the location's rooms
- No room-type filtering
- No building grouping
- No pagination or virtual scrolling
- No quick-jump or autocomplete for room selection

### 1.5 Existing Patterns (Reusable)

- **`UserSearchAutocomplete`** — MUI Autocomplete with server-side search, debounce, loading states
- **`PaginationControls`** — Existing pagination component with page size selector
- **`useRoomsByLocation(locationId)`** — Already fetches rooms by location
- **`useLocations()`** — Fetches all locations with caching
- **`usePaginatedRooms(params)`** — Server-side paginated room queries
- **Location → Room cascading** — Used in NewWorkOrderPage

---

## 2. Proposed Solution

### 2.1 Design Philosophy

**Progressive Disclosure:** Show less by default, reveal more on demand.

1. **Step 1:** Select a location (existing)
2. **Step 2 (NEW):** Filter rooms by type OR search by name
3. **Step 3:** Browse paginated results (max 12 cards per page)
4. **Step 4:** Click a room card to manage assignments

### 2.2 Component Layout (Wireframe)

```
┌───────────────────────────────────────────────────────────────┐
│ 🚪 Room Assignments                                           │
├───────────────────────────────────────────────────────────────┤
│                                                               │
│ [Select Location ▼]                                           │
│                                                               │
│ ┌─── Filter Bar ────────────────────────────────────────────┐ │
│ │ [🔍 Search rooms...          ] [Type ▼] [Building ▼]     │ │
│ └───────────────────────────────────────────────────────────┘ │
│                                                               │
│ Summary: 85 rooms · 142 assignments  (showing 1-12 of 85)    │
│                                                               │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │ Room 107 │ │ Room 108 │ │ Room 109 │ │ Room 110 │        │
│ │ CLASSROOM│ │ CLASSROOM│ │ OFFICE   │ │ CLASSROOM│        │
│ │ 3 users  │ │ 1 user   │ │ 0 users  │ │ 2 users  │        │
│ │[Manage]  │ │[Manage]  │ │[Manage]  │ │[Manage]  │        │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐        │
│ │ Room 111 │ │ Room 112 │ │ Room 113 │ │ Room 114 │        │
│ │ ...      │ │ ...      │ │ ...      │ │ ...      │        │
│ └──────────┘ └──────────┘ └──────────┘ └──────────┘        │
│ (+ 4 more cards = 12 total per page)                          │
│                                                               │
│ ◀ 1  2  3  4  5  6  7 ▶   Show: [12 ▼] per page            │
│                                                               │
└───────────────────────────────────────────────────────────────┘
```

### 2.3 Key UX Changes

| Feature | Current | Proposed |
|---------|---------|----------|
| Room search | None | Text input with instant client-side filter |
| Type filter | None | MUI Select dropdown (CLASSROOM, OFFICE, etc.) |
| Building filter | None | MUI Select populated from room data |
| Pagination | None (show all) | 12 cards per page with navigation |
| Empty state | Generic "no rooms" | Contextual: "No rooms match your search" |
| Total count | Chip showing total | Enhanced: "showing X–Y of Z rooms" |
| Quick access | Scroll to find | Search instantly narrows to matching rooms |

### 2.4 Specific MUI Components

- **`TextField`** with `InputAdornment` (search icon) — room name search
- **`Select` + `MenuItem`** — type filter dropdown
- **`Select` + `MenuItem`** — building filter dropdown (dynamically populated)
- **`Chip`** — active filter indicators (clearable)
- **`Pagination`** (from `@mui/material`) — page navigation
- **`Card`, `CardContent`, `CardActions`** — room cards (existing, unchanged)
- **`Skeleton`** — loading states (existing pattern)

---

## 3. Implementation Steps

### 3.1 Frontend Changes

#### Step 1: Add filter state to RoomAssignmentsPage

Add state variables for search text, room type filter, building filter, and current page.

#### Step 2: Create client-side filtering logic

Since `useLocationRoomAssignments` already fetches all rooms for a location (with assignments data needed for cards), apply client-side filtering and pagination. This avoids a new backend endpoint and keeps assignment counts accurate.

```typescript
// New state
const [roomSearch, setRoomSearch] = useState('');
const [typeFilter, setTypeFilter] = useState<string>('');
const [buildingFilter, setBuildingFilter] = useState<string>('');
const [page, setPage] = useState(1);
const PAGE_SIZE = 12;

// Derived: filter rooms client-side
const filteredRooms = useMemo(() => {
  if (!assignmentData?.rooms) return [];
  return assignmentData.rooms.filter((room) => {
    if (roomSearch && !room.name.toLowerCase().includes(roomSearch.toLowerCase())) return false;
    if (typeFilter && room.type !== typeFilter) return false;
    if (buildingFilter && room.building !== buildingFilter) return false;
    return true;
  });
}, [assignmentData?.rooms, roomSearch, typeFilter, buildingFilter]);

// Paginate
const paginatedRooms = filteredRooms.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
const totalPages = Math.ceil(filteredRooms.length / PAGE_SIZE);
```

#### Step 3: Extract unique buildings from room data

```typescript
const uniqueBuildings = useMemo(() => {
  if (!assignmentData?.rooms) return [];
  const buildings = assignmentData.rooms
    .map((r) => r.building)
    .filter((b): b is string => !!b);
  return [...new Set(buildings)].sort();
}, [assignmentData?.rooms]);
```

#### Step 4: Add Filter Bar UI

Insert between the location selector and the room grid:

```tsx
{selectedLocationId && assignmentData && !assignmentsLoading && (
  <Box display="flex" gap={2} mb={2} flexWrap="wrap" alignItems="center">
    {/* Search */}
    <TextField
      size="small"
      placeholder="Search rooms..."
      value={roomSearch}
      onChange={(e) => { setRoomSearch(e.target.value); setPage(1); }}
      InputProps={{
        startAdornment: <InputAdornment position="start"><SearchIcon /></InputAdornment>,
      }}
      sx={{ minWidth: 220 }}
    />
    {/* Type filter */}
    <FormControl size="small" sx={{ minWidth: 150 }}>
      <InputLabel>Room Type</InputLabel>
      <Select value={typeFilter} label="Room Type" onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
        <MenuItem value="">All Types</MenuItem>
        {ROOM_TYPES.map((t) => <MenuItem key={t} value={t}>{t.replace(/_/g, ' ')}</MenuItem>)}
      </Select>
    </FormControl>
    {/* Building filter (only if buildings exist) */}
    {uniqueBuildings.length > 0 && (
      <FormControl size="small" sx={{ minWidth: 150 }}>
        <InputLabel>Building</InputLabel>
        <Select value={buildingFilter} label="Building" onChange={(e) => { setBuildingFilter(e.target.value); setPage(1); }}>
          <MenuItem value="">All Buildings</MenuItem>
          {uniqueBuildings.map((b) => <MenuItem key={b} value={b}>{b}</MenuItem>)}
        </Select>
      </FormControl>
    )}
    {/* Clear filters button */}
    {(roomSearch || typeFilter || buildingFilter) && (
      <Button size="small" onClick={() => { setRoomSearch(''); setTypeFilter(''); setBuildingFilter(''); setPage(1); }}>
        Clear Filters
      </Button>
    )}
  </Box>
)}
```

#### Step 5: Replace room grid rendering with paginated version

Change from:
```tsx
{assignmentData.rooms.map((room) => (...))}
```
To:
```tsx
{paginatedRooms.map((room) => (...))}
```

#### Step 6: Add pagination controls

```tsx
{totalPages > 1 && (
  <Box display="flex" justifyContent="center" mt={3}>
    <Pagination
      count={totalPages}
      page={page}
      onChange={(_, p) => setPage(p)}
      color="primary"
      showFirstButton
      showLastButton
    />
  </Box>
)}
```

#### Step 7: Update summary chips

Change the existing chips to show filtered context:
```tsx
<Chip label={`Showing ${paginatedRooms.length} of ${filteredRooms.length} rooms`} />
```

#### Step 8: Reset filters on location change

```tsx
useEffect(() => {
  setRoomSearch('');
  setTypeFilter('');
  setBuildingFilter('');
  setPage(1);
}, [selectedLocationId]);
```

### 3.2 No Backend Changes Required

The existing `GET /api/room-assignments/location/:locationId` endpoint already returns all rooms with assignments for a location. Since the page needs assignment counts for every room card, client-side filtering on the already-fetched data is appropriate. The dataset per location (max ~85 rooms) is small enough for client-side operations without performance concerns.

---

## 4. File Paths to Modify

| File | Change |
|------|--------|
| `frontend/src/pages/RoomAssignments/RoomAssignmentsPage.tsx` | Add filter state, filter bar UI, pagination, reset logic |

**No new files required.** All changes are contained within the single page component.

### 4.1 New Imports Required

```typescript
import {
  TextField,
  InputAdornment,
  Pagination,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
```

(Note: `Box`, `Select`, `MenuItem`, `FormControl`, `InputLabel`, `Button`, `Chip` are already imported.)

---

## 5. Component Hierarchy & Data Flow

```
RoomAssignmentsPage
├─ useRoomAssignmentAccess()          → access control
├─ useLocations()                     → location dropdown data
├─ useLocationRoomAssignments(id)     → all rooms + assignments for location
├─ [NEW] Local state: roomSearch, typeFilter, buildingFilter, page
├─ [NEW] useMemo: filteredRooms       → client-side filter
├─ [NEW] useMemo: paginatedRooms      → slice for current page
├─ [NEW] useMemo: uniqueBuildings     → dynamic building filter options
├─ Filter Bar (TextField, Select x2, Clear button)
├─ Summary Chips (filtered count)
├─ Room Cards Grid (paginatedRooms.map)
├─ Pagination (MUI Pagination component)
└─ RoomAssignmentDialog (existing, unchanged)
```

**Data flow:**
1. Location selected → `useLocationRoomAssignments` fetches all rooms + assignments
2. User types search / selects type / selects building → `filteredRooms` memo recomputes
3. Pagination resets to page 1 on any filter change
4. `paginatedRooms` slices the filtered list → cards render
5. User clicks "Manage Assignments" → opens existing `RoomAssignmentDialog`

---

## 6. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Authentication | Route wrapped in `<ProtectedRoute requireRoomAssignment>` — unchanged |
| Authorization | `useRoomAssignmentAccess` hook checks admin/principal/supervisor — unchanged |
| Backend enforcement | `requireAdminOrPrimarySupervisor` middleware on API routes — unchanged |
| CSRF | All mutations use CSRF tokens via axios interceptor — unchanged |
| Rate limiting | Assignment POST endpoint has rate limiter — unchanged |
| Data exposure | Client-side filtering only filters already-authorized data — no new data exposure |

All security controls remain intact. The changes are purely presentational (client-side filtering of data the user is already authorized to see).

---

## 7. Accessibility

- Search field has proper `placeholder` text and start adornment icon
- MUI `Select` components have `InputLabel` for screen readers
- MUI `Pagination` has built-in ARIA labels
- Filter changes apply instantly (no form submission barrier)
- Clear Filters button provides keyboard-accessible reset
- Existing card structure with semantic HTML is maintained

---

## 8. Edge Cases

| Scenario | Behavior |
|----------|----------|
| Location has 0 rooms | Show existing "No active rooms found" alert |
| Filters return 0 results | Show "No rooms match your filters" + Clear Filters button |
| Location has only 1-12 rooms | Filter bar shows but pagination is hidden |
| User switches location | All filters and page reset to defaults |
| Location with no buildings | Building filter dropdown hidden |
| Room with null type | Excluded by type filter (only shown when "All Types" selected) |

---

## 9. Future Enhancements (Out of Scope)

- **Server-side pagination** of room assignments (only needed if locations grow to 200+ rooms)
- **Virtual scrolling** with `react-window` (overkill for current data sizes)
- **Saved filter preferences** via URL params or localStorage
- **Room autocomplete** (MUI Autocomplete for jump-to-room) — could be Phase 2
- **Keyboard shortcuts** (e.g., `/` to focus search)

---

## 10. Acceptance Criteria

1. ✅ Room Assignments page shows a search field after location is selected
2. ✅ Room type filter dropdown filters cards by room type
3. ✅ Building filter dropdown appears when rooms have building data
4. ✅ Maximum 12 room cards displayed at once (configurable)
5. ✅ Pagination controls appear when filtered results exceed page size
6. ✅ Changing any filter resets to page 1
7. ✅ Switching locations resets all filters
8. ✅ "Clear Filters" button visible when any filter is active
9. ✅ Existing "Manage Assignments" dialog works identically
10. ✅ All existing permission/access controls remain enforced
