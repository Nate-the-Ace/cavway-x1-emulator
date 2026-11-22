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

## Front face (UI model)

The panel's "Front face" card is a behavioral model of the X1's five buttons and
screen, written from the Rev C manual (firmware 1.1.6) and the 1.1.7 changelog.
Shots taken on it are stored in the emulated X1 and stream to a connected host
like the Measure button does.

Keys: Space = DIST, arrow keys = `<` `>`, M = M, Esc/Backspace = CLR. Hold DIST
2 s for a delayed shot (set the delay in Options), hold DIST+M or `>` (per the
Scan option) for scan mode, hold CLR 2 s to power off. The azimuth, inclination
and distance boxes under the screen aim the virtual instrument; "Force ACC ERR"
makes shots report an accuracy error.

Modelled: power and idle off, laser and shot, marks, leg detection (the third
close shot), `ACC ERR`, result pages, memory mode, the menus in the manual, scan
mode, on-device calibration. Not modelled: the lock chord (CLR + `>`), the
1.1.7 shot menu (delete shot, change mark), the boot-mode screen, and
persistence of UI settings across panel reloads. "Reset Statistic" only beeps,
and resetting a calibration group with `>` leaves its shots in memory.

Guessed, not measured: close-shot tolerances (2°, 2% distance), scan settle
times, the scan flag bit (bit 6 of the flag byte), the canned calibration report,
the hardware, BLE and battery values on the Information page, and the screen
layout (a 21x8 text grid, not the real pixels). A later phase will check these
against the real firmware. The proposed callout and name features are described
next. A Bluetooth link is not planned: the emulator is a design tool.

## Proposed profile preview

The front face has a "Firmware profile" switch: stock 1.1.7 or proposed. Switching
powers the X1 off and clears callouts and names. Tags and names live only in the
UI model, not in shot records.

Proposed flows:
- **Callout.** With the laser armed, hold M for 1 s: a single list of the most
  common cave feature callouts opens (`<` `>` scroll, `M` selects, `CLR` cancels). The
  next shot gets the callout. There are no categories and no Recent list.
- **Shot menu.** After a shot, or in memory mode, hold M for 1 s: Callout, Name, Mark,
  Delete shot (last shot only).
- **Station name.** `<` `>` scroll 0-9, A-Z, `-`, `.` and `OK`, `M` adds the character,
  `CLR` deletes, `DIST` accepts, long `CLR` cancels. The suggested name is the previous
  one plus one (A12 to A13), or the prefix plus the first number.
- **B button.** Presses `<` and `>` together (key `B`). In the proposed profile it opens
  the callout picker: before a shot it tags the next shot, after a shot or in memory
  mode it tags the shot on screen. It is counted as a two-button chord. Two arrows
  count as a pair only when pressed within 300 ms of each other. The scenario "Tag 10
  features (B button)" compares it with holding M.

Tools for judging the flows:
- **Press counter.** Taps, long presses, chords, hold time, a log, and task labels,
  with "Copy as text".
- **Scenarios.** Replayable cave-trip scripts run on stock and proposed with exact
  press counts and a rough time estimate; "Copy as markdown" for sharing.
- **Callout menu.** Edit the one callout list (one name per line, most common
  first, up to 64, names up to 12 characters), the name prefix and the first number.

Tags and names are not kept across panel reloads (shots are). Editing the callout
menu keeps existing tags attached to the same names and drops tags whose name was
removed.

Guessed: the 1 s long press for M, using a long M after a shot as the shot menu (the
real 1.1.7 shot menu may open differently), the stock steps in each scenario, and the
time model. A slow M tap (held 1 s or more) becomes a long press in the proposed
profile, which is part of what is being tested.

## Callout library

`lib/callout-library/` is a dependency-free module for editing the X1's callout list on a
computer and getting it onto the device as a block of memory. It does not touch the panel
or the emulated device yet. Spec: `docs/superpowers/specs/2026-11-22-x1-callout-library-design.md`.

```js
import { defaultLibrary, add, rename, move, encodeBlock, decodeBlock,
         writeLibrary, readLibrary, fromText, toText, diff } from './lib/callout-library/index.js';

let list = defaultLibrary();                 // ids 1..16, revision 1
list = add(list, 'Gear', { at: 3 }).lib;     // every edit returns { ok, lib, error }
const block = encodeBlock(list);             // the bytes the X1 would store

await writeLibrary(list, { writeFn, readFn, baseAddr });   // invalidate, data, commit, read back
const onDevice = await readLibrary(readFn, baseAddr);      // { ok, lib } or { ok: false, error }
```

- Each callout has a stable id (1 to 250, never reused). Shots store the id, so reordering,
  renaming or removing a callout never changes what an older shot means.
- Names are 1 to 12 printable ASCII characters, unique ignoring case; up to 64 callouts.
- The block is `CVCL`, version, count, revision, next id, 13 bytes per entry (id and a
  12-byte name), and a CRC-16/Modbus. At most 846 bytes.
- A send zeroes the magic first, writes the rest, and writes the magic last, so an
  interrupted send never leaves a half-new list. It then reads the block back and compares.
- Text import (`fromText(text, existing)`) keeps ids for names that already exist, so a
  list can be edited as plain text. `toJSON`/`fromJSON` save and load a library file, and
  `diff(a, b)` shows what a send would change.
- `checkLibrary` and `decodeBlock` accept untrusted input (a loaded file or bytes read from
  a device) and report problems instead of throwing.
- The revision is a 16-bit counter that wraps, so it cannot prove two lists are the same.
  Compare the block bytes (or its CRC) to find out whether the device holds a given list.

Not done: the emulator does not read its list from this block yet, the panel editor does
not use the library, and nothing is sent to a real X1. The real memory address and the
firmware feature to read the block need the vendor (see `docs/internal-design-notes.md`; it has not been sent to anyone).
Whether memory writes work over Bluetooth is untested.
