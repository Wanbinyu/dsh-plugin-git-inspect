# Changelog

## 0.3.7 - 2026-10-15

- Adapt to Harness 0.2.1-alpha.3. Peer ranges also accept 0.2.0-rc.2, 0.1.5-rc.2, and the 0.1.1-rc.2 baseline.
- Resolve 0.2 Medium icons first and fall back to the 0.1 icon names, so one externalized client bundle loads on both hosts.
- Accept Cordis 4.0.5-alpha alongside ^4.0.1. The invariant companion stays optional because 0.2.1 no longer publishes @deepseek-ai/dsh-invariants.
- Tool peers cover the 0.2.1 subprocess, system-prompt, and tools packages.

## 0.3.6 - 2026-09-11

- Adapt to Harness 0.1.5-rc.2 while retaining 0.1.1-rc.2 baseline coverage.
- Remove retired client runtime dependencies from Web plugins; preserve official Slot APIs.
- Add explicit compatibility guidance for downloadable archives.
