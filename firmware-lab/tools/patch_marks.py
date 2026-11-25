#!/usr/bin/env python3
"""Make a candidate Cavway X1 1.1.7 image whose M key cycles three extra marks (codes 4, 5, 6).

    python3 -I tools/patch_marks.py in/CVWY_X1_1.1.7.bin out/CVWY_X1_1.1.7m.bin [--timestamp UNIX]

Standard library only. Reads the stock image (never modifies it), asserts every byte it replaces
is the expected stock byte, and writes a new file.

NOT TESTED ON HARDWARE. See ../ANALYSIS.md.

What it changes (flash addresses; file offset = address - 0x08004000 + 0x100):
  C  0x0800D178..0x0800D1A5  M-key cycle: F8 F9 FA FB FC FD FE 7F F8 ... (was F8 F9 FA FB 7F F8)
  A  0x0800FF3A..0x0800FF47  measure screen (function 0x0800FE5C): Generic/new names via helper
  B  0x0801014E..0x0801015B  measure screen (second variant, near 0x080100E0): same
  D  0x08011514..0x08011523  memory detail page ("mark: ..."): codes 3..6 via helper
  V  0x08017B84..0x08017B8D  "1.1.7" shown on the About page -> "1.1.7m"
  N  0x0801D138..            new bytes appended after the stock image end (helpers, tables, labels)
  H  header bytes 8..11 (timestamp) and 16..31 (ASCII marker; the uploader ignores them)
"""
import struct, sys, time

HDR = 256
BASE = 0x08004000
STOCK_LEN = 102968
STOCK_END = 0x0801D138          # first address after the stock 1.1.7 payload
DRAW_STR = 0x080078F0           # draw_string(r0 = x, r1 = y, r2 = const char *)
MARK_RAM = 0x20000098           # current mark byte: 0xF8 + code, 0xFF = untouched, 0x7F = chosen "none"

# Existing strings reused so codes 0..3 render exactly as before
GENERIC_A = 0x0801009C          # "Generic" used by screen A
GENERIC_B = 0x08010508          # "Generic" used by screen B
MGENERIC = 0x080115D0           # "mark: Generic" used by the detail page

LABELS = [b'Lead', b'Squeeze', b'Drip']       # codes 4, 5, 6 (RAM values 0xFC, 0xFD, 0xFE)
VERSION_STR = b'1.1.7m'
HEADER_MARK = b'MOD marks+3 r1'


def a2o(a):
    return a - BASE + HDR


# ---------------------------------------------------------------- tiny Thumb encoder
def h(v):
    return struct.pack('<H', v)

def cond_b(cond, here, target):          # B<cond> T1
    off = target - (here + 4)
    assert off % 2 == 0 and -256 <= off <= 254, (hex(here), hex(target))
    return h(0xD000 | (cond << 8) | ((off >> 1) & 0xFF))

def b16(here, target):                   # B T2
    off = target - (here + 4)
    assert off % 2 == 0 and -2048 <= off <= 2046
    return h(0xE000 | ((off >> 1) & 0x7FF))

def _t4(here, target, bl):
    off = target - (here + 4)
    assert off % 2 == 0 and -(1 << 24) <= off < (1 << 24)
    s = (off >> 24) & 1
    i1 = (off >> 23) & 1
    i2 = (off >> 22) & 1
    imm10 = (off >> 12) & 0x3FF
    imm11 = (off >> 1) & 0x7FF
    j1 = (~(i1 ^ s)) & 1
    j2 = (~(i2 ^ s)) & 1
    hi = 0xF000 | (s << 10) | imm10
    lo = (0xD000 if bl else 0x9000) | (j1 << 13) | (j2 << 11) | imm11
    return h(hi) + h(lo)

def bl(here, target):
    return _t4(here, target, True)

def bw(here, target):
    return _t4(here, target, False)

def ldr_lit(rt, here, lit):              # LDR Rt,[PC,#imm] T1
    off = lit - ((here + 4) & ~3)
    assert off % 4 == 0 and 0 <= off <= 1020
    return h(0x4800 | (rt << 8) | (off >> 2))

def adr(rd, here, target):               # ADR T1
    off = target - ((here + 4) & ~3)
    assert off % 4 == 0 and 0 <= off <= 1020, (hex(here), hex(target))
    return h(0xA000 | (rd << 8) | (off >> 2))

movs = lambda rd, imm: h(0x2000 | (rd << 8) | imm)
cmpi = lambda rn, imm: h(0x2800 | (rn << 8) | imm)
addsi = lambda rd, imm: h(0x3000 | (rd << 8) | imm)
subsi = lambda rd, imm: h(0x3800 | (rd << 8) | imm)
lsls = lambda rd, rm, imm: h(0x0000 | (imm << 6) | (rm << 3) | rd)
ldrb_i = lambda rt, rn, imm: h(0x7800 | (imm << 6) | (rn << 3) | rt)
strb_i = lambda rt, rn, imm: h(0x7000 | (imm << 6) | (rn << 3) | rt)
ldr_r = lambda rt, rn, rm: h(0x5800 | (rm << 6) | (rn << 3) | rt)
BX_LR = h(0x4770)
NOP = h(0xBF00)
MOV_R0_R8 = h(0x4640)
EQ, NE, HS, LO, HI = 0, 1, 2, 3, 8


class Asm:
    """Minimal assembler: labels are resolved by assembling twice (all item sizes are fixed)."""
    def __init__(self, org):
        self.org = org

    def build(self, prog):
        labels = {}
        for _ in range(2):
            out = bytearray()
            for item in prog:
                here = self.org + len(out)
                if isinstance(item, str):
                    labels[item] = here
                    continue
                if callable(item):
                    try:
                        out += item(here, labels)
                    except KeyError:
                        out += b'\0' * getattr(item, 'size', 2)
                else:
                    out += item
            final_labels = dict(labels)
        return bytes(out), final_labels


def L(fn, size=2):
    """Wrap a lambda(here, labels) so the assembler knows its size before labels resolve."""
    fn.size = size
    return fn


def align4(here, labels):
    return b'' if here % 4 == 0 else NOP


# ---------------------------------------------------------------- the new code block
def new_block():
    org = STOCK_END
    prog = [
        # entry A: r0 = mark byte (0xF8+code). Draw names for codes 3..6 at (64, 96).
        'meas_A',
        L(lambda p, l: adr(3, p, l['tab_A'])),
        L(lambda p, l: b16(p, l['meas_common'])),
        'meas_B',
        L(lambda p, l: adr(3, p, l['tab_B'])),
        'meas_common',
        subsi(0, 0xFB),                       # r0 = mark - 0xFB  (0..3 for FB..FE)
        cmpi(0, 3),
        L(lambda p, l: cond_b(HI, p, l['ret'])),   # unsigned > 3 (also catches < 0xFB) -> nothing
        lsls(0, 0, 2),
        ldr_r(2, 3, 0),                       # r2 = table[r0]
        movs(1, 0x60),                        # y = 96
        movs(0, 0x40),                        # x = 64
        L(lambda p, l: bw(p, DRAW_STR), 4),   # tail call draw_string, returns to caller's lr
        'ret',
        BX_LR,
        # entry D: r0 = 3-bit mark code from the record. Draw "mark: ..." for codes 3..6 at (0, 93).
        'detail',
        subsi(0, 3),
        cmpi(0, 3),
        L(lambda p, l: cond_b(HI, p, l['ret'])),
        L(lambda p, l: adr(3, p, l['tab_D'])),
        lsls(0, 0, 2),
        ldr_r(2, 3, 0),
        movs(1, 0x5D),
        movs(0, 0x00),
        L(lambda p, l: bw(p, DRAW_STR), 4),
        L(align4),
        'tab_A', L(lambda p, l: struct.pack('<4I', GENERIC_A, l['s_lead'], l['s_squeeze'], l['s_drip']), 16),
        'tab_B', L(lambda p, l: struct.pack('<4I', GENERIC_B, l['s_lead'], l['s_squeeze'], l['s_drip']), 16),
        'tab_D', L(lambda p, l: struct.pack('<4I', MGENERIC, l['m_lead'], l['m_squeeze'], l['m_drip']), 16),
        's_lead', LABELS[0] + b'\0',
        's_squeeze', LABELS[1] + b'\0',
        's_drip', LABELS[2] + b'\0',
        'm_lead', b'mark: ' + LABELS[0] + b'\0',
        'm_squeeze', b'mark: ' + LABELS[1] + b'\0',
        'm_drip', b'mark: ' + LABELS[2] + b'\0',
    ]
    code, labels = Asm(org).build(prog)
    # pad to a 4-byte multiple with 0x00 so the file stays tidy
    code += b'\0' * (-len(code) % 4)
    return code, labels


# ---------------------------------------------------------------- in-place patches
def site_patches(labels):
    P = []
    # C: M-key cycle. Entry at 0x0800D178 with nothing live (the 0xFF case was handled above).
    org = 0x0800D178
    lit = 0x0800D408                          # existing literal pool word = 0x20000098
    prog = [
        L(lambda p, l: ldr_lit(1, p, lit)),
        ldrb_i(0, 1, 0),
        cmpi(0, 0x7F),
        L(lambda p, l: cond_b(EQ, p, l['to_f8'])),
        cmpi(0, 0xF8),
        L(lambda p, l: cond_b(LO, p, l['done'])),     # any other value: unchanged (as stock)
        cmpi(0, 0xFE),
        L(lambda p, l: cond_b(EQ, p, l['to_7f'])),
        addsi(0, 1),                                   # F8..FD -> next
        L(lambda p, l: b16(p, l['store'])),
        'to_7f', movs(0, 0x7F),
        L(lambda p, l: b16(p, l['store'])),
        'to_f8', movs(0, 0xF8),
        'store', strb_i(0, 1, 0),
        'done', L(lambda p, l: b16(p, 0x0800D1C6)),
    ]
    code, _ = Asm(org).build(prog)
    n = 0x0800D1A6 - org
    assert len(code) <= n
    code += NOP * ((n - len(code)) // 2)
    P.append(('C cycle', org, bytes.fromhex(
        'a3480078f82803d1f920a1490870 1ee09f480078f92803d1fa209d490870 16e09b480078fa2803d1fb20'
        '99490870'.replace(' ', '')), code))

    # A: screen A final "Generic" block -> helper (r0 already holds the mark byte)
    org = 0x0800FF3A
    code = bl(org, labels['meas_A']) + b16(org + 4, 0x0800FF48)
    code += NOP * ((14 - len(code)) // 2)
    P.append(('A measure', org, bytes.fromhex('fb2804d157a260214020f7f7d4fc'), code))

    # B: screen B final "Generic" block -> helper
    org = 0x0801014E
    code = bl(org, labels['meas_B']) + b16(org + 4, 0x08010198)
    code += NOP * ((14 - len(code)) // 2)
    P.append(('B measure', org, bytes.fromhex('fb2822d1eda260214020f7f7cafb'), code))

    # D: detail page final "mark: Generic" block -> helper with r0 = r8 (the 3-bit code)
    org = 0x08011514
    code = MOV_R0_R8 + bl(org + 2, labels['detail']) + b16(org + 6, 0x08011524)
    code += NOP * ((16 - len(code)) // 2)
    P.append(('D detail', org, bytes.fromhex('b8f1030f04d12da25d210020f6f7e6f9'), code))

    # V: About page version string. The code copies 12 bytes with LDM, but only 10 belong to the
    # string slot ("1.1.7" + 5 NULs); the bytes after it (3C 00 78 00 ...) are another table, so stay in 10.
    org = 0x08017B84
    new = VERSION_STR + b'\0' * (10 - len(VERSION_STR))
    P.append(('V version', org, b'1.1.7' + b'\0' * 5, new))
    return P


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    src, dst = argv[1], argv[2]
    ts = int(argv[argv.index('--timestamp') + 1]) if '--timestamp' in argv else int(time.time())
    stock = open(src, 'rb').read()
    assert len(stock) == STOCK_LEN, 'not the expected stock 1.1.7 image (length)'
    assert stock[:8] == bytes.fromhex('1123556e7cef6d5b') and stock[12:15] == b'\x01\x01\x07'
    img = bytearray(stock)

    block, labels = new_block()
    for name, org, old, new in site_patches(labels):
        o = a2o(org)
        assert img[o:o + len(old)] == old, '%s: stock bytes differ at 0x%08x' % (name, org)
        assert len(new) == len(old), '%s: size mismatch %d vs %d' % (name, len(new), len(old))
        img[o:o + len(new)] = new

    assert len(img) == a2o(STOCK_END)
    img += block

    # header: keep ID and version 1.1.7, new build timestamp, ASCII marker in bytes 16..31
    img[8:12] = struct.pack('>I', ts)
    assert img[16:32] == b'\0' * 16
    img[16:16 + len(HEADER_MARK)] = HEADER_MARK

    open(dst, 'wb').write(bytes(img))
    print('wrote %s (%d bytes, +%d appended at 0x%08x)' % (dst, len(img), len(block), STOCK_END))
    for k in sorted(labels, key=labels.get):
        print('  %-10s 0x%08x' % (k, labels[k]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
