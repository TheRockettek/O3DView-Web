// DataTransfer items must be captured synchronously during the drop event.
export function captureDrop(dataTransfer) {
  const items = Array.from(dataTransfer.items || []).filter(
    (item) => item.kind === "file",
  );
  if (!items.length)
    return Array.from(dataTransfer.files || [], (file) => ({ file }));
  return items.map((item) => {
    const entry = item.webkitGetAsEntry?.();
    if (entry) return { entry };
    const file = item.getAsFile();
    if (!file) throw new Error("A dropped item could not be read");
    return { file };
  });
}

export async function readDroppedFiles(items) {
  const files = [];
  function nameOf(entry) {
    if (
      !entry.name ||
      entry.name === "." ||
      entry.name === ".." ||
      /[/\\]/.test(entry.name)
    ) {
      throw new Error("A dropped item has an invalid name");
    }
    return entry.name;
  }
  async function visit(entry, parent) {
    const path = parent ? `${parent}/${nameOf(entry)}` : nameOf(entry);
    if (entry.isFile) {
      const file = await new Promise((resolve, reject) =>
        entry.file(resolve, reject),
      );
      files.push({
        name: file.name,
        webkitRelativePath: path,
        arrayBuffer: () => file.arrayBuffer(),
      });
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      while (true) {
        const batch = await new Promise((resolve, reject) =>
          reader.readEntries(resolve, reject),
        );
        if (!batch.length) break;
        for (const child of batch) await visit(child, path);
      }
    } else {
      throw new Error(`Unsupported dropped item: ${path}`);
    }
  }
  for (const item of items) {
    if (item.entry) await visit(item.entry, "");
    else files.push(item.file);
  }
  return files;
}
