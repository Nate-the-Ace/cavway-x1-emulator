// Firmware profiles the front face can show.
export const STOCK = 'stock-1.1.7';
export const PROPOSED = 'proposed';

export const LONG_MS = 2000;
// In the proposed profile a long M is quicker, so tagging is a short hold.
export const PROPOSED_M_LONG_MS = 1000;

export const isProposed = (profile) => profile === PROPOSED;

export function longMs(profile, button) {
  return isProposed(profile) && button === 'm' ? PROPOSED_M_LONG_MS : LONG_MS;
}
