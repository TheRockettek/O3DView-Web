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
Version 4+ O3D files using the encrypted-vertex variant recognized by
[OpenBusTest](https://github.com/TheRockettek/OpenBusTest) are decoded from
their header key and options. This variant obfuscates vertex position, normal
and UV components; it is not general-purpose or cryptographic decryption.
Focus the viewport and use the arrow keys to pan in camera space; movement
scales with the current zoom. The web and WebGL renderers use the same camera
controls.
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
Rotation (X/Y/Z degrees) and positive per-axis scale can also be edited for
standard model occurrences. They pivot around the loaded map placement when
available, or the model origin otherwise. Translation, rotation and scale affect
only that model occurrence, not associated lights or cabin records; parent
transforms are not editable. The resulting geometry is used by picking, fitting,
and model, group, scene, and O3D exports without changing source files. Each
change rebuilds the scene's rendering resources and may take time for large
scenes.
Loaded map splines and SCO paths also expose scene-local controls for placement,
heading, length, radius, profile width, gradients, cant, skew, delta height and
mirroring. Applying an edit regenerates that occurrence from its loaded spline
profile; its visibility, selection, camera, materials and any separate map
placement are retained. The source files are unchanged, and the edited geometry
is used by viewport picking and model/group/scene exports. These controls do not
edit or serialize the original map, SCO, or SLI files.
**Duplicate selected model** adds a scene-local copy beside the source in the
hierarchy, preserving its current placement and material settings. The copy has
independent material and translation edits, participates in the same visibility
groups, and follows repaint changes when the source has matching CTI slots.
Source files are unchanged.
Select a model-only group in the hierarchy and choose **Duplicate model-only
group** to copy the entire subtree next to its source. This includes nested
model and LOD entries; each copied model has independent material edits and
repaint bindings, and copied LOD thresholds and group visibility are separate
from the source. The first copied model is selected. Groups containing lights,
cabin entries, splines, paths or other non-model entries cannot be duplicated.
Viewport picking uses triangle geometry and visibility, not per-pixel texture
alpha or special depth modes, so transparent surfaces can still be selected.
Clicking a generated passenger-cabin marker or cabin-path strip selects its
associated cabin item; other geometry hits select the model occurrence.
Repeated clicks at the same location step through overlapping models.
Alt-click geometry to select its containing hierarchy group while keeping the
hit model selected in the material inspector.
Enable **Cull back faces (desktop style)** to hide back-facing triangles in
filled rendering and exclude them from picking. It is off by default to retain
the original web viewer's two-sided rendering; wireframe remains two-sided.
The scene tree groups loaded configurations, LODs, meshes, lights and generated
splines and paths by their source occurrence. Expand or collapse groups and use
the filter to find descendants. LOD groups, meshes and lights can be toggled
from the tree. A checkbox on a scene group shows or hides all descendant models;
it composes with child visibility, LODs, viewpoint filters, variables and gizmo
visibility without changing each child’s own visibility setting. Groups can be
selected and renamed for the current scene; the original name remains visible
in the group inspector. Model, group, light and cabin-entry selection is
indicated in the tree and opens the corresponding inspector. **Focus group**
frames all descendant geometry, including hidden models. Selection does not
make general scene objects transformable. **Focus light** centers the view on
a selected light's world position without changing zoom or orbit. Use **Up**
and **Down** on a tree
entry to reorder it among its current siblings. Reordering changes the scene
tree and group-export traversal order only; it does not change render order,
source data, or model transforms. Clear the scene filter before reordering.
Selecting a model in the hierarchy inspector reports its source name, vertex
and triangle counts, material count, and O3D version when available.
Cabin items, including path points and links, can be renamed for the current
scene; their original name and source record remain unchanged.
**Focus cabin item** centers the view on a positioned cabin item, applying the
same OMSI coordinate conversion and map placement used by its marker.
**Focus cabin link** centers the view on the midpoint between its placed path
endpoints without changing zoom or orbit.
The selected group, model, light or cabin entry can be moved under another
group or to the scene root from its inspector. Moving a group or model changes
inherited model visibility and group-export membership; moving a light or
cabin entry changes only its tree organization. Reparenting does not modify
source files, render order, LOD membership, light state, cabin data or model
transforms. LOD groups are not valid parent targets. Lights can be duplicated
and deleted in the light inspector. The hierarchy inspector can delete a
standard model occurrence, a map-spline or SCO-path occurrence, or a model-only
subtree containing those items. Deletion is scene-local: retained model
references and repaint bindings are reindexed and source files remain unchanged,
while remaining placements and transforms are preserved. Groups containing
lights, cabin entries, or generated cabin marker/path geometry cannot be deleted
with this control; cabin-entry deletion is not supported.
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

The selected model can also be downloaded as an unencrypted O3D. Encrypted
vertex data is exported in its decoded form, not re-encrypted. For an O3D input,
the default preserves the source version, extended options, bones and stored
transform; for OBJ input it uses version 7 with long indices. Version 7
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
files. **Duplicate selected light** copies its current scene settings into a
new independent light next to it in the scene tree. It does not retain the
source configuration or OMSI variable binding, and it does not change source
files or the original light. A duplicate beyond the 15-light rendering limit
remains editable but is not rendered until a slot opens. Enable
**Use editable desktop-style sun** to replace the original web viewer lighting
with the desktop's default directional sun. Its direction,
color, ambient contribution, intensity and on/off state are editable; press
**Apply sun** to commit edits. This opt-in setting persists across scene loads
in the current page; turning it off restores the original viewer lighting. The
sun appears as a protected, selectable scene-tree object. Its tree checkbox
enables or disables the desktop-style sun, and its inspector reports the
current lighting mode and values; the Lights panel remains the place to edit
those values. The sun has no spatial focus target and cannot be deleted, but it
can be moved between scene-tree parents for organization. It is viewer-session
state and is not written to source files.
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
Enable **Show interior-light references** to overlay each light's current
position in the viewport. Markers follow camera orbit, pan, zoom and resize,
and are hidden while outside the view. Selecting a marker selects that light
in the hierarchy and inspector; the overlay does not change light enablement
or rendering and is independent of the spline, path and cabin gizmo toggle.
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
uncompressed and RLE indexed, 15/16/24/32-bit truecolor, and grayscale TGA
images. BMP, PNG and JPEG
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
files are unchanged. **Focus cabin point** centers the view at its rendered
position, including axis conversion and map placement, without changing zoom
or orbit. Path-link endpoints, direction, room height and step sound can also be
edited; direction and metadata do not change the strip appearance. **Focus
cabin link** centers the view on the placed midpoint between its endpoints.
Each valid cabin path point now has a small orange marker in the generated
cabin-path mesh. The markers share the link strips' gizmo visibility and export
behavior; point-only paths can therefore be edited even when every link is
degenerate. Clicking an orange point marker selects that point in the cabin
inspector; clicking a path strip selects its path link. Passenger cabin records
with direct positions, such as seats, also
show markers colored by record type (blue seats, yellow stampers, orange ticket
sales, green money points and magenta change points) and can have their
positions edited in the inspector;
changes affect the current scene only. Records that only reference a path point,
such as entries and exits, use the path marker and follow edits to that point.
Indexed records that also contain an explicit position, such as stampers and
ticket-sale points, get separate editable markers. All cabin markers share the
gizmo toggle and export behavior. These simplified markers are not the
desktop's textured billboard icons or selected-seat preview. Seat height and
rotation can be edited for the current scene; these attributes update the
inspector data, not the position-only marker. Other cabin records are read-only.
Map terrain and attachments are not rendered.

## Current limitations

This port is in progress. Scene/configuration support is partial, and may
show warnings for missing references. Saving edits back to source files, animation,
many other material tags, color-mapped TGA, DDS DX10/cubemaps/volumes,
map terrain, editable spline properties, advanced cabin gizmos and
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
