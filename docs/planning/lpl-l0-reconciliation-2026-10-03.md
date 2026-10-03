# Limited Public Launch L0 reconciliation — 2026-10-03

## Status

Repository reconciliation is complete for the evidence available without
production, provider, credential, database or Hotel-Echo access. L0 remains
open. Production inventory and an explicit safe-pause statement from the
separate E3 conversation are still required.

No L1-L7 gate is complete. Launch remains stopped.

## Pinned control baseline

- Control branch: integrate/lpl-2026-10-02
- Control worktree: /home/michal/projects/eanhl-team-website-worktrees/lpl-control
- Baseline commit: b8fb23ffea64dff7c5521a06a7194341a380ee7a
- Baseline source: refreshed origin/main on 2026-10-03
- Roadmap SHA-256:
  3f5626f85462bdf9777efbb6a367be221653a0ece05e79c02a1d787c2b61dd58

The primary checkout was not modified. At reconciliation it remained on
0ec6989cd9ebf786b2730ee697b9768818ef2d26, 21 commits behind origin/main,
with 14 modified tracked files, 9 untracked files represented by 7 status
entries, and no staged changes.

The roadmap amendment was copied byte-for-byte from the primary checkout into
this isolated worktree. Its source and destination hashes matched the expected
value above.

## Evidence classification

### Already proven or reusable

- The LPL amendment and its public-beta, noindex, main-PC-first and interim
  backup posture are exact and preserved.
- The approved NHL 26/27 policy requires independent ingestion eligibility,
  frontend default and chronology, preserves NHL 26 history, and forbids
  overlapping career-total double counting.
- Account/admin denial, loopback Compose defaults, backup artifact integrity
  components, draft legal content, the webmaster path and historical NHL 27
  ingestion evidence exist.
- Cached upstream source includes the draft legal routes and global footer.

These are inputs, not complete launch controls.

### Implemented but needing current verification

- Account and admin route refusal.
- Archive-title reachability, source labels and career source precedence.
- Legal routes and footer.
- Responsive navigation and focus behavior.
- Backup producer, acceptance, integrity and freshness components.
- Core-route empty and unavailable states visible in source.

### Genuinely unimplemented

- Independent title ingestion/default/chronology controls and one shared
  resolver for the four title-aware core routes.
- LPL-wide noindex plus consistent robots and sitemap behavior.
- Removal or denial of preview and development-only surfaces.
- Complete security-header, input-boundary, rate-limit and 404/500 leakage
  controls.
- An activated off-host interim backup, scheduler, retention, failure signal,
  restore drill and exercised recovery/rollback procedures.
- Uptime, application-error, stale-worker, ingestion-gap, transform-error and
  interim-backup monitoring.
- Bounded production log retention.
- Final legal publication and a full launch-link crawl.
- Current browser, mobile, accessibility and performance evidence.
- A pinned release artifact, deployment proof and observation window.

### Requires operator or production authorization

- Read-only main-PC inventory of the deployed commit, images, migration state,
  database identity, rollback artifact, disk/log posture and edge state.
- Explicit safe-pause confirmation from the separate E3 conversation.
- Selection and access approval for the physically separate interim backup
  destination.
- Cloudflare analytics, domain, TLS and redirect verification or changes.
- Production smoke, exposure, secret, notification, restore and rollback
  exercises.
- Legal publication, commit/push/merge, deployment and observation.

## Smallest implementation units

1. Title-control split, shared resolver and chronology/career-label correction.
2. LPL public boundary: noindex, robots/sitemap, private-route denial,
   security headers and error-leakage tests.
3. Interim backup activation: non-E3 transport, schedule, retention, integrity
   reporting and freshness alert.
4. Recovery proof: disposable restore, critical counts, representative reads,
   host-loss and deployment rollback procedures.
5. Monitoring and disk safety: application/worker/data/backup checks,
   notification proof and bounded logs.
6. Legal publication and complete link verification.

The footer and account shutdown should be verified, not rewritten.

## Workstream boundaries

- integrate/lpl-2026-10-02 owns the roadmap, HANDOFF, October journal and
  integration evidence.
- feat/lpl-title-separation owns game-title schema/query/migration, worker
  title polling, title resolver, title-aware pages and focused tests.
- feat/lpl-interim-recovery owns non-E3 backup/monitoring files, recovery docs
  and Docker log limits. It must not touch ops/backup/credential or Proton/E3
  lifecycle material.
- feat/lpl-legal-publish owns legal content, legal routes, footer and legal
  HTTP tests.
- fix/lpl-public-boundary owns Next security/indexing configuration, preview
  route removal, error surfaces and security tests.
- A later test/lpl-ux-release branch verifies the integrated candidate and
  permits only launch-blocking corrections.

The primary dirty checkout and the E3 worktree are outside every workstream.

## Open L0 conditions

1. Obtain the read-only main-PC production inventory.
2. Obtain the E3 conversation's explicit safe-pause statement.
3. Reconcile both against this baseline and name the candidate commit, deployed
   images, database/migration state and rollback artifact.

Until all three are recorded, no L0 checkbox is closed.
