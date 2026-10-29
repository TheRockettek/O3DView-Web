import { placeMapVertices } from "./map-transform.js";
import { generateSplineMesh } from "./spline.js";

export function generatePlacedSplineGeometry(spline, profile, mapPlacement = null) {
  const geometry = generateSplineMesh(spline, profile);
  let vertices = placeMapVertices(geometry.vertices, spline);
  if (mapPlacement) vertices = placeMapVertices(vertices, mapPlacement);
  return { vertices, triangles: geometry.triangles };
}
