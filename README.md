# Treasure Hunt Map

A single-page React app (Vite + TypeScript, no backend) for tracking a treasure hunt on the game's world map.
There are two layers of marks:

- **Shared marks** ship with the site from [`src/data/shared.json`](src/data/shared.json). Every visitor sees them, and nobody can change them in the app; only a code change and a deploy can. Use them to publish the latest finds to everyone.
- **Your own marks** are saved in your browser's `localStorage`, as before. They can go on any tile that has no shared mark. Export and import JSON files for backups and sharing.

- **Map**: 507 × 1019 tiles (X 3–509, Y 3–1021), drawn on a `<canvas>` as **diamonds in staggered rows**, like in the game. Rows with an even Y sit half a tile to the right, so the lower-right neighbour of 100:200 is 101:201, and of 101:201 is 101:202. Rows are half a tile apart, so the map is square.
- **Zones**: 73 level areas (L1–L5) plus the King's Throne, converted from the zone map image.
- **Marks**: T (treasure found), C (scrap), S (suspected), D (dug, nothing), X (searched 39×39 area, nothing in it), each with an optional note.
- **Landmarks**: name, type, optional level, position and size, drawn on the map. Types, their colours and their icons (crown, ruin, castle, flag, star, gem, chest, dot) can be edited.
- **Pins when zoomed out**:
  - When tiles get too small to read, Treasure (chest icon), Scrap (gear) and Suspected (?) tiles become map pins. Nearby pins group into a bubble with a count badge; click it to zoom in. Click a single pin to jump to that tile.
  - Landmarks get bigger pins with their type's icon and their name.
  - Turn pins on or off under *Display & filters*.
- **Mark areas**: an optional 39×39-tile diamond centred on every T, C and X tile. Overlapping areas of the same mark merge into one outlined region (an indicator only). Turn it on or off in the **Map** tab.
- **Where to search next** (Map tab): a small probability model for the next drop. Finds keep about 33 tiles away from each other (fitted to the shared finds; treasures and scrap follow the same rule), so each tile gets a weight from its distance to the nearest find, and each zone area gets a % chance: its share of that weight, optionally within one level. Bigger and emptier areas score higher. Click a row to jump to the area's most likely spot; **Show on map** draws a heatmap with numbered badges. Mark dug-empty tiles D to rule them out.
- **Finder**: jump to `X:Y`, highlight the tile with a crosshair, and see the nearest landmark, Chebyshev distance and offset.
- **Lists and stats**: mark counts per zone level, plus clickable lists of marked tiles.
- **Undo/redo**, filters, dim unmarked tiles, and a dark UI by default (follows the system light/dark setting).
- **Responsive layout**: a side panel on desktop (narrower on tablets), and an expandable bottom sheet under the map on phones.

## Run locally

Requires Node.js 18+.

```bash
npm install
npm run dev        # http://localhost:5173
```

## Build

```bash
npm run build      # type-checks, then writes static files to dist/
npm run preview    # serves dist/ locally to check the build
```

The build is fully static, and `base: './'` makes it work from any sub-path.

## Deploy

### GitHub Pages

1. Push this project to a GitHub repository (branch `main`).
2. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The included workflow [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) builds and deploys on every push to `main`, or you can run it from the **Actions** tab.
4. The site will be at `https://<user>.github.io/<repo>/`.

### Netlify

- **Git-based:** "Add new site → Import an existing project", then pick the repository. [`netlify.toml`](netlify.toml) already sets `npm run build` and the `dist` folder.
- **Drag and drop:** run `npm run build` and drop the `dist/` folder on <https://app.netlify.com/drop>.

## Publishing shared marks

1. Mark the new finds in the app and click **Export JSON** (More tab). The export holds only your own marks.
2. Merge them into the shared map:

   ```bash
   npm run share -- treasure-map-2026-11-06.json            # add or update those marks
   npm run share -- treasure-map-2026-11-06.json --replace  # make the shared map exactly that file
   ```

   This rewrites `src/data/shared.json` with one mark per line and sets `updatedAt` to today. You can also edit that file by hand; to remove a shared mark, delete its line.
3. Commit and deploy. Visitors get the new marks the next time they load the page.

Shared marks are **read-only** in the app: the tile card shows a **SHARED · READ-ONLY** tag with its buttons and note disabled, brushes and the eraser skip those tiles, and imports skip them too. An own mark made on a tile before it became shared is hidden (the shared mark wins); **More → Remove N own marks hidden under shared marks** cleans those up.

> Saved data lives in each visitor's own browser, per site address. Moving to a new URL starts with an empty map, so export first and import at the new address.

## Side panel

The panel has five tabs, each split into groups:

| Tab | What's in it |
| --- | --- |
| **Tile** | Go to X:Y; the selected tile (mark, note, zone, nearest landmark, distance and offset, **Copy** X:Y); recent jumps |
| **Marks** | Marked-tile browser for one code at a time, with a zone filter, note search, sorting by position or by distance from the selected tile, and **Copy list** (paste it into game chat); **Paste coordinates** to mark a whole list in one step; progress by zone |
| **Landmarks** | Search, filter by type, sort by name or by distance from the selected tile; add, edit and delete; landmark types (colour, icon, name) |
| **Map** | Marks from **Both / Mine / Shared**; zones, pins, mark areas (39×39 around T, C and X), dimming and which mark codes to show; legend |
| **More** | Export and import (backup and sharing); how to use |

## Using the map

| Action | Mouse | Touch |
| --- | --- | --- |
| Select a tile (opens its card) | click or right-click; click again to deselect | tap; tap again to deselect |
| Mark the selected tile | card buttons, or keys `1`–`5` (T/C/S/D/X) and `0`/`Delete` to clear | card buttons |
| Paint with a brush (pick T/C/S/D/X/eraser in the toolbar) | click / drag; size 1/3/5/9 or **Box** (drag a rectangle) in the banner | tap / drag |
| Erase while a brush is active | right-drag | pick the eraser |
| Pan | drag (Select tool), or middle-drag / Space+drag with a brush | one-finger drag (Select tool), two fingers |
| Zoom | wheel or double-click (Shift+wheel pans sideways) | pinch or double-tap |
| Tile info | hover | tap |

Clicking a tile only selects it and never changes its mark. With a tile selected:

- The arrow keys move the selection (`Shift` moves 10 tiles).
- `N` / `Shift+N` (or the ‹ › buttons in the card) step through the tiles with the same mark, for example every Suspected tile in turn.
- `Esc` closes the card.

The **Go to X:Y** box in the toolbar jumps to a tile even when the side panel is closed. Every change shows a toast with **Undo**. While a brush is active, a banner on the map shows which one, with a **Done** button.

Keyboard: `V` select tool, `T` `C` `S` `D` `X` brushes, `E` eraser, `Esc` back to Select (or close the card), `F` fit map, `Z` zones on/off, `P` side panel, `+`/`-` zoom, `Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`) undo/redo.

Selecting a tile (by clicking it, using **Go**, or picking one from a list) shows its mark, note, zone level, nearest landmark, distance and offset in the Finder. Typing or pasting `123:456` (or `123 456`, `123,456`) into either coordinate box fills both. Coordinates outside 3–509 / 3–1021 are rejected.

## Data

### Export format

```json
{
  "app": "treasure-hunt-map",
  "version": 1,
  "marks": [{ "x": 120, "y": 300, "code": "T", "note": "chest" }],
  "landmarks": [{ "id": "…", "name": "Ruin Alpha", "typeId": "ruin", "level": 4, "x": 300, "y": 600, "size": 3, "notes": "" }],
  "landmarkTypes": [{ "id": "ruin", "name": "Ruin", "color": "#C65911" }]
}
```

Import offers two modes:

- **Merge** adds the file's marks and landmarks to yours. Marks overwrite tiles, and landmarks with the same `id` are replaced.
- **Replace** swaps out all your data.

Both can be undone. Entries with invalid coordinates (below 3 or beyond the map), unknown codes, or bad sizes are skipped and listed.

### Internals

- Marks are two `Uint8Array(507 × 1019)` layers, shared and own; the map shows shared ‖ own. Codes: (0 = none, 1 = T, 2 = R (hidden for now), 3 = D, 4 = S, 5 = C) plus a `Map<index, note>`. The index is `(Y − 3) × 507 + (X − 3)`.
- `localStorage` stores your own marks run-length encoded under the key `treasure-map:v1`. Saves are debounced and also flushed when the page is hidden.
- Rendering ([`src/lib/grid.ts`](src/lib/grid.ts), [`src/lib/mapView.ts`](src/lib/mapView.ts)): turned by 45°, the staggered diamonds form a plain square grid. Zone colours, zone borders, marks and the treasure / scrap areas are cached in offscreen canvases in that grid, one pixel per tile, and drawn with a rotating transform, so each pixel lands on its diamond. Each frame draws only the visible part, plus grid lines, letters, vector borders and landmarks for the visible tiles. A frame costs a few milliseconds.

## Regenerating the zone grid

The zone grid ships as [`src/data/zones.json`](src/data/zones.json): run-length-encoded area ids, a level for each area, and label positions. To rebuild it from the image:

```bash
npm run zones
# same as: node scripts/build-zones.mjs scripts/zones-source.jpg src/data/zones.json
```

[`scripts/build-zones.mjs`](scripts/build-zones.mjs):

1. Crops off the grey frame.
2. Splits the white areas between the border lines into connected regions.
3. Gives each region a level from a list of seed points: the printed level labels plus one point inside the Throne.
4. Grows the regions over the lines, digits and icons.
5. Stretches the result linearly onto the 507 × 1019 grid, with the inner left/right edges at X 3/509 and top/bottom at Y 3/1021.

It fails loudly if a region has no seed, if two seeds share a region, or if the counts per level aren't 24/18/16/10/5 plus the Throne. If you swap in a different image, update the `SEEDS` list at the top of the script.
