# Four-section dashboard

React + Vite + TypeScript. Light theme, responsive model controls, comparison table, SVG reliability chart and expandable prediction inspector. No login, payment, messaging or complex navigation.

Use `npm run build` then `npm run dev` for the Worker-served version. For hot reload, keep the Worker running and start `npm run dev:web` in another terminal. The frontend has no model credentials. All predictions and metrics come from the API; there are no hard-coded benchmark rows. Outcomes remain hidden until the explicit reveal action.

Google Fonts are optional; local system fonts are the offline fallback. No browser screenshot was captured in the build environment, so visual QA remains a local follow-up.
