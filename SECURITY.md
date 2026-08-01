<!-- SECURITY.md -->

# Security policy

## Reporting a vulnerability

Use the repository's private **GitHub Security Advisory** reporting flow. Do not open a public issue, discussion, or pull request for a suspected vulnerability before coordinated disclosure.

Include the affected version and host, reproduction steps, impact, whether physical proximity or a malicious peripheral/backend is required, and any proposed mitigation. Never include real patient, device-owner, or production credential data.

The maintainer will acknowledge a complete report within three business days, establish severity and a remediation plan within seven business days, and coordinate publication after a fix is available. These are response targets, not a promise that every investigation will finish inside seven days.

## Supported versions

Before `4.0.0` stable, only the newest published `4.0.0` prerelease is eligible for security fixes. After stable, the current major release receives security fixes. Older majors are unsupported unless a release-specific notice says otherwise.

Security fixes may remove unsafe behavior without a compatibility path. Public disclosure records affected versions, mitigations, and fixed versions without exposing reporter-sensitive information.

## Security boundary

The package performs no telemetry or network upload by default. BLE identifiers and payloads are sensitive. Applications control their own storage, logging, backend trust, permissions, entitlements, and operating-system policy. Third-party backends run with their host process privileges and must be reviewed as application dependencies.

The maintained threat model is [`docs/security/UNIFIED_BLE_4.0_THREAT_MODEL.md`](docs/security/UNIFIED_BLE_4.0_THREAT_MODEL.md).
