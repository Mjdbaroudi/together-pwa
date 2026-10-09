# Public source scope

This portfolio edition is derived from application version 3.6.5. The personal working copy remains unchanged.

## Included

- Application source, package lockfile, tests, schema migrations and generic icons.
- Empty configuration template; one clearly fictional `example.com` contact placeholder.
- New, generic English README and Arabic setup guide.
- Git ignore rules, a best-effort privacy check and an isolated CI quality workflow.

## Excluded

- Existing account or deployment configuration, actual environment files and secret keys.
- User profiles, chats, pair codes, photos, database exports and browser/session state.
- Personal screenshots, build output, dependency directories, logs, caches and Git history.
- Historical update guides, the old implementation PDF and user-specific installation narratives.

Test anniversary dates and Arabic contact labels that overlapped previous examples were replaced with synthetic alternatives. Fixtures, UUIDs and `.test` / `.example` / `.invalid` addresses are artificial. Public city-center presets are ordinary geographic reference data, not saved account locations; no city is assigned automatically.

The database schema and access policies are unchanged. There is no new migration, deployment or data deletion. Sharing source code does not disable the application's privacy features.

## Audit boundaries

Only files included in this source distribution were audited. A secret-pattern scan and file allowlist are useful guards, not proof of the absence of every possible identifier. No production database, remote Storage, live account or previous Git history was accessed. Future content added to a repository must be reviewed separately.

Do not reuse the original project's Git history for this edition. If any secrets were exposed elsewhere, revoke them independently.
