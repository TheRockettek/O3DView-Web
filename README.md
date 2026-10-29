# O3DView Web

An early, offline-capable WebGPU/WebGL 2 port of O3DView. This is **not yet a
feature-complete replacement** for the desktop application.
The [parity TODO](TODO.md) tracks reviewed gaps and priorities.

## Run and install

Serve this directory over `localhost` (or HTTPS), for example:

```sh
cd web
python3 -m http.server 8000
```

Visit <http://localhost:8000/> in a browser with WebGPU or WebGL 2 support. Wait for
"Ready for offline use" before disconnecting. Use the browser's install
command if available; alternatively revisit the same URL while offline.
The first visit and installation require a secure context; opening
`index.html` directly as a file does not provide service worker support.
The app tries WebGPU first and falls back to WebGL 2 if initialization fails;
the active renderer appears in the header. Support depends on the browser,
operating system and GPU. WebGL 1 is not supported. If the graphics device or
context is lost after initialization, reload the app to retry.

Choose or drop an O3D/RDY or Wavefront OBJ file, or a folder containing a
configuration or map tile and its referenced models. A drop containing exactly one
model, configuration, or map tile opens it automatically when the renderer is ready;
otherwise select the entry to open. Folder drops require a browser with
directory drag-and-drop support; use the folder chooser if unavailable. For referenced files
outside the selected folder, select a common parent folder. Browser file
access is restricted to what you explicitly select; your models are read
locally and are not uploaded or cached by the app. Left-drag to orbit, right-
or middle-drag to pan, and scroll to zoom. Fit view recenters the scene.
**Focus selected model** (or F while the page or viewport has focus) centers
the model selected in the material inspector, including a hidden model, without
changing the viewing angle. Select a model in the scene list or material
inspector or by clicking its geometry in the viewport; the selected model
receives the desktop-style animated highlight,
which can be disabled. Fullbright bypasses directional and interior
lighting while retaining material textures, alpha, emission and maps. The
material inspector edits diffuse, specular, emission and specular
power in the current scene; these changes are not saved to the original files.
The selected model can also be renamed for the current scene; its original
source remains displayed, and the scene name is used for model download names.
Its world-space translation can be edited relative to its loaded placement.
This moves only that model occurrence, not associated lights or cabin records;
rotation, scale and parent transforms are not editable yet. Translation is
included in picking, fitting and model, group and scene exports, without changing
the source file. Each change rebuilds the scene's rendering resources and may
take time for large scenes.
Viewport picking uses triangle geometry and visibility, not per-pixel texture
alpha or special depth modes, so transparent surfaces can still be selected.
Repeated clicks at the same location step through overlapping models.
Enable **Cull back faces (desktop style)** to hide back-facing triangles in
filled rendering and exclude them from picking. It is off by default to retain
the original web viewer's two-sided rendering; wireframe remains two-sided.
The scene tree groups loaded configurations, LODs, meshes, lights and generated
splines and paths by their source occurrence. Expand or collapse groups and use
the filter to find descendants. LOD groups, meshes and lights can be toggled
from the tree. Groups can be inspected and renamed for the current scene; the
original name remains visible in the group inspector. **Focus group** frames
all descendant geometry, including hidden models. This does not change source
files or select a general scene object for transforms. Other hierarchy
editing and parent-level visibility are not yet supported.
Normally a configuration with no successfully loaded models leaves the previous
scene visible. Enable **Open configurations without loaded models** to inspect
its available hierarchy, lights and cabin data instead; missing references
and other loading problems are still reported.
The scene OBJ/MTL downloads combine all loaded model occurrences, including
hidden ones, with their current baked placements and material edits. Download
both files without changing the scene between downloads. Textures are not
included; files with the same texture basename can collide.
Choose **Export group** on a scene tree group to download its descendant models
as an OBJ/MTL pair instead.
As in the desktop viewer, a loaded diffuse texture overrides the material's
diffuse color and opacity.

Dropdowns include a search field that filters all available options. Use the
arrow keys and Enter to choose an option, or Escape to close the list.

### Wavefront export

Select a model occurrence in the material inspector and apply any desired
material edits. Download **both** OBJ and MTL using their separate buttons,
then keep them together with their original downloaded names. The selected
model is exported even if hidden, not the entire scene. The OBJ uses the viewer's geometry: X and normal X are reflected, V is flipped,
and triangle winding is reversed. A map object's placement is baked into the
exported mesh, along with any scene-local translation; otherwise the stored
model transform is not applied.

The MTL contains the current diffuse RGBA, specular, emission and specular
power (clamped to 0–1000 as on desktop). Unapplied form edits are not included.
Diffuse textures are referenced as `texture/<filename>` but **not downloaded or
converted**. Copy the original texture yourself into a `texture` folder next to
the MTL; browser or target-application support for formats such as DDS varies.
Only the basename is used; control characters and `#` in texture filenames
become `_`, so rename the copied texture accordingly. Downloads use a sanitized
model basename; selecting another model or changing materials between the two
downloads can create a mismatched pair. Browser download settings may prompt
for a location. The exporter works offline after the app is cached.

OMSI transparency/night/light maps, variable-driven effects including alpha
scaling, alpha/depth modes, animation and other OMSI-specific settings are not
represented by this export. OBJ/MTL material behavior varies between programs;
in particular, a diffuse texture may override the exported diffuse color or
opacity.

### O3D export

The selected model can also be downloaded as an unencrypted O3D. For an O3D
input, the default preserves the source version, extended options, bones and
stored transform; for OBJ input it uses version 7 with long indices. Version 7
with long indices and version 3 with short indices can also be selected
explicitly. Version 3 cannot represent more than 65,535 vertices or triangles,
or long indices; choose version 7 if the export reports a size limit. Current
scene material values are exported, including applied configuration overrides.
Only O3D material fields are stored; CFG maps, variables, alpha/depth settings
and textures themselves are not included. Textures must be copied separately.
Loaded placements and scene-local translations are baked into the exported
vertices; the original stored transform is still preserved.
Names outside ISO-8859-1 or over 255 bytes cannot be saved in O3D and produce
an error rather than being silently changed. Source files are never overwritten.

The scene list can be filtered and individual meshes shown or hidden. For
CFG/SCO LOD groups, all referenced levels are loaded and initially visible,
as on desktop. Toggle groups individually or apply an LOD view radius from 0
to 1: groups with a threshold at or below that value are shown. The radius is
manual, not based on camera distance. LOD visibility combines with mesh,
viewpoint and variable visibility. Invalid thresholds are reported and only
the individual group toggle affects them. Inspect an LOD group to edit its
threshold for the current scene; apply the radius control again to update
visibility. For CFG/SCO meshes with
`[viewpoint]` flags, the viewpoint selector shows meshes
for all viewpoints (the default), exterior, interior, or AI. Flag 0 is
always visible and combined flags match any selected viewpoint. A manually
hidden mesh stays hidden when the viewpoint changes; meshes filtered by
viewpoint are marked in the list. The selector resets when a scene opens.
The wireframe toggle displays triangle edges. The configuration viewer shows
the original text and a navigable list of bracketed commands; it is a lexical
view, not a reconstruction of OMSI's parsed hierarchy. CFG/SCO material
`[allcolor]`, `[matl_alpha]`, `[matl_noZcheck]` and `[matl_noZwrite]`
overrides are applied per mesh and material occurrence. Static
`[matl_transmap]`, `[matl_nightmap]`, `[matl_lightmap]`, `[matl_bumpmap]`
and `[matl_envmap]` paths are also
supported. Transparency maps replace alpha with their red channel, while night
and light maps add color. Bump and environment maps use the configured strengths.
Night and light map strengths can be adjusted per material in the
inspector; night defaults to 0 and light to 1. The global night control
updates all current materials and carries its value to newly opened scenes;
subsequent inspector edits affect only the selected material.
Configuration `[interiorlight]` records create point lights using the desktop
viewer’s color, coordinate and attenuation conventions. They start enabled and
can be toggled in the interior lights list. The inspector can edit each light's
scene name, world position, direction, mode, RGB color, ambient color, range and
intensity for the current scene; these edits do not alter source files. Renaming
a light does not change its OMSI variable name or optional binding. Create scene-local
point or directional lights at the origin; directional lights default to the
desktop's downward direction. Lights can also be changed to ambient-only or
spot mode; spot lights produce no contribution in the desktop shader or web
viewer. Lights can be deleted from the current scene without changing source
files. Enable **Use editable desktop-style sun** to replace the original web
viewer lighting with the desktop's default directional sun. Its direction,
color, ambient contribution, intensity and on/off state are editable; press
**Apply sun** to commit edits. This opt-in setting persists across scene loads
in the current page; turning it off restores the original viewer lighting.
The sun is not yet a scene-tree object and cannot be deleted or reparented.
As in the desktop default of 16
lights including the sun, only the first 15 scene lights are rendered; a
warning is shown when more are present. Disabled lights still occupy a slot,
as with the desktop renderer's first-light limit. Lights beyond the limit can
still be edited and toggled; they become eligible for rendering if earlier
lights are removed. Their OMSI variable names are shown
but do not control the lights by default, matching the desktop loader's static
behavior. The optional **Bind interior-light intensity variables** setting
exposes these names in the scene variables panel and applies manual changes and
repaint setvars to matching lights. This is an opt-in extension, not a claim
that the desktop loader's current light binding works.
CTI files discovered in a configuration's CTC directory are enabled by
default. Additional CTIs and their textures can be selected in the Repaints
panel; use the folder chooser when a CTI refers to nested paths. Existing
case-insensitive file paths cannot be replaced by an import. Active CTIs apply
in loading order to every loaded CTC configuration; later matching items win.
Enable or disable individual CTIs to reapply the current scheme. Selecting
original textures restores the original maps but does not undo setvars.
If an imported CTI cannot be applied, it is disabled and the previous repaint
remains; add missing textures and enable it again. Imports and edits last only
for the current scene, and a CTI discovered by multiple configurations is
represented once.
The scene variables panel manually controls shared `[alphascale]`, lightmap
strength, and mesh `[visible]` variables. Applying a visibility variable shows
or hides its meshes according to the configured float value. It is combined
with the viewpoint filter and manual mesh visibility; neither can re-enable
a mesh hidden by another filter. Visibility-only variables start at 0 and
accept finite 32-bit float values. As in the desktop viewer, meshes initially
remain visible until a variable is applied. If a mesh has multiple `[visible]`
commands, the most recently applied variable determines that filter; repeated
commands for the same variable use the last condition.
Material-bound variables range from 0 to 1 and start at 1 to preserve the
initial material appearance, even when also bound to mesh visibility. This
differs from the desktop lightmap variable's displayed default of 0. OMSI
scripts and other variable-driven behavior are not evaluated. Alpha scaling
applies after cutout testing, and requires a blend alpha mode to fade a
material that has an explicit CFG alpha mode. Bound lightmap strength is
controlled by the variable panel rather than the material inspector. The
inspector can also adjust alpha and depth modes for the current scene.

Diffuse textures are resolved from the selected files using the desktop
viewer’s model and ancestor `texture` folders (DDS takes precedence). PNG,
JPEG, BMP, GIF and WebP support depends on browser decoding. Legacy 2D
DDS RGB(A), A8 and DXT1 through DXT5 images are decoded locally, as are
uncompressed and RLE truecolor and grayscale TGA images. BMP, PNG and JPEG
files named `.dds` are recognized by their contents. Unsupported,
unreadable or missing textures produce warnings. Select a folder when the
model refers to other files. CFG material maps use the configuration's
directory and ancestor texture folders rather than the model's directory.

Map tiles can load referenced scenery objects from the selected files; choose
an OMSI parent folder containing both the map and its `Sceneryobjects` assets.
Object position and heading are applied to each loaded mesh and interior light,
as in the desktop loader. Map spline placements load their SLI profiles and
textures, tessellate the profile using the desktop's default settings, and
apply position, heading, curvature, gradient, cant, skew and mirroring. Splines
appear in the model list and can be hidden, focused and exported with their
placement baked into the geometry. SCO `[path]` and `[path_2]` records use the
desktop's `invis_street.sli` and `invis_sidewalk.sli` profiles, including path
width and parent map placement. Select an OMSI parent folder containing those
profiles and their textures. Missing or invalid references produce warnings;
unusable profile strips are skipped while other valid strips are rendered.
The **Show spline, path and cabin gizmos** toggle hides these generated meshes without
changing their individual visibility settings. BUS `[paths]` references also
load passenger cabin path links as orange strips, using the desktop width and
coordinate conversion. Invalid point references and zero-width links are
reported and skipped. Cabin path points and supported seats, entries, exits
and other cabin records can be inspected from the scene tree; their positions
are shown in OMSI coordinates. Select a path point to edit its position for the
current scene; connected strips and referencing cabin records update, but source
files are unchanged. Path-link endpoints, direction, room height and step sound
can also be edited; direction and metadata do not change the strip appearance.
Edits that would create a path mesh where none was loaded
are not supported. Cabin markers are not yet rendered, and other cabin records
are read-only.
Map terrain and attachments are not rendered.

## Current limitations

This port is in progress. Scene/configuration support is partial, and may
show warnings for missing references. Saving edits back to source files, animation,
many other material tags, color-mapped TGA, DDS DX10/cubemaps/volumes,
map terrain, editable spline properties, cabin markers and
several other desktop features are not implemented. Do not rely on it for
desktop feature parity or visually exact OMSI rendering. Encrypted models
are not supported. OBJ smoothing groups and MTL texture options are not
implemented. Transparent geometry is sorted by material rather than by triangle.

## Tests

With Node.js installed, run `npm test` from this directory. No npm packages
are required.

The dropdown browser checks can also be run with
`node browser-checks/run-dropdown-check.cjs /usr/bin/firefox` or
`node browser-checks/run-dropdown-check.cjs /usr/bin/chromium`, using the
appropriate browser path for your system.

The original O3DView source and its GPL-3.0 license are in the adjacent
`O3DView` directory. This port is distributed under the same license.
