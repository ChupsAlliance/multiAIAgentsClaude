// Shim: redirect Tauri invoke() → Electron IPC
export async function invoke(command, args = {}) {
  if (!window.electronAPI) {
    throw new Error('electronAPI not available — are you running in Electron?');
  }
  return window.electronAPI.invoke(command, args);
}
