# Modding tools (local only)

The tools used to build mods. Nothing here is installed system-wide: **delete this whole
`_util` folder to remove all of it.** Nothing in here gets uploaded with a mod.

| Folder | What | Source |
|---|---|---|
| `source2viewer/Source2Viewer.exe` | Source 2 Viewer 20.1: browse and export Deadlock's files | [GitHub release 20.1](https://github.com/ValveResourceFormat/ValveResourceFormat/releases/tag/20.1), SHA-256 matched GitHub's digest |
| `source2viewer/cli/Source2Viewer-CLI.exe` | Same project's command-line decompiler, used by scripts to export models and textures | Same release (`cli-windows-x64.zip`), SHA-256 matched |
| `Reduced_CSDK_13/` | **Not installed yet.** Compiles models, materials and textures and packs VPKs | See below |

## Paths on this PC

- Deadlock: `Z:\SteamLibrary\steamapps\common\Deadlock`. The game files are in `game\citadel\pak01_dir.vpk`, and the addons folder `game\citadel\addons` doesn't exist yet.
- Blender 5.2: `D:\Blender\blender.exe`, with the Blender Lab MCP add-on connected on port 9876.

## Example: list hero models

```powershell
.\mods\_util\source2viewer\cli\Source2Viewer-CLI.exe -i "Z:\SteamLibrary\steamapps\common\Deadlock\game\citadel\pak01_dir.vpk" --vpk_list -e vmdl_c -f models/heroes
```

Hero folders use internal names, e.g. `haze`, `wraith`, `inferno` (Infernus), `geist` (Lady Geist), `viper` (Vyper).

## CSDK 13 (install manually)

CSDK 12 is outdated. The community notes say to use **CSDK 13**, which supports the
20 Oct 2026 Nurse Harrow update: https://deadlockmodding.pages.dev/modding-tools/csdk-13

It's a community repack of Valve's Workshop Tools, hosted on Google Drive or Mega, so download it
yourself from that page rather than having Claude fetch it. Then:

1. Unpack the `Reduced_CSDK_13` folder into this `_util` folder, giving
   `mods\_util\Reduced_CSDK_13\`.
2. Run `Reduced_CSDK_13\csdkcfg.exe`, create an addon with a lowercase name and no spaces,
   then press **Launch Tools**. Steam must be running.
