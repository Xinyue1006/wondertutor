# Dependency audit — 11 November 2026

## Safe correction applied

The frontend test environment used `jsdom@30.1.2 -> undici@8.11.2`. Npm reported a high-severity vulnerable package covering multiple upstream advisories. Updated only the transitive lockfile resolution to **undici 8.12.4**, within jsdom's existing compatible range; no direct library or major version was changed. The installed package was updated too.

`npm audit --json` now reports **0 frontend vulnerabilities**; `npm audit --omit=dev --json` also reports 0. These are dependency-database checks, not proof that application code has no security defects.

Primary source: [Undici excessive-content-encoding advisory](https://github.com/nodejs/undici/security/advisories/GHSA-xjj6-f33q-929c). The affected 8.x range ends before 8.12.2; 8.12.4 is outside that range. This package is used by the development/test DOM environment, rather than the deployed browser bundle.

## Backend advisories requiring an upstream compatibility decision

The complete backend audit reports **23 dependency findings: 3 high, 17 moderate, 3 low**. Several are dependency-chain reports of the same vulnerable lower-level package, rather than 23 independent application bugs. The `--omit=dev` view still includes **3 high findings** through the Prisma CLI/config chain, because Prisma is also installed through the client's peer relationship. Do not report this as a clean backend production audit.

- **Prisma 6.19.3 -> @prisma/config 6.19.3 -> deepmerge-ts 7.1.5.** The upstream recursive-object-graph issue is fixed in deepmerge-ts 8.0.0+. Prisma 6.19.3 pins 7.1.5. Registry checks found no later stable Prisma 6 release; npm's suggested remedy is Prisma 7.10.1, a major upgrade that conflicts with the project's Prisma 6 requirement. No forced upgrade or incompatible transitive override was applied. [Primary advisory](https://github.com/RebeccaStevens/deepmerge-ts/security/advisories/GHSA-ggr8-5vv4-36mx).
- **Jest/nodemon tooling chains.** Audits identify glob/minimatch and deepmerge issues. Existing parent dependencies do not accept all patched major versions. Npm's proposed aggregate fix includes a Jest downgrade to 25.1.0 and a nodemon downgrade, which would not be an appropriate automatic repair of this ES-module test setup. [Glob primary advisory](https://github.com/isaacs/node-glob/security/advisories/GHSA-3g3m-2fjr-6pw4), [minimatch primary advisory](https://github.com/isaacs/minimatch/security/advisories/GHSA-g3hv-75wg-m249).

The deepmerge-ts advisory requires recursive object graphs; ordinary JSON input alone does not create the reported condition. Its current dependency is used for Prisma configuration/build tooling. This limits the evident exposure in the reviewed app; it does not erase the advisory or justify accepting untrusted configuration. Keep build/test configuration trusted, isolate CI/deployment credentials, avoid exposing developer tools publicly, and track compatible upstream fixes. Application HTTP paths use Prisma Client, not a public configuration-merging endpoint.

Before real deployment, assign an owner to either obtain a supported Prisma 6 patch/backport or plan a separately tested Prisma upgrade with the teammate. Revisit test-tool advisories when compatible parent releases are available. Re-audit regularly: results change as advisory data and packages change.

## Final verification

After the lockfile update the full frontend suite passed **231 tests** and the production build passed. The final backend regression also passed **477 tests**. No backend dependency files were changed for the audit correction. This validates compatibility of the safe update; it does not resolve the documented backend advisories.
