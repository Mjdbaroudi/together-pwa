# Security

This source edition contains no configured backend or production credentials.

- Use a separate Supabase project for demonstrations. Do not expose a personal deployment as a portfolio sandbox.
- Keep all row-level security policies and the private media bucket enabled.
- Never commit environment files, deployment-provider account links, push subscriptions, exported data, private media, tokens or TURN/VAPID credentials.
- Signed media URLs are access-bearing URLs. Do not place them in screenshots, logs, issue reports or README files.
- Use server-only variables for private credentials. A `NEXT_PUBLIC_` variable is delivered to browsers.
- Review staged contents before each public commit. The included privacy scan is heuristic and does not scan complete Git history.
- If a credential has already been published, revoke/rotate it. Merely deleting a file or adding `.gitignore` does not undo exposure.

Authentication and access control are not end-to-end encryption. The local PIN is not a substitute for account security.

No security contact is embedded in this portfolio copy. Before accepting external vulnerability reports, configure an appropriate private reporting channel in your repository. Do not submit credentials or personal content in public issues.
