# Foundry Stream Overlay

A lightweight Foundry VTT module designed for OBS Browser Source overlays.

## Data Flow

Foundry VTT → Stream Overlay Module → Transparent Overlay Page → OBS Browser Source

## Current features

- Transparent OBS-ready overlay
- 1 GM slot plus active player slots
- Live actor HP
- D&D 5e death-save display
- Circle or square portraits
- Dark, Light, Nature, and Bronze themes
- Lightweight HTML/CSS rendering
- Socket-based live state broadcasts
- Optional lightweight Twitch chat display (off by default)

## Install

Use the module manifest:

`https://raw.githubusercontent.com/siller94-art/Foundry-Stream-Overlay/main/module.json`

Or download the repository ZIP and place it in:

`FoundryVTT/Data/modules/foundry-stream-overlay`

Then enable **Foundry Stream Overlay** in your world.

## OBS setup

Version 0.4.0 uses a dedicated Foundry client for OBS instead of the old static HTML file.

1. Start Foundry VTT and enter the world.
2. Enable **Foundry Stream Overlay**.
3. Open **Game Settings → Configure Settings → Module Settings → Foundry Stream Overlay → OBS Browser Source**.
4. Click **Copy OBS URL**.
5. In OBS add **Sources → + → Browser**.
6. Paste the generated URL and use **1920 × 1080**.
7. If the OBS browser needs to join the Foundry world, use OBS **Interact** to complete the Foundry join/login once.
8. Refresh the Browser Source.

The generated address uses `?fsoOverlay=1`. In this mode the normal Foundry interface and canvas are hidden and only the transparent stream overlay is rendered.

Do not use the old `modules/foundry-stream-overlay/overlay/overlay.html` address. That file can be served as source text by Foundry and is no longer the OBS entry point.

## Settings

Go to **Game Settings → Configure Settings → Module Settings → Foundry Stream Overlay**.

Available settings:

- Enable Stream Overlay
- Portrait Shape: Circle / Square
- Theme: Dark / Light / Nature / Bronze
- Show Death Saves
- Show GM Slot
- Show Twitch Chat: On / Off (default Off)
- Twitch Channel
- Twitch Chat Position: Left / Right

## Notes

## OBS URL helper

GMs can open **Game Settings → Configure Settings → Module Settings → Foundry Stream Overlay → OBS Browser Source**.

The helper automatically builds the dedicated overlay address from the current Foundry world URL and provides:

- **Copy OBS URL**
- **Open / Test Overlay**
- Recommended **1920 × 1080** Browser Source dimensions

No manual URL construction is required.


## Optional Twitch chat

Twitch chat is **off by default**. When disabled, the module does not create or load a Twitch chat frame.

To use it:

1. Enable **Show Twitch Chat**.
2. Enter the Twitch channel name.
3. Choose **Left** or **Right**.
4. Refresh/test the OBS Browser Source.

The chat display uses Twitch's embedded chat rather than bundling a separate chat client library, keeping the Foundry module small and avoiding extra polling code.
