# Cavway X1 Emulator

A software Cavway X1 for testing
[Cavway Assistant Web](https://github.com/Nate-the-Ace/cavway-assistant-web)
without hardware. It is a Chrome extension: it replaces `navigator.serial` on the
flasher's pages with a faithful fake, so the flasher's code runs **unmodified**
and cannot tell the emulated X1 from a real one on a USB port.

The X1 lives in the extension's side panel, with a Connect/Disconnect switch
(plug and unplug), a Reset button, the Measure button, indicator LEDs, a firmware status card,
a traffic log and a drawer of faults.

GPLv3. The device logic is written from the upstream Windows app
([tswcmpass/CavwayAssistant_Win](https://github.com/tswcmpass/CavwayAssistant_Win)
@ `ce01324`) and shares no code with the flasher on purpose, so a misreading
in the flasher shows up as a disagreement instead of being copied.

## Install (once)

1. Open `chrome://extensions`, turn on **Developer mode** (top right).
2. **Load unpacked** and pick this folder.
3. Pin the extension; clicking its toolbar icon opens the side panel.

Nothing on macOS changes; remove the extension to undo everything.

It runs on `https://nate-the-ace.github.io/*`, `http://localhost/*` and
`http://127.0.0.1/*` (any port). Add patterns to `manifest.json` for other hosts.

## Use

1. Open the flasher, open the side panel, press **Connect** (plugs the X1 in).
2. In the flasher press **Connect**. A Chrome-style chooser lists
   "Cavway X1 (emulated)" (and "Real serial ports…" for real hardware).
3. Use the flasher normally. Press **Measure** in the panel to take shots.

Closing the side panel unplugs the X1. Keep the panel open and visible while
testing: Chrome slows timers in hidden pages, which would stretch the line
timing past the flasher's timeouts.

Turn **Intercept Web Serial** off (panel footer) to hand every request straight
to Chrome's real Web Serial.

## What is emulated

- **Web Serial**, as Chrome implements it: user-gesture check, filters,
  `NotFoundError` on cancel, open-option validation, `InvalidStateError`,
  `NetworkError` when unplugged or opened by another tab, streams that are
  recreated after cancel, `"The device has been lost."` on unplug, `disconnect`
  and `connect` events (bubbling to `navigator.serial` with `target` = port),
  per-origin grants, `getPorts()`, `forget()`, signals.
- **The line**: 115200 8N1 byte timing both ways, replies delivered in 1 ms
  USB frames of up to 64 bytes, garbage if the host opens with other settings.
- **The X1**: memory reads/writes (shots by index below 0x8000, clock at
  0x8000 that ticks, serial at 0x8008, calibration at 0x9040/0x9080), laser and
  calibration commands, laser trigger, firmware receiver with CRC checks and a
  bootloader ("bricked") state after an interrupted flash.
- **Reset**: the panel's Reset button, or DTR/RTS pulled low by the host, resets
  the X1's processor only; the USB-serial chip stays powered, so the port stays
  open. It boots for 600 ms (silent), clears laser and calibration mode, keeps
  memory, and interrupts a flash in progress. DTR/RTS reset is a guess about the
  X1's wiring and can be turned off in the Device drawer.

Guesses until the real X1 is measured are listed in
`docs/superpowers/specs/2026-09-25-x1-emulator-design.md` (timings, shot
capacity, the unsolicited live-shot packet, write-to-shot-area behaviour).

## Faults

Line: extra latency, jitter, per-byte corruption each way, reply drop rate,
freeze. One-shot: drop next reply, stray unsolicited packet before the next
reply, unplug after N ms. Flash: NAK at packet N, wrong CRC echo at N, stall at
N, unplug at N, slow erase, reject final checksum. A seed makes random faults
repeatable.

## Develop

```
npm test                       # node --test: device, line, shim, relay, end-to-end
node dev/serve.mjs 8123        # harness: flasher + panel side by side
```

The end-to-end tests import the flasher's own `transport.js` and `protocol.js`
from `../cavway-assistant-web` (skipped if it is not checked out beside this
repo) and run them through the real shim, relay, host and device.

The harness (`dev/`) serves the flasher with the shim injected and the panel
with a `chrome.*` stub over BroadcastChannel, so the whole loop runs in one
page without installing the extension. Only one harness page may be open at a
time; two panels would both answer.

## Layout

| Path | Job |
|---|---|
| `shim/serial.js` | fake `navigator.serial` (page world, `document_start`) |
| `shim/relay.js` | content script: page ⇄ side panel messages, grants |
| `panel/` | side panel UI, `host.js` hub (the USB plug), `glue.js` ports |
| `device/` | the X1: framing, memory, shots, firmware, line model, faults |
| `background.js` | toolbar click opens the side panel |
| `dev/` | harness server, chrome stub |
| `test/` | `node --test` suites |
