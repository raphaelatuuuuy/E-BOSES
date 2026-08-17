# E-Boses Web

React and Vite frontend for residents, barangay officials, and responders.

## Commands

Run from the repository root:

```powershell
npm install
npm run dev --workspace web
npm run typecheck --workspace web
npm run lint --workspace web
npm run test --workspace web
npm run build --workspace web
```

The frontend uses the Django API under `/api`. Start Django in a second terminal. The frontend does not provide a manual AI-review queue; accepted concerns enter the normal official work queue after automatic validation.
