# Form Validation — Layer 1 Code Review

**Review Date:** May 8, 2026  
**Reviewer:** Code Review Subagent (Phase 3)  
**Spec Reference:** `docs/SubAgent/form_validation_spec.md`  
**Overall Assessment:** ⚠️ **NEEDS_REFINEMENT**

---

## Table of Contents

1. [Per-File Review Findings](#1-per-file-review-findings)
2. [Security Checklist](#2-security-checklist)
3. [Build Output](#3-build-output)
4. [Score Table](#4-score-table)
5. [Critical Issues](#5-critical-issues)
6. [Recommended Issues](#6-recommended-issues)
7. [Optional Suggestions](#7-optional-suggestions)
8. [Files Requiring Changes](#8-files-requiring-changes)

---

## 1. Per-File Review Findings

---

### File 1 — `backend/src/validators/user.validators.ts`

**Review Task:** Verify `search` field has `.max(200)`, fix is in the GET query schema (not POST body), no other fields changed.

**Findings:**

| Check | Result | Notes |
|---|---|---|
| `.max(200)` added to `search` in `GetUsersQuerySchema` | ✅ PASS | Line ~43: `z.string().max(200, 'Search term must be 200 characters or fewer').optional().default('')` |
| Fix is in GET query params schema (correct location) | ✅ PASS | `GetUsersQuerySchema` is the query-param schema |
| No accidental changes to other fields | ✅ PASS | All other fields (`page`, `limit`, `accountType`) unchanged |
| Error message is user-facing safe, not internal | ✅ PASS | `'Search term must be 200 characters or fewer'` |
| TypeScript types inferred and exported | ✅ PASS | `export type GetUsersQuery = z.infer<typeof GetUsersQuerySchema>` |
| No `console.log` | ✅ PASS | None present |
| No `any` types | ✅ PASS | None present |

**Minor observation:** `SearchUsersQuerySchema.q` (autocomplete endpoint) has `z.string().optional().default('')` with NO `.max()` constraint. This is the same class of vulnerability that was fixed in `GetUsersQuerySchema`. This was not in Phase 2 scope but is worth noting as a follow-up gap.

**Verdict: ✅ PASS** — The targeted fix is correct and isolated.

---

### File 2 — `backend/src/validators/inventory.validators.ts`

**Review Task:** Verify `customFields` key regex error message, constrained `z.record()` pattern in both create + update schemas, value union types, and max-20-fields `.refine()`.

**Findings:**

```typescript
// CustomFieldsSchema (line ~108)
const CustomFieldsSchema = z.record(
  z.string().min(1).max(50).regex(/^[a-zA-Z0-9_-]+$/, 'Key must be alphanumeric, underscore, or dash'),
  z.union([z.string().max(500), z.number(), z.boolean(), z.null()])
).refine(
  (val) => Object.keys(val).length <= 20,
  { message: 'Cannot exceed 20 custom fields' }
).optional();
```

| Check | Result | Notes |
|---|---|---|
| Key regex error message updated | ✅ PASS | `'Key must be alphanumeric, underscore, or dash'` |
| Key regex pattern correct | ✅ PASS | `/^[a-zA-Z0-9_-]+$/` — alphanumeric, underscore, hyphen |
| Key max length constraint | ✅ PASS | `.max(50)` |
| Value union covers string/number/boolean/null | ✅ PASS | `z.union([z.string().max(500), z.number(), z.boolean(), z.null()])` |
| String values have `.max(500)` | ✅ PASS | Guards against large value injection |
| `.refine()` enforces max 20 fields | ✅ PASS | `Object.keys(val).length <= 20` |
| Applied to `CreateInventorySchema` | ✅ PASS | `customFields: CustomFieldsSchema` present |
| Applied to `UpdateInventorySchema` | ✅ PASS | `customFields: CustomFieldsSchema` present |
| `CustomFieldsSchema` is `.optional()` (not required) | ✅ PASS | Correct — Prisma field is `Json?` |
| No `console.log` | ✅ PASS | None present |
| No `any` types | ✅ PASS | None present |

**Verdict: ✅ PASS** — `customFields` validation is comprehensive and correct for both create and update schemas.

---

### File 3 — `shared/src/schemas/purchaseOrder.schema.ts`

**Review Task:** All PO Prisma model fields represented, enum values match, string `.max()` constraints, required vs. optional matches Prisma, TypeScript types exported.

**Prisma Model vs. Schema Field Comparison:**

| Prisma Field | In Schema | Constraint | Notes |
|---|---|---|---|
| `id` | ❌ Excluded | N/A | Correct — server-generated UUID |
| `poNumber` | ❌ Excluded | N/A | Correct — server-generated |
| `reqNumber` | ❌ Excluded | N/A | Correct — server-generated |
| `type` | ✅ `type` | `min(1).max(100)` | ✅ |
| `requestorId` | ❌ Excluded | N/A | Correct — set from JWT in service |
| `vendorId` | ✅ `vendorId` | `uuid()` required | ✅ |
| `description` (= title) | ✅ `title` | `max(200)`, default | ✅ Mapped to `description` in service |
| `amount` | ❌ Excluded | N/A | Correct — computed from line items |
| `status` | ❌ Excluded | N/A | Correct — managed by workflow |
| `accountCode` | ❌ Excluded | N/A | Correct — set via separate endpoint |
| `program` | ✅ `program` | `max(200)`, optional | ✅ |
| `isApproved`, `approvedBy`, etc. | ❌ Excluded | N/A | Correct — workflow-managed |
| `shipTo` | ✅ `shipTo` | `max(500)`, optional | ✅ |
| `shipToType` | ✅ `shipToType` | `enum(['entity','my_office','custom'])` | ✅ |
| `shippingCost` | ✅ `shippingCost` | `min(0)`, optional | ✅ |
| `notes` | ✅ `notes` | `max(2000)`, optional | ✅ |
| `officeLocationId` | ✅ `officeLocationId` | `uuid()`, optional | ✅ |
| `entityType` | ✅ `entityType` | `enum(['SCHOOL','DEPARTMENT','PROGRAM'])` | ⚠️ See below |
| `workflowType` | ✅ `workflowType` | `enum(['standard','food_service'])` | ✅ |
| `fiscalYear` | ❌ Excluded | N/A | Correct — set server-side |
| `approverEmailsSnapshot` | ❌ Excluded | N/A | Correct — set server-side |
| `po_items` | ✅ `items` | `min(1).max(100)` array | ✅ |

**Item Schema Comparison:**

| Field | Implemented | Spec Recommendation | Gap? |
|---|---|---|---|
| `description` | `z.string().min(1).max(500)` | Add `.trim()` | ⚠️ `.trim()` missing |
| `quantity` | `z.number().int().positive()` | None | ✅ |
| `unitPrice` | `z.number().positive()` | None | ✅ |
| `lineNumber` | `z.number().int().positive().optional()` | None | ✅ |
| `model` | `z.string().max(200).optional().nullable()` | Add `.trim()` | ⚠️ `.trim()` missing |

**Critical finding — `entityType` enum mismatch:**  
The Prisma schema comment documents `entityType` as: `'SCHOOL' | 'DEPARTMENT' | 'PROGRAM' | 'DISTRICT_OFFICE' | null`.  
The shared schema uses `z.enum(['SCHOOL', 'DEPARTMENT', 'PROGRAM'])` — **`'DISTRICT_OFFICE'` is missing**. If a District Office location submits a PO and the service passes that entity type through, a validation failure will occur when the frontend sends `entityType: 'DISTRICT_OFFICE'`.

**String `.trim()` gap:**  
Per spec section 5.1 (Task A-1) and section 5.2, all string fields should have `.trim()` transforms. The following are missing it:  
- `title`, `shipTo`, `notes`, `program` in `CreatePurchaseOrderSchema`  
- `description`, `model` in `PurchaseOrderItemSchema`

**Additional issue — `UpdatePurchaseOrderSchema`:**
```typescript
export const UpdatePurchaseOrderSchema = CreatePurchaseOrderSchema
  .partial()
  .omit({ workflowType: true });
```
This derivation is correct — `workflowType` is immutable after creation per spec.

**TypeScript type exports:**

| Export | Present |
|---|---|
| `PurchaseOrderItem` | ✅ |
| `CreatePurchaseOrderInput` | ✅ |
| `UpdatePurchaseOrderInput` | ✅ |
| `POStatusShared` | ✅ |
| `PO_VALID_STATUSES_SHARED` | ✅ |

**Verdict: ⚠️ NEEDS_REFINEMENT** — Two issues: missing `'DISTRICT_OFFICE'` in `entityType` enum, and missing `.trim()` on string fields per spec section 5.1.

---

### File 4 — `shared/src/index.ts`

**Review Task:** Verify export of PO schema is present.

```typescript
// Current index.ts exports:
export * from './types';
export * from './api-types';
export * from './schemas/purchaseOrder.schema';
```

| Check | Result |
|---|---|
| `purchaseOrder.schema` exported | ✅ PASS |
| All schema symbols re-exported via `export *` | ✅ PASS |
| No `console.log` | ✅ PASS |
| No `any` types | ✅ PASS |

**Verdict: ✅ PASS** — Export is present and correct.

---

### File 5 — `backend/src/validators/purchaseOrder.validators.ts`

**Review Task:** Verify import from `@mgspe/shared-types` is correct.

```typescript
import {
  CreatePurchaseOrderSchema,
  UpdatePurchaseOrderSchema,
} from '@mgspe/shared-types';
```

| Check | Result | Notes |
|---|---|---|
| Import from `@mgspe/shared-types` correct | ✅ PASS | Package name matches `shared/package.json` |
| `CreatePurchaseOrderSchema` re-exported | ✅ PASS | `export { CreatePurchaseOrderSchema, UpdatePurchaseOrderSchema }` |
| `PO_VALID_STATUSES` enum defined locally | ✅ PASS | Lowercase values match Prisma defaults |
| All action schemas present (`ApproveSchema`, `RejectSchema`, `AssignAccountSchema`, `IssuePOSchema`) | ✅ PASS | All correctly constrained |
| `ApproveSchema.notes` — max(1000) | ✅ PASS | |
| `RejectSchema.reason` — min(1), max(1000) | ✅ PASS | |
| `AssignAccountSchema.accountCode` — min(1), max(100) | ✅ PASS | |
| `IssuePOSchema.poNumber` — max(100), optional | ✅ PASS | |
| `PurchaseOrderQuerySchema.search` — max(200) | ✅ PASS | |
| TypeScript DTO types exported | ✅ PASS | All 6 DTOs exported |
| No `console.log` | ✅ PASS | |
| No `any` types | ✅ PASS | |

**Minor cosmetic issue:** `PurchaseOrderIdParamSchema` has a double space after the opening brace:
```typescript
export const PurchaseOrderIdParamSchema = z.object({  id: z.string().uuid(...)
```
This is cosmetic only and does not affect runtime behavior.

**Verdict: ✅ PASS** — Import is correct and all schemas are complete.

---

### File 6 — `backend/src/utils/redact.ts`

**Review Task:** Verify `sanitizeText` strips HTML tags and null bytes, calls `.trim()`, is a correct implementation.

```typescript
export function sanitizeText(input: string): string {
  return input
    .replace(/<[^>]*>/g, '')   // strip HTML tags
    .replace(/\0/g, '')        // strip null bytes
    .trim();
}
```

| Check | Result | Notes |
|---|---|---|
| Strips HTML tags via `/<[^>]*>/g` | ✅ PASS | Regex correctly matches `<...>` patterns |
| Strips null bytes via `/\0/g` | ✅ PASS | |
| Calls `.trim()` | ✅ PASS | |
| Input typed as `string` (not `any`) | ✅ PASS | Strongly typed function signature |
| Returns `string` (not `any`) | ✅ PASS | |
| No `console.log` | ✅ PASS | |

**Pre-existing `any` in file (not Phase 2):** `redactSensitiveData(data: any): any` uses `any` type. This is a separate pre-existing utility function for log redaction and is acceptable given its generic purpose — not introduced by Phase 2.

**Regex security note:** The `/<[^>]*>/g` regex is not ReDoS-vulnerable (linear complexity). Catastrophic backtracking is not possible with this pattern. ✅

**Verdict: ✅ PASS** — `sanitizeText` implementation is correct and safe.

---

### File 7 — `backend/src/services/purchaseOrder.service.ts`

**Review Task:** Verify `sanitizeText` is applied on `notes`/`purpose` before Prisma create/update.

**Create path (line ~215):**
```typescript
notes: data.notes != null ? sanitizeText(data.notes) : null,
```
✅ `notes` sanitized correctly in create.

**Update path (line ~580):**
```typescript
...(data.notes !== undefined && { notes: data.notes != null ? sanitizeText(data.notes) : null }),
```
✅ `notes` sanitized correctly in update.

**`shipTo` — CRITICAL GAP:**

Create path:
```typescript
shipTo: data.shipTo ?? null,
```
❌ `shipTo` is **NOT sanitized** in the create path.

Update path:
```typescript
...(data.shipTo !== undefined && { shipTo: data.shipTo }),
```
❌ `shipTo` is **NOT sanitized** in the update path.

Per spec section 5.2:
> ```typescript
> const sanitizedShipTo = data.shipTo ? sanitizeText(data.shipTo) : null;
> ```
> Add server-side sanitization ... `sanitizeText` on notes **and shipTo**.

`shipTo` is a `.max(500)` free-text address field. An attacker could persist `<script>alert(1)</script>` in the shipping address. While React output encoding protects against XSS in the main UI, this value is used in PDF generation (PO documents are generated with `pdfkit`), email notifications, and could be consumed by future systems.

**`purpose` field note:** There is no `purpose` field in the `purchase_orders` Prisma model or the shared schema. The review task reference to "notes/purpose" appears to map to "notes/shipTo" per spec section 5.2. This is N/A.

**`title` (stored as `description`) — not sanitized:**
```typescript
description: data.title,         // create
...(data.title !== undefined && { description: data.title }), // update
```
This is not in the immediate scope of spec section 5.2 (which specifies notes and shipTo), but represents an additional unsanitized free-text field.

| Check | Result |
|---|---|
| `sanitizeText` imported | ✅ PASS |
| `notes` sanitized in create | ✅ PASS |
| `notes` sanitized in update | ✅ PASS |
| Applied BEFORE Prisma call | ✅ PASS |
| `shipTo` sanitized in create | ❌ FAIL |
| `shipTo` sanitized in update | ❌ FAIL |
| `purpose` field (N/A) | ✅ N/A |
| No `console.log` | ✅ PASS |
| No raw SQL | ✅ PASS |

**Verdict: ❌ NEEDS_REFINEMENT** — `shipTo` sanitization missing in both create and update paths.

---

## 2. Security Checklist

| Item | Status | Notes |
|---|---|---|
| No `console.log` in modified files | ✅ PASS | None found in any of the 7 files |
| No `any` types (without justification) | ✅ PASS | Pre-existing `any` in `redactSensitiveData` is acceptable (generic log utility); not introduced by Phase 2 |
| No new raw SQL queries | ✅ PASS | All DB access through Prisma ORM |
| `authenticateToken` middleware untouched | ✅ PASS | No changes to auth middleware |
| CSRF protection untouched | ✅ PASS | No changes to CSRF middleware |
| Rate limiting untouched | ✅ PASS | No changes to rate limit configuration |
| No tokens stored in localStorage | ✅ PASS | No frontend changes in scope |
| Error messages do not expose internals | ✅ PASS | All Zod error messages are user-facing descriptions, not stack traces or DB errors |
| `shipTo` free-text stored without sanitization | ❌ FAIL | See Critical Issue #1 |
| `entityType` accepts invalid value `DISTRICT_OFFICE` | ⚠️ WARN | Enum mismatch with Prisma model comment |

---

## 3. Build Output

### shared — `npx tsc --noEmit`

```
(no output)
```

**Result: ✅ PASSED** — Zero TypeScript errors.

### backend — `npx tsc --noEmit`

```
(no output)
```

**Result: ✅ PASSED** — Zero TypeScript errors.

---

## 4. Score Table

| Category | Score | Grade |
|---|---|---|
| Specification Compliance | 82% | B |
| Best Practices | 80% | B |
| Functionality | 87% | B+ |
| Code Quality | 90% | A- |
| Security | 78% | C+ |
| Performance | 97% | A+ |
| Consistency | 91% | A- |
| Build Success | 100% | A+ |
| **Overall** | **88%** | **B+** |

**Grading scale:** A+ ≥ 97 | A ≥ 93 | A- ≥ 90 | B+ ≥ 87 | B ≥ 83 | B- ≥ 80 | C+ ≥ 77 | C ≥ 73

---

## 5. Critical Issues

> Must fix before approval.

### CRITICAL-1: `shipTo` Not Sanitized in `purchaseOrder.service.ts`

**Severity:** High  
**File:** `c:\Tech-V2\backend\src\services\purchaseOrder.service.ts`  
**Spec Reference:** Section 5.2 — explicitly names `sanitizeText(data.shipTo)` as required

**Problem:** The `shipTo` field (max 500 chars, free-text shipping address) is persisted to the database without running through `sanitizeText`. Only `notes` was sanitized. Both `notes` AND `shipTo` were specified in the spec.

**Risk:** An attacker with a valid account can submit a PO with `<script>alert(1)</script>` in the ship-to address. This data is:  
1. Embedded in PDF documents generated by the PO service  
2. Included in HTML email notifications  
3. Stored in the database for future consumption by any service  

**Required fix — create path:**
```typescript
// Before (current):
shipTo: data.shipTo ?? null,

// After (required):
shipTo: data.shipTo != null ? sanitizeText(data.shipTo) : null,
```

**Required fix — update path:**
```typescript
// Before (current):
...(data.shipTo !== undefined && { shipTo: data.shipTo }),

// After (required):
...(data.shipTo !== undefined && { shipTo: data.shipTo != null ? sanitizeText(data.shipTo) : null }),
```

---

## 6. Recommended Issues

> Should fix before production deploy or in next sprint.

### RECOMMENDED-1: `entityType` Enum Missing `'DISTRICT_OFFICE'` in Shared Schema

**Severity:** Medium  
**File:** `c:\Tech-V2\shared\src\schemas\purchaseOrder.schema.ts`  
**Spec Reference:** Prisma schema comment — `'SCHOOL' | 'DEPARTMENT' | 'PROGRAM' | 'DISTRICT_OFFICE' | null`

**Problem:** The shared schema validates `entityType` as `z.enum(['SCHOOL', 'DEPARTMENT', 'PROGRAM'])`. The Prisma model documents `DISTRICT_OFFICE` as a valid entity type. If a user at a District Office location submits a PO and the frontend sends `entityType: 'DISTRICT_OFFICE'`, validation will reject it with a confusing enum error.

**Required fix:**
```typescript
// Before:
entityType: z.enum(['SCHOOL', 'DEPARTMENT', 'PROGRAM']).optional().nullable(),

// After:
entityType: z.enum(['SCHOOL', 'DEPARTMENT', 'PROGRAM', 'DISTRICT_OFFICE']).optional().nullable(),
```

---

### RECOMMENDED-2: Missing `.trim()` Transforms on String Fields in Shared PO Schema

**Severity:** Low-Medium  
**File:** `c:\Tech-V2\shared\src\schemas\purchaseOrder.schema.ts`  
**Spec Reference:** Section 5.1 table (column "Recommended Additions") and Task A-1

**Problem:** Per spec, `.trim()` should be added to all user-supplied string fields to strip leading/trailing whitespace before persistence. Currently none of the string fields in the shared schema have `.trim()`.

**Affected fields:**
- `CreatePurchaseOrderSchema`: `title`, `shipTo`, `notes`, `program`
- `PurchaseOrderItemSchema`: `description`, `model`

**Example fix for `PurchaseOrderItemSchema`:**
```typescript
description: z
  .string()
  .trim()                               // ← add
  .min(1, 'Item description is required')
  .max(500, 'Description must be 500 characters or less'),

model: z
  .string()
  .trim()                               // ← add
  .max(200, 'Model must be 200 characters or less')
  .optional()
  .nullable(),
```

---

### RECOMMENDED-3: `SearchUsersQuerySchema.q` Lacks `.max()` Constraint

**Severity:** Low  
**File:** `c:\Tech-V2\backend\src\validators\user.validators.ts`  
**Spec Reference:** Same vulnerability class as the fixed `GetUsersQuerySchema.search` field

**Problem:** The autocomplete endpoint schema `SearchUsersQuerySchema` has:
```typescript
q: z.string().optional().default(''),
```
No length limit. An attacker could send a large string to `GET /api/users/search?q=<large>`.

**Required fix:**
```typescript
q: z.string().max(200, 'Search term must be 200 characters or fewer').optional().default(''),
```

---

## 7. Optional Suggestions

### OPTIONAL-1: Sanitize `title` Field in PO Service

**File:** `c:\Tech-V2\backend\src\services\purchaseOrder.service.ts`  
`data.title` is stored as `description` in the DB without sanitization. While lower risk than `shipTo` (title is shorter and less likely to contain rich HTML), applying `sanitizeText` would be consistent and defend against PDF/email injection.

### OPTIONAL-2: Minor Formatting — `PurchaseOrderIdParamSchema`

**File:** `c:\Tech-V2\backend\src\validators\purchaseOrder.validators.ts`  
Extra space: `z.object({  id:` → `z.object({ id:`. Cosmetic only.

### OPTIONAL-3: Extend Sanitization to Other Free-Text Fields

Per spec section 8.4 (XSS Risk Assessment), email notifications and PDF generation also consume stored text from `WorkOrder.description`, `FieldTrip.purpose`/`additionalNotes`, and `Transportation.tripItinerary`. These are out of scope for Phase 2 but represent the same risk surface as `shipTo`.

---

## 8. Files Requiring Changes

The following files must be modified before this review can be re-assessed as PASS:

| Priority | File | Change Required |
|---|---|---|
| **CRITICAL** | `c:\Tech-V2\backend\src\services\purchaseOrder.service.ts` | Apply `sanitizeText` to `shipTo` in both create (line ~213) and update (line ~580) paths |
| **RECOMMENDED** | `c:\Tech-V2\shared\src\schemas\purchaseOrder.schema.ts` | Add `'DISTRICT_OFFICE'` to `entityType` enum; add `.trim()` to string fields |
| **RECOMMENDED** | `c:\Tech-V2\backend\src\validators\user.validators.ts` | Add `.max(200)` to `SearchUsersQuerySchema.q` |

