// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // ── Force GPU-accelerated rendering for WebView2 ──
    // Without this, WebView2 on Windows often falls back to CPU software rendering,
    // which makes the entire UI laggy. These Chromium flags force GPU rasterization.
    #[cfg(target_os = "windows")]
    unsafe {
        std::env::set_var(
            "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
            "\
            --enable-gpu-rasterization \
            --enable-zero-copy \
            --enable-features=CanvasOopRasterization \
            --disable-features=CalculateNativeWinOcclusion \
            --disable-background-timer-throttling \
            --force-dark-mode\
            "
        );
    }

    agent_teams_guide_lib::run()
}
