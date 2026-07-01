# Foundation Clean Architecture Design

**Date:** 2026-07-01
**System:** E-Boses
**Scope:** Foundation cleanup for the existing Django and React monorepo.

## Context

`research.md` describes E-Boses as a barangay civic engagement and emergency coordination platform with verified residents, barangay officials, responders, structured concern reporting, emergency alert routing, witness notifications, privacy protection, RBAC, audit logging, PostGIS location checks, and future AI-assisted validation.

The current codebase is earlier than that target. The frontend contains resident-facing mock UI flows, while the backend is mostly a Django scaffold. The cleanup must make the codebase easier to extend in later phases without changing the current visible UI or claiming that production workflows are implemented.

## Approved Direction

Use **foundation cleanup with architecture boundaries**.

This means:

- Fix current quality blockers.
- Preserve the current UI visuals and mock behavior exactly.
- Move large mock data and display constants out of page components.
- Add typed frontend service boundaries that can later swap mock data for API calls.
- Make the Django scaffold import-safe and structurally ready for future feature implementation.
- Document source-layout conventions for future development phases.

## Goals

- `npm run typecheck` passes.
- `npm run lint` passes.
- Django settings, URL config, ASGI config, and installed app modules import successfully.
- Current routes and visible UI behavior stay unchanged.
- Mock data is clearly separated from production service interfaces.
- Backend app boundaries reflect the research domains without implementing full workflows.
- Future phases can add auth, reports, emergency alerts, notifications, validation, and AI integrations without reorganizing the repository again.

## Non-Goals

- No visual redesign.
- No new product behavior.
- No real authentication flow.
- No production database schema unless a minimal stub is needed for import safety.
- No AI, OTP, Twilio, Cloudinary, PostGIS validation, or emergency dispatch implementation.
- No integration with external government systems or emergency hotlines.
- No broad unrelated refactor outside the app foundation.

## Architecture

The monorepo keeps its existing shape:

- `packages/ui`: shared UI primitives only.
- `apps/web`: React application, feature modules, app-wide utilities, and mock adapters.
- `apps/api`: Django API scaffold organized by domain apps.
- `docs`: architecture and implementation guidance.

The important boundary is between **current mock behavior** and **future production adapters**.

Frontend pages should not own large fixture arrays or call future backend code directly. They should compose UI, use hooks/services, and receive typed domain data. During this phase, those services can remain mock-backed.

Backend apps should import cleanly and expose explicit module slots for future domain logic, but they should not contain fake implementations pretending to be production workflows.

## Frontend Structure

Use feature-owned folders under `apps/web/src/features`.

Recommended pattern:

```text
features/<feature>/
  components/
  fixtures/
  hooks/
  schemas/
  services/
  types.ts
```

Use `apps/web/src/lib` for app-wide utilities such as:

- environment helpers
- API client shell
- shared result/error types
- local storage helpers when shared outside one feature

### Dashboard Cleanup

Move these out of large page/component files into typed fixtures or config modules:

- feed sample posts
- report sample records
- announcements
- active reports
- active responders
- concern category metadata
- report status display maps
- timeline display maps
- emergency type metadata
- mock resident user data

Keep current UI rendering and interaction behavior unchanged.

The dashboard pages remain responsible for layout and composition. Data and display maps live in feature modules.

### Auth Cleanup

Keep the current Zod schemas and form hooks. Add service-shaped submit boundaries so future backend integration can happen without rewriting form components.

Examples:

- `authService.signIn`
- `authService.register`
- `authService.verifyOtp`
- `authService.requestPasswordReset`
- `authService.setNewPassword`

For this phase, implementations remain local/mock and preserve current navigation behavior.

### UI Package Cleanup

Fix shared package correctness without changing appearance:

- Resolve the missing `@radix-ui/react-slot` import used by `attachment.tsx`.
- Fix React 19-compatible `useRef` initialization in `hover-card.tsx`.
- Resolve React Refresh lint errors caused by exporting non-component variant constants from component files. Choose one convention and apply it consistently.

The preferred convention is to keep component files lint-clean by moving reusable variants into adjacent non-component files when they must be exported. If a variant is not consumed outside the file, keep it private.

## Backend Structure

The backend remains a Django scaffold, but each app should have clear future extension points.

Recommended app modules:

```text
apps/<domain>/
  constants.py
  models.py
  permissions.py
  selectors.py
  serializers.py
  services.py
  tests.py
  urls.py
  views.py
```

These modules may be thin in this phase. Their job is to make boundaries explicit and import-safe.

### Domain Alignment

Backend app responsibilities should align with the research document:

- `accounts`: users, barangay profiles, roles, verification state, consent state, future OTP/ID verification.
- `concerns`: concern reports, votes, status history, media metadata, future validation and severity scoring.
- `emergencies`: emergency alerts, acknowledgments, responder status, witness notification dispatch records.
- `notifications`: in-app notifications and future WebSocket routing.
- shared/audit concern: audit logging can be introduced in a dedicated app later or as a shared service when real workflows exist.

### ASGI and Routing

The current ASGI config references notification WebSocket URL patterns. The routing module must define an import-safe `websocket_urlpatterns` list even before real consumers exist.

Each included REST app should expose import-safe URL patterns. If placeholder routes are exposed, they must make it clear that the workflow is not implemented.

## Data Flow

Current frontend data flow:

1. Page components call local hooks/services.
2. Hooks/services return typed data from fixtures.
3. UI state such as filters, selected report, local votes, and modal visibility remains local where it is today.
4. Form submissions keep the same navigation and validation behavior as the current UI.

Future production data flow:

1. The same service interfaces can call HTTP or WebSocket adapters.
2. API responses map into frontend domain types.
3. Form and page components should not need major rewrites when adapters switch from mock to API.

Current backend data flow:

1. Django settings, URL config, ASGI config, and app modules import cleanly.
2. No production workflow is executed.
3. No fake AI, OTP, geospatial validation, or emergency dispatch behavior is introduced.

## Error Handling

Frontend:

- Keep Zod as the first line of form validation.
- Add shared result/error shapes for future async actions.
- Keep existing user-visible messages unless a bug fix is required.
- Do not introduce new visible error states that change the UI behavior.

Backend:

- Import errors should be caught by tests.
- Placeholder routes, if any, should return explicit "not implemented" semantics.
- Do not hide configuration failures that would break future deployment.

## Testing

Required checks for this cleanup:

- Root `npm run typecheck`.
- Root `npm run lint`.
- Python import checks for:
  - `config.settings`
  - `config.urls`
  - `config.asgi`
  - each installed local Django app module
- Backend smoke tests for URL and ASGI routing import safety.

If Python dependencies are missing locally, document the blocker and run the import checks in the available environment where possible.

## Implementation Boundaries

Allowed source changes after this spec is approved for implementation:

- Move mock data into fixtures.
- Add frontend domain types and mock service modules.
- Add app-wide result/error utility types.
- Fix TypeScript and ESLint blockers.
- Add backend import-safe modules and route stubs.
- Add tests for import safety and frontend type/lint correctness.
- Add architecture documentation under `docs/architecture`.

Disallowed source changes in this phase:

- Changing visible UI layout, colors, copy, or navigation.
- Implementing real database models and migrations beyond minimum scaffold safety.
- Adding real API workflows.
- Adding real external service integrations.
- Adding new product features.

## Success Criteria

The cleanup is complete when:

- Existing UI routes still work as before.
- The project passes frontend lint and typecheck.
- The Django scaffold imports cleanly.
- Backend route and ASGI placeholders are explicit and safe.
- Mock data and future API service boundaries are separated.
- Future development can begin from clear module conventions without another broad restructure.
