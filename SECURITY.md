# Security Policy

If you find a vulnerability in Green Launcher, report it privately rather than opening
a public issue. Only the latest stable public release is currently supported.

## Reporting a Vulnerability

Use [GitHub private vulnerability reporting](https://github.com/Despical/GreenLauncher/security/advisories/new)
or email **contact@despical.dev**.

Include the affected version, a clear description, reproduction steps, expected impact
and a minimal proof of concept using isolated test data. Redact access tokens, Microsoft
account information, private filesystem paths and other personal data from evidence.
Do not send destructive payloads or test against someone else's accounts or worlds.

## Scope

- Microsoft authentication, account tokens and Windows secure storage.
- Game/profile directories, archive extraction, imports, backups and filesystem paths.
- Downloads, checksums, update metadata, native update helpers and executable replacement.
- IPC boundaries, external URLs, renderer isolation and process execution.
- Minecraft and Java installation, modpack handling and external provider integrations.

## Response

Valid reports will be reviewed as soon as possible. Confirmed vulnerabilities will be
fixed privately and released with credit where appropriate. Please allow time for a
fix before public disclosure. Use normal issues for non-security bugs and feature requests.
