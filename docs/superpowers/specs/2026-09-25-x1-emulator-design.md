# Cavway X1 Emulator — design

Date: 2026-09-25. Status: approved in conversation ("go ahead with everything").

## Goal

A software stand-in for the Cavway X1 that the Cavway Assistant Web flasher
(`../cavway-assistant-web`) talks to **without knowing**. No flasher code
changes, no demo flags, no special ports. It must let us rehearse the unhappy
paths a real device and cable produce: latency, chunked reads, corrupted bytes,
dropped replies, unplugs, failed and interrupted firmware flashes.

## Why a Chrome extension

Web Serial only lists ports the OS registers. Options considered:

| Option | Rejected because |
|---|---|
| macOS DriverKit virtual serial port | needs SIP off or Apple-approved entitlements |
| Null-modem USB-serial pair / Pico relay | hardware; kept as a later option for real-driver testing |
| Linux VM with dummy_hcd USB gadget | Chrome would run inside a VM |
| Separate web page | a page cannot add a port to another page's `navigator.serial` |

A Manifest V3 extension can run a script in the page's own JS world at
`document_start`, before any page script, and replace `navigator.serial` with a
spec-faithful fake. The flasher's code runs unmodified. Trade-off: the macOS tty
and USB stack are imitated (timing, chunking), not exercised. The real X1 (or a
Pico relay, later) remains the final check.

## Independence rule

The emulator's device logic is written from the upstream C# app
(tswcmpass/CavwayAssistant_Win @ ce01324: `UART.cs`, `Shot.cs`, `FrmMain.cs`,
`FrmCali.cs`, `FrmFirmware.cs`, `GLOBAL.cs`) and **imports nothing from the
flasher**. A flasher misreading then shows up as a disagreement. The flasher is
imported only by the end-to-end test, as the system under test.

## Architecture

```
 flasher page (MAIN world)          content script (ISOLATED)       side panel (extension page)
 ┌─────────────────────────┐ post  ┌──────────────────────┐ runtime ┌──────────────────────────┐
 │ shim/serial.js           │ Msg  │ shim/relay.js         │  port   │ panel/host.js  (hub)     │
 │  fake navigator.serial   │◄────►│  window <-> extension │◄──────►│ device/wire.js (line)    │
 │  SerialPort, streams     │      │  grants, state push   │         │ device/x1.js   (the X1)  │
 └─────────────────────────┘       └──────────────────────┘ tabs.   │ panel/panel.js (UI)      │
                                                           sendMsg  └──────────────────────────┘
```

- **shim/serial.js** (classic script, MAIN world). Knows Web Serial, not the X1.
  Also loadable in Node (`vm`) for tests via `createWebSerial(bridge, env)`.
- **shim/relay.js** (ISOLATED world). Moves messages; keeps per-origin grants in
  `chrome.storage.local`.
- **device/** — pure ES modules, no browser APIs, fully unit-tested in Node.
- **panel/** — side-panel UI plus the host hub that owns the device.
- **background.js** — service worker; only sets "toolbar click opens side panel".

### The device lives in the side panel

Panel open + **Connect** on = X1 plugged in. **Disconnect** or closing the
panel = unplug: the page gets a real-shaped `disconnect` event and in-flight
reads fail. Device memory persists in `chrome.storage.local`.

### Shim behaviour (Web Serial spec, as Chrome implements it)

- `navigator.serial.requestPort({filters})`
  - Without transient user activation: `SecurityError`
    "Must be handling a user gesture to show a permission request."
  - Shows an in-page chooser (closed shadow DOM, looks like Chrome's): the
    emulated port "Cavway X1 (emulated)" if plugged in and matching `filters`;
    **Real ports…** (delegates to the original `requestPort`); **Cancel** →
    `NotFoundError` "No port selected by the user."
  - Picking the emulated port grants it to the origin.
- `getPorts()` — emulated port if granted and plugged in, plus real ports.
- `connect` / `disconnect` events on `navigator.serial` for granted ports.
  `disconnect` is dispatched on the port and bubbles to `navigator.serial`
  with `event.target === port` (the flasher checks this).
- `SerialPort`
  - `getInfo()` → `{ usbVendorId: 0x1a86, usbProductId: 0x55d3 }` (WCH CH343).
  - `open(options)`: `TypeError` on bad/missing `baudRate`, `dataBits ∉ {7,8}`,
    `stopBits ∉ {1,2}`, bad `parity`/`flowControl`; `InvalidStateError`
    "The port is already open."; `NetworkError` "Failed to open serial port."
    when unplugged or already opened by another tab.
  - `readable`/`writable` streams of `Uint8Array`; writes must be
    BufferSource (`TypeError` otherwise).
  - On unplug: pending `read()` rejects `NetworkError` "The device has been
    lost."; writes reject the same; `readable`/`writable` become `null`;
    `connected` false.
  - `close()` rejects `TypeError` while a stream is locked.
  - `setSignals`/`getSignals` stored locally, logged in the panel.
  - `forget()` drops the grant.
- Known gap: no `BufferOverrunError` modelling (flasher reads continuously).

### Wire (device/wire.js) — the line model

- 8N1 at the device's 115200 baud: 10 bits/byte ≈ 86.8 µs/byte, both ways.
- Device→host bytes are delivered in USB full-speed frames: every 1 ms, all
  bytes that have finished transmitting leave as one chunk (≤ 64 bytes).
- Host→device bytes reach the device after their transmission time; the device
  then answers after a per-operation processing time.
- Host baud ≠ 115200 (or dataBits 7, parity ≠ none, stopBits 2): bytes in both
  directions are garbled deterministically, as a mismatched UART would.
- Faults are applied here (see below). All randomness uses a seeded PRNG, so a
  failing run can be repeated.
- Timer and clock are injected; tests use a fake clock.

### Device (device/)

| File | Job |
|---|---|
| `crc.js` | CRC16/MODBUS (init 0xFFFF, poly 0xA001 reflected) |
| `framing.js` | host frames `"data:"` + len + payload + CR LF; resyncs on junk; a frame without CR LF is discarded and counted |
| `shots.js` | 64-byte shot records from readable values (layout below) |
| `memory.js` | shots by index at addr < 0x8000; 8 KB config area 0x8000–0x9FFF; live clock |
| `firmware.js` | 0x4B / 0x4C / 0x4D receiver and bootloader state |
| `x1.js` | ties it together: bytes in → timed replies out, plus a state snapshot |

Protocol facts (from UART.cs):

- Memory read `3D lo hi n` → reply `3D lo hi n` + n bytes (unframed).
- Memory write `3E lo hi n data…` → same reply shape, echoing memory after the
  write. Writes to the shot area are ignored, so the echo mismatches (the host
  then reports failure) — a guess, stated as such.
- Address < 0x8000 is a **shot index** (FrmMain reads `readMemory(i, …, 64)`).
  Empty slots read as 0xFF. Capacity 4000 shots (guess).
- 0x8000 clock (u32 LE, epoch seconds, host writes local-as-UTC); ticks live.
- 0x8008 serial (u16 LE, then two zero bytes).
- 0x9040 cali info (16 bytes, flag 0x55), 0x9080 coeffs (2 × 64 bytes; each
  48 used, rest 0xFF). Stored opaquely; defaults are plausible values encoded
  with FV = 24000, FM = 16384.
- Commands (1-byte payload, no reply): 0x30 enter cali, 0x31 quit cali,
  0x36 laser on, 0x37 laser off, 0x38 trigger (take a shot, laser off after).
- Firmware: `4B` → `4B 01`; `4C idxLo idxHi data[128] crcLo crcHi` →
  `4C idxLo idxHi status crcLo crcHi` (status 0 = ok; must be the next index
  and CRC must match); `4D sum32 LE` → `4D 00` if sum of packet CRCs matches,
  else `4D 01`. The host never sends the 256-byte header, so the device cannot
  know the version; the panel shows size and CRC-sum of the received image.
- Unsolicited packet (guess): on each shot, while a host has the port open,
  the device sends `01` (or `02` in cali mode) + 64-byte record + CR LF.
  Toggle "Stream live shots", default on.

Shot record (from Shot.cs): `[0]` 0x00 valid; `[1]` bit7 = splay, bit0 = 0 for
cali shot, bits1–3 flag (0 feature, 1 ridge, 2 backsight, 3 generic, 7 none);
`[2]` distance mm bits 16–23, `[3]` bits 0–7, `[4]` bits 8–15; `[5..6]` azimuth
u16 × 360/65535; `[7..8]` inclination i16 × 360/65535; `[11..12]` absG
× 1000 × FM / 667; `[13..14]` absM × 100 × FM / 4876; `[15..16]` dip; `[17..20]`
time u32 LE; `[21..44]` raw G/M for two sensors (i16 LE, X Y Z G then M);
`[45..53]` error bytes, 0xFF = none; rest 0xFF.

Processing times (guesses, adjustable): memory op 3 ms, command 1 ms,
flash start (erase) 400 ms, packet 6 ms, flash end (verify) 1200 ms. The
flasher's timeouts are 3000 / 500 / 8000 ms, so "slow" faults can cross them.

Firmware states: `app` → `4B` → `receiving` → `4D` ok → `app` (image
installed). While `receiving`, non-firmware frames are ignored. If the host
goes away or stays silent 10 s while receiving, or `4D` fails, the device
enters `bootloader` ("bricked": only `4B…` answered) when "Brick on interrupted
flash" is on (default), else returns to `app`. A later complete flash or
Factory reset recovers.

## Faults

Continuous: extra latency + jitter (ms); per-byte corruption rate, host→device
and device→host; per-reply drop rate; freeze (no replies).
One-shot: drop next reply; stray unsolicited packet before next memory reply;
unplug after N ms.
Firmware: NAK packet N; wrong CRC echo at packet N; stall (no reply) at packet
N; unplug at packet N; slow start (ms); end checksum reject.
Seed field for the PRNG.

## Panel

Header: Connect/Disconnect switch; LEDs Power, Laser, Cali, TX, RX, Bricked
(red); intercept on/off (off = shim delegates everything to real Web Serial).
Measure: button, Leg/Splay, flag, optional distance/azimuth/inclination
(blank = random walk). Shot count + Clear shots.
Firmware card: state, progress (packets), CRC failures, last result, received
image size + checksum, Save received image.
Traffic log: hex, direction-coloured, timestamps, Clear, Copy.
Faults drawer (above). Device drawer: serial number, clock, Factory reset.

## Testing

- `node --test` unit tests: crc, framing, shots (decoded with an independent
  transcription of Shot.cs in the test), memory, firmware (incl. every fault),
  wire timing with a fake clock, shim spec behaviour under `vm`.
- End-to-end (skipped if `../cavway-assistant-web` is absent): the flasher's
  own `WebSerialTransport` + `Device` run against the shim + host + device in
  Node: serial read, download, cali round trip, clock sync, firmware flash,
  mid-flash unplug, NAK, stray packet.
- Browser: panel page previewed with a `chrome.*` stub; final check is loading
  the unpacked extension in Chrome and driving the live flasher.

## Build order

1. device (crc, shots, framing, memory, firmware, x1) + tests
2. wire + faults + tests
3. shim + tests
4. host hub + relay + background + manifest
5. panel UI
6. e2e against the flasher; README; browser checks

## As built (2026-09-25)

Diverged from or added to the design above:

- **Streams recreate lazily.** Chrome hands out a fresh `readable`/`writable`
  after a cancel or a non-fatal error while the port is open; the shim does the
  same. Bytes that arrive before the page first touches `readable` are held,
  as Chrome's data pipe holds them.
- **An unplugged panel stays silent** on a wire open instead of refusing it,
  because `runtime.connect` reaches every listening extension page (two
  windows can each have the panel open). The relay fails an unanswered open
  after 1 s. A plugged panel with a session refuses (`open-failed`).
- **The relay knocks every 2 s** for the panel while it has no presence port;
  the panel's `panel-up` broadcast alone lost a race when both loaded at once.
- **Timers must stay visible.** A hidden page's timers are throttled to about
  1 s, which pushes replies past the flasher's timeouts. The side panel is
  visible while open; the preview browser's pages report `hidden`, so harness
  checks there are run in a freshly opened tab.
- **Default timer functions are wrapped** (`(fn, ms) => setTimeout(fn, ms)`):
  a bare `setTimeout` called as a method throws "Illegal invocation" in
  browsers but not in Node, so only the browser caught it.
- **Dev harness** (`dev/serve.mjs`) serves the unmodified flasher with the
  shim injected, and the panel with a `chrome.*` stub over BroadcastChannel.

Verified in the harness through the flasher's own UI: chooser, connect, serial
number, download of 100 shots, a 41-packet firmware flash ("upgrade success"),
and unplug-at-packet-10 ("Upgrade Fail at packet 10 of 41", flasher
disconnected, emulator bricked, then recovered). Not yet verified: the
unpacked extension in Chrome itself.
