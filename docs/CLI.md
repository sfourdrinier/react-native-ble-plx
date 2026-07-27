<!-- docs/CLI.md -->

# `ubm` CLI

The CLI is non-interactive and emits one structured JSON result to standard output. It has no telemetry or network behavior. It imports only the explicitly selected backend module and rejects non-Node-capable providers before invoking a backend operation.

```text
ubm doctor --backend <module>
ubm capabilities --backend <module>
ubm tck --backend <module>
ubm scenario --backend <module> --scenario <id>
ubm trace validate <file>
ubm trace redact <file>
```

`doctor` reports declared provider/adapter state without inventing radio readiness. `capabilities` projects the instantiated backend registry with its evidence and limitations. `tck` runs every applicable base/feature suite; `scenario` verifies that the selected scenario appears in that complete truthful run. Trace commands are offline and bound input size to one MiB. `redact` prints a fresh redacted document and never overwrites the supplied input.

The backend module must export `unifiedBleBackend`, created through the public backend SDK. The CLI cannot and does not drive browser or React Native radio work.
