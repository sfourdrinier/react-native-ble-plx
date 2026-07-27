<!-- docs/platforms/META_QUEST_4.1_SCOPE.md -->

# Meta Quest 4.1 Scope Decision

Status: deferred by maintainer decision on 2026-07-25

Meta Quest support is not part of Unified BLE 4.0 and does not block any 4.0
architecture, implementation, evidence, or release gate.

Quest returns in 4.1 as a shared-Android-backend environment profile. The 4.1
work must preserve maximum DRY: Quest-specific packaging, permissions,
lifecycle, capability limitations, and evidence may wrap the shared React
Native Android backend, but must not fork its radio/GATT implementation without
physical evidence of a platform requirement.

The 4.1 acceptance target remains an evidence-bound Live Preview with an exact
Quest/Horizon OS target, package/install proof, permission characterization,
shared-backend TCK, and a physical scan/connect/discover/read/notify/teardown
vertical slice.

No Quest support claim is made by 4.0.
