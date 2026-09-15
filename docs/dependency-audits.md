# Dependency audit

The workspace uses pnpm for dependency management. Run the repeatable audit gate after any dependency or lockfile update:

```sh
pnpm run audit:dependencies
```

The command runs `pnpm audit --json`, reports each affected package and severity when advisories are present, and exits with status 1 for any reported vulnerability. A clean audit prints the dependency count and exits with status 0.

The same check is registered as the `dependency-audit` validation command in the workspace validation settings, so it can also be run with the other project quality gates.

## Deployment release gate

The deployment post-build hook runs:

```sh
pnpm run release:verify
```

That script runs `audit:dependencies` before pruning the pnpm store. A nonzero audit result stops the post-build hook, so the deployment cannot publish. Failed audits print each affected package, severity, vulnerable version range, and advisory before exiting with status 1.