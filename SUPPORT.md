<!-- SUPPORT.md -->

# Support policy

## Evidence-backed support labels

Platform claims are generated from retained evidence; they are not a static compatibility promise. Consult [`docs/generated/PLATFORM_SUPPORT.md`](docs/generated/PLATFORM_SUPPORT.md) before relying on a backend. `Experimental`, `Preview`, `Live Preview`, `Supported`, and `Reliability-qualified` have the proof requirements defined in the 4.0 implementation plan.

An unavailable device lab lowers only the affected evidence label. It does not convert deterministic, compile, or package evidence into live-radio proof.

## Getting help

- Use GitHub Discussions for usage and backend-author questions.
- Use GitHub Issues for reproducible defects and documentation errors.
- Use private GitHub Security Advisories for vulnerabilities; follow [`SECURITY.md`](SECURITY.md).

Reports should include package version, entrypoint, backend ID, host/runtime and OS versions, adapter/peripheral model when relevant, a minimal reproduction, normalized error details, and redacted diagnostics. Do not post BLE payloads or stable device identifiers unless they are synthetic fixtures.

## Supported versions

During the 4.0 prerelease train, support targets the newest published prerelease. After `4.0.0` stable, support targets the current major release. Support is best-effort open-source maintenance and does not replace application-specific validation, regulatory review, or emergency medical systems.
