# Cavway X1 test firmware: extra marks (1.1.7m)

**Status: checked offline only. It has never run on an X1.** Everything below describes
what was verified on a computer, and what only a real unit can tell us.

## What the image is

`out/CVWY_X1_1.1.7m.bin` is the stock 1.1.7 firmware with a small patch (103 bytes changed
in place, 152 bytes appended). With the laser on, `M` now cycles

Feature, Ridge, Backsight, Generic, **Lead, Squeeze, Drip**, none, and back to Feature.

The three new marks are stored as codes 4, 5 and 6 in the same bits of the shot record that
the stock firmware already uses for marks (stock only uses codes 0 to 3 and 7). Their names show
on both measure-screen layouts and on the memory detail page (`mark: Lead`). The About page
shows `1.1.7m`.

It is **not** the full callout picker, the shot-menu changes, or the station-name editor. Those
need new screens and menus (see "Effort" below). This is a first, small test of the idea on real
hardware.

## What was checked on the computer

- The patch tool refuses to run unless every stock byte it replaces is what it expects, and
  gives the same output every time (rebuilding it gave an identical file).
- The image header keeps the vendor ID and version 1.1.7; the uploader will accept it.
- The upload packets and end checksum were computed two ways (Python and the JavaScript port of
  the uploader) and agree: 804 packets, checksum `0x019E3535` (stock: 803 packets).
- No stock branch or pointer lands inside a changed range, except the two intended entry points,
  and the start-up path is byte-identical.
- The changed routines were run in a CPU emulator against the stock routines: identical for
  every existing mark, and the new marks draw the new names. The record encoder stores codes 4,
  5 and 6 unchanged.
- Full detail: `out/verify.txt`. Rebuild and re-check:

```bash
python3 -I tools/patch_marks.py in/CVWY_X1_1.1.7.bin out/CVWY_X1_1.1.7m.bin --timestamp 1795305600
.venv/bin/python -I tools/verify.py in/CVWY_X1_1.1.7.bin out/CVWY_X1_1.1.7m.bin
```

## What is NOT known

1. **The bootloader is not in the files.** It may limit the image size (this one is 804 packets
   against 803 for stock, and 1.1.7 already grew by 30 over 1.1.6), or check something beyond
   the packet CRCs.
2. **How it looks on the LCD.** The font width and clipping were not seen. The new labels are
   shorter than "Backsight", so they should fit.
3. **Other software.** Cavway Assistant and the web app show no name for codes 4 to 6; other
   readers (TopoDroid, SexyTopo) may treat them as unknown marks. Check with a download.
4. **The Change Mark menu** on a shot that has a new mark opens on "No Mark"; pressing `M`
   there clears the mark. Left as is on purpose.
5. **Recovery was not tested** (see below).

## Before you flash (your steps)

Flashing can erase stored shots. The manual warns that all stored data may be erased, and the
1.1.4 changelog says calibration is kept.

1. With the **official Windows Cavway Assistant**, download all stored shots and export them,
   and save the calibration coefficients ("Download Coeffs", "Save Coeffs").
2. Keep the stock image `CVWY_X1_1.1.7.bin` (in `../cavway-firmware/`) ready to restore.
3. Charge the unit fully. Use a good USB cable.
4. Use the official Windows Assistant to flash, not the web port: its README says firmware
   upgrade has not been tested on a real X1.

## Flashing (from the manual, firmware upgrade section)

1. Open Cavway Assistant. Connect the X1 by USB with the X1 **off**.
2. Turn the X1 on in boot mode: hold `<` and `>`, then press `DIST`. The screen says BOOT MODE.
3. Click Connect (you may need to click it a few times until it says Disconnect).
4. Click Firmware, browse to `out/CVWY_X1_1.1.7m.bin`, then Upgrade. Wait for Success on the
   PC and on the X1 screen.
5. Hold `CLR` to shut the X1 down, then turn it on normally with `DIST`.

## First checks after flashing

1. About page (menu, Information) shows `1.1.7m`.
2. Turn on, press `DIST` (laser on), press `M` repeatedly. The mark name should cycle through all
   eight values and show on screen. Take a shot with a new mark and look at it in memory mode.
3. Check everything else still works: normal shots, scan mode, the menus and the calibration screen.
4. Download the shots with Cavway Assistant (and your phone app) and look at the mark values and
   what the apps show for them.

## If it goes wrong

- A failed or interrupted flash leaves the X1 in boot mode, as with a stock image. Flash the stock
  `CVWY_X1_1.1.7.bin` again.
- If the new image boots but misbehaves (a hang or restart when a mark is drawn or when `M` is
  pressed), boot mode should still work, because it lives in the bootloader, which an app flash
  does not overwrite. Hold `<` and `>`, press `DIST`, and flash stock.
- If boot mode could not be reached, only a hardware programming connection would remain. That has
  not been tested and would need the vendor.
- Restore your calibration with "Load Coeffs" and "Upload Coeffs" if it is missing afterwards.

## Facts about the firmware (for later work)

- Cortex-M4 (Thumb-2), STM32F4-style. The image has no vector table (the bootloader supplies it).
- The upload skips the 256-byte header. Payload byte 0 is flash address `0x08004000`
  (file offset = address - `0x08004000` + `0x100`).
- The current mark is the RAM byte `0x20000098`: `0xF8` + code, `0xFF` untouched, `0x7F` none.
- There is no mark name table. Each place that draws a mark is an if-chain with inline strings:
  measure screens at about `0x0800FE5C` and `0x080100C4`, memory detail at about `0x08010F38`,
  and the `M` cycle at `0x0800D156`.
- Menus are hard-coded draw calls with a UI state byte (`0x20000068`); there is no data table to
  extend. The 1.1.7 shot menu uses UI states `0x12` and `0x13`.

## Effort for more

- A **full callout picker** needs a new UI state in the key handler, a scrolling list draw, and a
  new field in the shot record for the callout id (bits 1 to 3 are full, and the unused tail bytes
  must first be proven unused). It also needs app, web and emulator changes. Roughly 5 to 10 times
  this patch: one to two weeks of offline work and several hardware test-and-recover cycles.
- More **marks** is cheap but limited: the 3-bit field has eight values, and this patch uses all
  of them (codes 0 to 3 stock, 4 to 6 new, 7 means none). Anything beyond that needs a new field.

## Files

`tools/` holds the patch tool (`patch_marks.py`), the offline uploader copy (`uploader.py`), the
checker (`verify.py`), a cross-check against the JavaScript port, and address helpers. `in/` has
read-only copies of the stock images. This folder is git-ignored; do not commit the `.bin` files.

## 1.1.7-cc4m: these marks on top of CaveCAD's cc4 (2026-11-25)

`out/CVWY_X1_1.1.7-cc4m.bin` = `in/CVWY_X1_1.1.7-cc4.bin` (the build flashed to Nathan's X1 on 2026-11-17) plus the marks edits.

```bash
python3 -I tools/patch_marks_cc4.py in/CVWY_X1_1.1.7.bin in/CVWY_X1_1.1.7-cc4.bin out/CVWY_X1_1.1.7-cc4m.bin --timestamp 1795305600
```

- cc4 and the marks patch touch disjoint places (checked by the script). The marks helpers (152 bytes) sit in the erased gap
  0x0801D138..0x0801D1D0, below cc4's code at 0x0801D200. Same size and 808 packets as cc4.
- About page shows `1.1.7cc4m` (the slot is 10 bytes, so `-cc4m` does not fit). The `cc` marker at 0x08004004 is unchanged.
- `verify.py` against stock reports one FAIL on this image: two stock branches target 0x0800D500, which is cc4's own hook
  entry. Expected, not a marks problem. Every emulation check passes.
- Not flashed. Flash path and recovery: as above; recovery file for cc4 is `in/CVWY_X1_1.1.7-cc4.bin`.

## What is in git here (2026-11-25)

This folder is git-ignored (`.gitignore` is `*`) because `in/` and `out/` hold Cavway's firmware files, which are not ours to commit.
The scripts and this README were added with `git add -f`; new scripts need the same. Not committed: `in/*.bin`, `out/*.bin`,
`out/verify.txt`, `.venv/`.

- `tools/patch_marks.py`, `tools/patch_marks_cc4.py`: the extra-marks patch, alone and merged onto a CaveCAD `-cc` build
  (the cc source and builder are in the cavecad-rs repo, `tools/x1-patch/`, branch `x1flash-ble`).
- `tools/test_picker.py`: CPU-emulator tests of the feature picker, the in-flash list, and the real command dispatcher.
  `.venv/bin/python -I tools/test_picker.py out/CVWY_X1_1.1.7-cc9m.bin` (needs `unicorn` and `capstone` in the venv).
- `tools/verify.py`, `fw.py`, `uploader.py`, `crosscheck_js.mjs`: checks and helpers.
