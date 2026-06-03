// Shim: Tauri getCurrentWebview() for drag-drop
// Electron doesn't have the same native drag-drop API
// HTML5 drag-drop works fine in Electron, so this is a noop
export function getCurrentWebview() {
  return {
    onDragDropEvent(_callback) {
      // Return a promise resolving to an unlisten function (noop)
      return Promise.resolve(() => {});
    }
  };
}
