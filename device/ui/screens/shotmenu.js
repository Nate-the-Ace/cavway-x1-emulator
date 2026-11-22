import { ListScreen, ConfirmScreen } from './menu.js';
import { PickerScreen } from './picker.js';
import { NameEditScreen } from './nameedit.js';
import { MARKS, MARK_CYCLE } from '../shotview.js';
import { calloutLabel } from '../callouts.js';

// Opened by a long M in the proposed profile. `parent` is the screen to go back to.
export function shotMenu({ ui, index, parent }) {
  const back = (u) => u.resume(parent);
  const rec = (u) => u.x1.memory.shots[index];
  const isLast = index === ui.x1.memory.shots.length - 1;
  const items = [
    {
      label: 'Callout',
      value: (u) => calloutLabel(u.content.callouts, u.annotations.tag(index)),
      enter: (u, self) => new PickerScreen({
        onPick: (u2, code) => { u2.annotations.setTag(index, code); back(u2); },
        onCancel: (u2) => u2.resume(self),
      }),
    },
    {
      label: 'Name',
      value: (u) => u.annotations.name(index),
      enter: (u, self) => new NameEditScreen({
        initial: u.annotations.name(index) || u.annotations.suggestName(u.content.namePrefix, u.content.nameFirst),
        onDone: (u2, name) => { u2.annotations.setName(index, name); back(u2); },
        onCancel: (u2) => u2.resume(self),
      }),
    },
    {
      label: 'Mark',
      value: (u) => (rec(u) ? MARKS[(rec(u)[1] >> 1) & 7] : ''),
      adjust: (u) => {
        const r = rec(u);
        if (!r) return;
        const next = MARK_CYCLE[(MARK_CYCLE.indexOf((r[1] >> 1) & 7) + 1) % MARK_CYCLE.length];
        r[1] = (r[1] & ~0x0e) | (next << 1);
      },
    },
  ];
  if (isLast) {
    items.push({
      label: 'Delete shot',
      enter: (u, self) => new ConfirmScreen(
        ['', 'Delete shot?', ' The last one'],
        (u2) => {
          // Another source (the host) may have added a shot since the menu opened.
          if (index !== u2.x1.memory.shots.length - 1) { u2.beep('long'); u2.resume(self); return; }
          u2.x1.memory.shots.pop();
          u2.annotations.drop(index);
          u2.sent.delete(index);
          u2.open('measure');
        },
        (u2) => u2.resume(self),
      ),
    });
  }
  return new ListScreen({ items, back, footer: ['< >:Prev/Next', 'M:Enter CLR:Back'] });
}
