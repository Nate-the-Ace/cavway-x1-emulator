#!/usr/bin/env python3
"""Rebuild the extra-marks patch (1.1.7m) on top of CaveCAD's scan-control build 1.1.7-cc4.

    python3 -I tools/patch_marks_cc4.py in/CVWY_X1_1.1.7.bin CVWY_X1_1.1.7-cc4.bin out/CVWY_X1_1.1.7-cc4m.bin [--timestamp UNIX]

Standard library only. Inputs are read, never modified.

How it works: patch_marks.py already knows every marks edit as "these exact stock bytes become these bytes".
cc4 leaves those places alone (it only touches six hook sites, the version string, a marker at 0x08004004 and
the free flash from 0x0801D200), so the same edits apply unchanged to the cc4 image. This script
  1. proves the cc4 file is the stock 1.1.7 plus ONLY the cc4 edits (diff runs are checked against a whitelist),
  2. proves no marks edit overlaps a cc4 edit,
  3. applies the marks edits (each one asserts the bytes it replaces are the stock bytes),
  4. puts the marks helper block in the gap between the stock end (0x0801D138) and cc4's code (0x0801D200),
  5. shows "1.1.7cc4m" on the About page (the slot holds 10 bytes: text + NUL, so "1.1.7-cc4m" does not fit),
  6. re-checks the result against both inputs.

NOT TESTED ON HARDWARE.
"""
import os
import struct
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import patch_marks as pm

HDR = pm.HDR
BASE = pm.BASE
a2o = pm.a2o
CC_CODE = 0x0801D200                       # where cc4's code starts (build.py PATCH_BASE)
VERSION_TEXT = 0x08017B84
NEW_VERSION = b'1.1.7cc9m'                 # 9 chars + NUL = the 10-byte slot
HEADER_MARK = b'MOD cc9+marks'

# every place cc4 differs from stock inside the stock image (build.py HOOKS + version string + version block)
CC4_SITES = [(0x0800D352, 4), (0x0800D37E, 4), (0x0800B62E, 4), (0x0800B674, 4), (0x0800B74E, 4), (0x0800C420, 4), (0x0800C448, 4), (0x0800C450, 4), (0x0800791A, 4), (0x0800CFE0, 4), (0x080072BA, 4), (0x0800C3DE, 4), (0x0800D500, 4), (0x080132C4, 4), (0x0800641A, 4), (0x0800C682, 4),
             (0x08015BC0, 4), (VERSION_TEXT, 10), (0x08004004, 4)]


def runs(a, b, n):
    out, i = [], 0
    while i < n:
        if a[i] != b[i]:
            j = i
            while j < n and a[j] != b[j]:
                j += 1
            out.append((i, j))
            i = j
        else:
            i += 1
    return out


def main(argv):
    if len(argv) < 4:
        print(__doc__)
        return 2
    stock = open(argv[1], 'rb').read()
    cc4 = open(argv[2], 'rb').read()
    dst = argv[3]
    ts = int(argv[argv.index('--timestamp') + 1]) if '--timestamp' in argv else int(time.time())

    assert len(stock) == pm.STOCK_LEN and stock[:8] == bytes.fromhex('1123556e7cef6d5b'), 'not the stock 1.1.7'
    stock_end = a2o(pm.STOCK_END)
    cc_off = a2o(CC_CODE)
    assert len(cc4) > cc_off and cc4[:8] == stock[:8] and cc4[12:15] == b'\x01\x01\x07', 'not a cc4 image'

    # 1. cc4 = stock + only its own edits
    allowed = [(a2o(a), a2o(a) + n) for a, n in CC4_SITES]
    for s, e in runs(stock, cc4, stock_end):
        if s < HDR:
            assert s >= 8 and e <= 12, 'unexpected header difference at %d' % s    # timestamp only
            continue
        assert any(s >= lo and e <= hi for lo, hi in allowed), 'cc4 differs from stock at 0x%08x..0x%08x' % (
            pm.BASE + s - HDR, pm.BASE + e - HDR)
    assert cc4[stock_end:cc_off] == b'\xff' * (cc_off - stock_end), 'gap before cc4 code is not erased flash'
    assert cc4[a2o(VERSION_TEXT):a2o(VERSION_TEXT) + 10].startswith(b'1.1.7-cc'), 'cc4 version string not where expected'
    assert cc4[16:32] == b'\0' * 16, 'header marker bytes in use'

    block, labels = pm.new_block()
    assert stock_end + len(block) <= cc_off, 'marks helper block (%d bytes) does not fit before cc4 code' % len(block)

    # 2. marks edits (skip pm's own version edit), none may overlap a cc4 edit
    edits = [p for p in pm.site_patches(labels) if p[0] != 'V version']
    img = bytearray(cc4)
    for name, org, old, new in edits:
        o = a2o(org)
        assert len(old) == len(new)
        for lo, hi in allowed:
            assert o + len(old) <= lo or o >= hi, '%s overlaps a cc4 edit' % name
        assert stock[o:o + len(old)] == old, '%s: stock bytes differ at 0x%08x' % (name, org)
        assert cc4[o:o + len(old)] == old, '%s: cc4 bytes differ at 0x%08x (cc4 changed this place)' % (name, org)
        img[o:o + len(new)] = new

    # 3. helper block in the gap
    img[stock_end:stock_end + len(block)] = block

    # 4. version text
    vo = a2o(VERSION_TEXT)
    img[vo:vo + 10] = NEW_VERSION + b'\0' * (10 - len(NEW_VERSION))

    # 5. header: timestamp and marker
    img[8:12] = struct.pack('>I', ts)
    img[16:16 + len(HEADER_MARK)] = HEADER_MARK

    # 6. re-check: every byte is either cc4's, or a marks byte, or the new version/header
    marks_ranges = [(a2o(org), a2o(org) + len(new)) for _, org, _, new in edits] + \
                   [(stock_end, stock_end + len(block)), (vo, vo + 10)]
    for i in range(HDR, len(cc4)):
        if img[i] != cc4[i]:
            assert any(lo <= i < hi for lo, hi in marks_ranges), 'unplanned change at file offset 0x%x' % i
    assert len(img) == len(cc4)
    # the marks regions equal what patch_marks.py alone puts there
    for name, org, old, new in edits:
        o = a2o(org)
        assert bytes(img[o:o + len(new)]) == new, name
    assert bytes(img[stock_end:stock_end + len(block)]) == block

    open(dst, 'wb').write(bytes(img))
    print('wrote %s (%d bytes; cc4 is %d, marks block %d bytes at 0x%08x)' % (dst, len(img), len(cc4), len(block), pm.STOCK_END))
    print('cc4 code untouched at 0x%08x.., marks helpers end at 0x%08x' % (CC_CODE, pm.STOCK_END + len(block)))
    for k in sorted(labels, key=labels.get):
        print('  %-10s 0x%08x' % (k, labels[k]))
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
