# Callout library: edit the list on a computer, send it to the X1 (design)

Date: 2026-11-22. Status: draft for review. Follows
`2026-11-22-x1-proposed-ui-preview-design.md` (the callout picker is one flat
list).

## Goal

The callout list on the X1 should not be edited on the device. Build a small,
transport-independent library that lets a person add, rename, remove and reorder
callouts on a computer, turns the list into a fixed block of bytes, and sends it
to the X1 now and then. The same block could later be sent from a phone over
Bluetooth if the X1 allows that.

## What "sending" means

It is a **memory write**, not a firmware flash. Cavway Assistant already writes
calibration coefficients, the clock and the serial number to the X1's memory over
USB with the `0x3e` write command (the emulator already models this). The list
would be another block in that memory. It can be sent as often as wanted, and
the firmware does not change.

This needs one firmware feature from the vendor: reserve a block of memory for
the list, read it when the picker opens, and fall back to a built-in default list
when the block is missing or invalid. The block should survive firmware
upgrades. (The 1.1.6 manual says an upgrade erases stored data; the 1.1.4
changelog says calibration now survives. Ask about the list explicitly.)

## Non-goals

- Flashing firmware.
- Cloud sync or accounts.
- Real-device upload in the first phases (it needs the vendor feature).
- Editing on the X1 itself.

## Stable ids

A callout has a **stable id** (1 to 250) and a name. The list order is the order
the picker shows. A shot's tag stores the id, not the position. Reordering,
renaming or deleting callouts therefore never changes what an earlier shot
means: a renamed id shows its new name, a deleted id shows as `#<id>`. Ids are
never reused. (Today the emulator stores a position; Phase B moves it to ids.)

## Block format, version 1 (proposed)

All fields are bytes, multi-byte values little-endian.

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | magic `CVCL` (43 56 43 4C) |
| 4 | 1 | format version, 1 |
| 5 | 1 | entry count N, 0 to 64 |
| 6 | 2 | list revision (increments on every edit) |
| 8 | 1 | next id to assign (1 to 251), so ids are never reused |
| 9 | 3 | reserved, 0 |
| 12 | 13 x N | entries: 1 byte id, 12 bytes name |
| 12 + 13 N | 2 | CRC-16/Modbus over every byte before it |

- Ids in a block are unique and below the next id.
- Names are printable ASCII (0x20 to 0x7E), padded with 0x00, 1 to 12
  characters, unique ignoring case.
- Largest block: 12 + 13 x 64 + 2 = 846 bytes.
- The CRC is the same CRC-16/Modbus the firmware upload already uses.
- Anything else (bad magic, unknown version, count over 64, CRC mismatch, duplicate
  ids) is invalid; the X1 then uses its built-in list.

### Writing safely

Writes are at most 250 bytes each (the length field is one byte); the library uses 120 by default. Order:
write zeros over the magic first (the block becomes invalid), then the entries
and CRC, then the magic last. A write interrupted at any point leaves an invalid
block, never a half-new list. After writing, read the block back and compare.

### Address

The base address is **not known**. The emulator's guess is `0x9400`, inside its
8 KB configuration area. A real address comes from the vendor. Nothing is
written to a real unit until then.

## The library (JavaScript, no dependencies)

A pure ES module in this repo, written so CaveCAD or a PC tool can copy or
import it later.

- Editing: `create`, `add(name, { at })`, `rename(id, name)`, `remove(id)`,
  `move(id, toIndex)`. Each returns a new library with the revision bumped and
  reports problems (empty, too long, duplicate, over 64, bad characters).
- Block: `encodeBlock(lib)` and `decodeBlock(bytes)` returning `{ ok, lib, error }`.
- Transfer: `planWrites(block, baseAddr, { chunk })` giving the ordered `0x3e` writes
  above, `planReads`, and async `writeLibrary` and `readLibrary` that take injected
  `writeFn(addr, bytes, why)` and `readFn(addr, length)`. `writeLibrary` reads the
  invalidating write back before sending data, rejects short or non-byte replies, times
  out a stuck call, and on failure says how far it got (`stage`) and what the device
  holds (`deviceList`: `unchanged`, `invalid` or `unknown`).
- Files: JSON (`{ version, revision, entries: [{ id, name }] }`) for saving and
  sharing on the computer, and plain text (one name per line) for quick edits;
  importing text into an existing library keeps the ids of names that match.
- `diff(a, b)`: what was added, removed, renamed or moved (to show before a send).

## Transports

- **USB (first choice).** The same `0x3e` writes the Assistant uses, then read
  back and compare. This is a proven path for other blocks.
- **Bluetooth from a phone (unverified).** The vendor's Bluetooth document
  lists only reads (`0x3d`) and simple commands, and CaveCAD never sends
  `0x3e`. Whether memory writes work over Bluetooth is unknown. A low-risk test
  on a real X1: write the device clock (it is already written during time sync)
  through a Bluetooth `0x3e` frame, with the Bluetooth header and footer, and see
  whether the clock changes. If it does, the same plan could send the list; if it
  does not, the phone can still read the list and show it, and edits stay on the
  computer.

## What the emulator gets

1. The device reads its list from the memory block. If the block is missing or
   invalid it uses the default list, exactly as the real firmware would.
2. The panel's callout editor becomes a library editor: add, rename, remove,
   reorder, import and export, the revision, a diff against what the emulated X1
   holds, and "Send to X1" and "Read from X1" using the same write plan.
3. Tags in the emulator store ids. Scenarios use names, resolved through the
   library.
4. A test that a list sent to the emulated X1, then read back through the
   existing memory read path, decodes to the same library, including an
   interrupted send leaving the old list unusable and the default list in use.

This previews the whole round trip and tests the library before any real unit
is involved.

## Phasing

- **A. Library and tests.** Pure module, block format, safe write plan, files.
- **B. Emulator integration.** Memory block, device reads it, panel library editor,
  ids in tags and scenarios.
- **C. Real unit (needs the vendor).** A small uploader reusing the Assistant's
  protocol code, the Bluetooth clock-write test, and CaveCAD showing names for ids
  it reads from shots.

## Risks and open questions

1. Where should the library live: this repo, its own repository, or CaveCAD? It
   starts here and stays dependency-free so it can move.
2. Are 64 callouts of 12 characters enough, and is ASCII enough for the display
   font?
3. Stable ids add a byte per entry and a rule that ids are never reused. Is that
   worth it compared with position codes? The cost is small and it removes a
   whole class of wrong labels after an edit.
4. The real memory address, whether the block survives a firmware upgrade, how
   much memory is free, and whether the vendor will add the feature, are all
   unknown.
5. If Bluetooth writes do not work, is read-only on the phone enough?
6. The feature request (`docs/cavway-x1-feature-request.md`) now describes the callout
   id tag byte and this block; it has not been sent to the vendor yet.
7. The 16-bit revision wraps after 65 536 edits, so it cannot identify a list. Whether
   the device holds a given list is decided by comparing the block bytes or CRC.
