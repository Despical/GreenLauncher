# Green Launcher development

- Preserve the existing dark neutral interface and shared controls. Use green only in established or explicitly requested accents.
- Keep Turkish UI copy consistent and add the matching English, German, French, Russian and Polish translations in `src/renderer/src/i18n.ts`.
- Protect account credentials, launcher runtime data, profiles, worlds and server lists. Use isolated fixtures for testing; never publish runtime files or generated QA output.
- Verify relevant behavior before publishing. Run `pnpm run build` and `node scripts/check-i18n.mjs`; use the focused service and renderer checks for changes to launch, accounts, servers or worlds.
- Build a requested portable executable with `pnpm dist:portable` and verify the package with `node scripts/qa-accounts-package.cjs`.

## Commit and publication workflow

The user authorizes English commits and pushes to the public `Despical/GreenLauncher` repository after significant, verified changes. The repository was made public at the user's explicit request.

- The implementing agent finishes and verifies the change, then sends the commit agent the exact scope, relevant checks and intended behavior.
- Delegate the Git commit and push to the repository commit agent, using `gpt-6-luna` when available. Reuse the existing agent in the same conversation when possible.
- The commit agent inspects the staged diff, checks that ignored files and secrets are excluded, creates a focused English commit and pushes to `main`. Never force-push, rewrite history or include unrelated changes.
- The commit agent reports the commit hash, changed paths, verification results, remote branch and push outcome to the implementing agent.
- The implementing agent reviews that report and verifies the local and remote commit identities before reporting completion.
- An explicit user request to hold commits or pushes overrides this default. Do not create background schedules or run continuous monitoring for this workflow.

## Releases and updates

- Significant verified changes may be published as GitHub releases with English release notes. Bump the stable package version, update the built-in six-language changelog, and add `docs/releases/<version>.md` before building.
- Use patch version bumps for fixes and small interface refinements; reserve minor version bumps for substantial new features.
- Build the NSIS setup using `pnpm dist:setup`. Updates require the versioned setup EXE, its blockmap and `latest.yml` on the same GitHub release. Verify checksums and the packaged updater configuration before publication; publish a draft only after all assets are uploaded and checked. Tag the verified source commit, never an unrelated HEAD.
- Never publish runtime/account files or credentials. Never embed a GitHub token in the launcher. Preserve user data and the no-downgrade policy. Do not overwrite already published release assets.
- Update installation is explicit and blocked while games, downloads or installations are active. Keep the portable build available, but prefer the setup for users who want automatic updates.
