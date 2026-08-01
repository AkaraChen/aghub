# Third-Party Notices — skill-audit rules

This crate bundles skill-poisoning detection rules derived from third-party
projects. The crate itself is MIT (see the workspace license); the bundled rule
files carry the licenses below.

## rules/cisco/\*.yara

Copied from **cisco-ai-defense/skill-scanner**
(https://github.com/cisco-ai-defense/skill-scanner), licensed under the
**Apache License, Version 2.0**. Copyright 2026 Cisco Systems, Inc. and its
affiliates. A full copy of the license is at `../LICENSE-APACHE`.

The original copyright/meta headers inside each `.yara` file are preserved.
Files changed by aghub carry a modification notice at their top, per
Apache-2.0 §4(b).

## rules/clawhub/agent_specific.yara

Detection logic derived from **openclaw/clawhub**
(https://github.com/openclaw/clawhub), file `convex/lib/moderationEngine.ts`,
licensed under the **MIT License**, Copyright (c) OpenClaw contributors. The
TypeScript regular expressions were rewritten into YARA rules for this crate.

Exact upstream revisions, paths, blob identities, and local modification status
are recorded in `SOURCES.toml`.

---

Neither Cisco nor OpenClaw endorses aghub. These notices record attribution as
required by the respective licenses; they do not imply any affiliation.
