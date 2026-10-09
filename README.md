# Together

A bilingual, mobile-first private space for two people: real-time conversation, shared memories, a visual milestone timeline and everyday moments.

**Portfolio source edition · 3.6.5**

This repository contains application code and database migrations, not an existing couple's account, conversations, photos or database. It ships with empty environment settings and no production deployment link. Each installation uses its own Supabase project. Publishing the source does **not** make an existing application's private data public.

## Highlights

- Real-time chat with replies, reactions, editing, read receipts, search and offline text retry.
- Private photo/video albums, multiple uploads and a rotating story cover.
- Chronological milestones, anniversary celebrations, full-photo viewing, pinch zoom and file downloads.
- WebRTC audio/video calls with authenticated signaling and configurable TURN.
- Web Push with per-device foreground-chat suppression and persistent notification preferences.
- English/Arabic UI, carefully scoped RTL, responsive mobile layouts and reduced-motion support.
- Prayer-time settings, morning/evening remembrance and an Arabic daily Quran verse.
- PWA installation, offline shell and an optional local PIN convenience lock.

## Stack

Next.js App Router · React · TypeScript · Supabase Auth / PostgreSQL / Realtime / Storage · WebRTC · Web Push · CSS / Tailwind tooling.

## Local setup

Use Node.js 22 or newer and npm. From the extracted project directory:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

On Windows, copy `.env.example` to `.env.local` with your file manager or `Copy-Item .env.example .env.local` in PowerShell.

The project builds without credentials, but real account pairing and messaging require your own backend:

1. Create a **new, independent** Supabase project.
2. Run all 16 SQL files in `supabase/migrations/`, in filename order, using that project's SQL editor. They create schema, policies and application functions; they are not a database export. Do not rerun the initial migration over an existing production database.
3. Configure Supabase Auth URLs for your local/deployed origin.
4. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` in your local environment.
5. Create two accounts and pair them through the app's pairing flow. No accounts or sample conversations are preloaded.

Only add Web Push and TURN settings when using those features. Public browser variables are prefixed `NEXT_PUBLIC_`; VAPID private keys, TURN secrets and credentials must stay server-side. `VAPID_SUBJECT` is a placeholder contact, not a real account address.

## Quality checks

```bash
npm run check
npm run build
npm run privacy:check
```

Tests use synthetic fixtures and a local PostgreSQL-WASM engine. They do not connect to a production database. When run inside this repository's Git root, the privacy check inspects the staged/tracked **index contents**, including any accidentally force-added secret files. It is a best-effort guard, not a guarantee or Git-history audit.

The GitHub Actions workflow runs the checks/build on pushes and pull requests, without repository secrets or a live backend. It does not deploy.

## Architecture

| Location | Responsibility |
| --- | --- |
| `src/app` | Routes, layouts, styles and authenticated API handlers |
| `src/components` | Chat, calls, albums, dates, faith and shared UI |
| `src/lib/together` | Message reconciliation, uploads, offline queue and presence |
| `src/lib/calls` | Call transport, negotiation, history and TURN configuration |
| `src/lib/push` | Subscriptions, server delivery and foreground reading leases |
| `src/lib/faith` | Prayer validation, content and device-local progress |
| `supabase/migrations` | Ordered schema and row-level access policies |
| `tests` | Synthetic unit, lifecycle, API and database-policy tests |

## Security and platform limits

Pair data is protected by Supabase row-level policies and private Storage with signed URLs. No service-role key is required or included. Keep these protections enabled in your own installation.

This is **not end-to-end encrypted**, and the PIN is a convenience lock rather than a cryptographic boundary. Background/locked-screen calls depend on browser/OS behavior; native CallKit/Telecom integration is not included. A web app cannot bypass denied permissions or save directly to Photos without user interaction. Already-queued push notifications may still arrive after opening chat.

See [SECURITY.md](SECURITY.md), [privacy scope](docs/PUBLIC_RELEASE.md) and the [Arabic setup / publishing guide](START_HERE_AR.md).

## Publishing this portfolio copy

Extract this archive and create a **fresh GitHub repository** from this folder only. Do not upload the original application's folder, its database exports, personal screenshots or environment files. Review the staged changes and run `npm run privacy:check` before committing.

This copy has no inherited Git history and is not linked to any deployed app. No automatic production deployment is configured. A live demonstration should use a separate backend and fictional content, not existing personal accounts.

## Licensing

No open-source license has been selected for this portfolio copy. Public source visibility alone does not grant an additional reuse license. Choose a license deliberately before offering reuse permissions; third-party packages retain their own licenses. GeoNames-derived public city-center presets are attributed to [GeoNames](https://www.geonames.org/) under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
