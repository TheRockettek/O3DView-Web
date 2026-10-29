export function moveSceneNode(siblings, node, direction) {
  if (!Array.isArray(siblings) || !node || ![-1, 1].includes(direction))
    throw new TypeError("Invalid scene node move");
  const index = siblings.indexOf(node);
  if (index === -1) throw new RangeError("Scene node is not in this sibling list");
  const target = index + direction;
  if (target < 0 || target >= siblings.length) return false;
  [siblings[index], siblings[target]] = [siblings[target], siblings[index]];
  return true;
}

export function canContainSceneNode(node) {
  return (
    !!node &&
    Array.isArray(node.children) &&
    node.type !== "model" &&
    node.type !== "lod" &&
    node.type !== "light" &&
    node.type !== "cabin-item"
  );
}

export function containsSceneNode(root, candidate) {
  return (
    root === candidate ||
    root.children?.some((child) => containsSceneNode(child, candidate)) === true
  );
}

export function findSceneNodeParent(hierarchy, target) {
  function find(siblings, parent) {
    for (const node of siblings) {
      if (node === target) return { parent, siblings };
      const result = find(node.children || [], node);
      if (result) return result;
    }
    return null;
  }
  return find(hierarchy, null);
}

export function reparentSceneNode(hierarchy, node, parent) {
  if (!Array.isArray(hierarchy) || !node)
    throw new TypeError("Invalid scene node reparenting");
  if (parent !== null && !canContainSceneNode(parent))
    throw new TypeError("Scene node parent cannot contain children");
  const source = findSceneNodeParent(hierarchy, node);
  if (!source) throw new RangeError("Scene node is not in this hierarchy");
  if (parent !== null && !findSceneNodeParent(hierarchy, parent))
    throw new RangeError("Scene node parent is not in this hierarchy");
  if (parent !== null && containsSceneNode(node, parent))
    throw new TypeError("A scene node cannot be moved into itself or a descendant");
  if (source.parent === parent) return null;

  const destination = parent ? parent.children : hierarchy;
  const index = source.siblings.indexOf(node);
  source.siblings.splice(index, 1);
  destination.push(node);
  return { source: source.siblings, sourceIndex: index, destination };
}

export function restoreSceneNodeParent(hierarchy, node, move) {
  if (
    !Array.isArray(hierarchy) ||
    !node ||
    !move ||
    !Array.isArray(move.source) ||
    !Array.isArray(move.destination)
  )
    throw new TypeError("Invalid scene node reparent rollback");
  const index = move.destination.indexOf(node);
  if (index === -1) throw new RangeError("Moved scene node is missing");
  move.destination.splice(index, 1);
  move.source.splice(move.sourceIndex, 0, node);
}
