# Contributing

Please discuss proposed changes in a [GitHub issue](https://github.com/Despical/GreenLauncher/issues)
before starting a large contribution. Follow our [Code of Conduct](CODE_OF_CONDUCT.md).

## Pull Request Process

- Keep changes focused and follow the existing code style. Use spaces, not tabs.
- Keep the dark neutral UI and shared controls consistent. Add matching translations
  for Turkish, English, German, French, Russian and Polish when changing UI text.
- Run `pnpm run build` and `node scripts/check-i18n.mjs`.
- Run relevant isolated core checks from the GitHub Actions workflow.
- For packaging changes, build with `pnpm dist:portable` and run
  `node scripts/qa-accounts-package.cjs`. Packaging requires Windows native build tools.
- Never commit credentials, Microsoft tokens, launcher data, generated output or QA captures.
- Do not change version numbers or publish release assets as part of an unrelated change.

## Issues

Check existing issues and use the latest release before reporting a bug. Include your
launcher version, Windows version, Minecraft version and clear reproduction steps.
Remove tokens, account details and personal filesystem paths from logs and screenshots.
Use the feature request form for suggestions. Security reports belong in
[private reporting](SECURITY.md), not public issues.
