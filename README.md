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

## Install

Use the module manifest:

`https://raw.githubusercontent.com/siller94-art/Foundry-Stream-Overlay/main/module.json`

Or download the repository ZIP and place it in:

`FoundryVTT/Data/modules/foundry-stream-overlay`

Then enable **Foundry Stream Overlay** in your world.

## OBS setup

1. Start Foundry VTT and enter the world.
2. Enable the module.
3. Add a **Browser Source** in OBS.
4. Point that Browser Source at the overlay page exposed by your Foundry host.
5. Recommended source size: **1920 × 1080**.
6. Keep the browser background transparent.

The intended overlay file is:

`modules/foundry-stream-overlay/overlay/overlay.html`

For a locally hosted Foundry instance this is typically available under the same Foundry base URL.

## Settings

Go to **Game Settings → Configure Settings → Module Settings → Foundry Stream Overlay**.

Available settings:

- Enable Stream Overlay
- Portrait Shape: Circle / Square
- Theme: Dark / Light / Nature / Bronze
- Show Death Saves
- Show GM Slot

## Notes

This is an early standalone build. The OBS browser-source bridge and automatic source URL helper will be expanded as the module matures.
