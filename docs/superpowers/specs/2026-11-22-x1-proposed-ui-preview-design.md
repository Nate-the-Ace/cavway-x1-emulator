# Proposed X1 interface: preview and usability testing (phase 2) design

Date: 2026-11-22. Status: draft for review. Replaces the Bluetooth shim as
phase 2 of `2026-11-22-x1-ui-emulator-design.md`.

## Goal

Preview the proposed firmware interface (callout menu, on-device station
names) and judge its usability and workflow before anything is sent to the
vendor or flashed. The emulator is a design tool here. It does not need to
talk to CaveCAD, the flasher or any other software for this, so the Bluetooth
shim is dropped (an unfinished draft of it is left uncommitted in
`2026-11-22-x1-ble-shim-design.md` and can be deleted).

## What is wanted

1. **Feel it by hand.** A stock / proposed switch on the front face, with the
   new flows working, and callouts and names visible in memory mode.
2. **Count button presses.** A live count and log of presses, long presses and
   time, so flows can be compared by effort.
3. **Scripted scenarios.** Replayable cave-trip scripts run on stock and on
   proposed, with a side-by-side result.
4. **Editable menu content.** Change the callout list and the
   name prefix in the panel, without code changes.

## Non-goals

- Anything that talks to other software: Bluetooth, USB changes, shot-record
  bytes, `0x03` name records, sync. Tags and names live in the UI model only.
  (The internal design notes in `docs/internal-design-notes.md` still describe
  the data side; this spec is only about on-device behavior.)
- A model of human speed. Counts are exact; times use a simple adjustable
  model and are labeled as such.
- Real firmware comparison (phase 3, unchanged).

## Profile switch

`Ui.profile` is `'stock-1.1.7'` or `'proposed'`. The panel gets a switch.
Switching profile powers the X1 off and clears callout tags and station names
(not shots), so each test starts clean. The Information page already shows the
profile (`1.1.7` or `1.1.7+proposed`).

## Proposed interface

Both flows were chosen to fit the existing buttons. The firmware 1.1.7 shot
menu (delete the last shot, change its mark) is the natural home for them, but
how the real one is opened is unknown. This spec assumes a long press of `M`.

### Both-arrows button

The front face gets a sixth on-screen button, **B**, that presses `<` and `>`
together (also the `B` key). The Ui recognizes the pair as its own input,
`left+right`: a tap when the two are released together, a long press after 2 s.
While both are held, neither arrow fires its own long press. No screen uses it
yet in the stock profile. In the proposed profile B opens the callout picker: armed,
it tags the next shot; after a shot or in memory mode it tags the shot on screen. It
is counted by the press counter (as a two-button chord) and available to scenario
scripts (`{ callout: 'Drip', via: 'both' }`, used by "Tag 10 features (B button)").

### Long press thresholds

Today every long press is 2 s. In the proposed profile a long `M` is 1 s, so
tagging is quick. `CLR` stays 2 s (power off) except inside the name editor,
where long `CLR` cancels the edit instead. `DIST` and `>` are unchanged, and
the `DIST`+`M` scan chord stays at 2 s. While `DIST` is held, `M` does not
fire its own long press (so the chord still works).

### Callout picker

- **When armed** (laser on, before the shot): long `M` opens the picker. The
  chosen callout applies to the shot that is about to be taken.
- **After a shot** (result pages): long `M` opens the shot menu: Callout, Name,
  Mark, Delete shot. Callout and Name apply to that shot.
- **Picker.** One flat list of the most common feature callouts, in a fixed
  order, with no categories and no Recent list. Five rows show at a time. `<` `>`
  move (clamped), `M` selects, `CLR` cancels. Category names are not editable on
  the device because there are none.
- **Capacity.** Up to 64 callouts, names up to 12 characters, unique ignoring
  case. A callout is its 1-based position in the list (code 1 is the first).
- **Display.** The measure screen shows `Tag: <item>` on row 6 for a pending or
  taken shot. Memory mode marks tagged shots with `_` and shows `Tag:` on the
  last detail page, next to the mark.
- **Default content** is an example, edited in the panel (below):
  Lead, Squeeze, Drip, Stream, Pool, Sump, Drop, Climb, Crawl, Breakdown,
  Flowstone, Column, Straw, Bats, Bones, Hazard (most common first).

### Station name editor

- **Where.** In the shot menu (after a shot), and from memory mode by long `M`
  on a shot or its detail page.
- **Entry.** `<` `>` scroll the character (0-9, A-Z, `-`, `.`, then an "end"
  token), `M` commits it and moves on, `CLR` is backspace (cancel when the
  name is empty), long `CLR` cancels, `DIST` accepts the whole name. Names are
  up to 8 characters.
- **Default.** The previous name with its trailing number incremented (A12 to
  A13). With no previous name, the configured prefix plus 1 (for example
  `S1`). So the common case is shot, long `M`, `<`/`>` to Name, `M`, `DIST`.
- **Target.** The name belongs to the shot it was entered on (the leg's "to"
  station). Memory mode shows it in the header of the list and detail
  views (`SHOT # 7      A13`).

## Press counting

A recorder sits on the Ui and sees every button event with its time and the
screen it landed on. It counts taps, long presses, chords and total hold time,
keeps the last events as a log, and supports labeled task markers so a count
can be split by task ("tag 10 features: 38 presses"). The panel shows the live
counts, the log, a reset button and a "copy as text" button for sharing.

## Scripted scenarios

A scenario is a name, a description, and per-profile step lists. Steps:
point the instrument (`pose`), `tap` a button, `hold` a button for some
milliseconds, `repeat` a list of steps, and `task` markers. The runner drives a
throwaway X1 and Ui on a virtual clock (no real waiting), once per profile, and
returns counts per task and in total.

Built-in scenarios (stock cannot tag or name, so its steps do the nearest
thing, which is part of what is being compared):

1. **Survey 10 stations.** Three close shots per leg; on proposed, also name
   each station (defaults accepted).
2. **Tag 10 features.** Stock cycles the `Feature` mark; proposed picks
   a callout from the list (rotating through Drip, Squeeze, Lead).
3. **Survey with callouts.** Ten stations, each with one named station and one
   callout from the list, the realistic mix.

The result table shows, for stock and proposed side by side: taps, long
presses, total hold time, an estimated time (model: each tap 0.6 s including
reading the screen, each long press its hold time plus 0.4 s, each shot wait
2 s; all adjustable) and the per-task split. "Copy as markdown" for the vendor
discussion.

## Editable menu content

The panel gets a callout editor: one callout per line (commas also
separate), plus a name prefix and a first number. It validates (at most 64
callouts, names up to 12 characters, no duplicates ignoring case, no colons, no
empty list) and shows the errors; it applies on a valid edit and is saved in the
extension's storage. Scenarios use the saved content. Content saved by the earlier
two-level menu no longer parses (a colon is rejected) and falls back to the
default list. Editing keeps tags attached to the same names and drops tags whose
name was removed.

## Architecture

```
device/ui/profile.js        NEW: profile constants, per-profile long-press times
device/ui/callouts.js       NEW: callout content: parse, validate, default list,
                            flat list, code = position
device/ui/annotations.js    NEW: per-shot tags and names (Maps), name increment
device/ui/screens/shotmenu.js, picker.js, nameedit.js   NEW screens
device/ui/recorder.js       NEW: InputRecorder (counts, log, task markers)
device/ui/scenarios.js      NEW: step format, runner, built-in scenarios
device/ui/virtual-clock.js  NEW: a clock that only moves when told
device/ui/ui.js, screens/measure.js, memory.js   CHANGED: profile-aware
panel/                      CHANGED: profile switch, counters, scenario results,
                            callout editor
```

Annotations live on the Ui, not in shot records. They clear on profile switch,
factory reset and "Clear shots".

## Testing

- Unit tests for each new module on a fake clock: picker and name editor key
  sequences against expected screen text, long-press timing per profile (`M`
  1 s only in proposed, chord still works), name increment, callout parse and
  validation, recorder counts, scenario runner counts for known step lists.
- Scenario tests assert exact press counts for the built-ins on both profiles,
  so a later change to a flow that alters the effort shows up as a test change.
- Browser check of the panel: switch profile, run a flow by hand, run
  scenarios, edit the callouts.

## Risks and open questions

- How the real 1.1.7 shot menu opens is unknown. Long `M` after a shot is an
  assumption; the interface is easy to change in `profile.js` and the screens.
- Stock steps in the comparison scenarios are a judgment about the nearest
  equivalent. They are plain data and easy to edit.
- In the proposed profile a slow `M` tap (held 1 s or more) becomes a long
  press and does nothing on screens that ignore it. That trade-off is part of
  what is being tested.
- The time model is a guess. Use counts for comparisons and times only as a
  rough guide.
- Whether `<`/`>` scrolling through 26+ characters is tolerable is exactly what
  the name editor is meant to reveal. Faster scrolling (hold to repeat) and
  alternative layouts (digits first, jump to a letter group) are possible
  experiments after the first version.

## Phasing

One plan: profile and long-press change, callouts and annotations, picker, shot
menu and name editor, recorder, scenarios, panel. Tasks in that order; each
leaves the stock behavior and all existing tests unchanged.
