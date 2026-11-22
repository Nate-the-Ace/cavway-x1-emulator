// A clock that only moves when told, for running scripts without waiting.
export class VirtualClock {
  constructor(start = 1_700_000_000_000) {
    this.t = start;
    this.now = () => this.t;
  }

  advance(ms) { this.t += ms; }
}
