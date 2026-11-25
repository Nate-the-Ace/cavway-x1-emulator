#!/usr/bin/env python3
"""Offline verification of a patched image against the stock 1.1.7 image.

    .venv/bin/python -I tools/verify.py in/CVWY_X1_1.1.7.bin out/CVWY_X1_1.1.7m.bin

Checks (no hardware involved):
  1. byte-level diff listing (runs of changed bytes, plus appended bytes)
  2. uploader view of both files (header, packets, CRCs, end checksum)
  3. disassembly of every changed region before and after
  4. control-flow safety: no branch/call/pointer in unchanged code lands inside a changed range
     except at the intended entry points; stock code outside the patch is byte-identical
  5. unicorn emulation of the patched routines against the stock ones (if unicorn is installed)
"""
import os, sys, struct
sys.path.insert(0, os.path.dirname(__file__))
import uploader
from fw import HDR, FLASH_BASE, a2o, o2a, u32, md, show, linear

STOCK_END = 0x0801D138
DRAW = 0x080078F0
DRAWNUM = 0x08012E34
FAIL = []


def check(cond, msg):
    print(('  ok   ' if cond else '  FAIL ') + msg)
    if not cond:
        FAIL.append(msg)


def diff_runs(a, b):
    runs = []
    n = min(len(a), len(b))
    i = 0
    while i < n:
        if a[i] != b[i]:
            j = i
            while j < n and a[j] != b[j]:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1
    return runs


def section(t):
    print('\n' + '=' * 78 + '\n' + t + '\n' + '=' * 78)


def main(stock_p, new_p):
    A = open(stock_p, 'rb').read()
    B = open(new_p, 'rb').read()

    section('1. byte diff (file offset / flash address)')
    runs = diff_runs(A, B)
    total = 0
    for s, e in runs:
        where = 'header' if s < HDR else '0x%08x..0x%08x' % (o2a(s), o2a(e) - 1)
        print('file 0x%05x..0x%05x  %-26s %3d bytes' % (s, e - 1, where, e - s))
        print('    old ' + A[s:e].hex(' '))
        print('    new ' + B[s:e].hex(' '))
        total += e - s
    if len(B) > len(A):
        print('appended file 0x%05x..0x%05x  0x%08x..0x%08x  %d bytes' % (
            len(A), len(B) - 1, o2a(len(A)), o2a(len(B)) - 1, len(B) - len(A)))
        for k in range(len(A), len(B), 16):
            print('    %08x  %s' % (o2a(k), B[k:k + 16].hex(' ')))
    print('changed in place: %d bytes in %d runs; appended: %d bytes' % (total, len(runs), len(B) - len(A)))

    section('2. uploader view (stock, then patched)')
    _, pa, ca = uploader.report(stock_p)
    print()
    _, pb, cb = uploader.report(new_p)
    v = uploader.check_valid(B)
    check(v is not None and v[0] == '1.1.7', 'patched header passes checkValid (ID) and shows version 1.1.7')
    check(B[HDR:HDR + 4] == A[HDR:HDR + 4], 'payload version word at 0x08004000 unchanged (01 01 07 00)')
    check(len(pb) == (len(B) - HDR + 127) // 128 and len(B) % 128 != 0, 'packet count = ceil(payload/128), no extra 0xFF packet')
    rebuilt = b''.join(pb)[:len(B) - HDR]
    check(rebuilt == B[HDR:], 'concatenated packets reproduce the payload exactly')
    check(o2a(len(B)) < 0x08020000, 'payload ends at 0x%08x, inside flash sector 4 (< 0x08020000)' % o2a(len(B)))

    section('3. disassembly before / after')
    pay_runs = [(max(s, HDR), e) for s, e in runs if e > HDR]
    for s, e in pay_runs:
        lo = o2a(s) & ~1
        lo -= 4
        hi = o2a(e) + 4
        print('\n--- stock 0x%08x..0x%08x' % (lo, hi))
        show(A, lo, end=hi)
        print('--- patched')
        show(B, lo, end=hi)
    print('\n--- appended block (code part)')
    show(B, STOCK_END, end=0x0801D168)

    section('4. control-flow safety')
    changed = [(o2a(s), o2a(e)) for s, e in pay_runs]
    entries = {0x0800D178,           # cycle block entry (stock bne at 0x0800D162 lands here)
               0x08011514}           # detail block entry (stock bne at 0x08011506 lands here)

    def inside(t):
        return any(lo <= t < hi for lo, hi in changed)

    bad = []
    n = 0
    for i in linear(A):
        if i.id == 0 or inside(i.address):
            continue
        if i.mnemonic.startswith(('b', 'cb')) and i.operands and i.operands[-1].type == 2:  # IMM
            t = i.operands[-1].imm
            n += 1
            if inside(t) and t not in entries:
                bad.append((i.address, i.mnemonic, t))
    check(not bad, 'no stock branch (of %d checked) targets the inside of a changed range %s' % (n, bad))
    ptr_bad = [o2a(o) for o in range(HDR, len(A) - 3, 2)
               if inside(u32(A, o) & ~1) and (u32(A, o) & 1) and not inside(o2a(o))]
    check(not ptr_bad, 'no odd (Thumb) pointer word in the image points into a changed range %s' % [hex(x) for x in ptr_bad])
    # the cycle block's stock tail 0x0800D1A6.. must still be intact (cbnz at 0x0800D15A jumps to 0x0800D1A6)
    check(B[a2o(0x0800D1A6):a2o(0x0800D1C6)] == A[a2o(0x0800D1A6):a2o(0x0800D1C6)],
          '0x0800D1A6 (target of cbnz at 0x0800D15A) still holds the stock "b 0x0800D1C6"')
    check(u32(B, a2o(0x0800D408)) == 0x20000098, 'literal 0x0800D408 used by the new cycle code is 0x20000098')
    check(B[a2o(0x0801D0D8):a2o(0x0801D0F8)] == A[a2o(0x0801D0D8):a2o(0x0801D0F8)],
          'scatter-load region table at 0x0801D0D8 unchanged')

    section('5. emulation (unicorn)')
    try:
        import unicorn  # noqa
    except ImportError:
        print('  unicorn not installed: skipped')
        return
    emulate(A, B)


# ------------------------------------------------------------------ emulation
def make_emu(img):
    from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
    from unicorn.arm_const import UC_ARM_REG_SP
    uc = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    uc.mem_map(0x08000000, 0x80000)
    payload = img[HDR:]
    uc.mem_write(FLASH_BASE, payload)
    uc.mem_map(0x20000000, 0x20000)
    uc.reg_write(UC_ARM_REG_SP, 0x2001F000)
    return uc


def run(img, start, stop, mark=None, r4buf=None, r8=None, extra_regs=None, limit=2000):
    """Run from start until pc == stop. draw_string / draw_number are stubbed and logged."""
    from unicorn import UC_HOOK_CODE
    from unicorn.arm_const import (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R4,
                                   UC_ARM_REG_R8, UC_ARM_REG_LR, UC_ARM_REG_PC)
    uc = make_emu(img)
    if mark is not None:
        uc.mem_write(0x20000098, bytes([mark]))
    uc.mem_write(0x200000A2, struct.pack('<h', -1))
    if r4buf is not None:
        uc.mem_write(0x20010000, r4buf)
        uc.reg_write(UC_ARM_REG_R4, 0x20010000)
    if r8 is not None:
        uc.reg_write(UC_ARM_REG_R8, r8)
    calls = []

    def cstr(a):
        s = uc.mem_read(a, 32)
        return bytes(s.split(b'\0')[0]).decode('latin1')

    def hook(uc_, addr, size, ud):
        if addr in (DRAW, DRAWNUM):
            r0, r1, r2 = (uc_.reg_read(r) for r in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2))
            calls.append((r0, r1, cstr(r2)) if addr == DRAW else ('num', r0, r1))
            uc_.reg_write(UC_ARM_REG_PC, uc_.reg_read(UC_ARM_REG_LR) | 1)
        if addr == stop:
            uc_.emu_stop()
    uc.hook_add(UC_HOOK_CODE, hook)
    uc.reg_write(UC_ARM_REG_LR, 0x08000001)
    uc.emu_start(start | 1, 0x08000000, count=limit)
    pc = uc.reg_read(UC_ARM_REG_PC)
    return calls, bytes(uc.mem_read(0x20000098, 1))[0], pc


def emulate(A, B):
    names = {0xF8: 'Feature', 0xF9: 'Ridge', 0xFA: 'Backsight', 0xFB: 'Generic',
             0xFC: 'Lead', 0xFD: 'Squeeze', 0xFE: 'Drip'}

    print('\n  M-key cycle block 0x0800D178 -> 0x0800D1C6 (value of 0x20000098 after one press)')
    for v in [0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0x7F, 0x00, 0x42, 0xF7]:
        _, sa, pa = run(A, 0x0800D178, 0x0800D1C6, mark=v)
        _, sb, pb = run(B, 0x0800D178, 0x0800D1C6, mark=v)
        print('    %02X: stock -> %02X   patched -> %02X' % (v, sa, sb))
        check(pa == 0x0800D1C6 and pb == 0x0800D1C6, '    both reach 0x0800D1C6 for %02X' % v)
    seq = [0xF8]
    for _ in range(8):
        seq.append(run(B, 0x0800D178, 0x0800D1C6, mark=seq[-1])[1])
    print('    patched sequence from F8: ' + ' '.join('%02X' % x for x in seq))
    check(seq == [0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0x7F, 0xF8], 'cycle is F8 F9 FA FB FC FD FE 7F F8')
    for v in [0x00, 0x42, 0xF7]:
        check(run(B, 0x0800D178, 0x0800D1C6, mark=v)[1] == v, 'value %02X outside the cycle stays unchanged (as stock)' % v)

    print('\n  Full M handler 0x0800D14E -> 0x0800D1C6 with key flag set (0x2000129B=1), 0x20000070=0')
    for v in [0xFF, 0xFB, 0xFE, 0x7F]:
        outs = []
        for img in (A, B):
            from unicorn.arm_const import UC_ARM_REG_PC
            uc_calls, s, pc = run_full_m(img, v)
            outs.append(s)
        print('    %02X: stock -> %02X   patched -> %02X' % (v, outs[0], outs[1]))

    print('\n  Screen A chain 0x0800FEC6 -> 0x0800FF48 and screen B chain 0x0801010E -> 0x08010198')
    for v in [0xF8, 0xF9, 0xFA, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF, 0x7F]:
        for tag, st, sp in (('A', 0x0800FEC6, 0x0800FF48), ('B', 0x0801010E, 0x08010198)):
            ca, _, pa = run(A, st, sp, mark=v)
            cb, _, pb = run(B, st, sp, mark=v)
            print('    %s %02X: stock %-30s patched %s' % (tag, v, ca, cb))
            check(pb == sp, '    %s %02X returns to 0x%08x' % (tag, v, sp))
            if v <= 0xFB or v in (0xFF, 0x7F):
                check(ca == cb, '    %s %02X draws exactly what stock draws' % (tag, v))
            else:
                check(cb == [(0x40, 0x60, names[v])], '    %s %02X draws "%s" at (64,96)' % (tag, v, names[v]))

    print('\n  Detail page 0x080114D8 -> 0x08011524 (record byte 1 = 0xF1 | code<<1)')
    mnames = {0: 'mark: Feature', 1: 'mark: Ridge', 2: 'mark: Backsight', 3: 'mark: Generic',
              4: 'mark: Lead', 5: 'mark: Squeeze', 6: 'mark: Drip'}
    for code in range(8):
        rec = bytearray(b'\xff' * 64)
        rec[1] = 0xF1 | (code << 1)
        ca, _, pa = run(A, 0x080114D8, 0x08011524, r4buf=bytes(rec))
        cb, _, pb = run(B, 0x080114D8, 0x08011524, r4buf=bytes(rec))
        print('    code %d: stock %-28s patched %s' % (code, ca, cb))
        check(pb == 0x08011524, '    code %d returns to 0x08011524' % code)
        if code <= 3 or code == 7:
            check(ca == cb, '    code %d draws exactly what stock draws' % code)
        else:
            check(cb == [(0, 0x5D, mnames[code])], '    code %d draws "%s" at (0,93)' % (code, mnames[code]))

    print('\n  Record encoder 0x0800802C: byte 1 produced for each mark value (stock code, unchanged)')
    for v in [0xF8, 0xFB, 0xFC, 0xFD, 0xFE, 0xFF, 0x7F]:
        b1 = run_encoder(B, v)
        print('    mark %02X -> byte1 %02X -> bits1-3 = %d' % (v, b1, (b1 >> 1) & 7))
    check(((run_encoder(B, 0xFC) >> 1) & 7, (run_encoder(B, 0xFD) >> 1) & 7, (run_encoder(B, 0xFE) >> 1) & 7) == (4, 5, 6),
          'stock encoder stores FC/FD/FE as codes 4/5/6 in bits 1-3')


def run_full_m(img, v):
    """Execute the stock M-with-laser-on handler entry (0x0800D14E) so the 0xFF 'recall last mark' path is covered."""
    from unicorn.arm_const import UC_ARM_REG_PC, UC_ARM_REG_LR
    from unicorn import UC_HOOK_CODE
    uc = make_emu(img)
    uc.mem_write(0x20000098, bytes([v]))
    uc.mem_write(0x2000129A, b'\x00\x01')    # key struct: [+1] == 1 means pressed
    uc.mem_write(0x20000070, b'\0\0\0\0')
    uc.mem_write(0x2000009C, struct.pack('<I', 0))
    st = {}

    def hook(u, a, s, d):
        if a == 0x0800D1C6:
            st['pc'] = a
            u.emu_stop()
    uc.hook_add(UC_HOOK_CODE, hook)
    uc.emu_start(0x0800D14E | 1, 0x08000000, count=500)
    return [], bytes(uc.mem_read(0x20000098, 1))[0], st.get('pc')


def run_encoder(img, mark):
    from unicorn.arm_const import (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2, UC_ARM_REG_R3,
                                   UC_ARM_REG_SP, UC_ARM_REG_LR)
    uc = make_emu(img)
    sp = 0x2001F000
    uc.mem_write(sp, struct.pack('<I', mark))     # 5th argument on the stack
    uc.reg_write(UC_ARM_REG_SP, sp)
    for r, val in ((UC_ARM_REG_R0, 0x20010000), (UC_ARM_REG_R1, 0), (UC_ARM_REG_R2, 0), (UC_ARM_REG_R3, 0)):
        uc.reg_write(r, val)
    uc.reg_write(UC_ARM_REG_LR, 0x08000001)
    try:
        uc.emu_start(0x0800802C | 1, 0x08000000, count=40)   # byte 1 is final after the first ~10 insns
    except Exception:
        pass
    return bytes(uc.mem_read(0x20010001, 1))[0]


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
    print('\nRESULT: %s' % ('ALL CHECKS PASSED' if not FAIL else '%d FAILED' % len(FAIL)))
    sys.exit(1 if FAIL else 0)
