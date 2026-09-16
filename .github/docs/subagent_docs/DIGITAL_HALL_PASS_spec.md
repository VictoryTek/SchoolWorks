# Digital Hall Pass — Phase 1 Specification

Status: **DRAFT — architecture review, not yet implemented.**
Scope decisions confirmed with user (2026-09-16): real OneRoster/SIS roster integration, Server-Sent Events for realtime delivery, new routes inside the existing SchoolWorks SPA (not a separate app).

---

## 1. Current State Analysis

### 1.1 Auth & roles (verified)
- Auth: MSAL/Entra ID → JWT in HttpOnly cookie ([backend/src/middleware/auth.ts](../../../backend/src/middleware/auth.ts)). `AuthRequest.user` = `{ id, entraId, email, name, roles: string[], groups: string[], permLevel? }`.
- `role` on `User` is a 2-value union (`ADMIN`/`USER`) — not a role hierarchy. Real per-module access is computed live from Entra group membership in [backend/src/utils/groupAuth.ts](../../../backend/src/utils/groupAuth.ts) (`GROUP_MODULE_MAP`, `requireModule(module, minLevel)`).
- **`ENTRA_ALL_STUDENTS_GROUP_ID` already exists and is wired in.** Students already have real Entra accounts, already authenticate into this exact app today, and already have a scoped permission level (submit/view own Technology work orders only — see [backend/src/controllers/work-orders.controller.ts:124-164](../../../backend/src/controllers/work-orders.controller.ts#L124-L164)). This means **no new auth mechanism is needed** for students — we add a new `HALL_PASSES` entry to `GROUP_MODULE_MAP` and gate routes the same way every other module does.
- `docs/PERMISSIONS_AND_ROLES.md` and `docs/permission.md` are stale (describe a legacy DB-table permission system that no longer exists) — do not use them as a reference; `groupAuth.ts` is ground truth.

### 1.2 Student data (verified)
- Students are ordinary rows in `users`, synced from Entra, itself fed at provisioning time by a SIS CSV ([backend/src/services/userProvision.service.ts](../../../backend/src/services/userProvision.service.ts)). Fields available: `employeeId` (`'s' + SIS Student ID`), name, `department` (holds `"Grade {n}"`, parsed into `gradeLevel`), active flag, ELL/ESL flag.
- **No class, section, period, enrollment, or teacher-of-record data exists anywhere in Tech-V2 today.** No OneRoster integration, no Microsoft Graph Education API (`educationClass`/`educationUser`) usage, no School Data Sync. A targeted repo-wide search confirmed zero hits beyond the account-provisioning CSV.
- This is the central gap requirement #2 (route to "current scheduled teacher/class") depends on — it requires a **new** data pipeline, not something layered onto the existing SIS CSV.

### 1.3 Realtime & notifications (verified)
- No WebSocket/SSE library in `backend/package.json` or `frontend/package.json` today.
- Existing "live update" pattern: TanStack Query polling (`staleTime: 30_000`, `refetchInterval: 60_000`, refetch-on-focus) — [frontend/src/hooks/queries/useRequestBadges.ts](../../../frontend/src/hooks/queries/useRequestBadges.ts) / [backend/src/services/requestBadges.service.ts](../../../backend/src/services/requestBadges.service.ts).
- Email ([backend/src/services/email.service.ts](../../../backend/src/services/email.service.ts)) and self-hosted VAPID web-push ([backend/src/services/push.service.ts](../../../backend/src/services/push.service.ts), `push_subscription` Prisma model) exist and are reusable for pass approval/denial pushes, but are too high-latency/best-effort to serve as the primary "your pass was just approved, timer is now running" channel.
- Backend runs as a **single container, single Node process** ([docker-compose.dev.yml](../../../docker-compose.dev.yml) — no replica/scale config). This matters for the realtime design: an in-process `EventEmitter` pub/sub is sufficient; no Redis/message-broker is needed unless the backend is later scaled horizontally (flagged as a risk in §6).
- nginx dev proxy ([frontend/nginx.dev.conf:21-39](../../../frontend/nginx.dev.conf#L21-L39)) already sets `proxy_http_version 1.1` and `Connection: upgrade`, but has no `proxy_buffering off` — required for SSE to stream instead of being buffered.
- CSRF protection ([backend/src/middleware/csrf.ts](../../../backend/src/middleware/csrf.ts)) only guards `POST/PUT/PATCH/DELETE` — an SSE `GET` stream needs no CSRF handling, only the normal cookie-based `authenticate` middleware.

### 1.4 Workflow pattern precedent (verified)
Two existing request/approval entities were reviewed as modeling precedent:
- `FieldTripRequest` ([backend/prisma/schema.prisma:687-796](../../../backend/prisma/schema.prisma#L687)) — multi-week, multi-stage chain with separate `FieldTripApproval` (per-action audit) and `FieldTripStatusHistory` (per-transition log) tables. Too heavy for an entity that lives minutes.
- `TransportationRequest` ([backend/prisma/schema.prisma:1282-1356](../../../backend/prisma/schema.prisma#L1282)) — `status` as a plain string with a documented comment listing valid values, inline approver id/timestamp/reason fields per stage, a denormalized `submitterEmail` snapshot. This is the right shape to copy for `HallPass`: fast-moving, single-object state, no reason to split into a wide audit-table family for MVP.

---

## 2. Problem Definition

Add a digital hall pass feature ("SchoolWorks Pass") allowing:
1. A student to request a hall pass (destination + optional reason) from inside SchoolWorks.
2. The request to route automatically to the teacher of the student's **current class**, determined by a new roster/bell-schedule data source.
3. Real-time status (Requested → Approved/Denied → Active w/ live timer → Ended/Expired) visible to the student, with teacher/hallway-monitor visibility into all currently-active passes.

Given §1.2, requirement #2 is not achievable with existing data — it requires building a new roster ingestion pipeline as part of this feature, not merely a UI/API layer on top of what exists.

---

## 3. Proposed Solution Architecture

### 3.1 New domain: roster ingestion (prerequisite for teacher routing)

A OneRoster 1.2-shaped import, following the exact convention already used for student provisioning (scheduled CSV pickup from a mounted share, mirroring `SIS_STUDENT_CSV` → `userProvision.service.ts`). OneRoster 1.2's CSV bulk-exchange format is the most common interchange SIS platforms (including Synergy-family products) support, and the Rostering Service's `class` object carries a `periods` attribute for exactly this purpose ([IMS OneRoster v1.2 Rostering Service Information Model](https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-informationmodel/OneRosterv1p2RosteringService_InfoModelv1p0.html)).

**Important nuance surfaced by research, not assumption:** OneRoster's `class.periods` is a list of period *codes* (e.g. `["2"]`), not clock times — OneRoster does not model bell-schedule start/end times at all ([1EdTech OneRoster overview](https://standards.1edtech.org/oneroster/); [Edlink's OneRoster 1.2 guide](https://ed.link/community/everything-you-need-to-know-about-oneroster-1-2/)). So even with a real OneRoster feed, Tech-V2 still needs a **locally maintained bell-schedule table** (period code → start/end time, per school, with day-type support for early-release/assembly schedules) to translate "it is 10:14am" into "that's period 3." This is new admin-configured data, not something the OneRoster feed supplies — flagging this now so it isn't rediscovered mid-implementation.

Planned ingestion tables (bulk CSV import, `.csv` files matching the OneRoster 1.2 CSV bulk export layout for `orgs.csv`, `courses.csv`, `classes.csv`, `enrollments.csv`, `users.csv` subset):

- `RosterOrg` — school-level org (sourcedId, name; joins to existing `Location`/school concept where one exists).
- `RosterCourse` — course (sourcedId, title, courseCode).
- `RosterClass` — a section/period of a course (sourcedId, title, classCode, courseId → RosterCourse, orgId → RosterOrg, periods: `String[]`).
- `RosterEnrollment` — links a roster user (student or teacher) to a `RosterClass` with a role (`student`/`teacher`), primary flag, status. Roster `sourcedId` for users maps to Tech-V2 `User.employeeId` (same `'s' + SIS ID` convention already used for students; teachers use their existing staff `employeeId`).
- `BellPeriod` — **new, not from OneRoster**: `orgId`, `dayType` (e.g. `REGULAR`, `EARLY_RELEASE`, `ASSEMBLY`), `periodCode` (matches `RosterClass.periods` entries), `startTime`/`endTime` (stored as `String` `"HH:mm"`, matching the existing time-as-string convention seen on `TransportationRequest.loadingTime` etc.), `daysOfWeek` (`Int[]`, 0-6). Admin-maintained via a small CRUD UI, same pattern as `WorkOrderCategoriesTab`/reference-data management.

A scheduled job (reusing the existing `node-cron` pattern in [backend/src/services/scheduler.service.ts](../../../backend/src/services/scheduler.service.ts)) performs a full reconcile pass against the CSV drop, matching the CREATE/UPDATE/DISABLE 3-pass shape already used in `userProvision.service.ts`.

**Routing resolution at request time:** given `studentId` + `now()`, look up the school's active `dayType` for today (simplest MVP: a single default day type, with per-date overrides table if needed later), find the `BellPeriod` row containing the current time → `periodCode` → find the `RosterClass` where the student has an active `RosterEnrollment` and `periods` contains that code → find the teacher's `RosterEnrollment` (role=`teacher`) on that same class → resolve to a Tech-V2 `User` via `employeeId`. If no class is found (passing period, lunch, before/after school, unmapped enrollment), the student is prompted to pick from their own enrolled teachers instead of relying on auto-detection — this fallback is required for MVP correctness, not optional polish, since auto-detection will legitimately miss cases (new student not yet in a rostered enrollment, etc.).

### 3.2 Pass entity & state machine

```
REQUESTED --(teacher approves)--> ACTIVE --(student/teacher/monitor ends)--> ENDED
REQUESTED --(teacher denies)-----> DENIED
REQUESTED --(student cancels)----> CANCELLED
ACTIVE     --(now > autoExpireAt, scheduler sweep)--> EXPIRED
EXPIRED    --(teacher/monitor ends)--> ENDED   (still closeable/auditable after auto-expiry)
```

Six states total — deliberately flat (no separate "Approved" state before "Active"): teacher approval is treated as "go now," matching how Securly Pass's real approval flow works — the teacher clicks approve/deny and the student's timer starts immediately, rather than modeling a distinct waiting-to-depart state nobody actually uses ([Securly Pass product page](https://www.securly.com/pass); [Securly digital hall pass blog](https://blog.securly.com/how-digital-hall-pass-works/)). This keeps the entity closer to `TransportationRequest`'s inline-fields simplicity (§1.4) instead of introducing a status nobody needs.

Planned `HallPass` model (mirrors `TransportationRequest` conventions — plain `status` string with a documented comment, inline actor id/timestamp fields, denormalized email snapshots, no `@@map`):

```prisma
model HallPass {
  id                String    @id @default(uuid())

  studentId         String
  student           User      @relation("HallPassStudent", fields: [studentId], references: [id])
  studentEmailSnapshot String

  destinationId     String
  destination       HallPassDestination @relation(fields: [destinationId], references: [id])
  reason            String?   @db.VarChar(300)

  // Routing (resolved at request time, snapshotted so a later roster change
  // doesn't retroactively alter an in-flight pass)
  rosterClassId     String?
  teacherId         String?
  teacher           User?     @relation("HallPassTeacher", fields: [teacherId], references: [id])
  teacherEmailSnapshot String?

  status            String    @default("REQUESTED")
  // REQUESTED | ACTIVE | ENDED | DENIED | CANCELLED | EXPIRED

  requestedAt       DateTime  @default(now())
  respondedById     String?
  respondedBy       User?     @relation("HallPassResponder", fields: [respondedById], references: [id])
  respondedAt       DateTime?
  denialReason      String?   @db.VarChar(300)

  startedAt         DateTime?   // == respondedAt when approved; timer origin
  maxDurationMinutes Int
  autoExpireAt      DateTime?

  endedById         String?
  endedBy           User?     @relation("HallPassEnder", fields: [endedById], references: [id])
  endedAt           DateTime?

  createdAt         DateTime  @default(now())
  updatedAt          DateTime @updatedAt

  @@index([studentId, status])
  @@index([teacherId, status])
  @@index([status, autoExpireAt])
}

model HallPassDestination {
  id                 String   @id @default(uuid())
  name               String   @db.VarChar(100)
  maxDurationMinutes Int
  isActive           Boolean  @default(true)
  sortOrder          Int      @default(0)
  hallPasses         HallPass[]
}
```

`HallPassStatusHistory` (audit trail) is **not** proposed for MVP — `HallPass`'s own fields (`respondedById/At`, `endedById/At`) already capture who/when for every real transition, matching `TransportationRequest`'s inline-fields-only approach. Add a history table only if a future requirement needs multi-actor history per pass (e.g. reopen/reassign), which nothing here currently needs — avoids the FieldTrip-style overbuild for an entity with at most 2-3 transitions in its lifetime.

**Concurrency rule:** at most one non-terminal (`REQUESTED`/`ACTIVE`) pass per student. Enforced with a partial unique index (Postgres, hand-written in the migration SQL per this repo's existing convention for cases Prisma's schema syntax can't express):
```sql
CREATE UNIQUE INDEX "HallPass_one_open_per_student"
  ON "HallPass" ("studentId")
  WHERE status IN ('REQUESTED', 'ACTIVE');
```

### 3.3 API surface (route → controller → service, per existing layering)

- `POST   /api/hall-passes` — student creates a request (destination + optional reason); resolves teacher per §3.1, enforces the one-open-pass rule.
- `GET    /api/hall-passes/mine/current` — the student's own open pass, if any.
- `GET    /api/hall-passes/mine/history` — the student's past passes.
- `POST   /api/hall-passes/:id/cancel` — student cancels while `REQUESTED`.
- `POST   /api/hall-passes/:id/approve` — teacher approves (only the routed teacher, or an admin/monitor override).
- `POST   /api/hall-passes/:id/deny` — teacher denies with reason.
- `POST   /api/hall-passes/:id/end` — student ("I'm back"), teacher, or hallway-monitor role ends an `ACTIVE`/`EXPIRED` pass.
- `GET    /api/hall-passes/active` — module-gated dashboard list (teacher: their own routed passes; broader monitor/admin group: school-wide), used for the "all active passes visible to staff" dashboard pattern Securly Pass uses ([Securly Pass product page](https://www.securly.com/pass)).
- `GET    /api/hall-passes/stream` — SSE endpoint (§3.4).
- Reference-data CRUD for `HallPassDestination` — mirrors the existing `referenceData.controller.ts` pattern already used for other write-in/admin-managed lists.
- Roster admin: `BellPeriod` CRUD (small admin UI) + a manual "run roster import now" trigger, mirroring the existing admin sync-job UI patterns (`AdminJobsPage.tsx`).

All mutating routes go through the existing CSRF double-submit-cookie middleware automatically (already applied globally per current convention — no new opt-in needed). All routes gated by a new `HALL_PASSES` entry in `GROUP_MODULE_MAP`, with the existing `ENTRA_ALL_STUDENTS_GROUP_ID` granted student-level access (request/cancel/end-own-pass, view own history) and staff/teacher groups granted approve/deny/end/dashboard access — exactly the same shape as the existing student → `WORK_ORDERS` level-2 carve-out.

### 3.4 Real-time delivery — Server-Sent Events

- New `GET /api/hall-passes/stream` route, authenticated via the existing cookie-based `authenticate` middleware (SSE via `EventSource` sends cookies automatically on same-origin requests — no new auth mechanism, and CSRF doesn't apply to GET).
- Server sets `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`, calls `res.flushHeaders()` immediately, and writes a `:heartbeat\n\n` comment every 30s to keep the connection alive through proxies/load balancers — this is the standard, currently-recommended pattern for Express SSE ([Svix: Server-Sent Events in Express](https://www.svix.com/resources/guides/server-sent-events-express/); [Server-Sent Events in 2026: streaming architecture](https://thebackenddevelopers.substack.com/p/server-sent-events-in-2026-streaming)).
- Backend pub/sub: a single in-process `EventEmitter` (new `backend/src/services/hallPassEvents.service.ts`), since the backend runs as one Node process today (§1.3). Every mutating hall-pass service call emits an event after its Prisma write commits; the SSE route subscribes the connected user to events relevant to them (their own student id, or their teacher id / monitor scope) and forwards matching events as `data:` lines.
- The `EXPIRED` transition is driven by the same `scheduler.service.ts` cron pattern already used elsewhere — a periodic sweep (e.g. every 60s) finds `ACTIVE` passes past `autoExpireAt` and flips them, emitting the same pub/sub event so open SSE connections see it live.
- **Nginx change required:** [frontend/nginx.dev.conf](../../../frontend/nginx.dev.conf) and its prod counterpart need `proxy_buffering off;` added to the `location /api/` block (or a dedicated `location /api/hall-passes/stream` block) — without it, nginx will buffer the stream and the client sees nothing until the connection closes, per the SSE-through-proxy best practice found in research.
- Frontend: a small `useHallPassStream()` hook wrapping native `EventSource`, invalidating/updating the relevant TanStack Query cache entries on each event (`hall-passes/mine/current`, `hall-passes/active`) rather than introducing a parallel state store — keeps the existing TanStack Query-as-source-of-truth convention intact. Falls back to the existing 60s-interval polling pattern (`useRequestBadges`-style) if `EventSource` is unsupported/blocked, so the feature degrades gracefully rather than breaking.

### 3.5 UI surface

New routes inside the existing SchoolWorks SPA (decision confirmed), gated the same way every other module route is (`ProtectedRoute` + module-level check), added to `AppLayout`'s navigation only for users whose resolved role/groups grant `HALL_PASSES` access:
- `/hall-pass` — student self-service: request form (destination picker + optional reason), live status/timer card, own history.
- `/hall-pass/dashboard` — teacher/monitor view: pending requests needing action + live grid of currently-active passes (who, where, elapsed/remaining time, overdue highlighting), approve/deny actions.
- `/hall-pass/admin` (admin-gated) — `HallPassDestination` and `BellPeriod` management, manual roster-import trigger.

---

## 4. Implementation Steps (for Phase 2)

1. **Roster ingestion foundation** — `RosterOrg`/`RosterCourse`/`RosterClass`/`RosterEnrollment`/`BellPeriod` Prisma models + migration SQL; CSV parser (reuse `csv-parse`, already a dependency) matching the confirmed OneRoster CSV export layout from the actual source system; scheduled reconcile job in `scheduler.service.ts`.
2. **Teacher-resolution service** — `resolveCurrentTeacherForStudent(studentId, at: Date)` in a new `rosterResolution.service.ts`, with the graceful "pick from my teachers" fallback UI/endpoint.
3. **`HallPass` + `HallPassDestination` schema**, migration SQL (including the partial unique index), `hallPass.service.ts`/`controller.ts`/`routes.ts`, Zod validators in `backend/src/validators/`.
4. **`GROUP_MODULE_MAP` entry + routing gating**, reusing the existing student-group carve-out pattern.
5. **SSE transport** — `hallPassEvents.service.ts` (EventEmitter pub/sub), `/hall-passes/stream` route, nginx `proxy_buffering off` change (dev + prod configs), expiry sweep job.
6. **Frontend**: `hallPass.types.ts` in `shared/src/` (contract types), `hallPassService.ts` API client, `useHallPassStream` hook, student request/status page, teacher/monitor dashboard page, admin reference-data pages, nav entry in `AppLayout`.
7. **Notifications**: wire approve/deny/overdue events into the existing `email.service.ts`/`push.service.ts` for users who are away from the SSE-connected tab (mirrors how other modules already layer push/email on top of in-app state).

Each step is independently verifiable (build success + manual click-through) before moving to the next, per the project's goal-driven execution principle — this is not a single-PR feature.

---

## 5. Dependencies

No new npm packages required for the architecture above:
- Roster CSV parsing: `csv-parse` — already a backend dependency, already used for CSV import elsewhere in the codebase (exempt from the docs-verification requirement per the "already exercised elsewhere" carve-out).
- SSE: native Express 5 `res.write`/streaming — no library needed; current API patterns verified against [Svix's Express SSE guide](https://www.svix.com/resources/guides/server-sent-events-express/) and a 2026 SSE architecture reference.
- Scheduling: `node-cron` — already a dependency, already used in `scheduler.service.ts`.
- Roster data model shape: verified against the official [IMS OneRoster v1.2 Rostering Service spec](https://www.imsglobal.org/spec/oneroster/v1p2) and [Rostering Information Model](https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-informationmodel/OneRosterv1p2RosteringService_InfoModelv1p0.html).

**Open item, not a library-doc question:** the *actual* export format/transport of the district's real roster data (file share CSV vs. a REST API, and its exact column layout) is still unconfirmed — this spec assumes a OneRoster-1.2-shaped CSV bulk export delivered the same way `SIS_STUDENT_CSV` is today, mirroring the existing convention. This needs to be confirmed against the real source before Phase 2 implementation of the importer, since the parser's column mapping depends on it.

## 6. Configuration Changes

- New env vars: `ROSTER_CSV_PATH` (or `ROSTER_ORGS_CSV`/`ROSTER_CLASSES_CSV`/`ROSTER_ENROLLMENTS_CSV` if the source ships as multiple OneRoster CSV files, mirroring `SIS_STUDENT_CSV`'s single-mount pattern), `ROSTER_SYNC_CRON` (schedule expression, mirroring existing cron env vars in `scheduler.service.ts`).
- New Entra group env var: `ENTRA_HALL_PASS_MONITOR_GROUP_ID` (or reuse an existing staff group) for the "sees all active passes school-wide" role, if that's distinct from regular teachers.
- nginx: `proxy_buffering off;` added for the SSE route in both `frontend/nginx.dev.conf` and `frontend/nginx.conf`.
- Prisma migration file required alongside the schema changes in step 1 and 3 above, per project convention (`backend/prisma/migrations/<timestamp>_<name>/migration.sql`), committed together — no `prisma migrate dev` is to be run.

## 7. Risks & Mitigations

| Risk | Mitigation |
|---|---|
| Real roster source format differs from assumed OneRoster-1.2 CSV shape | Confirm actual export format before Phase 2 importer implementation; parser is isolated to one service, easy to adapt |
| Bell-schedule edge cases (early release, assemblies, block schedules) mis-map a student to the wrong teacher | `BellPeriod.dayType` supports multiple schedule types per school; "pick from my teachers" fallback always available, so a bad auto-route is never a hard block |
| Backend horizontal scaling in the future breaks in-process EventEmitter pub/sub (SSE events wouldn't cross processes) | Documented as a known limitation; if the backend is ever scaled to >1 replica, pub/sub needs to move to Postgres `LISTEN/NOTIFY` (no new dependency) or Redis — not needed for the current single-container deployment |
| Nginx buffers SSE stream if config change is missed in prod | Explicit step in implementation checklist for both `nginx.dev.conf` and `nginx.conf`; verify with a manual curl/EventSource test during Phase 3 review |
| Roster data links to `User` via `employeeId`, which can be null/mismatched for some accounts (seen already in prior `USER_SYNC_EMAIL_FALLBACK` work) | Reconcile job logs unmatched roster rows rather than silently dropping them, surfaced in the same admin-jobs UI pattern used for other sync jobs |
| Partial-unique-index migration (hand-written SQL) drifts from `schema.prisma` if someone edits the schema later without updating the raw SQL | Document the index inline as a Prisma-schema comment pointing at the migration file, matching how other hand-written constraints are already flagged elsewhere in this schema |

---

## Sources Consulted

1. [Securly Pass — product page](https://www.securly.com/pass)
2. [Securly — How Does a Digital Hall Pass Work](https://blog.securly.com/how-digital-hall-pass-works/)
3. [Securly — What to Know Before Choosing a Digital Hall Pass Solution](https://blog.securly.com/digital-hall-pass-solution/)
4. [1EdTech — OneRoster standard overview](https://standards.1edtech.org/oneroster/)
5. [IMS Global — OneRoster v1.2 Rostering Service, Information Model](https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-informationmodel/OneRosterv1p2RosteringService_InfoModelv1p0.html)
6. [IMS Global — OneRoster v1.2 Rostering Service, REST/JSON Binding](https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html)
7. [IMS Global — OneRoster Version 1.2 spec index](https://www.imsglobal.org/spec/oneroster/v1p2)
8. [Edlink — Everything You Need to Know about OneRoster 1.2](https://ed.link/community/everything-you-need-to-know-about-oneroster-1-2/)
9. [Svix — How to Use Server-Sent Events in Express](https://www.svix.com/resources/guides/server-sent-events-express/)
10. [Server-Sent Events in 2026: Streaming Architecture, Scalability, and Real-Time UX](https://thebackenddevelopers.substack.com/p/server-sent-events-in-2026-streaming)

---

## Explicit Assumptions (flagged, not silently decided)

- The real roster/SIS source is assumed to be deliverable as a OneRoster-1.2-shaped CSV bulk export dropped on a mounted share, mirroring the existing `SIS_STUDENT_CSV` convention. **Needs confirmation before Phase 2.**
- "Approval = go now" (no separate pending-departure state) is assumed correct based on how Securly Pass's real workflow behaves; if this district wants a distinct "approved, hasn't left yet" step, that's one extra state and one extra transition — a small, contained change to §3.2 if needed.
- A single Entra group is assumed sufficient to represent "hallway monitor / sees all active passes school-wide"; if that audience should instead be "any teacher for any class, school-wide" or something more granular, the `GROUP_MODULE_MAP` level scheme (§3.3) accommodates that without a design change.
