# Security Policy

## Supported versions

Only the latest published release (currently `v1.0.4-beta.1`) receives fixes. The
previous stable release is `v1.0.3`.

## Reporting a vulnerability

Please do **not** open a public issue for security-sensitive reports.

Use GitHub's private vulnerability reporting instead:

1. Open the repository's **Security** tab;
2. Choose **Report a vulnerability**;
3. Describe the issue, affected version, and reproduction steps.

You can expect an initial response within a few days. This plugin runs inside the
DSH Host process and can spawn an Electron companion window, so reports about
command execution, local API exposure, or approval handling are especially
welcome.

## Scope

- The local HTTP API under `/quick-panel/*` is protected by a per-process token
  and should stay bound to loopback.
- The companion window is a local Electron app; it does not accept remote
  connections.
- Release assets are built by GitHub Actions from the tagged commit; verify
  `SHA256SUMS` before installing manually.
