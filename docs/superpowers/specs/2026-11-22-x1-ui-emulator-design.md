# Cavway X1 UI emulator, BLE link and proposed-UI profile: design

Date: 2026-11-22. Status: approved in conversation ("Looks right"). Extends
`2026-09-25-x1-emulator-design.md`, which covers the USB serial emulator.

## Goal

Test changes to the X1's on-device interface, and how they sync into CaveCAD,
without flashing a real unit. Today the emulator fakes the USB serial protocol
only: it has no buttons, no screen and no menus, and no Bluetooth.

The driving use case is the planned additions in the vendor feature request
draft (callout tags, on-device station names): prototype the button flows and the
sync in software, then send a proven design to the vendor. Firmware source is
not public, so a modified firmware cannot be built. The emulator is the only
place the new interface can run.

## Non-goals

- Building or patching real firmware.
- Emulating the native BLE paths in CaveCAD (desktop `btleplug`, iOS
  CoreBluetooth). Only the browser path (`lib/instrument/webble.ts`, which uses
  `navigator.bluetooth`) is covered.
- Replacing the real X1 as the final check, as in the first spec.

## Approach: hybrid

1. A **behavioral model** of the X1 interface, written from the manual
   (Rev C, firmware 1.1.6) and the 1.1.7 changelog. This is where new
   interface designs get tested.
2. Later, the **stock firmware binary** (`../cavway-firmware/CVWY_X1_1.1.7.bin`)
   runs in a CPU emulator and acts as ground truth for stock screens and key
   handling. Where the model disagrees with it, the model is corrected.

Running only the real binary was rejected: it cannot show a new interface,
because the code for it does not exist.

### Facts about the firmware binary (for phase 3)

- 256-byte header (`FrmFirmware.cs` `checkValid`): 8-byte ID
  `11 23 55 6e 7c ef 6d 5b`, big-endian build timestamp at 8-11, version bytes
  at 12-14 (1.1.7 is `01 01 07`). Program image starts at file offset 0x100.
- Not encrypted: readable strings such as "SCAN MODE" and `AT+NAME=0,CavwayX1-XXXX`.
- Thumb-2 code, with addresses that look like flash at 0x0800xxxx and RAM at
  0x2000xxxx (Cortex-M, probably STM32-family). The exact MCU, the image's
  load address and the vector table are **not yet determined**.
- Peripherals the firmware will touch, each needing a model or stub: 128x128
  display controller, five button GPIOs, two sensor pairs (RM3100, SCA3300),
  laser module, BLE module (AT commands over a UART), USB serial chip, flash,
  clock.

## Independence rule (unchanged)

Device logic is written from the manual and upstream C# source and imports
nothing from the flasher or from CaveCAD. The flasher and `webble.ts` are
imported only by end-to-end tests, as the system under test.

## Architecture

```
device/            existing core (memory, shots, framing, firmware, faults)
  ui/              NEW: UI state machine, no DOM
    ui.js            Ui class: input(button, event), tick(ms), frame(), outputs
    screens/         measure, memory, shotDetail, menu, options, advanced,
                     scan, calibration, info, (proposed) callout, nameEdit
    profile.js       'stock-1.1.7' | 'proposed' feature switch
  scene.js         NEW: the UI model's output, a 21x8 text grid (see Renderer)
  instrument.js    NEW: virtual pose (azimuth, inclination, distance), shot
                   taking, three-close-shots leg detection, ACC ERR injection
shim/
  serial.js        existing navigator.serial fake
  bluetooth.js     NEW: navigator.bluetooth fake, Nordic UART service
panel/             adds canvas with five buttons, keyboard shortcuts, pose
                   sliders, profile switch, BLE connect control
test/              adds ui.test.js, frames golden files, e2e-ble.test.js
```

### UI model

- `Ui` is a pure state machine. Inputs are button events (`DIST`, `<`, `>`,
  `M`, `CLR`; `down`, `up`) and a clock tick. Long-press timing runs on an
  injected clock, so tests use a fake one.
- Outputs: a screen "scene" (a 21x8 text grid with inverse and bold rows),
  beep requests (short, long, double), and the backlight level.
- Behavior covered, from the manual: power on/off and lock; measure with laser
  on, shot, delayed shot (long `DIST`); marks cycled by `M` with the laser on;
  `<` `>` info pages after a shot; memory mode with the `E` `C` `S` and `*`
  markers and four detail pages; menu (Calibration, Clr. Unsent, Options,
  Information, Advanced); Options (reference, shot delay, backlight, beep,
  idle off); Advanced menu (shot, scan, calibration options, time, units, BLE,
  factory reset); scan mode and its two triggers; calibration group taking;
  long `>` clear-unsent hotkey; boot mode screen for firmware upgrade.
- 1.1.7 additions, from the changelog only (screens unknown, to be corrected in
  phase 3): shot menu to delete the latest shot or change its mark, memory
  clear option, automatic backsight error calculation.

### Renderer

Phases 1 and 2 stop at a text-grid scene, drawn on the panel canvas with a
monospace font. The real font, pixel layout and a true 128x128 1-bit
framebuffer need the real firmware's screens, so they wait for phase 3.
Tests assert on scene text, which is readable and does not depend on a font.

### Instrument model

Panel sliders set the pointing direction and the laser distance. `DIST` or a
host `LaserTrig` creates a shot record through the existing shot code. Three
consecutive close shots set the leg flag. A fault drawer can force `ACC ERR`.

### BLE shim

- Replaces `navigator.bluetooth` in the page's world, as the serial shim does
  for `navigator.serial`: `requestDevice`, `gatt.connect`, the Nordic UART
  service `6e400001-b5a3-f393-e0a9-e50e24dcca9e`, write characteristic
  `6e400002-...`, notify characteristic `6e400003-...`.
- Same `data:` framing as USB (header `64 61 74 61 3a`, length byte, payload,
  `0d 0a`). Replies are chunked to the BLE MTU. The chunk size is a setting,
  default 20 bytes, because real behavior is unverified.
- New shots are notified automatically, and each needs an acknowledge
  (`byte 1 | 0x55`) before the next one is sent. Unacknowledged shots stay
  flagged as unsent and show `*` in memory mode.
- Faults reuse the existing fault drawer: dropped notifications, duplicate
  notifications, disconnects, slow acknowledges.

### Profiles

- **stock-1.1.7:** manual and changelog behavior only.
- **proposed:** adds what the vendor feature request draft describes (callout
  tags and station names; the draft is `docs/cavway-x1-feature-request.md`).
  - Long `M` opens the callout picker (two levels, 8 categories of up to 8
    items, 6-bit code, three most-recent items first).
  - Name editor: `<` `>` scroll characters, `M` commits and advances, `CLR`
    backspaces, long `CLR` cancels, `DIST` accepts. Default name is the
    previous one incremented.
  - Tag byte in the shot record (proposed byte 55, unconfirmed with the
    vendor).
  - `0x03` name record (timestamp of its shot, 8 ASCII characters), written
    to history memory and acknowledged like a shot.
  - Tag list at a proposed memory address, read and written with `0x3d` and
    `0x3e`.

The panel shows which profile is active and marks screens that are inferred
rather than documented.

## Data flow

Button press, then `Ui.input`, then a new frame to the canvas. A shot goes
into device memory, then out over serial (when polled) or BLE (notified), then
the host acknowledges. A name edit writes a `0x03` record, which the host
reads from history.

## Testing

- **UI tests (headless, fake clock):** each key sequence is checked against
  expected screen text. Golden frame images arrive with phase 3.
- **End to end:** the flasher against the serial shim (exists), and CaveCAD's
  `webble.ts` against the BLE shim. Tests that need the CaveCAD repo are
  skipped when `../cavecad-rs` is absent.
- **Phase 3 oracle:** record frames from the stock binary for the same key
  sequences, and fail the model's tests when they differ. The proposed
  profile has no oracle.

## Phases

1. UI model (text-grid scenes), instrument model and panel canvas for the
   stock profile.
2. BLE shim and the proposed profile.
3. Stock firmware in a CPU emulator. Identify the MCU and image load address,
   find the vector table, model peripherals by running until the firmware
   stalls, capture frames, correct the model.

Each phase gets its own implementation plan.

## Risks

- The manual is for 1.1.6 and the 1.1.7 screens are unknown until phase 3.
- Packet details for BLE (MTU, notify pacing) are inferred, not measured.
- Proposed byte and address choices may collide with what the vendor actually
  uses.
- Phase 3 size is uncertain: weeks are plausible for MCU and display
  reverse engineering.
- Browser BLE emulation does not exercise CaveCAD's native bridges.

## Open questions

1. Phase 3 host: a Node module (for example Unicorn bindings) or a browser one
   that the panel can also use?
2. Should golden frames be committed, and are the 1.1.7 binary and its
   captured frames acceptable to keep in this repo?
