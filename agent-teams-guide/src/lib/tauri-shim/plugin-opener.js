// Shim: Tauri plugin-opener
export async function openUrl(url) {
  if (window.electronAPI) {
    return window.electronAPI.invoke('open_url', { url });
  }
  // Fallback: use browser's native open
  window.open(url, '_blank');
}
