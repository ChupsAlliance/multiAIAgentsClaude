// Shim: redirect Tauri listen() → Electron IPC events
export async function listen(event, callback) {
  if (!window.electronAPI) {
    throw new Error('electronAPI not available — are you running in Electron?');
  }
  // Tauri wraps payloads in { payload: data }, replicate that
  return window.electronAPI.on(event, (data) => {
    callback({ payload: data });
  });
}

export async function emit() {
  // Frontend doesn't emit to backend in this app — noop
}
