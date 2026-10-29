# O3DView desktop-to-web parity TODO

Reviewed against the adjacent desktop source on 2026-10-28. This is a
feature-parity backlog, not a claim that either viewer fully implements OMSI.
An unchecked item may be partially implemented in the web app. Verify behavior
against the desktop implementation, including its limitations, before marking
an item complete. Paths below are relative to this file.

## Current web baseline

- O3D/RDY and OBJ loading; selected CFG/SCO/BUS/OVH mesh references; all LODs;
  case-insensitive texture lookup; drag-and-drop and folder selection.
- Map scenery objects and profile-based map splines with position and heading. Interior
  lights, selected material overrides and maps, manual material/visibility
  variables, CTI/CTC repaint selection, mesh and parent-group visibility, and
  viewpoint filtering.
- Orbit, pan, zoom, fit view, wireframe, a browsable scene tree and material inspector.
  Selected models can be downloaded as OBJ/MTL or unencrypted O3D. Interior-light
  viewport references can be toggled independently of other gizmos and selected
  to inspect the corresponding light.
- WebGPU and WebGL 2 renderers, searchable dropdowns, and offline app caching.

These features are not necessarily equivalent in all cases. See
[README](README.md) for user-facing behavior and limitations.

## P0: Loading, scene structure and export

- [ ] **Preserve the desktop scene hierarchy.** Loading now presents configuration,
  LOD, map, scenery, mesh, light, spline and path occurrences as a searchable,
  expandable tree, including opt-in opening of metadata-only scenes and
  scene-local group names. Scene groups now show or hide all descendant models
  while preserving child visibility choices and composing with other visibility
  filters. Tree entries can be reordered among siblings; this changes tree and
  group-export order only. Models, groups, lights and cabin entries can be
  selected in their respective inspectors, with selection indicated in the
  tree. Groups and model occurrences can be reparented to another group or the
  scene root, updating inherited model visibility and group exports without
  changing model data.
  LOD groups cannot be parent targets; their source membership remains intact.
  Model, light and cabin entries can also be reparented without changing their
  source records. Scene lights can be duplicated as independent instances
  without source variable bindings. Selected model occurrences can now be
  duplicated next to their source with independent material edits and repaint
  bindings. Model-only groups, including nested LOD entries, can also be
  duplicated with their hierarchy, visibility settings and repaint bindings.
  Groups containing lights, cabin entries or generated geometry are not
  duplicable. Standard model occurrences and model-only groups can now be
  deleted from this scene; retained model indices and repaint bindings are
  remapped. Standalone map-spline/SCO-path occurrences and model-only groups
  containing them can also be deleted. Mixed groups, generated cabin
  marker/path geometry and cabin entries remain non-deletable from the
  hierarchy inspector. Verify repeated references and resource ownership.
  Desktop: [hierarchy](../O3DView/O3DView/GUI/HierarchyWindow.cs),
  [scene graph](../O3DView/O3DView/SceneGraph.cs).
  Web: [scene loader](src/scene.js), [scene list](src/app.js).
- [ ] **Complete map and SCO spline support.** Map placements and SCO paths
  now load profile textures and generated geometry, including width, curvature,
  cant, skew and mirroring, and participate in fitting, visibility and export.
  Scene-local controls now edit placement, heading, length, radius, profile
  width, gradients, cant, skew, delta height and mirroring by regenerating the
  occurrence from its loaded profile. Source map/SCO/SLI files are not changed
  or serialized. Compare more real assets against desktop.
  Desktop: [loader](../O3DView/O3DView/FileLoader.cs),
  [spline generator](../O3DView/O3DParse/SplineMeshGenerator.cs).
  Web: [map records](src/map-tile.js), [spline generation](src/spline.js).
- [ ] **Complete LOD parity.** All parsed LODs, group toggles, editable thresholds
  and the manual view-radius control are supported. Desktop source comparison
  confirms that every CFG LOD is loaded, each LOD starts visible, and the
  desktop's 0-to-1 `LOD View Radius` shows a level when the radius is greater
  than or equal to its threshold; the web control follows the same rule.
  Synthetic UI regressions now cover the equality boundary and applying a
  changed threshold through the hierarchy inspector. Verify against
  representative real assets and both renderers.
  Desktop: [loader](../O3DView/O3DView/FileLoader.cs),
  [inspector](../O3DView/O3DView/GUI/InspectorWindow.cs);
  web: [scene loader](src/scene.js).
- [ ] **Complete scene and configuration export.** Support desktop-selected
  objects, optional descendants and whole-scene export, including supported
  configuration serialization, minification and optional texture copying.
  Preserve hierarchy, source data and intended local versus world transforms.
  Provide safe browser downloads and explicit reporting for unsupported objects.
  Desktop: [export window](../O3DView/O3DView/GUI/ExportWindow.cs);
  web exports one selected model via [OBJ](src/obj-export.js) or
  [O3D](src/o3d-write.js), and all loaded models or a chosen tree group's
  descendants as a combined OBJ/MTL pair.
- [ ] **Complete CTI loading and activation parity.** CTIs discovered through
  CTC paths or imported separately can be enabled and disabled; active CTIs
  apply globally in order, and repaint failures roll back. Compare duplicate
  CTI occurrences, slot matching, setvars, restoring originals and missing
  textures with representative real vehicles and both renderers.
  Desktop: [loader](../O3DView/O3DView/FileLoader.cs),
  [variable manager](../O3DView/O3DView/VariableManager.cs);
  web: [repaint session](src/repaint-session.js).
  The installed B727 example is not a successful replacement test: its
  model names `B727_PanAm_Billboard.bmp`, while its CTC slot names
  `B727_allwhite.bmp`.

## P1: Editing, inspection and interaction

- [ ] **Implement object inspector and transforms.** Select objects in the tree
  and viewport; inspect source, mesh metadata and object-specific properties.
  The hierarchy inspector now reports a selected model's source name, vertex
  and triangle counts, material count and O3D version when available. Models
  can be selected by viewport triangle picking, but picking does not yet
  account for texture alpha or special depth modes. Support general objects;
  clicking passenger-cabin or path-point markers or path strips selects the
  corresponding cabin item in the inspector. Alt-clicking model geometry
  selects its containing hierarchy group. Interior-light viewport markers
  select the corresponding light in the hierarchy and inspector.
  rename selected models, groups, lights and cabin items, and translate
  individual model occurrences relative to their loaded placement. Standard
  model occurrences now also support scene-local X/Y/Z rotation and positive
  per-axis scale, using the loaded map placement or model origin as pivot.
  Transformed vertices flow through rendering, picking, fitting and supported
  exports. Associated lights/cabin records and parent transforms are not moved;
  map placement remains baked into loaded vertices. Edit remaining object
  properties and preserve local geometry instead of permanently baking map
  placement into vertices.
  Desktop: [inspector](../O3DView/O3DView/GUI/InspectorWindow.cs),
  [click selection](../O3DView/O3DView/ClickSelectionManager.cs);
  web: [map transform](src/map-transform.js).
- [ ] **Implement desktop path and cabin gizmos.** Load and display applicable
  cabin path points, entries, exits and seats; support inspection, selection,
  editing and gizmo visibility using desktop coordinate conventions.
  BUS cabin path links now load as selectable, hideable strips. Path points and
  link properties can be edited in the hierarchy, cabin item names can be
  changed for the current scene, and supported cabin records inspected.
  Selected path points can be focused at their placed world
  positions, and each valid point has a marker in the generated cabin-path
  mesh. Selected path links can be focused at the midpoint of their placed
  endpoints. Passenger cabin records with explicit positions, including indexed
  records such as stampers and ticket points, also have editable markers;
  records with only a path-point reference share the corresponding point marker.
  Direct-position markers are now color-coded by record type, but remain
  simplified geometry rather than desktop textured billboards or seat previews.
  Viewport picks on passenger-cabin and path-point markers select the
  associated cabin record; path-strip hits select their corresponding link.
  Positioned cabin items can be focused at their placed world positions.
  Seat height and rotation are editable for the current scene; the marker
  continues to represent position only.
  Other cabin gizmos, editing and real-asset comparison remain.
  Desktop: [loader](../O3DView/O3DView/FileLoader.cs),
  [inspector](../O3DView/O3DView/GUI/InspectorWindow.cs).
- [ ] **Complete lighting controls.** Integrate light transforms and selection
  with the scene hierarchy, including the default sun. The opt-in editable
  desktop-style directional sun now appears as a protected, selectable
  hierarchy node; its tree checkbox mirrors the Lights-panel opt-in control,
  and its inspector reports the active lighting mode and values. It remains
  session-only and has no spatial focus target. Point
  and directional lights can be created, duplicated and edited for the
  current scene;
  ambient-only and desktop-style non-rendering spot modes are selectable.
  An opt-in extension binds interior-light intensity to scene
  variables (the desktop loader currently leaves these bindings static). Existing
  interior lights can be toggled and their world position, color, range and
  intensity inspected and edited for the current scene.
  The desktop default also takes the first 16 lights before considering whether
  they are enabled; compare configurable limits and coordinate/attenuation
  behavior. Selecting a scene light in the hierarchy enables **Focus light**,
  which recenters the camera at its world position while preserving zoom and
  orbit.
  Desktop: [variable manager](../O3DView/O3DView/VariableManager.cs),
  [GUI controller](../O3DView/O3DView/GUI/GUIController.cs);
  web: [light controls](src/app.js).
- [ ] **Match desktop view controls.** Add remaining gizmos and
  texture reload. Viewport-focused arrow keys now pan in camera space, matching
  the desktop camera's arrow-key movement in both web renderers. Browser-picked
  files are immutable snapshots, so refreshing externally changed textures
  requires reselecting the updated files; a safe scene-preserving replacement
  flow remains open. Compare mouse and keyboard interaction and ensure both web
  renderers behave consistently. Fullbright, highlighting, model picking and
  focus for models, groups, lights and positioned cabin items are supported;
  viewport picking maps passenger-cabin markers and path strips to their
  associated cabin items; Alt-click selects a containing group; viewport
  interior-light markers select the corresponding light. Desktop:
  [view menu](../O3DView/O3DView/GUI/GUIController.cs),
  [camera](../O3DView/O3DView/Camera.cs).
- [ ] **Extend variable and material inspection.** Match desktop variable
  types and supported bindings beyond the current alpha, lightmap and mesh
  visibility controls; compare defaults and value ranges. Match the desktop's
  material and object inspector behavior without treating parser-only commands
  as rendered features. Desktop:
  [variable manager](../O3DView/O3DView/VariableManager.cs),
  [material](../O3DView/O3DView/GL/Material.cs);
  web: [variables](src/scene-variables.js),
  [material parser](src/cfg-materials.js).

## P2: Fidelity, formats and validation

- [ ] **Compare material rendering and texture support on real assets.** Verify
  transparency and depth modes, map strengths, bump/environment maps, lighting
  and texture replacement visually against desktop in WebGL 2 and WebGPU.
  Desktop-style back-face culling is available as an opt-in and affects
  viewport picking; compare winding and material behavior on real assets.
  Document or address format differences where desktop actually supports them;
  web currently documents unsupported color-mapped TGA and DDS
  DX10/cubemaps/volumes. Desktop:
  [fragment shader](../O3DView/O3DView/Shaders/main_frag.glsl),
  [texture manager](../O3DView/O3DView/TextureManager.cs);
  web: [renderer](src/renderer.js), [WebGL renderer](src/webgl-renderer.js).
- [ ] **Compare OBJ import/export and O3D round trips.** Cover desktop-supported
  material and texture paths, indices, versions, bones and transforms with
  representative files. Keep the web app's documented unsupported features and
  error behavior explicit. Desktop:
  [OBJ I/O](../O3DView/O3DView/WavefrontOBJIO.cs),
  [O3D parser](../O3DView/O3DParse/O3DParser.cs);
  web: [OBJ parser](src/obj.js), [O3D parser](src/o3d.js).
- [ ] **Build a repeatable parity test matrix.** Exercise real and synthetic
  examples of desktop-supported formats, hierarchy, LODs, splines, repaints,
  lights and exports. Compare observable desktop results and visual output with
  both web backends; include offline and Firefox checks. Record known
  differences and fixture provenance, and test errors and cleanup as well as
  success. Existing tests are in [test/](test/) and
  [browser-checks/](browser-checks/).

## Boundaries: do not count unsupported desktop features as parity gaps

- The public desktop build does not provide general encrypted O3D support;
  encryption/decryption depends on conditional build support. Do not claim
  public-build parity requires encryption.
- Desktop map terrain, water and several attachment branches are placeholders;
  the web parser retaining these records does not mean they are rendered in
  either viewer. Implementing them would be an enhancement, not established
  desktop parity. Desktop: [map loader](../O3DView/O3DView/FileLoader.cs).
- Desktop parses bone data but a skeletal animation rendering path has not
  been established. OMSI script execution, particle systems and several
  dynamic material commands are likewise not established desktop features.
  Investigate before adding them to the parity scope.
- The desktop global lightmap UI exists, but its shader uniform update is
  commented out; avoid claiming an active renderer feature without verifying
  the desktop behavior.
- Browser file selection, downloads and graphics APIs differ from desktop
  filesystem access and OpenGL. Define safe equivalents and document unavoidable
  differences rather than claiming identical platform behavior.
