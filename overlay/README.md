# OBS Overlay Files

Use **obs-overlay.html** as the OBS Browser Source local file. Do not use overlay.html.

## OBS setup

1. Add your Foundry game/map to OBS using Window Capture or Game Capture.
2. Add a new **Browser Source** above the Foundry capture.
3. Enable **Local file**.
4. Browse to this module folder and select:
   `overlay/obs-overlay.html`
5. Set Width to **1920** and Height to **1080**.
6. Leave the Browser Source above the Foundry capture so the transparent HUD/frame is visible.
7. In OBS, enable **Tools > WebSocket Server Settings** on port **4455**.
8. In Foundry Stream Overlay settings, use host `127.0.0.1`, port `4455`, and the same OBS WebSocket password.
9. Use Foundry's Notes controls > **OBS Overlay Layout** to arrange the GM/player cards, choose a theme, and Save & Close.

The Browser Source receives live GM/player data from Foundry through obs-websocket. It includes the selected Dark, Muted Light, Nature, or Bronze frame, portrait shape, Level, AC, HP, HP bar, and Death Saving Throws.

The files in `frames/` are standalone frame assets. They are optional; `obs-overlay.html` already draws the matching frame automatically.
