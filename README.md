# Deadlock After Market

My Deadlock mods, from working files to finished uploads on GameBanana.
Friends install them through Deadlock Mod Manager (DMM), which reads GameBanana,
so there is no website to host.

## Folder layout

```
mods/
  _template/          copied for every new mod (don't edit for a specific mod)
  <mod-name>/
    mod.md            title, version, hero, category, description, changelog
    source/           working files (Blender, textures, sounds). Never uploaded.
    build/            the finished pak##_dir.vpk file(s)
    images/           screenshots for the GameBanana page
releases/             zips made by package.ps1, ready to upload
tools/
  new-mod.ps1         makes a new mod folder
  package.ps1         checks a mod and zips it for upload
```

## Making and sharing a mod

Run these in PowerShell from this folder. If Windows blocks scripts, run this once first:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

1. **Start a mod**

   ```powershell
   .\tools\new-mod.ps1 "Golden Haze"
   ```

   This creates `mods\golden-haze\`. Fill in `mod.md`.

2. **Build it.** Make the mod in CSDK 12 or Source 2 tools. To get a VPK, open CSDK 12's
   Asset Browser, then CS2 Workshop Manager > New > Submit. The submit fails, but it still
   writes a VPK to `game\citadel_addons`. Guides:
   https://deadlockmodding.pages.dev/modding-guides/

3. **Name the VPK** `pak##_dir.vpk` (## = 01 to 99, e.g. `pak21_dir.vpk`) and put it in
   `mods\<mod>\build\`. To test it yourself, also copy it into
   `Deadlock\game\citadel\addons`.

4. **Add screenshots** to `mods\<mod>\images\`.

5. **Package it**

   ```powershell
   .\tools\package.ps1 golden-haze
   ```

   This checks the VPK names, title, version and screenshots, then writes
   `releases\golden-haze-v1.0.0.zip` (the VPKs plus an INSTALL.txt for manual installs).

6. **Upload to GameBanana.** Sign in at https://gamebanana.com, open the Deadlock game page,
   and submit a new Mod. Upload the zip and screenshots, then copy the title, category, hero
   and description from `mod.md`.

7. **Friends install it.** In Deadlock Mod Manager (https://deadlockmods.app), search the Mods
   Store for the mod name and click install. New GameBanana mods can take a little while to
   show up in DMM. Friends without DMM can download the zip from GameBanana and follow
   INSTALL.txt.

## Updating a mod

1. Rebuild the VPK into `mods\<mod>\build\` and keep the same file name.
2. Bump `Version` in `mod.md` and add a changelog entry.
3. Run `.\tools\package.ps1 <mod>` again.
4. On your GameBanana page, upload the new zip as an update. DMM shows your friends the
   update.

## Releasing on GitHub

GitHub Actions runs the tests and typecheck on every push (`.github/workflows/test.yml`). It
can't build the mod: compiling needs CSDK (Valve's tools, Windows, Steam running) and the
game's own `hud.xml`, and neither can live in a public repo. So releases are built on this PC:

1. Commit your changes. Add a `### <version>` entry under `## Changelog` in `mod.md`.
2. Close Deadlock, keep Steam open, then run:

   ```powershell
   .\tools\release.ps1 hud-event-timers 1.0.1
   ```

   It sets the version, runs the tests, builds and compiles with CSDK, packages the zip,
   commits, tags `hud-event-timers-v1.0.1`, pushes, and publishes a GitHub Release with the zip
   and that changelog entry.
3. Upload the same zip to GameBanana as an update. GameBanana has no upload API, so this
   step stays manual.

Kept out of git (see `.gitignore`): the game's extracted files (`vanilla\`, `extract\`, Blender
scenes), built VPKs and release zips, the Source 2 Viewer program, and screenshots.

## Tips

- **Pak numbers:** when two mods change the same file, the lower pak number wins. DMM
  renumbers files for players automatically, so the number you pick mostly matters for
  manual installs.
- **Variants:** for several versions of a skin (colours, etc.), put each VPK in `build\` with
  its own pak number. DMM lets players pick which one to install.
- **After game updates:** Deadlock patches can break mods. DMM repairs many of them
  automatically. If yours breaks, rebuild it and upload a new version.
- **HUD mods with code:** `mods/hud-event-timers` is a HUD mod with a TypeScript script and its
  own build. Its steps are in `mods/hud-event-timers/source/README.md`.
- **Size:** keep each VPK under 2 GB. For bigger mods, use CSDK's Multichunk Workshop Manager.
