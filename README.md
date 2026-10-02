# Green Launcher

An independent Windows launcher for Minecraft: Java Edition, built with Electron, React and TypeScript.

## Features

- Minecraft releases, snapshots and historical versions, with automatic dependency and Java runtime installation.
- Microsoft accounts and local offline accounts, account switching, cached skins and account cosmetics.
- Separate profiles with their own Minecraft version, game directory, worlds, mods, Java and memory settings.
- Mod and modpack catalogs, compatible loader installation, and profile import/export.
- Profile-specific server lists synchronized with Minecraft’s `servers.dat`, cached server icons and connection information.
- Profile-specific worlds with icons, game mode, last-played time and size; import, rename, duplicate, recycle-bin deletion, icon reset, exact seed copying and folder opening.
- World seed support for legacy saves, Minecraft 1.16+ `WorldGenSettings`, and the separate `data/minecraft/world_gen_settings.dat` format used by Minecraft 26.1+.
- Direct world launch on Minecraft versions that support Quick Play Singleplayer (1.20+); direct server launch on supported versions.
- Daily and weekly playtime, profile-specific session history and optional local persistence, with an idle bottom-bar summary.
- Screenshot gallery, download manager, storage tools, logs, Discord activity and Windows shortcuts.
- Turkish, English, German, French, Russian and Polish interfaces.

## Development

Use Windows, Node.js 22 and pnpm 10.28.2 (the version declared in `package.json`).

```powershell
pnpm install --frozen-lockfile
pnpm dev
```

Build and check the application:

```powershell
pnpm run build
node scripts/check-i18n.mjs
node scripts/test-accounts.cjs
node scripts/test-profile-sessions.cjs
node scripts/test-playtime.cjs
node scripts/test-servers-custom.cjs
node scripts/test-profile-server-sync.cjs
node scripts/test-worlds.cjs
```

The core checks use isolated fixtures. Renderer QA helpers in `scripts/` also use a separate fixture directory under `build/`; do not run destructive checks against real launcher or Minecraft data.

## Windows distribution

Install `GreenLauncher-Setup-<version>.exe` from [GitHub Releases](https://github.com/Despical/GreenLauncher/releases) once to receive future updates inside the launcher. Automatic checks run at startup and every six hours. Manual checks are in Settings > Launcher. A newer release displays its notes on the home page and an indicator in the bottom bar. Download and installation require explicit actions; installation waits until games and active operations finish. Equal, older and prerelease versions are never offered. Downloads are checksum-verified before execution, failed/cancelled downloads can be retried, and a completed cached installer is revalidated on the next download attempt. User data stays outside the install directory.

```powershell
pnpm dist:setup
node scripts/verify-release.cjs
```

The setup, its blockmap and `latest.yml` must all be uploaded to the same stable GitHub release. The publisher settings in `package.json` generate the update metadata. Release notes belong to the GitHub release. Create releases only at the user’s explicit request. Use a draft until all assets are present and verified. A future website can serve the same NSIS installer and update metadata through a generic update provider.

Portable packaging requires Visual Studio C++ Build Tools and the Windows SDK for the native splash helper.

```powershell
pnpm dist:portable
node scripts/qa-accounts-package.cjs
```

The executable is written to `release/GreenLauncher.exe`. The packaging check compares the bundled application files with the final build, including lazy renderer chunks.

Source artwork and packaging icons live under `build/` and `src/renderer/assets/`. Generated output, extracted runtimes, dependencies and QA captures are ignored by Git. The custom XMCL installer patch in `patches/` is required and is applied by pnpm.

## Accounts and saved data

Settings, profiles and cached data live under `%APPDATA%/GreenLauncher`, outside this repository. Each profile normally uses `profiles/<profile-id>` as its game directory; a custom game directory can be selected in the profile settings. Existing vanilla Minecraft installations are detected without relocating their files.

Playtime measures successful profile launches until process exit. Sessions are checkpointed every 30 seconds so an interrupted launcher preserves the last measured interval. Daily totals use local dates; weeks start on Monday. Old launch-only history cannot provide accurate durations and is not converted into fabricated playtime. Settings > Launcher can disable local persistence: saved duration records are removed when that preference is saved, and playtime remains only in memory until the launcher closes. Re-enabling persistence saves the in-memory history again. No playtime data is uploaded.

Offline accounts do not require Microsoft sign-in and can join only servers that permit offline accounts. Microsoft launch requires a licensed Minecraft: Java Edition account and successful authentication. Authentication tokens are stored using Windows secure storage; live sign-in availability also depends on the configured OAuth application. CurseForge access requires an approved API key and is not supplied by this repository.

## Contributions and commits

Read [AGENTS.md](AGENTS.md) for UI conventions, validation and the delegated commit workflow. Significant verified changes use focused English commits on `main`; generated output, credentials and runtime data must stay out of commits.

The Windows GitHub Actions workflow runs translations, core checks, update lifecycle checks and a production build for pushes and pull requests.

## License

[GNU GPL v3](LICENSE). Green Launcher is an independent project and is not affiliated with Mojang Studios or Microsoft.
