# Cavway X1 feature request: user callouts and on-device station names

Target: firmware after 1.1.7. Based on User Manual Rev C (firmware 1.1.6), Communication Protocol v1.0, and the 1.1.7 changelog.

## Summary

Two related additions, both using only the existing five buttons:

1. **Callout tags.** A menu of feature callouts (drip, water, hazard, survey point, and so on) that can be attached to a shot, instead of cycling five fixed marks.
2. **Station names.** Let the surveyor name a station on the device, and sync the name with the shot data.

The goal is to cut notebook and phone use in the cave, so the surveyor can mark features and name stations without pulling out a second device.

## Why the current design is not enough

- Marks are stored in bits 1-3 of byte 1 of the shot record. That is 8 codes at most, and 5 are used (None, Feature, Ridge, Backsight, Generic). Pressing `M` to cycle through many callouts would also be slow.
- The 64-byte shot record has no station name or label field. Apps have to invent station names after download.
- Firmware 1.1.7 added a shot menu to change the last shot's mark, so a mark-editing flow already exists. This request extends that flow.

## Part 1: callout tags

### Behavior

- `M` short press with the laser on: unchanged (cycles the five marks).
- `M` long press (about 1 s) with the laser on, or on the shot detail page: opens the **Callout** picker.
- Picker is two levels, category then item. `<` and `>` scroll, `M` selects, `CLR` goes back or cancels, and holding `<` or `>` repeats.
- The three most recently used items are listed first.
- The chosen tag shows on the measurement screen and in memory mode (a marker like the existing `_`).
- A tag applies to the pending shot if the laser is on, otherwise to the most recent shot.
- Tag 0 means no tag. Clearing a tag sets it back to 0.

### Tag list

- Up to 64 tags: 8 categories of up to 8 items, stored as a 6-bit code (category in the high 3 bits, item in the low 3 bits).
- Each category and item has a name of up to 8 ASCII characters.
- Default list ships in firmware. The host can replace it through a new memory address (see below), the same way calibration coefficients are read and written.

### Record change

Add a one-byte `tag` to the shot record.

- Proposed location: byte 55, if bytes 54-55 are unused. In the protocol document, bytes 45-55 are accuracy error information, and the parser appears to use only up to byte 53. **Please confirm which bytes are free.**
- Value: 0 = none, 1-63 = tag code. 0xFF must also read as "none" so old records stay valid.
- The existing mark in bits 1-3 stays as is, for backward compatibility.

### Memory map additions

| Address | Content | Access |
|---|---|---|
| 0x9100 (proposed) | Tag list: 8 category names, then 64 item names, 8 bytes each | read/write |

Address is a suggestion. Use whatever is free.

## Part 2: station names

### Behavior

- New "Edit name" entry on the shot detail page, and a long `M` press in memory mode.
- Character entry:
  - `<` / `>`: scroll characters (0-9, A-Z, `-`, `.`, and an end-of-name token).
  - `M`: commit the character and move to the next position.
  - `CLR`: backspace. Long `CLR`: cancel.
  - `DIST`: accept the whole name.
- The suggested starting name is the previous name incremented (A12 becomes A13). The common case is a single `DIST` press.
- A prefix can be set from the host and is used as the default starting text.
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
- **Question for the vendor:** how do TopoDroid and SexyTopo handle an unknown packet type `0x03`? If they fail, an option is a setting in the Advanced menu that turns name records off (default off).

## Part 3: host protocol

- Tag list read/write through the existing `0x3d` read and `0x3e` write commands.
- A way to read the device's tag and name capability, for example firmware version gating, so apps can detect support.

## Open questions for the vendor

1. Which bytes in 45-55 of the shot record are free?
2. Is there room in flash and in the 0x0000-0x7FFF history area for name records, and how many shots does history hold today?
3. Is a long `M` press free in the shot detail and laser-on states?
4. Is a different packet type, or a different location for names, preferred?
5. Is firmware source available to contributors, or should this stay a request?
6. Is the manual's note that firmware upgrade erases calibration still true? The 1.1.4 changelog says it no longer does.

## Compatibility summary

| Item | Effect on existing apps |
|---|---|
| Tag byte | Old apps ignore it |
| Name record `0x03` | Unknown type; needs confirming |
| Mark bits 1-3 | Unchanged |
| M short press | Unchanged |
