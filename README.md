# Vite+ core peer resolution

Reproduce whether installing **only `vite-plus`, without overrides**, also installs upstream Vite to satisfy Vitest's peer dependency.

This isolates the stable-version change proposed in [vite-plus#3317](https://github.com/voidzero-dev/vite-plus/pull/3317). It is a real package installation experiment, **not a full build comparison of the PR's base and head**.

## Run

Requires Python 3, Node.js 22.18+ (or a newer supported Node release), npm, pnpm, curl, and access to the public npm registry. The recorded run used Node 26.4.0, npm 11.17.0, and pnpm 11.21.0 on macOS arm64. Other versions may behave differently.

```sh
git clone https://github.com/liang-demos/vite-plus-core-peer-resolution.git
cd vite-plus-core-peer-resolution
python3 run.py
```

The script creates four fresh projects in `.runs/`, installs their dependencies, and prints JSON results. Each project declares only:

```json
{
  "private": true,
  "dependencies": {
    "vite-plus": "1.6.0"
  }
}
```

No overrides, resolutions, or peer suppression rules are added. Installation scripts are disabled. npm caches, pnpm metadata caches, and pnpm stores are separate for each case; pnpm copies package files rather than sharing hardlinks. Run with ordinary/default pnpm settings: custom global peer settings can change the outcome.

The localhost registry stops automatically when the run finishes. Downloaded packages, logs, lockfiles, manifests, resolved paths, and measurements stay under `.runs/` for inspection. No packages are published.

## What changes between the two cases?

Both use the actual published `vite-plus@1.6.0` and `@voidzero-dev/vite-plus-core@1.6.0` tarballs, with bundled Vite 8.3.7 and Vitest 5.1.0.

| Manifest field | Before | After |
| --- | --- | --- |
| Core `version` | `1.6.0` | `8.3.7000` |
| CLI `dependencies.vite` | `npm:@voidzero-dev/vite-plus-core@1.6.0` | `npm:@voidzero-dev/vite-plus-core@8.3.7000` |

Only these two manifest values change. The local registry serves matching metadata and repacked tarballs; all other packages come from npm. Using a registry instead of `file:` dependencies preserves alias and peer resolution behavior.

The after version uses the PR's patch encoding (`7 × 1000 + 0`, giving `8.3.7000`), because this published core bundles Vite 8.3.7. Newer PR revisions may bundle a different Vite patch.

```text
workspace
└── vite-plus
    ├── vite → @voidzero-dev/vite-plus-core
    └── vitest
        └── peer vite → which package actually resolves here?
```

## Recorded result

See [the original measured data and conditions](results/macos-arm64.json) and [the end-to-end demo rerun](results/demo-rerun.json). The rerun reproduced the npm sizes exactly and the pnpm resolution behavior; pnpm totals were 123.83 MiB in both cases.

| Package manager | Before: upstream Vite copies | After: upstream Vite copies | Before size | After size |
| --- | ---: | ---: | ---: | ---: |
| npm 11.17.0 | 1 | 0 | 144.20 MiB | 123.65 MiB |
| pnpm 11.21.0 | 0 | 0 | 123.82 MiB | 123.82 MiB |

npm saved **21,543,623 bytes / 20.55 MiB (14.25%)**. Before alignment, Vitest resolved upstream `vite@8.3.8`, while the CLI resolved core. After alignment, both resolved the same core instance.

The npm before case additionally installed:

- `vite@8.3.8`
- `rolldown@1.2.19`
- `@rolldown/binding-darwin-arm64@1.2.19` (about 17.34 MiB alone)
- `@rolldown/pluginutils@1.1.1`
- `@oxc-project/types@0.156.0`

pnpm resolved Vitest and the CLI to the same core in both cases. Its before case emitted a peer warning; its after case did not. Total file size differed by only 65 bytes.

## Measurement and limits

- `scripts/inspect.mjs` uses `createRequire` from the installed CLI and Vitest locations, then compares the real paths of their resolved `vite/package.json` files.
- `scripts/measure.py` scans installed package manifests for packages actually named `vite`; the core alias retains its canonical package name.
- Size is the sum of regular-file bytes under `node_modules`, excluding symlinks. It includes installation metadata, excludes caches/stores outside `node_modules`, and is not compressed download size or filesystem allocated blocks. `payloadBytes` additionally excludes selected package-manager metadata files.
- The recorded `results/` file is historical evidence, not a golden assertion. Transitive semver ranges and the registry can change between runs, and native binary sizes depend on the platform.
- This experiment validates dependency installation/resolution, not runtime compatibility of a fully rebuilt release. Core runtime files are deliberately unchanged.
