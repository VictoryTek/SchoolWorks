# Form Validation & Input Security Specification
**Tech-V2 Full-Stack Application**  
**Document Date:** May 7, 2026  
**Classification:** Internal — Security Specification  
**Prepared by:** Security Research Subagent (Phase 1)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Current State Analysis](#2-current-state-analysis)
3. [Vulnerability Inventory](#3-vulnerability-inventory)
4. [Recommended Architecture](#4-recommended-architecture)
5. [Purchase Order Implementation Plan (Priority #1)](#5-purchase-order-implementation-plan)
6. [Implementation Roadmap](#6-implementation-roadmap)
7. [Shared Schema Strategy](#7-shared-schema-strategy)
8. [Security Considerations](#8-security-considerations)
9. [Code Examples](#9-code-examples)

---

## 1. Executive Summary

### Validation Coverage Score: **65 / 100**

| Layer | Coverage | Score |
|---|---|---|
| Backend Validation | Zod schemas on all routes, consistently applied | 88% |
| Frontend Validation | Inconsistent — only AdminSettings uses RHF+Zod | 40% |
| Shared Schema Strategy | Shared package exists but has NO Zod schemas yet | 0% |
| Overall Weighted | | **65%** |

### Overall Risk Rating: **MEDIUM**

The backend is in a strong position — Zod validation schemas exist for every route, the `validateRequest` middleware is consistently applied, CSRF protection is in place, and Prisma ORM eliminates SQL injection entirely. The primary risk surface is the **frontend**, where most forms use ad-hoc manual validation instead of the proper React Hook Form + Zod resolver pattern. This creates user experience gaps but does not introduce direct injection vulnerabilities due to backend coverage.

### Top 3 Immediate Priorities

1. **Frontend PO / RequisitionWizard forms** — Currently rely on two boolean flags (`step1Valid`, `step2Valid`) instead of proper field-level validation. Backend catches errors, but the UX is poor and the form allows submission with XSS-like strings in `notes`/`shipTo`/description fields without user-facing guidance.

2. **`req.query` transformation gap** — The `validateRequest` middleware explicitly skips replacing `req.query` (Express read-only property). This means Zod `.transform()` calls on query params (e.g., `page` string → number) never reach the route handler. Services compensate with manual `parseInt()` but this creates duplicated parsing logic and inconsistency.

3. **User search query lacks a `max()` constraint** — `GetUsersQuerySchema` defines `search: z.string().optional().default('')` with no length limit. An attacker could send a 10 MB search string to the `/api/users?search=` endpoint. Every other search field across the app has `.max(200)`.

---

## 2. Current State Analysis

### 2.1 Installed Validation Libraries

**Backend** (`c:\Tech-V2\backend\package.json`):

| Library | Version | Purpose |
|---|---|---|
| `zod` | 4.3.6 | Schema validation — all route inputs |
| `express-rate-limit` | 8.4.1 | Brute-force / DoS protection |
| `helmet` | 8.1.0 | HTTP security headers (HSTS, CSP, X-Frame-Options, etc.) |
| `cookie-parser` | 1.4.7 | Cookie parsing (needed for CSRF double-submit) |
| `multer` | 2.1.1 | File upload handling (inventory import) |
| `crypto` (built-in) | Node stdlib | CSRF token generation (timing-safe comparison) |

**Frontend** (`c:\Tech-V2\frontend\package.json`):

| Library | Version | Purpose |
|---|---|---|
| `zod` | 4.3.6 | Schema validation — **underutilized on frontend forms** |
| `react-hook-form` | 7.71.2 | Form management — **only used in AdminSettings** |
| `@hookform/resolvers` | 5.2.2 | Zod resolver bridge — **only used in AdminSettings** |
| `axios` | 1.15.2 | HTTP client |

**Shared** (`c:\Tech-V2\shared\src\`):

Current files: `types.ts`, `api-types.ts`, `work-order.types.ts`, `index.ts`  
**No Zod schemas exist in the shared package** — only TypeScript interfaces.

---

### 2.2 What Validation Is Currently Implemented

#### Backend (Strong)

| Area | Status | Details |
|---|---|---|
| Authentication middleware | ✅ Complete | JWT cookie + Bearer fallback, applied via `router.use(authenticate)` |
| CSRF protection | ✅ Complete | Double-submit cookie pattern, `crypto.timingSafeEqual`, applied to all state-changing routers |
| Purchase Order routes | ✅ Complete | 8 Zod schemas: Create, Update, Query, Approve, Reject, Assign, Issue, IdParam |
| Inventory routes | ✅ Complete | Create, Update, BulkUpdate, Query, ImportOptions schemas |
| User management routes | ✅ Mostly | All CRUD routes have schemas; `search` field missing `.max()` |
| Work Order routes | ✅ Complete | Create, Update, Status, Assign, Comment schemas |
| Field Trip routes | ✅ Complete | Create, Update, Approve, Deny, SendBack schemas |
| Transportation Request routes | ✅ Complete | Create, Approve, Deny schemas |
| Reference Data routes | ✅ Complete | Brand, Vendor, Category, Model schemas |
| Settings routes | ✅ Complete | UpdateSettings, StartNewFiscalYear schemas |
| Assignment routes | ✅ Complete | Assign, Transfer, BulkAssign schemas |
| Rate limiting | ✅ Active | 500 req/15min general, 20 req/15min auth |
| Helmet headers | ✅ Active | Default Helmet config (CSP, HSTS, X-Frame-Options, etc.) |
| Body size limit | ⚠️ Default | `express.json()` with no explicit limit (default 100 kB) |
| HTML sanitization (server-side) | ❌ Missing | Text fields stored/returned verbatim |

#### Frontend (Inconsistent)

| Form | Uses RHF | Uses Zod | Manual Validation | Status |
|---|---|---|---|---|
| AdminSettings | ✅ Yes | ✅ Yes (local schema) | No | Best practice |
| RequisitionWizard (PO) | ❌ No | ❌ No | Boolean flags only | Inadequate |
| InventoryFormDialog | ❌ No | ⚠️ Local schema defined but not wired as resolver | Manual `validationErrors` state | Partial |
| FieldTripRequestPage | ❌ No | ❌ No | Custom `validateStep()` | Inadequate |
| TransportationRequestForm | ❌ No | ❌ No | Custom `validate()` | Inadequate |
| All other pages | ❌ No | ❌ No | Varies | Unknown |

---

### 2.3 What Is Missing

1. **Frontend forms not using RHF + Zod**: Four of five major forms bypass the proper validation pattern.
2. **No shared Zod schemas**: The `/shared` package exists but contains only TypeScript interface types. Backend Zod schemas are not exported for frontend re-use, causing duplication of validation rules.
3. **`req.query` transformation bypass**: `validateRequest` correctly validates query params but skips `.transform()` application (Express read-only constraint). Service layers manually re-parse with `parseInt()`.
4. **Missing `max()` on user search query**: `GetUsersQuerySchema` has no length limit on the `search` field.
5. **No server-side HTML sanitization**: Free-text fields (`notes`, `description`, `purpose`, `shipTo`, etc.) are stored verbatim. React's output encoding protects against XSS at render time, but data stored in the database could be dangerous if ever rendered via `dangerouslySetInnerHTML`, exported to PDF without escaping, or consumed by other systems.
6. **PDF service output**: `pdf.service.ts` and `fieldTripPdf.service.ts` render stored text into PDFs. If stored data contains control sequences or malicious content, this could affect PDF rendering.
7. **Nginx allows 50 MB uploads** (`client_max_body_size 50M`) but the multer configuration only limits inventory CSV/Excel imports to 10 MB. No explicit content-length validation on other POST routes.
8. **No Content Security Policy customization**: Helmet's default CSP is applied but not tuned for a React SPA. A stricter policy could prevent stored XSS from executing.

---

## 3. Vulnerability Inventory

### Full Form/Route Validation Status Table

| Form / Route | Field | Backend Validation? | Frontend Validation? | Risk Level | Notes |
|---|---|---|---|---|---|
| **POST /api/purchase-orders** | `vendorId` | ✅ uuid() | ✅ Vendor required | Low | Properly validated both sides |
| | `title` | ✅ max(200) | ❌ None | Medium | Could submit 200-char string without warning |
| | `notes` | ✅ max(2000) | ❌ None | **High** | Free-text; unlimited on frontend; stored verbatim |
| | `shipTo` | ✅ max(500) | ❌ None | **High** | Free-text address; no frontend limit |
| | `shippingCost` | ✅ min(0) | ❌ None | Medium | Negative value caught only on backend |
| | `officeLocationId` | ✅ uuid() | ⚠️ Dropdown | Low | Dropdown selection reduces risk |
| | `entityType` | ✅ z.enum | ⚠️ Inferred from location | Low | |
| | `workflowType` | ✅ z.enum | ⚠️ Inferred from location | Low | |
| | `items[].description` | ✅ max(500) | ⚠️ Required check only | **High** | Free-text; no length limit on frontend |
| | `items[].quantity` | ✅ int, positive | ⚠️ `> 0` check only | Medium | No integer check on frontend |
| | `items[].unitPrice` | ✅ positive | ⚠️ `> 0` check only | Medium | No format check on frontend |
| | `items[].model` | ✅ max(200) | ❌ None | Medium | Free-text |
| **PUT /api/purchase-orders/:id** | All fields | ✅ UpdatePurchaseOrderSchema | ❌ Unknown (edit form not reviewed) | Medium | Edit form (PurchaseOrderDetail.tsx) needs review |
| **POST /api/purchase-orders/:id/approve** | `notes` | ✅ max(1000) | ❌ Unknown | Medium | Approval dialog not reviewed |
| | `accountCode` | ✅ max(100) | ❌ Unknown | Low | |
| **POST /api/purchase-orders/:id/reject** | `reason` | ✅ min(1) max(1000) | ❌ Unknown | Medium | Rejection dialog not reviewed |
| **POST /api/inventory** | `assetTag` | ✅ regex + max(50) | ✅ Local Zod schema | Low | Regex allows alphanumeric, `-_./:` |
| | `name` | ✅ max(200) | ✅ Local Zod schema | Low | |
| | `description` | ✅ max(1000) | ✅ Local Zod schema | Low | |
| | `notes` | ✅ max(2000) | ✅ Local Zod schema | Low | |
| | `serialNumber` | ✅ max(100) | ✅ Not validated | Medium | No format constraint |
| | `purchasePrice` | ✅ regex + number | ✅ coerce.number().min(0) | Low | |
| | `customFields` | ✅ Not in schema | ❌ JSON blob | **High** | Prisma schema has `customFields Json?` — backend schema has no `customFields` validator! Arbitrary JSON accepted |
| **POST /api/users** | N/A — Users synced from Entra | — | — | — | No user creation form |
| **PUT /api/users/:id/role** | `role` | ✅ z.enum(['ADMIN','USER']) | ❌ Admin-only action | Low | Role is enumerated |
| **GET /api/users** | `search` | ⚠️ No max() | ❌ None | **High** | `z.string().optional().default('')` — no length limit. Only user list query with this gap |
| | `page`, `limit` | ✅ Transform to number | ⚠️ Transform not applied to req.query | Medium | Service re-parses manually |
| **POST /api/field-trips** | `teacherName` | ✅ max(200) | ⚠️ Custom validateStep() | Medium | Frontend validation inconsistent |
| | `purpose` | ✅ min(10) max(2000) | ⚠️ Custom validateStep() | Medium | |
| | `preliminaryActivities` | ✅ min(1) max(3000) | ⚠️ Custom validateStep() | Medium | |
| | `followUpActivities` | ✅ min(1) max(3000) | ⚠️ Custom validateStep() | Medium | |
| | `additionalNotes` | ✅ min(1) max(2000) | ⚠️ Custom validateStep() | Medium | Free-text; stored verbatim |
| | `chaperones[].name` | ✅ Validated in schema | ⚠️ No frontend check | Medium | Array of objects |
| **POST /api/transportation-requests** | `tripItinerary` | ✅ max(5000) | ⚠️ No explicit check | **High** | 5000 chars of free text; no frontend limit |
| | `additionalDestinations` | ✅ max(10) array | ⚠️ No count limit on frontend | Medium | |
| **POST /api/work-orders** | `description` | ✅ min(10) max(5000) | ❌ None shown | **High** | Free-text up to 5000 chars |
| | `title` | ✅ max(200) | ❌ None shown | Medium | |
| **POST /api/work-orders/:id/comments** | `body` | ✅ max(5000) | ❌ None shown | **High** | Free-text comment |
| **POST /api/reference-data/vendors** | `name` | ✅ max(100) | ❌ Unknown | Medium | |
| | `email` | ✅ z.email() | ❌ Unknown | Low | |
| | `phone` | ✅ max(30) | ❌ Unknown | Low | No format regex |
| | `website` | ✅ z.url() or empty | ❌ Unknown | Low | |
| **PUT /api/settings** | All approval levels | ✅ min(1) max(6) | ✅ RHF+Zod | Low | AdminSettings properly done |
| **POST /api/settings/new-fiscal-year** | All fields | ✅ Complete Zod schema | ✅ RHF+Zod | Low | Wizard form properly done |
| **POST /api/inventory/import** | CSV/Excel file | ✅ multer 10 MB, row-level Zod schema | ❌ Client-side only | Medium | File MIME + extension allowed-listed |
| **Admin sync routes** | No body params | — | — | Low | POST params not user-facing |

### Critical Findings Summary

| # | Finding | Affected Routes | Risk |
|---|---|---|---|
| F-1 | `notes`/`shipTo`/`description` free-text fields stored verbatim with no HTML sanitization | PO, FieldTrip, WorkOrder, Transportation | High |
| F-2 | `GET /api/users?search=` has no max length constraint in validator | /api/users | High |
| F-3 | `equipment.customFields` (Json?) has no Zod schema — arbitrary JSON accepted | /api/inventory | High |
| F-4 | RequisitionWizard frontend uses boolean flags only — no field-level validation | Frontend PO Form | High (UX) |
| F-5 | `req.query` Zod transforms never applied — services re-parse manually | All GET routes | Medium |
| F-6 | Work Order `description` and `comments.body` (up to 5000 chars) have no frontend validation | Frontend WorkOrder | Medium |
| F-7 | Transportation `tripItinerary` (5000 chars) has no frontend validation | Frontend TransportReq | Medium |
| F-8 | No server-side HTML sanitization library installed | All text routes | Medium |
| F-9 | `express.json()` body size limit not explicitly configured | All POST/PUT routes | Medium |
| F-10 | No CSP customization — Helmet defaults applied | All routes | Low |

---

## 4. Recommended Architecture

### The Two-Layer Defense Approach

```
User Input
    │
    ▼
┌─────────────────────────────────────────┐
│  Layer 2 — Frontend (UX + Fast Feedback) │
│  React Hook Form + Zod Resolver + MUI    │
│  • Real-time field validation             │
│  • On-submit schema validation            │
│  • Friendly error messages               │
│  • Uses shared Zod schemas from /shared  │
└────────────────────┬────────────────────┘
                     │  HTTP (CSRF token + JWT cookie)
                     ▼
┌─────────────────────────────────────────┐
│  Layer 1 — Backend (Source of Truth)     │
│  Express + validateRequest middleware     │
│  • Zod schema parse (strip unknown keys) │
│  • Field-level error 400 response        │
│  • String sanitization (.trim())         │
│  • HTML sanitization (DOMPurify/isomorphic) │
│  • Prisma parameterized queries           │
└─────────────────────────────────────────┘
```

---

### Layer 1 — Backend (Source of Truth)

#### 4.1 Zod Schema Definitions

Each resource should have **one authoritative Zod schema** that lives in the `/shared` package (see Section 7). The backend imports and applies it at the route level.

**Key principles:**
- Use `.strict()` or `.strip()` to reject unknown keys (mass assignment prevention)
- All string fields must have `.max()` constraints and `.trim()` transforms
- Enums must be z.enum() — never `z.string()` for fixed-value fields
- Numeric fields must use `.int()`, `.positive()`, or explicit range checks
- UUIDs always validated with `.uuid()`

**Minimum field constraints for every text input:**
```typescript
z.string()
  .trim()              // strip whitespace
  .min(1, '...')       // prevent empty strings for required fields
  .max(N, '...')       // prevent oversized input
```

#### 4.2 Where to Place Validation Middleware

Current pattern is correct. Maintain it:

```typescript
router.post(
  '/',
  validateRequest(CreatePurchaseOrderSchema, 'body'),   // ← Zod validation
  requireModule('REQUISITIONS', 2),                     // ← Permission check
  purchaseOrderController.createPurchaseOrder,          // ← Business logic
);
```

**Fix for `req.query` transforms not applying:**

The `validateRequest` middleware skips `req.query` reassignment because it's read-only. To propagate transformed values, attach parsed results to a custom property:

```typescript
// In validation.ts — augment the strategy:
if (target === 'query') {
  // Attach parsed/transformed query to req.parsedQuery
  (req as any).parsedQuery = parsed;
} else {
  req[target] = parsed;
}
```

Then services use `(req as any).parsedQuery` instead of `req.query`. Alternatively, define a typed `TypedAuthRequest` extension.

#### 4.3 Sanitization Strategy

**Install `isomorphic-dompurify` for server-side sanitization:**

```bash
npm install isomorphic-dompurify @types/dompurify
```

Apply to all free-text fields before persistence:

```typescript
import createDOMPurify from 'isomorphic-dompurify';
import { JSDOM } from 'jsdom';

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window as any);

function sanitizeText(input: string): string {
  return DOMPurify.sanitize(input, { ALLOWED_TAGS: [] }); // strip ALL HTML
}
```

For plain-text fields (notes, descriptions, comments), use `{ ALLOWED_TAGS: [] }` — no HTML tags allowed.

**Alternative (lighter weight) for plain text only:**

Use the `validator` npm package (`validator.escape()`) or simply rely on React's auto-escaping + Zod validation for character set control.

#### 4.4 Error Response Format

The current format is already good. Maintain it:

```json
{
  "error": "Validation Error",
  "message": "Invalid request data",
  "details": [
    {
      "field": "items.0.description",
      "message": "Item description is required",
      "code": "too_small"
    }
  ]
}
```

---

### Layer 2 — Frontend (UX)

#### 4.5 React Hook Form + Zod Resolver Pattern

All forms should follow the pattern already established in `AdminSettings.tsx`:

```typescript
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

// Use schema from shared package (recommended):
// import { CreatePurchaseOrderSchema } from '@tech-v2/shared/schemas';

const form = useForm<z.infer<typeof CreatePurchaseOrderSchema>>({
  resolver: zodResolver(CreatePurchaseOrderSchema),
  defaultValues: { ... },
  mode: 'onBlur',  // validate on blur for a good UX balance
});
```

#### 4.6 Field-Level Error Display with MUI

```tsx
<Controller
  name="notes"
  control={form.control}
  render={({ field, fieldState }) => (
    <TextField
      {...field}
      label="Notes"
      multiline
      rows={4}
      error={!!fieldState.error}
      helperText={fieldState.error?.message ?? `${field.value?.length ?? 0}/2000 characters`}
      inputProps={{ maxLength: 2000 }}
    />
  )}
/>
```

#### 4.7 Validation Strategy: Real-time vs On-Submit

| Scenario | Recommended Mode |
|---|---|
| Short, required fields (title, name) | `mode: 'onBlur'` — validate when user leaves field |
| Long free-text (notes, description) | `mode: 'onBlur'` — too noisy to validate on every keystroke |
| Passwords / email | `mode: 'onChange'` — immediate feedback is helpful |
| Multi-step wizards (PO, FieldTrip) | Validate each step's fields on "Next" click via `trigger(['field1', 'field2'])` |

#### 4.8 How to Share Zod Schemas

(See Section 7 for full strategy.)

Import directly from the shared package:
```typescript
import { CreatePurchaseOrderSchema } from '@tech-v2/shared';
```

---

## 5. Purchase Order Implementation Plan (Priority #1)

### 5.1 All PO Fields — Zod Types, Constraints, and Validation Rules

#### `PoItemSchema` (line items)

| Field | Zod Type | Constraints | Frontend Rule |
|---|---|---|---|
| `description` | `z.string()` | min(1), max(500), trim() | Required, `maxLength={500}`, char counter |
| `quantity` | `z.number()` | int(), positive() | Integer > 0; no decimals |
| `unitPrice` | `z.number()` | positive() | > 0; 2 decimal places |
| `lineNumber` | `z.number()` | int(), positive(), optional | Auto-generated |
| `model` | `z.string()` | max(200), trim(), optional | Optional; `maxLength={200}` |

#### `CreatePurchaseOrderSchema` (full form)

| Field | Zod Type | Current Constraints | Recommended Additions | Frontend Rule |
|---|---|---|---|---|
| `title` | `z.string()` | max(200), default('Purchase Order') | Add `.trim()` | Shown as optional label |
| `vendorId` | `z.string()` | uuid() | ✅ No change | Required; dropdown |
| `shipTo` | `z.string()` | max(500), optional | Add `.trim()` | Optional; `maxLength={500}` |
| `shipToType` | `z.enum()` | 3 values | ✅ No change | Radio group |
| `shippingCost` | `z.number()` | min(0), optional | ✅ No change | Currency input; `min={0}` |
| `notes` | `z.string()` | max(2000), optional | Add `.trim()`, **server: sanitize** | Optional; char counter |
| `program` | `z.string()` | max(200), optional | Add `.trim()` | Optional |
| `officeLocationId` | `z.string()` | uuid(), optional | ✅ No change | Dropdown |
| `entityType` | `z.enum()` | 3 values | ✅ No change | Auto-set from location |
| `items` | array | min(1), max(100) | ✅ No change | Validated per item |
| `workflowType` | `z.enum()` | 2 values | ✅ No change | Auto-set from location |

#### Workflow Action Schemas — No changes needed (all complete)

`ApproveSchema`, `RejectSchema`, `AssignAccountSchema`, `IssuePOSchema` — all correctly validated.

---

### 5.2 Backend Route Changes Needed

**Current state:** All PO routes have `validateRequest` middleware. This is correct.

**Changes needed:**

1. **Add `.trim()` transforms** to string fields in `CreatePurchaseOrderSchema` and `UpdatePurchaseOrderSchema`:
   - `notes`, `shipTo`, `title`, `program`, `items[].description`, `items[].model`

2. **Add server-side sanitization** in `purchaseOrder.service.ts` → `createPurchaseOrder()` and `updatePurchaseOrder()`:
   ```typescript
   const sanitizedNotes = data.notes ? sanitizeText(data.notes) : null;
   const sanitizedShipTo = data.shipTo ? sanitizeText(data.shipTo) : null;
   ```

3. **No new middleware needed** — existing `validateRequest` + `authenticate` + `validateCsrfToken` chain is correct.

---

### 5.3 Frontend Form Changes Needed

**File:** `c:\Tech-V2\frontend\src\pages\PurchaseOrders\RequisitionWizard.tsx`

**Current:** Uncontrolled `useState` for each field, two boolean validation flags.

**Required changes:**

1. Replace the flat `useState` fields with a single `useForm` instance using `zodResolver(CreatePurchaseOrderSchema)`
2. Replace `step1Valid`/`step2Valid` booleans with `form.trigger(['vendorId'])` and `form.trigger(['items'])` before advancing steps
3. Wire all form fields to `Controller` components or `register()`
4. Show `fieldState.error?.message` in each `TextField.helperText`
5. Add character counters to `notes`, `shipTo`, `items[].description`

---

### 5.4 Shared Schema File Path Recommendation

Create: `c:\Tech-V2\shared\src\schemas\purchaseOrder.schemas.ts`

Export from: `c:\Tech-V2\shared\src\index.ts`

---

## 6. Implementation Roadmap

### Phase A — Critical (Estimated: 2–3 sprints)

| # | Task | File(s) | Effort |
|---|---|---|---|
| A-1 | Add `.trim()` transforms to all string fields in all backend validators | All `*/validators/*.validators.ts` | 1 day |
| A-2 | Fix `req.query` transform propagation in `validation.ts` | `middleware/validation.ts` | 2 hours |
| A-3 | Add `.max(200)` to `GetUsersQuerySchema.search` | `validators/user.validators.ts` | 15 min |
| A-4 | Add `customFields` validation to `CreateInventorySchema` / `UpdateInventorySchema` | `validators/inventory.validators.ts` | 1 hour |
| A-5 | Add explicit body size limit to `express.json()` | `server.ts` | 15 min |
| A-6 | Migrate RequisitionWizard to RHF + Zod resolver | `pages/PurchaseOrders/RequisitionWizard.tsx` | 1.5 days |
| A-7 | Migrate PurchaseOrderDetail edit form to RHF + Zod | `pages/PurchaseOrders/PurchaseOrderDetail.tsx` | 1 day |
| A-8 | Approval/Rejection dialog forms — add RHF + basic validation | Approval/rejection dialogs | 0.5 day |

### Phase B — High (Estimated: 1–2 sprints)

| # | Task | File(s) | Effort |
|---|---|---|---|
| B-1 | Migrate InventoryFormDialog to RHF + Zod resolver | `components/inventory/InventoryFormDialog.tsx` | 1 day |
| B-2 | Migrate FieldTripRequestPage to RHF + Zod | `pages/FieldTrip/FieldTripRequestPage.tsx` | 2 days |
| B-3 | Migrate TransportationRequestForm to RHF + Zod | `components/fieldtrip/TransportationRequestForm.tsx` | 1 day |
| B-4 | Create shared Zod schemas in `/shared/src/schemas/` | `shared/src/schemas/*.ts` | 1 day |
| B-5 | Add server-side sanitization for notes/description fields | PO, FieldTrip, WorkOrder services | 1 day |
| B-6 | Customize Helmet CSP for React SPA | `server.ts` | 0.5 day |

### Phase C — Medium (Ongoing)

| # | Task | File(s) | Effort |
|---|---|---|---|
| C-1 | Migrate WorkOrder new/edit forms to RHF + Zod | `pages/NewWorkOrderPage.tsx`, WorkOrder components | 1 day |
| C-2 | Migrate Reference Data management forms to RHF + Zod | `pages/ReferenceDataManagement.tsx` | 1 day |
| C-3 | Migrate Room management form to RHF + Zod | `components/RoomFormModal.tsx` | 0.5 day |
| C-4 | Migrate Location management forms to RHF + Zod | Location forms | 0.5 day |
| C-5 | Add regex validation for phone numbers in vendor schema | `validators/referenceData.validators.ts` | 0.5 day |
| C-6 | Add ReDoS-safe regex audit | All validators using `.regex()` | 0.5 day |
| C-7 | Add CSP nonce-based header for inline scripts | `server.ts` + nginx.conf | 1 day |

---

## 7. Shared Schema Strategy

### Current State

The `/shared` package (`c:\Tech-V2\shared\src\`) currently exports only TypeScript interfaces:
- `types.ts` — `User`, `OfficeLocation`, `LocationSupervisor`, etc.
- `api-types.ts` — API response shapes
- `work-order.types.ts` — Work order types

**No Zod schemas are exported from the shared package.** This means:
- Backend Zod schemas exist only in `backend/src/validators/`
- Frontend forms either define local Zod schemas or skip validation entirely
- If a field constraint changes, it must be updated in two places

### Recommended Strategy

#### Step 1: Create a `schemas/` directory in `/shared`

```
c:\Tech-V2\shared\src\
  schemas/
    purchaseOrder.schemas.ts   ← Shared PO Zod schema
    inventory.schemas.ts
    fieldTrip.schemas.ts
    workOrder.schemas.ts
    user.schemas.ts
    common.schemas.ts           ← UUID params, pagination, etc.
  types.ts                      (existing)
  index.ts                      (re-export everything)
```

#### Step 2: Move schemas from backend validators to shared

```typescript
// shared/src/schemas/purchaseOrder.schemas.ts
import { z } from 'zod';

export const PoItemSchema = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().positive(),
  unitPrice: z.number().positive(),
  lineNumber: z.number().int().positive().optional(),
  model: z.string().trim().max(200).optional().nullable(),
});

export const CreatePurchaseOrderSchema = z.object({
  // ... all fields
});

export type CreatePurchaseOrderDto = z.infer<typeof CreatePurchaseOrderSchema>;
```

#### Step 3: Backend imports from shared

```typescript
// backend/src/validators/purchaseOrder.validators.ts
export {
  CreatePurchaseOrderSchema,
  UpdatePurchaseOrderSchema,
  CreatePurchaseOrderDto,
  // ...
} from '@tech-v2/shared/schemas/purchaseOrder.schemas';
```

#### Step 4: Frontend imports from shared

```typescript
// frontend/src/pages/PurchaseOrders/RequisitionWizard.tsx
import { CreatePurchaseOrderSchema } from '@tech-v2/shared';
import { zodResolver } from '@hookform/resolvers/zod';
```

#### Step 5: Configure workspace package linking

In `shared/package.json`, ensure the package name is consistent:
```json
{
  "name": "@tech-v2/shared"
}
```

Both `backend/package.json` and `frontend/package.json` already reference the shared package. Verify the `zod` version is compatible for both — currently both use `zod@4.3.6` ✅.

### Benefits

| Benefit | Description |
|---|---|
| Single source of truth | Change a max length once; both layers update automatically |
| Type inference | `z.infer<typeof Schema>` gives TypeScript types for API payloads |
| No schema drift | Frontend and backend validate the same rule set |
| Reduced code | ~40% less validation code overall |

---

## 8. Security Considerations

### 8.1 OWASP Top 10 Alignment

| OWASP Top 10 (2021) | Current Status | Gaps |
|---|---|---|
| **A01 Broken Access Control** | ✅ Mitigated | JWT auth + `requireModule` permission levels on all routes |
| **A02 Cryptographic Failures** | ✅ Mitigated | HTTPS enforced (TLS 1.2/1.3), HSTS enabled, HttpOnly+Secure cookies |
| **A03 Injection** | ✅ Mitigated | Prisma ORM (parameterized queries), no raw SQL found; Zod validates inputs |
| **A04 Insecure Design** | ⚠️ Partial | Frontend validation inconsistency reduces defense depth; no shared schemas |
| **A05 Security Misconfiguration** | ✅ Mostly | Helmet configured, rate limiting active; CSP not customized for React SPA |
| **A06 Vulnerable Components** | ⚠️ Partial | `npm audit` not evidenced; zod 4.3.6 and express 5.2.1 are current |
| **A07 Auth & Session Failures** | ✅ Mitigated | JWT in HttpOnly cookie, CSRF double-submit, refresh token pattern |
| **A08 Software Integrity** | ⚠️ Unknown | No SBOM or integrity checks documented |
| **A09 Logging Failures** | ✅ Mitigated | Winston logger + daily rotate; request logger middleware active |
| **A10 SSRF** | ✅ N/A | No server-side URL fetching from user input; redirect prevention documented |

### 8.2 Integration with `authenticateToken` Middleware

The existing authentication chain ensures all validation happens **after** identity verification:

```
Request
  → authenticate (verify JWT, populate req.user)
  → validateCsrfToken (CSRF check for mutating methods)
  → validateRequest (Zod schema parse)
  → requireModule (permission level check)
  → Controller handler
```

**No changes needed to this chain.** When adding server-side sanitization, apply it **inside the controller/service** after the Zod parse, not as separate middleware (to maintain context-awareness of the sanitization).

### 8.3 Integration with CSRF Protection

The current CSRF implementation follows the Double Submit Cookie pattern correctly:
- `provideCsrfToken` middleware runs on all routes, generates a cryptographically random 64-hex-char token
- `validateCsrfToken` applied at the router level for all state-changing routes
- `crypto.timingSafeEqual()` prevents timing attacks on token comparison

**No changes needed** to the CSRF flow. The frontend already includes the CSRF token in the `x-xsrf-token` header via the Axios API client.

**One note:** The CSRF cookie is set as `httpOnly: true` but the token is also sent in `X-CSRF-Token` response header. The Axios client reads this header to maintain the token in memory. The nginx config includes `exposedHeaders: ['X-CSRF-Token']` to allow cross-origin JS access ✅.

### 8.4 XSS Risk Assessment

React 19 provides strong contextual output encoding for all JSX text content. The primary XSS risk in this application is **stored XSS via free-text fields rendered in less-safe contexts**:

1. **PDF generation**: `pdf.service.ts` and `fieldTripPdf.service.ts` render stored text into PDFs using `pdfkit`. If a user injects malicious text like `<script>` tags, PDFKit will incorporate them as literal text (not HTML rendering), so this is low risk for PDF execution. However, if the PDF rendering ever switches to HTML-to-PDF conversion (e.g., puppeteer), stored malicious content becomes dangerous.

2. **Email service**: `email.service.ts` sends HTML emails containing stored values (PO title, vendor name, amounts). If a malicious vendor name contains `</td><script>...`, it could affect HTML email rendering. Add sanitization to the email service.

3. **Audit log display**: `inventory_changes` stores `oldValue`/`newValue` as strings. If these are displayed in an admin context using `dangerouslySetInnerHTML`, there is XSS risk.

**Recommendation:** Implement a lightweight server-side sanitizer for all free-text fields before persistence. Use either `validator.escape()` for plain text, or `DOMPurify` (isomorphic) for rich text.

---

## 9. Code Examples

### 9.1 Shared Zod Schema for Purchase Order (Complete)

```typescript
// c:\Tech-V2\shared\src\schemas\purchaseOrder.schemas.ts
import { z } from 'zod';

export const PO_VALID_STATUSES = [
  'draft',
  'submitted',
  'supervisor_approved',
  'finance_director_approved',
  'dos_approved',
  'po_issued',
  'denied',
] as const;

export type POStatus = (typeof PO_VALID_STATUSES)[number];

export const PoItemSchema = z.object({
  description: z
    .string()
    .trim()
    .min(1, 'Item description is required')
    .max(500, 'Description must be 500 characters or less'),
  quantity: z
    .number({ error: 'Quantity must be a number' })
    .int('Quantity must be a whole number')
    .positive('Quantity must be greater than zero'),
  unitPrice: z
    .number({ error: 'Unit price must be a number' })
    .nonnegative('Unit price cannot be negative')
    .refine((v) => v > 0, 'Unit price must be greater than zero'),
  lineNumber: z.number().int().positive().optional(),
  model: z
    .string()
    .trim()
    .max(200, 'Model must be 200 characters or less')
    .optional()
    .nullable(),
});

export const CreatePurchaseOrderSchema = z.object({
  title: z
    .string()
    .trim()
    .max(200, 'Title must be 200 characters or less')
    .optional()
    .default('Purchase Order'),
  type: z.string().min(1).max(100).optional().default('general'),
  vendorId: z.string().uuid('Invalid vendor ID format'),
  shipTo: z
    .string()
    .trim()
    .max(500, 'Ship-to address must be 500 characters or less')
    .optional()
    .nullable(),
  shipToType: z.enum(['entity', 'my_office', 'custom']).optional().nullable(),
  shippingCost: z
    .number({ error: 'Shipping cost must be a number' })
    .min(0, 'Shipping cost cannot be negative')
    .optional()
    .nullable(),
  notes: z
    .string()
    .trim()
    .max(2000, 'Notes must be 2000 characters or less')
    .optional()
    .nullable(),
  program: z
    .string()
    .trim()
    .max(200, 'Program must be 200 characters or less')
    .optional()
    .nullable(),
  officeLocationId: z.string().uuid('Invalid location ID').optional().nullable(),
  entityType: z.enum(['SCHOOL', 'DEPARTMENT', 'PROGRAM']).optional().nullable(),
  items: z
    .array(PoItemSchema)
    .min(1, 'At least one line item is required')
    .max(100, 'Cannot exceed 100 line items'),
  workflowType: z.enum(['standard', 'food_service']).optional().default('standard'),
});

export const UpdatePurchaseOrderSchema = CreatePurchaseOrderSchema.partial().omit({
  workflowType: true,
});

export const ApproveSchema = z.object({
  notes: z.string().trim().max(1000).optional().nullable(),
  accountCode: z.string().trim().min(1).max(100).optional().nullable(),
});

export const RejectSchema = z.object({
  reason: z.string().trim().min(1, 'Denial reason is required').max(1000),
});

export const AssignAccountSchema = z.object({
  accountCode: z.string().trim().min(1, 'Account code is required').max(100),
});

export const IssuePOSchema = z.object({
  poNumber: z.string().trim().min(1).max(100).optional(),
});

// TypeScript DTO types inferred from schemas
export type CreatePurchaseOrderDto = z.infer<typeof CreatePurchaseOrderSchema>;
export type UpdatePurchaseOrderDto = z.infer<typeof UpdatePurchaseOrderSchema>;
export type PoItemDto = z.infer<typeof PoItemSchema>;
export type ApproveDto = z.infer<typeof ApproveSchema>;
export type RejectDto = z.infer<typeof RejectSchema>;
```

---

### 9.2 Backend Validation Middleware Usage Example

```typescript
// c:\Tech-V2\backend\src\routes\purchaseOrder.routes.ts (no changes needed — example only)

import { validateRequest } from '../middleware/validation';
import {
  CreatePurchaseOrderSchema,
  UpdatePurchaseOrderSchema,
  PurchaseOrderQuerySchema,
} from '@tech-v2/shared';  // ← Import from shared once migration is complete

router.post(
  '/',
  validateRequest(CreatePurchaseOrderSchema, 'body'),
  requireModule('REQUISITIONS', 2),
  purchaseOrderController.createPurchaseOrder,
);

// For query params — fix the transform issue:
// Option A: Use parsedQuery middleware approach (in validation.ts)
// Option B: Keep re-parsing in service but document it is intentional
router.get(
  '/',
  validateRequest(PurchaseOrderQuerySchema, 'query'),  // Validates but doesn't transform
  requireModule('REQUISITIONS', 1),
  purchaseOrderController.getPurchaseOrders,
);
```

---

### 9.3 React Hook Form + MUI + Zod Resolver — PO Form Example

```tsx
// c:\Tech-V2\frontend\src\pages\PurchaseOrders\RequisitionWizard.tsx
// (Partial refactor showing Step 1 and Step 2 with RHF + Zod)

import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CreatePurchaseOrderSchema } from '@tech-v2/shared';
import { TextField, Button, Box, Typography } from '@mui/material';

type FormValues = z.infer<typeof CreatePurchaseOrderSchema>;

export default function RequisitionWizard() {
  const {
    control,
    handleSubmit,
    trigger,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(CreatePurchaseOrderSchema),
    defaultValues: {
      title: 'Purchase Order',
      workflowType: 'standard',
      items: [{ description: '', quantity: 1, unitPrice: 0, model: '' }],
    },
    mode: 'onBlur',
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: 'items',
  });

  // Validate only Step 1 fields before advancing
  const handleStep1Next = async () => {
    const valid = await trigger(['vendorId', 'shipTo', 'notes']);
    if (valid) setActiveStep(1);
  };

  const handleStep2Next = async () => {
    const valid = await trigger(['items']);
    if (valid) setActiveStep(2);
  };

  return (
    <Box>
      {/* Step 1 — Details */}
      {activeStep === 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Vendor selection omitted for brevity — wire through Controller */}

          <Controller
            name="shipTo"
            control={control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                label="Ship To Address"
                multiline
                rows={3}
                error={!!fieldState.error}
                helperText={
                  fieldState.error?.message ??
                  `${(field.value ?? '').length}/500 characters`
                }
                inputProps={{ maxLength: 500 }}
              />
            )}
          />

          <Controller
            name="notes"
            control={control}
            render={({ field, fieldState }) => (
              <TextField
                {...field}
                label="Notes"
                multiline
                rows={4}
                error={!!fieldState.error}
                helperText={
                  fieldState.error?.message ??
                  `${(field.value ?? '').length}/2000 characters`
                }
                inputProps={{ maxLength: 2000 }}
              />
            )}
          />

          <Button
            variant="contained"
            onClick={handleStep1Next}
            disabled={isSubmitting}
          >
            Next: Line Items
          </Button>
        </Box>
      )}

      {/* Step 2 — Line Items */}
      {activeStep === 1 && (
        <Box>
          {fields.map((field, index) => (
            <Box key={field.id} sx={{ display: 'flex', gap: 2, mb: 2 }}>
              <Controller
                name={`items.${index}.description`}
                control={control}
                render={({ field: f, fieldState }) => (
                  <TextField
                    {...f}
                    label="Description *"
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    inputProps={{ maxLength: 500 }}
                    sx={{ flex: 3 }}
                  />
                )}
              />
              <Controller
                name={`items.${index}.quantity`}
                control={control}
                render={({ field: f, fieldState }) => (
                  <TextField
                    {...f}
                    type="number"
                    label="Qty *"
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    inputProps={{ min: 1, step: 1 }}
                    sx={{ flex: 1 }}
                    onChange={(e) => f.onChange(Number(e.target.value))}
                  />
                )}
              />
              <Controller
                name={`items.${index}.unitPrice`}
                control={control}
                render={({ field: f, fieldState }) => (
                  <TextField
                    {...f}
                    type="number"
                    label="Unit Price *"
                    error={!!fieldState.error}
                    helperText={fieldState.error?.message}
                    inputProps={{ min: 0.01, step: 0.01 }}
                    sx={{ flex: 1 }}
                    onChange={(e) => f.onChange(Number(e.target.value))}
                  />
                )}
              />
            </Box>
          ))}
          <Button onClick={() => append({ description: '', quantity: 1, unitPrice: 0 })}>
            Add Item
          </Button>
          <Button variant="contained" onClick={handleStep2Next}>
            Next: Review
          </Button>
        </Box>
      )}
    </Box>
  );
}
```

---

### 9.4 Field-Level Error Display Pattern (Reusable)

```tsx
// c:\Tech-V2\frontend\src\components\forms\ValidatedTextField.tsx
// Reusable wrapper for consistent error display across all forms

import { Controller, Control, FieldPath, FieldValues } from 'react-hook-form';
import { TextField, TextFieldProps } from '@mui/material';

type Props<T extends FieldValues> = TextFieldProps & {
  name: FieldPath<T>;
  control: Control<T>;
  maxLength?: number;
  showCounter?: boolean;
};

export function ValidatedTextField<T extends FieldValues>({
  name,
  control,
  maxLength,
  showCounter,
  label,
  ...rest
}: Props<T>) {
  return (
    <Controller
      name={name}
      control={control}
      render={({ field, fieldState }) => {
        const charCount = String(field.value ?? '').length;
        const counterText = showCounter && maxLength
          ? `${charCount}/${maxLength} characters`
          : undefined;

        return (
          <TextField
            {...field}
            {...rest}
            label={label}
            error={!!fieldState.error}
            helperText={fieldState.error?.message ?? counterText ?? rest.helperText}
            inputProps={{
              ...rest.inputProps,
              ...(maxLength ? { maxLength } : {}),
            }}
          />
        );
      }}
    />
  );
}

// Usage in any form:
// <ValidatedTextField
//   name="notes"
//   control={form.control}
//   label="Notes"
//   multiline
//   rows={4}
//   maxLength={2000}
//   showCounter
// />
```

---

## Sources and References

1. **OWASP Input Validation Cheat Sheet** — https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html
   - Allowlist validation strategy, syntactic + semantic validation, server-side enforcement requirement

2. **OWASP XSS Prevention Cheat Sheet** — https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html
   - React framework output encoding, DOMPurify recommendation, safe sinks vs dangerous sinks

3. **OWASP Mass Assignment Cheat Sheet** — https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
   - DTO pattern for allow-listing fields, NodeJS exploit vectors

4. **Express.js Security Best Practices** — https://expressjs.com/en/advanced/best-practice-security.html
   - Helmet usage, input sanitization, TLS configuration

5. **Zod Documentation** — https://zod.dev/
   - Schema API, `.parse()` vs `.safeParse()`, `.superRefine()`, `.transform()`, strict mode

6. **React Hook Form Validation** — https://react-hook-form.com/docs/useform/register
   - `zodResolver`, `mode` options, `useFieldArray`, `trigger()` for multi-step forms

7. **Codebase Analysis** — Direct inspection of:
   - `c:\Tech-V2\backend\src\validators\` (all 15 validator files)
   - `c:\Tech-V2\backend\src\routes\` (all 15 route files)
   - `c:\Tech-V2\backend\src\middleware\validation.ts`, `auth.ts`, `csrf.ts`
   - `c:\Tech-V2\frontend\src\pages\PurchaseOrders\RequisitionWizard.tsx`
   - `c:\Tech-V2\frontend\src\components\inventory\InventoryFormDialog.tsx`
   - `c:\Tech-V2\frontend\src\pages\admin\AdminSettings.tsx`
   - `c:\Tech-V2\frontend\src\pages\FieldTrip\FieldTripRequestPage.tsx`
   - `c:\Tech-V2\backend\src\server.ts` (rate limiting, Helmet, CORS)
   - `c:\Tech-V2\frontend\nginx.conf` (HTTPS, HSTS, CSP context)
   - `c:\Tech-V2\backend\prisma\schema.prisma` (all data models)

---

*End of Specification Document*
