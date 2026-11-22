# Internal design notes: callout list, station names, and a host-editable list

Our own notes. This has not been sent to anyone and is not addressed to the vendor. It records what we would want from the firmware, and what we still need to find out.

Target: firmware after 1.1.7. Based on User Manual Rev C (firmware 1.1.6), Communication Protocol v1.0, and the 1.1.7 changelog.

## Summary

Three related additions, all using only the existing five buttons:

1. **Callout tags.** One fixed list of the most common feature callouts (Lead, Squeeze, Drip, Stream, Pool, and so on) that can be attached to a shot, instead of cycling five fixed marks.
2. **A host-editable callout list.** The list is not edited on the device. It is edited on a computer (or later a phone) and written to the X1's memory now and then, the same way calibration coefficients are written. It is not a firmware flash.
3. **Station names.** Let the surveyor name a station on the device, and sync the name with the shot data.

The goal is to cut notebook and phone use in the cave, so the surveyor can mark features and name stations without pulling out a second device.

## Why the current design is not enough

- Marks are stored in bits 1-3 of byte 1 of the shot record. That is 8 codes at most, and 5 are used (None, Feature, Ridge, Backsight, Generic). Pressing `M` to cycle through many callouts would also be slow.
- The 64-byte shot record has no station name or label field. Apps have to invent station names after download.
- Firmware 1.1.7 added a shot menu to change the last shot's mark, so a mark-editing flow already exists. These notes extend that flow.

## Part 1: callout tags

### Behavior

- `M` short press with the laser on: unchanged (cycles the five marks).
- `M` long press (about 1 s) with the laser on: opens the **Callout** list. The chosen callout is applied to the shot about to be taken.
- `M` long press (about 1 s) after a shot, or in memory mode: opens the shot menu (Callout, Name, Mark, Delete shot), extending the 1.1.7 shot menu. Callout and Name apply to that shot.
- Optional shortcut: `<` and `>` pressed together (within about 300 ms) open the same Callout list directly, tagging the pending shot, the shot on screen, or the shot under the cursor in memory mode.
- The list is one level: `<` and `>` scroll (5 rows visible), `M` selects, `CLR` cancels.
- The chosen callout shows on the measurement screen and in memory mode (a marker like the existing `_`, and its name on the detail page).
- Tag 0 means no tag.

### The callout list

- Up to 64 callouts. Each has a stable **id** (1 to 250, never reused) and a name of 1 to 12 printable ASCII characters. The order of the list is the order shown.
- A shot's tag stores the **id**, not the position. Reordering, renaming or removing callouts on the host therefore never changes what earlier shots mean.
- The device ships with a built-in default list, in this order: Lead, Squeeze, Drip, Stream, Pool, Sump, Drop, Climb, Crawl, Breakdown, Flowstone, Column, Straw, Bats, Bones, Hazard (ids 1 to 16).
- On boot, and when the list is opened, the device reads the list block (below). If the block is missing or invalid it uses the built-in list.
- The list should survive firmware upgrades. **Unknown: whether it can.**
- Information page, second page or a new third page: show `Callouts: rev N, M entries` (or `built-in`), so the user can see which list is on the device.

### Record change

Add a one-byte `tag` to the shot record.

- Proposed location: byte 55, if bytes 54-55 are unused. In the protocol document, bytes 45-55 are accuracy error information, and the parser appears to use only up to byte 53. **Unknown: which bytes are free.**
- Value: 0 = none, 1-250 = callout id. 0xFF must also read as "none" so old records stay valid.
- The existing mark in bits 1-3 stays as is, for backward compatibility.

### The list block in memory

All fields are bytes; multi-byte values are little endian.

| Offset | Size | Field |
|---|---|---|
| 0 | 4 | magic `CVCL` (43 56 43 4C) |
| 4 | 1 | format version, 1 |
| 5 | 1 | entry count N, 0 to 64 |
| 6 | 2 | list revision (increments on every edit on the host) |
| 8 | 1 | next id the host will assign (1 to 251) |
| 9 | 3 | reserved, 0 |
| 12 | 13 x N | entries: 1 byte id, 12 bytes name (ASCII, padded with 0x00) |
| 12 + 13 N | 2 | CRC-16/Modbus over every byte before it (the same CRC as the firmware upload) |

- Largest block: 12 + 13 x 64 + 2 = 846 bytes.
- The device treats the block as invalid (and uses the built-in list) if the magic or version is wrong, the count is over 64, the CRC does not match, an id is 0, over 250 or repeated, or a name is empty or not printable ASCII.
- Base address: **a suggestion only** (our emulator uses 0x9400). A real free region has to be found.

### How the host writes it

The host writes the block with the existing `0x3e` memory-write command in chunks of at most 120 bytes, in this order, so an interrupted write never leaves a half-new list:

1. Write four zero bytes over the magic (the block is now invalid).
2. Write the rest of the block (bytes 4 to the end) in chunks.
3. Write the real magic last.

The host then reads the block back with `0x3d` and compares. The device does not need to do anything special beyond reading the block and validating it.

### Memory map additions

| Address | Content | Access |
|---|---|---|
| to be chosen (we use 0x9400) | Callout list block, up to 846 bytes | read/write |

## Part 2: station names

### Behavior

- A **Name** entry in the shot menu (long `M` after a shot or in memory mode).
- Character entry:
  - `<` / `>`: scroll characters (0-9, A-Z, `-`, `.`, and an end-of-name token), wrapping around.
  - `M`: commit the character and move to the next position.
  - `CLR`: backspace (cancel when the name is empty). Long `CLR`: cancel the edit, without powering off.
  - `DIST`: accept the whole name.
- The suggested starting name is the previous name incremented (A12 becomes A13; S09 becomes S10). The common case is a single `DIST` press.
- A prefix and first number can be set from the host and are used for the first suggestion.
- Maximum name length: 8 characters.
- Names label the "to" station of the shot (the end of a leg). The "from" station is the previous leg's "to". The host is free to apply names differently.

### Record change

Add a **name record** rather than changing the 64-byte shot record.

- Packet type byte 0 = `0x03` (existing: `0x01` shot, `0x02` calibration).
- Layout (64 bytes):
  - byte 0: `0x03`
  - byte 1: reserved, 0
  - bytes 2-5: timestamp of the shot the name belongs to (matches shot bytes 17-20)
  - bytes 6-13: station name, ASCII, padded with 0x00
  - bytes 14-63: reserved, 0xFF
- Name records go in the same history memory and use the same acknowledge process as shots.
- Editing a name writes a new name record with the same timestamp. The host keeps the latest.

### Compatibility

- Old shot parsing is untouched. Apps that ignore unknown packet types keep working.
- **Open question:** how do TopoDroid and SexyTopo handle an unknown packet type `0x03`? If they fail, an option is a setting in the Advanced menu that turns name records off (default off).

## Part 3: host protocol

- The callout list block is read with `0x3d` and written with `0x3e` (above).
- A way to read the device's capabilities (callout list, name records), for example firmware version gating, so apps can detect support.
- **Bluetooth.** The protocol document lists only reads (`0x3d`) and the simple commands over Bluetooth. Do memory writes (`0x3e`) work over Bluetooth, using the same header and footer as other commands? If yes, a phone could edit the list too; if not, the phone can still read it. Untested.

## Open questions

1. Which bytes in 45-55 of the shot record are free (for the tag byte)?
2. Which memory region can hold the 846-byte callout list block? Can it survive firmware upgrades?
3. Is there room in flash and in the 0x0000-0x7FFF history area for name records, and how many shots does history hold today?
4. Is a long `M` press free in the shot detail, laser-on and memory states, and can `<` and `>` pressed together be used as a shortcut?
5. Is a different packet type, or a different location for names, preferred?
6. Do memory writes work over Bluetooth?
7. Is firmware source available to anyone outside the vendor?
8. Is the manual's note that firmware upgrade erases calibration still true? The 1.1.4 changelog says it no longer does.

## Compatibility summary

| Item | Effect on existing apps |
|---|---|
| Tag byte | Old apps ignore it |
| Callout list block | Not read by old apps; the device falls back to the built-in list |
| Name record `0x03` | Unknown type; needs confirming |
| Mark bits 1-3 | Unchanged |
| M short press | Unchanged |

## Reference implementation

The callout list format and the safe write order are implemented and tested in a small JavaScript library, with an emulator of the proposed interface, in this repository (`lib/callout-library/`, `docs/superpowers/specs/2026-11-22-x1-callout-library-design.md`). Nothing has been written to a real X1.
