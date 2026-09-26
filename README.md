# Insu Lang Quick Check V4.3

Deployment 2 baseline (26 Sep 2026).

## Current structure
- Clean URLs via `vercel.json` (`/`, `/self-check`, `/privacy`, `/terms`)
- Vercel API routes: `api/analyze.js`, `api/lead.js`, `api/event.js`
- PWA manifest + service worker
- Home Screen icons in `/icons/`
- Live brand logo in `/images/insu-lang-logo-small.png`

## PWA icons
- `/icons/icon-192.png`
- `/icons/icon-512.png`
- `/icons/apple-touch-icon.png`

All three are generated from the existing Insu Lang wordmark and are used for Add to Home Screen / installed-app presentation.

## Notes
- FAQ content and scoring rules are unchanged in this deployment.
- AI remains optional and only explains precomputed scoring.
- Deploy the repository root to Vercel.


## Deployment 2.1
- Lead/Funnel attribution aligned as Source → Medium → Campaign → Content → Term → Ref.
- Added separate intent tracking for Self Review and Full Review.
- PWA icons retained.
