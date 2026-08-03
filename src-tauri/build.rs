fn main() {
    // Tauri's generated build output depends on the application artwork, but
    // Cargo does not discover binary asset dependencies by itself. Without
    // these hints an icon-only change can leave `tauri dev` running a stale
    // executable — exactly the old mark macOS then keeps showing in the Dock.
    for icon in [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico",
    ] {
        println!("cargo:rerun-if-changed={icon}");
    }

    tauri_build::build()
}
