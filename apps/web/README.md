# E-Boses Web

React and Vite frontend for residents, barangay officials, and responders.

## Android app shell

The Android wrapper is Capacitor-based and is intentionally the only native
platform currently configured. The SOS wizard, duty-hours prompt, and live
tracking view use full-viewport page shells, and Android location permission is
provided by the Capacitor Geolocation plugin.

For a bundled Android build, copy `.env.capacitor.example` to `.env.capacitor`
and set `VITE_API_BASE_URL` to the HTTPS Django API URL including `/api`. Then
run:

```text
npm run cap:sync --workspace web
npm run cap:open:android --workspace web
```

The API deployment must also allow the Capacitor origin `https://localhost` in
`CORS_ALLOWED_ORIGINS` and `CSRF_TRUSTED_ORIGINS`.

Android Studio should use its bundled JDK 21 (or another JDK 11+; JDK 21 is
recommended for this Capacitor version). VS Code can run the same commands in
its integrated terminal, but the emulator/device is managed by Android Studio
or ADB.

For local-device development with the Vite server, set `CAPACITOR_SERVER_URL`
to a LAN-reachable Vite URL before opening or running the Android project. This
live-server mode is not an offline build; the bundled build is the mode that
carries the cached SOS shell into the app.

For the bundled Android build using the existing HTTPS localhost API URL, expose
the computer's Vite proxy to the connected device before launching the app:

```text
adb reverse tcp:5173 tcp:5173
```

Keep both Vite on port 5173 and Django on port 8000 running. `adb reverse` is
USB transport only; the bundled SOS-to-SMS fallback remains available when the
API health probe cannot reach that endpoint.

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
