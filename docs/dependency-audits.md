# Dependency audit

The workspace uses pnpm for dependency management. Run the repeatable audit gate after any dependency or lockfile update:

```sh
pnpm run audit:dependencies
```

The command runs `pnpm audit --json`, reports each affected package, advisory ID, severity, and vulnerable range, and exits with status 1 for every unaccepted vulnerability. A clean audit prints the dependency count and exits with status 0.

## Temporary reviewed exceptions

The safest default remains an empty `config/dependency-audit-allowlist.json`:

```json
{
  "exceptions": []
}
```

If remediation is temporarily impossible, add the narrowest exception in a reviewed change:

```json
{
  "exceptions": [
    {
      "package": "affected-package",
      "advisory": "GHSA-abcd-1234-wxyz",
      "reason": "Compatibility constraint while the patched release is validated.",
      "owner": "Security owner",
      "expires": "2026-09-30"
    }
  ]
}
```

- `package` and `advisory` must exactly match the package name and stable advisory ID reported by the audit.
- `reason` must explain why immediate remediation is not possible.
- `owner` names the person or team accountable for remediation and review.
- `expires` is a real `YYYY-MM-DD` UTC date. The exception is valid through that date and fails the next day.

The audit fails for malformed, duplicate, expired, or unmatched exceptions. An unmatched exception includes one whose package/advisory pair changed or whose advisory is no longer reported; remove it rather than leaving a stale approval in the allowlist. Matching active exceptions are printed prominently with their owner, expiration, and reason. Any advisory without a matching active exception still fails the gate.

Run the policy regression tests after changing the audit script or exception format:

```sh
pnpm run test:audit-dependencies
```

The same check is registered as the `dependency-audit` validation command in the workspace validation settings, so it can also be run with the other project quality gates.

## Deployment release gate

The deployment post-build hook runs:

```sh
pnpm run release:verify
```

That script runs `audit:dependencies` before pruning the pnpm store. A nonzero audit result stops the post-build hook, so the deployment cannot publish. Failed audits print each affected package, severity, vulnerable version range, and advisory before exiting with status 1.