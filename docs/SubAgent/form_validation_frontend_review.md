# Form Validation Frontend Review
**Tech-V2 — Phase 2, Layer 2**  
**Review Date:** May 8, 2026  
**Reviewed by:** Code Review Subagent  
**Status:** NEEDS_REFINEMENT

---

## 1. Overall Assessment

**NEEDS_REFINEMENT**

The implementation successfully migrates the `RequisitionWizard` from ad-hoc boolean-flag validation to React Hook Form + Zod (`CreatePurchaseOrderSchema`). The core RHF architecture is correct — `useForm` with `zodResolver`, `useFieldArray` for line items, `Controller` for complex controls, `register` for simple inputs, and `handleSubmit` wrapping both submit paths. The build passes cleanly. However, several specification requirements are incomplete: the `getFieldError` helper is never used, four fields render no error message when Zod fails them, two item table fields show error state without any error text, and `officeLocationId` is not registered with RHF at all.

---

## 2. Build Result

| Package | Command | Result |
|---|---|---|
| `@mgspe/shared-types` | `npx tsc --noEmit` | **PASSED** — no output |
| `frontend` | `npx tsc --noEmit` | **PASSED** — no output |

---

## 3. Score Table

| Category | Score | Grade |
|---|---|---|
| Specification Compliance | 68% | D+ |
| Best Practices | 78% | C+ |
| Functionality | 80% | B- |
| Code Quality | 83% | B |
| Security | 93% | A |
| Performance | 90% | A- |
| Consistency | 70% | C+ |
| Build Success | 100% | A+ |
| **Overall** | **83%** | **B** |

---

## 4. File-by-File Review

### 4.1 `formHelpers.ts` — NEW

**Verdict: CORRECT but UNUSED**

```typescript
export function getFieldError(error?: FieldError) {
  return {
    error: !!error,
    helperText: error?.message ?? '',
  };
}
```

| Check | Result |
|---|---|
| Signature: takes `FieldError \| undefined` | ✅ (optional parameter) |
| Returns `{ error: boolean, helperText: string }` | ✅ |
| No `any` types | ✅ |
| Exported | ✅ |
| **Used anywhere in the codebase** | ❌ NEVER IMPORTED |

The helper is well-written and correct. It is **never imported or used** — not in `RequisitionWizard.tsx`, not anywhere else in the frontend. This is dead code. The spec required this helper to be the standard pattern for wiring RHF errors to MUI TextFields.

---

### 4.2 `RequisitionWizard.tsx` — MODIFIED

#### Architecture Checks

| Check | Result | Notes |
|---|---|---|
| `useForm` with `zodResolver(CreatePurchaseOrderSchema)` | ✅ | Line ~130 |
| `defaultValues` set correctly | ✅ | All schema fields covered |
| `useFieldArray` for line items | ✅ | `{ control, name: 'items' }` |
| `handleSubmit` wraps both submit paths | ✅ | `handleSaveDraft` + `handleSaveAndSubmit` |
| `Controller` for complex MUI components | ⚠️ Partial | shipTo ✅, notes ✅, shippingCost ✅, **officeLocationId ❌** |
| `register` for simple text/number inputs | ✅ | model, description, quantity, unitPrice |
| `useForm<CreatePurchaseOrderInput>` generic | ❌ Missing | `useForm({...})` — no type param |
| Field-level error display — vendorId | ✅ | `error={!!errors.vendorId}` + `helperText={errors.vendorId?.message}` |
| Field-level error display — shipTo | ❌ | Controller renders TextField with no `error`/`helperText` |
| Field-level error display — notes | ❌ | Controller renders TextField with no `error`/`helperText` |
| Field-level error display — shippingCost | ❌ | Controller renders TextField with no `error`/`helperText` |
| Field-level error display — officeLocationId | ❌ | Not in Controller; no error display possible |
| Field-level error display — items[].description | ✅ | `error` + `helperText` both set |
| Field-level error display — items[].quantity | ⚠️ | `error` set, **no `helperText`** — user sees red field, no message |
| Field-level error display — items[].unitPrice | ⚠️ | `error` set, **no `helperText`** — user sees red field, no message |

#### Regression Checks

| Check | Result |
|---|---|
| `useQuery` / `useMutation` hooks present and unchanged | ✅ |
| Loading state (vendorsLoading + CircularProgress) | ✅ |
| Error state (submitError Alert with onClose) | ✅ |
| MUI component structure / layout | ✅ |
| `useNavigate` | ✅ |
| Disregard confirmation dialog | ✅ |
| Responsive behavior (`useIsMobile`) | ✅ |
| Pending state (`isSaving` guards both submit buttons) | ✅ |

#### Code Quality Checks

| Check | Result | Notes |
|---|---|---|
| No `any` types in new code | ✅ | Error casts use typed inline expression |
| No `console.log` statements | ✅ | |
| Unused `useState` removed | ✅ | `selectedVendor` / `selectedEntitySupervisor` are display-only, correct |
| No duplicate state for form fields | ✅ | RHF owns all form data; display state is separate |
| `step1Valid` / `step2Valid` boolean flags | ⚠️ | **Still present** — computed from `watch()` values. Partially duplicates Zod rules. Spec said replace these. |
| `getFieldError` imported and used | ❌ | Not imported in this file |
| `useCallback` for expensive handlers | ✅ | `handleEntityLocationChange` wrapped |
| `useMemo` for derived data | ✅ | `groupedLocations` memoized |

---

### 4.3 `api.ts` — CSRF Interceptor (Pre-existing, Verified)

| Check | Result | Notes |
|---|---|---|
| CSRF token added to POST/PUT/PATCH/DELETE | ✅ | `CSRF_PROTECTED_METHODS` set |
| Token source: response header `x-csrf-token` | ✅ | Backend sends `X-CSRF-Token`; Axios normalizes to lowercase |
| Token sent as: `x-xsrf-token` | ✅ | Backend `CSRF_HEADER_NAME = 'x-xsrf-token'` — exact match |
| Backend fallback header check | ✅ | Backend also accepts `x-csrf-token` as fallback |
| No sensitive data logged | ✅ | |
| Token stored in module-level `let` (not localStorage) | ✅ | In-memory only; cleared on page reload |
| Cookie is `HttpOnly: true` + `SameSite: strict` | ✅ (backend) | Header reflection used to deliver token to JS — valid pattern |
| `as any` cast on `error.config` | ⚠️ | Pre-existing; not introduced by this PR |

**CSRF pattern is secure.** The backend generates a token, sets it as an `HttpOnly` + `SameSite=strict` cookie AND reflects it in the `X-CSRF-Token` response header. The frontend caches the header value in memory and sends it back as `x-xsrf-token`. Backend validates using `crypto.timingSafeEqual`. This is a correct synchronized-token pattern via header reflection.

---

### 4.4 `purchaseOrder.schema.ts` — Shared Schema (Pre-existing, Verified)

| Check | Result | Notes |
|---|---|---|
| Exported as `CreatePurchaseOrderSchema` | ✅ | Named export |
| Exported as `CreatePurchaseOrderInput` type | ✅ | `z.infer<typeof CreatePurchaseOrderSchema>` |
| Re-exported from `@mgspe/shared-types` index | ✅ | `export * from './schemas/purchaseOrder.schema'` |
| Frontend import: `import { CreatePurchaseOrderSchema } from '@mgspe/shared-types'` | ✅ | |
| Frontend type import: `import type { CreatePurchaseOrderInput } from '@mgspe/shared-types'` | ✅ | |
| All required form fields match schema fields | ✅ | `vendorId`, `items`, `title`, `type`, etc. |
| Optional schema fields handled as nullable in defaultValues | ✅ | `shipTo: null`, `notes: null`, etc. |
| `program` field in schema has no UI control | ℹ️ | Intentional (defaults to `null`) — acceptable |
| `type` field in schema has no UI control | ℹ️ | Defaults to `'general'` — acceptable |

---

## 5. CRITICAL Issues (Must Fix)

### CRIT-1 — `getFieldError` helper defined but never used

**File:** `c:\Tech-V2\frontend\src\utils\formHelpers.ts` (and `RequisitionWizard.tsx`)

The spec explicitly created this helper as the standard pattern for MUI + RHF error display. It is never imported in `RequisitionWizard.tsx` or any other file. This is dead code and a missed spec requirement.

**Fix:** Import and use `getFieldError` in the item table fields and any simple text inputs with error states. Example for `description`:

```tsx
// Before
error={!!errors.items?.[index]?.description}
helperText={errors.items?.[index]?.description?.message}

// After
import { getFieldError } from '@/utils/formHelpers';
...
{...getFieldError(errors.items?.[index]?.description)}
```

---

### CRIT-2 — Field-level errors silently swallowed for `shipTo`, `notes`, `shippingCost`

**File:** `c:\Tech-V2\frontend\src\pages\PurchaseOrders\RequisitionWizard.tsx`

Three `Controller`-rendered TextFields have no `error` or `helperText` props. If Zod rejects a value (e.g., `notes` > 2000 chars, `shippingCost` < 0), the form will block submission but show no field-level feedback. Users are stranded on the Review step with no indication of why Save/Submit is disabled.

**Fix for `notes` Controller (same pattern for `shipTo` and `shippingCost`):**

```tsx
<Controller
  control={control}
  name="notes"
  render={({ field }) => (
    <TextField
      {...field}
      value={field.value ?? ''}
      onChange={(e) => field.onChange(e.target.value || null)}
      label="Notes / Special Instructions"
      multiline
      minRows={3}
      fullWidth
      inputProps={{ maxLength: 2000 }}
      error={!!errors.notes}
      helperText={errors.notes?.message ?? `${(field.value ?? '').length}/2000`}
    />
  )}
/>
```

---

### CRIT-3 — `officeLocationId` Select not wrapped in Controller

**File:** `c:\Tech-V2\frontend\src\pages\PurchaseOrders\RequisitionWizard.tsx`

The department/location Select uses `value={watchedOfficeLocationId ?? ''}` with a direct `onChange` → `handleEntityLocationChange`. It is not registered through RHF at all. If `officeLocationId` fails schema validation, there is no error display and no form-level tracking.

**Fix:** The `handleEntityLocationChange` function calls `setValue`, so RHF does own the field value. The missing piece is the error display on the Select itself:

```tsx
<FormControl fullWidth error={!!errors.officeLocationId}>
  <InputLabel id="entity-location-label">...</InputLabel>
  <Select ...>
    ...
  </Select>
  {errors.officeLocationId && (
    <FormHelperText>{errors.officeLocationId.message}</FormHelperText>
  )}
</FormControl>
```

*(Import `FormHelperText` from MUI)*

---

### CRIT-4 — `items[].quantity` and `items[].unitPrice` show error state but no message

**File:** `c:\Tech-V2\frontend\src\pages\PurchaseOrders\RequisitionWizard.tsx`

Both fields set `error={!!errors.items?.[index]?.quantity}` but have no `helperText`. The user sees a red field with no explanation ("Must be a whole number", "Must be greater than zero").

**Fix:**
```tsx
// quantity
error={!!errors.items?.[index]?.quantity}
helperText={errors.items?.[index]?.quantity?.message}

// unitPrice
error={!!errors.items?.[index]?.unitPrice}
helperText={errors.items?.[index]?.unitPrice?.message}
```

---

### CRIT-5 — `useForm` missing generic type parameter

**File:** `c:\Tech-V2\frontend\src\pages\PurchaseOrders\RequisitionWizard.tsx`

```tsx
// Current (infers from defaultValues only)
const { control, register, ... } = useForm({

// Required
const { control, register, ... } = useForm<CreatePurchaseOrderInput>({
```

Without the generic, `errors` is typed from the inferred `defaultValues` shape rather than `CreatePurchaseOrderInput`. This means TypeScript won't catch mismatches between the schema and the form fields. The `handleSubmit` callbacks manually annotate `(data: CreatePurchaseOrderInput)` as a workaround, but this is non-idiomatic and fragile.

---

## 6. RECOMMENDED Issues (Should Fix)

### REC-1 — Replace `step1Valid` / `step2Valid` watch-based flags with RHF `trigger()`

The dual validation pattern (Zod for submit, watched values for step navigation) duplicates business rules:

```tsx
// Current — duplicates Zod rules
const step2Valid = watchedItems.every(
  (i) => i.description.trim().length > 0 && i.quantity > 0 && i.unitPrice > 0
);
```

**Preferred pattern:** Call `trigger(['vendorId'])` on "Next" from step 1, and `trigger(['items'])` on "Next" from step 2. This reuses Zod and surfaces field errors without duplication.

---

### REC-2 — Add character counters to `shipTo` and item `description` fields

`notes` shows `${n}/2000`. The `shipTo` field (max 500) and `description` fields (max 500) have `maxLength` in `inputProps` but display no counter. Users cannot see how close they are to the limit.

---

### REC-3 — Validate `items[].model` field error display

`model` uses `register` with `inputProps={{ maxLength: 200 }}` but has no `error` or `helperText`. The schema allows up to 200 chars. Since `maxLength` on the input prevents exceeding the limit, this is lower priority, but if the user pastes programmatically, Zod catches it while the UI does not show the error.

---

## 7. OPTIONAL Suggestions

### OPT-1 — `error.config as any` in `api.ts`

Pre-existing. Can be typed properly with `AxiosRequestConfig & { _retry?: boolean }` to remove the `any`.

### OPT-2 — `program` field

The schema has `program: z.string().trim().max(200).optional().nullable()` but the wizard has no input for it. If program tracking is needed in future, a text field would fit in Step 1 Details. Currently acceptable as a future enhancement.

### OPT-3 — `handleSaveAndSubmit` creates PO then immediately submits (two round-trips)

This is architectural — not introduced here. A backend endpoint that atomically creates-and-submits would be more reliable if the network fails between the two mutations. Out of scope for this review.

---

## 8. Security Checklist Summary

| Check | Result |
|---|---|
| No tokens in localStorage | ✅ |
| No `console.log` leaking form data | ✅ |
| `maxLength` on all free-text inputs | ✅ |
| CSRF protection active and verified end-to-end | ✅ |
| CSRF uses `timingSafeEqual` (timing-attack resistant) | ✅ |
| Auth via HttpOnly cookie (not Authorization header) | ✅ |
| No new sensitive data in component state | ✅ |
| Zod enforces character limits on shared schema | ✅ |
| Backend is final gatekeeper (defense in depth) | ✅ |

---

## 9. Files Requiring Changes

| File | Changes Needed | Priority |
|---|---|---|
| `c:\Tech-V2\frontend\src\pages\PurchaseOrders\RequisitionWizard.tsx` | CRIT-1 (import + use `getFieldError`), CRIT-2 (shipTo/notes/shippingCost error props), CRIT-3 (officeLocationId FormHelperText), CRIT-4 (qty/price helperText), CRIT-5 (useForm generic), REC-1 (trigger-based step nav), REC-2 (counters) | CRITICAL |
| `c:\Tech-V2\frontend\src\utils\formHelpers.ts` | No changes needed — file is correct; just not used yet | — |

---

## 10. What Is Done Well

- RHF core architecture is correctly established (resolver, defaultValues, useFieldArray, handleSubmit)
- `Controller` vs `register` choice is correct for each field type
- Vendor Autocomplete error display is a good model (error + helperText inline)
- `notes` character counter (`${n}/2000`) is excellent UX
- `maxLength` on every free-text `inputProps` prevents runaway input before Zod fires
- `handleEntityLocationChange` correctly uses `setValue` with side-effect derivations (shipToType, workflowType, entityType)
- Display state (`selectedVendor`, `selectedEntitySupervisor`) is correctly separated from form state
- CSRF interceptor is secure and correctly verified end-to-end
- Shared schema export chain works correctly (`purchaseOrder.schema.ts` → `index.ts` → `@mgspe/shared-types`)
- Both TypeScript build checks pass with zero errors
