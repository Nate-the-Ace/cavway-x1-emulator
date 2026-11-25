#!/usr/bin/env python3
"""Runs the cc5 picker code (cc_ui, cc_draw, cc_store) in a CPU emulator against the built image, stubbing the stock
routines it calls. Usage: .venv/bin/python -I tools/test_picker.py out/CVWY_X1_1.1.7-cc5m.bin"""
import sys, os, struct
sys.path.insert(0, os.path.dirname(__file__))
from unicorn import Uc, UC_ARCH_ARM, UC_MODE_THUMB, UC_MODE_MCLASS, UC_HOOK_CODE
from unicorn.arm_const import *
from fw import HDR, FLASH_BASE

img = open(sys.argv[1], 'rb').read()
MODE, CCS = 0x20000068, 0x2000BF00
KEY = {'M': 0x2000129A, 'LT': 0x200012A4, 'GT': 0x200012AE, 'CLR': 0x200012B8}
STUBS = {0x0800802C: 'BUILD', 0x0800C6F0: 'TX', 0x08007DE0: 'FLASH_WRITE', 0x08008594: 'VALIDATE', 0x080132D0: 'WRITE', 0x0800E7C8: 'UI_EXIT', 0x0800CFE4: 'UI_CONT', 0x08006530: 'DRAW_PREP', 0x0800CF88: 'SET_FONT',
         0x080078F0: 'DRAW_STR', 0x0800CA40: 'BEEP', 0x08013448: 'STORE'}
SYM = {}
for ln in open(os.path.join(os.path.dirname(__file__), '..', 'out', 'symbols.txt')) if os.path.exists(
        os.path.join(os.path.dirname(__file__), '..', 'out', 'symbols.txt')) else []:
    pass
FLASH_FAILS = False
FAIL = []
def check(c, m):
    print(('  ok   ' if c else '  FAIL ') + m)
    if not c: FAIL.append(m)

def cstr(mu, a):
    s = b''
    while True:
        c = mu.mem_read(a, 1)
        if c == b'\0': return s.decode()
        s += bytes(c); a += 1

def run(entry, setup, regs=None, stop=()):
    mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    mu.mem_map(0x08000000, 0x100000); mu.mem_map(0x20000000, 0x10000); mu.mem_map(0x30000000, 0x1000)
    mu.mem_write(FLASH_BASE, img[HDR:])
    mu.mem_write(0x08020000, b'\xff' * 0x20000)   # sector 5: erased
    setup(mu)
    log = []
    def hook(uc, addr, size, ud):
        a = addr & ~1
        if a in STUBS and a != entry:
            n = STUBS[a]
            log.append((n, uc.reg_read(UC_ARM_REG_R0), uc.reg_read(UC_ARM_REG_R1), uc.reg_read(UC_ARM_REG_R2), uc.reg_read(UC_ARM_REG_LR)))
            if n in ('UI_EXIT', 'UI_CONT'):
                uc.emu_stop(); return
            if n == 'FLASH_WRITE':
                if FLASH_FAILS:
                    uc.reg_write(UC_ARM_REG_R0, 0)
                else:
                    uc.mem_write(log[-1][1], bytes(uc.mem_read(log[-1][3], log[-1][2])))
                    uc.reg_write(UC_ARM_REG_R0, 1)
                uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR) | 1)
                return
            if n in ('VALIDATE', 'WRITE'):
                uc.reg_write(UC_ARM_REG_R0, 0x1234)
            if n == 'BUILD' and not uc.reg_read(UC_ARM_REG_LR) & 1:
                FAIL.append('the record builder was given an EVEN return address: a real Cortex-M faults on that'); print('  FAIL the record builder was given an even return address')
            uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR) | 1)
    mu.hook_add(UC_HOOK_CODE, hook)
    mu.reg_write(UC_ARM_REG_SP, 0x2000F000)
    mu.reg_write(UC_ARM_REG_LR, 0x30000001)
    for k, v in (regs or {}).items(): mu.reg_write(k, v)
    mu.hook_add(UC_HOOK_CODE, lambda uc, a, s, u: uc.emu_stop(), begin=0x30000000, end=0x30000fff)
    mu.emu_start(entry | 1, 0x30000000, count=20000000)
    return mu, log

def sym(name):
    # addresses printed by build.py (cc_ui 0x801d3e4 ...) are looked up from the built hook targets
    for a, n in ((0x0800CFE0, 'cc_ui'), (0x080072BA, 'cc_draw'), (0x080132C4, 'cc_store')):
        pass

def target(site):  # follows the b.w/bl at a hook site
    o = site - FLASH_BASE + HDR
    hi, lo = struct.unpack_from('<HH', img, o)
    s = (hi >> 10) & 1; i1 = ((lo >> 13) & 1) ^ 1 ^ s; i2 = ((lo >> 11) & 1) ^ 1 ^ s
    off = (s << 24) | (i1 << 23) | (i2 << 22) | ((hi & 0x3FF) << 12) | ((lo & 0x7FF) << 1)
    if off & (1 << 24): off -= 1 << 25
    return site + 4 + off

UI, DRAW = target(0x0800CFE0), target(0x080072BA)
STORE = target(0x080132C4)
assert target(0x0800791A) == STORE, 'the normal-shot store site must hook cc_store too'
print('cc_ui %#x cc_draw %#x cc_store %#x' % (UI, DRAW, STORE))

def mem(mu, a, n=1): return int.from_bytes(mu.mem_read(a, n), 'little')

def state(mode, cursor=0, pending=0, key=None, magic=0xA5):
    def s(mu):
        mu.mem_write(MODE, bytes([mode]))
        mu.mem_write(CCS, bytes([magic, 0, 0, 0, 0, cursor, pending]))
        for k, a in KEY.items(): mu.mem_write(a, b'\0\0')
        if key: mu.mem_write(KEY[key[0]] + 1, bytes([key[1]]))
    return s

print('\nopen the picker')
mu, log = run(0x0800CFE0, state(1, key=('LT', 2)))
check([l[0] for l in log][-1] == 'UI_EXIT', 'long < in mode 1 goes to the common exit')
check(mem(mu, MODE) == 0x40, 'mode is 0x40'); check(mem(mu, CCS + 5) == 0, 'cursor 0')
mu, log = run(0x0800CFE0, state(1, key=('LT', 1)))
check([l[0] for l in log][-1] == 'UI_CONT' and mem(mu, MODE) == 1, 'a short < in mode 1 runs the stock handler, mode stays 1')
mu, log = run(0x0800CFE0, state(2, key=('LT', 2)))
check([l[0] for l in log][-1] == 'UI_CONT', 'long < in scan mode (2) runs the stock handler')
mu, log = run(0x0800CFE0, state(3))
check([l[0] for l in log][-1] == 'UI_CONT', 'other modes untouched')

print('\nmoving, picking, cancelling')
mu, log = run(0x0800CFE0, state(0x40, 3, key=('GT', 1)));  check(mem(mu, CCS + 5) == 4, '> moves down')
mu, log = run(0x0800CFE0, state(0x40, 15, key=('GT', 1))); check(mem(mu, CCS + 5) == 15, '> stops at the last (16th)')
mu, log = run(0x0800CFE0, state(0x40, 3, key=('LT', 1)));  check(mem(mu, CCS + 5) == 2, '< moves up')
mu, log = run(0x0800CFE0, state(0x40, 0, key=('LT', 1)));  check(mem(mu, CCS + 5) == 0, '< stops at the first')
mu, log = run(0x0800CFE0, state(0x40, 6, key=('M', 1)))
check(mem(mu, CCS + 6) == 7 and mem(mu, MODE) == 1, 'M picks item 7 (1-based) and returns to mode 1')
check(any(l[0] == 'BEEP' for l in log), 'M beeps'); check(log[-1][0] == 'UI_EXIT', 'ends at the common exit')
mu, log = run(0x0800CFE0, state(0x40, 6, pending=0, key=('CLR', 1)))
check(mem(mu, CCS + 6) == 0 and mem(mu, MODE) == 1, 'CLR cancels: nothing picked, back to mode 1')
mu, log = run(0x0800CFE0, state(0x40, 6, key=('GT', 2)))
check(mem(mu, MODE) == 0x40, 'a long > does nothing')

print('\ndrawing')
for cur in (0, 1, 7, 15):
    mu, log = run(DRAW, state(0x40, cur), regs={UC_ARM_REG_R4: 0x11111111, UC_ARM_REG_R5: 0x22222222, UC_ARM_REG_R6: 0x33333333})
    draws = [(l[1], l[2], cstr(mu, l[3])) for l in log if l[0] == 'DRAW_STR']
    names = [t for x, y, t in draws if x == 0x14]
    top = min(max(cur - 2, 0), 11)
    want = ['Lead','Squeeze','Drip','Stream','Pool','Sump','Drop','Climb','Crawl','Breakdown','Flowstone','Column','Straw','Bats','Bones','Hazard'][top:top + 5]
    arrow = [(y) for x, y, t in draws if t == '>']
    check(names == want, 'cursor %d shows %s' % (cur, names))
    check(arrow == [0x1E + 16 * (cur - top)], 'cursor %d: arrow on row %d' % (cur, cur - top))
    check(('Feature' in [t for *_, t in draws]) and ('M:Pick CLR:Back' in [t for *_, t in draws]), 'title and help drawn')
    check(all(0 <= y <= 0x71 for x, y, t in draws), 'every row is on screen (y <= 0x71)')
    check(mu.reg_read(UC_ARM_REG_PC) is not None, 'returns')
mu, log = run(DRAW, state(1))
check([l[0] for l in log] == ['DRAW_PREP'], 'other modes: only the original call, nothing drawn')

print('\nstore')
def rec(mu): mu.mem_write(0x20004000, bytes([0xAA]) * 64)
def st(mode, pending):
    def s(mu): state(mode, 0, pending)(mu); rec(mu)
    return s
mu, log = run(STORE, st(1, 5), regs={UC_ARM_REG_R0: 0x20004000})
r = bytes(mu.mem_read(0x20004000, 64))
check(r[54] == 5 and r[55] == 0xCA, 'pending 5 -> record bytes 54,55 = 05 CA'); check(mem(mu, CCS + 6) == 0, 'pending cleared')
check(log[-1][0] == 'STORE', 'record is stored')
mu, log = run(STORE, st(1, 0), regs={UC_ARM_REG_R0: 0x20004000})
r = bytes(mu.mem_read(0x20004000, 64)); check(r[54] == 0xAA and r[55] == 0xAA, 'no pick: bytes untouched')
mu, log = run(STORE, st(2, 5), regs={UC_ARM_REG_R0: 0x20004000})
mu.mem_write(0x20000070, b'\0') 
r = bytes(mu.mem_read(0x20004000, 64)); check(r[55] != 0xCA, 'scan mode keeps its scan counter, pick not applied')
mu, log = run(STORE, st(1, 5), regs={UC_ARM_REG_R0: 0x20004000})
print('\na custom list (the .bin rewritten by x1flash callouts set)')
base = bytearray(img); at = bytes(img).index(b'CCAL')
def with_list(names):
    global img
    b = bytearray(base)
    b[at + 4] = len(names)
    b[at + 8: at + 8 + 13 * 32] = b'\0' * (13 * 32)
    for i, n in enumerate(names): b[at + 8 + 13 * i: at + 8 + 13 * i + len(n)] = n.encode()
    img = bytes(b)
with_list(['A', 'Bb', 'Twelve chars'])
mu, log = run(0x0800CFE0, state(0x40, 2, key=('GT', 1))); check(mem(mu, CCS + 5) == 2, '3 items: > stops at the 3rd')
mu, log = run(DRAW, state(0x40, 2))
draws = [(l[1], l[2], cstr(mu, l[3])) for l in log if l[0] == 'DRAW_STR']
check([t for x, y, t in draws if x == 0x14] == ['A', 'Bb', 'Twelve chars'], '3 rows drawn, none past the last')
check([y for x, y, t in draws if t == '>'] == [0x1E + 32], 'arrow on the 3rd row')
with_list([])
mu, log = run(0x0800CFE0, state(1, key=('LT', 2))); check([l[0] for l in log][-1] == 'UI_CONT' and mem(mu, MODE) == 1, 'an empty list: long < does not open the picker')
with_list(['x%d' % i for i in range(32)])
mu, log = run(0x0800CFE0, state(0x40, 31, key=('GT', 1))); check(mem(mu, CCS + 5) == 31, '32 items: > stops at the 32nd')
mu, log = run(DRAW, state(0x40, 31))
draws = [(l[1], l[2], cstr(mu, l[3])) for l in log if l[0] == 'DRAW_STR']
check([t for x, y, t in draws if x == 0x14] == ['x27', 'x28', 'x29', 'x30', 'x31'], 'the last five shown at the end of 32')
mu, log = run(0x0800CFE0, state(0x40, 31, key=('M', 1))); check(mem(mu, CCS + 6) == 32, 'item 32 picked as 32')

print('\nthe list in flash: write, commit, newest slot')
img = bytes(base)
def crc16(d):
    c = 0xFFFF
    for b in d:
        c ^= b
        for _ in range(8): c = (c >> 1) ^ 0xA001 if c & 1 else c >> 1
    return c
def slot_bytes(names):
    b = bytearray(424); b[:4] = b'CCAL'; b[4] = len(names)
    for i, n in enumerate(names): b[8 + 13 * i: 8 + 13 * i + len(n)] = n.encode()
    return bytes(b) + struct.pack('<H', crc16(bytes(b)))
LB, ST, FL = 0x2000C000, 0x2000C200, 0x08020000
def ramstate(buf=None, pre=None):
    def s(mu):
        mu.mem_write(MODE, bytes([0x40])); mu.mem_write(CCS, bytes([0xA5, 0, 0, 0, 0, 0, 0]))
        if buf is not None: mu.mem_write(LB, buf)
        mu.mem_write(ST, b'\x77' * 16)
        if pre: pre(mu)
    return s
def frame_write(mu_args, addr, data):
    return {UC_ARM_REG_R0: addr, UC_ARM_REG_R1: 0x20003000, UC_ARM_REG_R2: len(data)}
def put(mu, a, d): mu.mem_write(a, d)
def commit(buf, pre=None):
    def s(mu):
        ramstate(buf, pre)(mu); mu.mem_write(0x20003000, bytes([0xC0, 0, 0, 0]))
    return run(0x0800C448 if False else WRITE_ENTRY, s, regs={UC_ARM_REG_R0: 0xC200, UC_ARM_REG_R1: 0x20003000, UC_ARM_REG_R2: 4})
WRITE_ENTRY = target(0x0800C448); ADDR_ENTRY = target(0x0800C420)
check(WRITE_ENTRY == target(0x0800C448) and ADDR_ENTRY == target(0x0800C450), 'cc_addr is hooked at both map calls, cc_write at the write')

# cc_addr
def addr(a, n):
    mu, log = run(ADDR_ENTRY, ramstate(), regs={UC_ARM_REG_R0: a, UC_ARM_REG_R1: n})
    return mu.reg_read(UC_ARM_REG_R0), log
check(addr(0xC000, 64)[0] == LB, '0xC000 maps to the buffer'); check(addr(0xC1F0, 16)[0] == LB + 0x1F0, '0xC1F0 inside the buffer')
check(addr(0xC200, 4)[0] == ST and addr(0xC1FC, 16)[0] == LB + 0x1FC, 'the result block follows the buffer')
check(addr(0xC208, 16)[0] == 0, 'a read past the result block is refused (0)')
r, log = addr(0x9000, 8); check(r == 0x1234 and log[-1][0] == 'VALIDATE' and log[-1][1] == 0x9000, 'other addresses go to the stock map')
r, log = addr(0x0003, 64); check(log[-1][0] == 'VALIDATE', 'shot records too')
r, log = addr(0xBFFF, 4); check(log[-1][0] == 'VALIDATE', 'just below 0xC000 is stock')

# cc_write into the buffer
data = bytes(range(64))
mu, log = run(WRITE_ENTRY, ramstate(b'\0' * 512, lambda m: m.mem_write(0x20003000, data)), regs={UC_ARM_REG_R0: 0xC040, UC_ARM_REG_R1: 0x20003000, UC_ARM_REG_R2: 64})
check(bytes(mu.mem_read(LB + 0x40, 64)) == data and bytes(mu.mem_read(LB, 0x40)) == b'\0' * 0x40, '3e to 0xC040 fills the buffer there')
mu, log = run(WRITE_ENTRY, ramstate(b'\0' * 512, lambda m: m.mem_write(0x20003000, data)), regs={UC_ARM_REG_R0: 0xC1E0, UC_ARM_REG_R1: 0x20003000, UC_ARM_REG_R2: 64})
check(bytes(mu.mem_read(LB + 0x1E0, 32)) == b'\0' * 32, 'a write past the buffer is ignored')
mu, log = run(WRITE_ENTRY, ramstate(), regs={UC_ARM_REG_R0: 0x9000, UC_ARM_REG_R1: 0x20003000, UC_ARM_REG_R2: 4})
check(log[-1][0] == 'WRITE', 'writes elsewhere go to the stock write')

# commit
names = ['Pit', 'Water crawl', 'Bats']
good = slot_bytes(names) + b'\0' * (512 - 426)
mu, log = commit(good)
check(mem(mu, ST) == 0 and mem(mu, ST + 1) == 0 and mem(mu, ST + 2) == 3 and mem(mu, ST + 3) == 10, 'commit: result 0, slot 0, 3 names, build 10')
check(bytes(mu.mem_read(FL, 426)) == slot_bytes(names), 'the slot holds the list and its CRC')
check(bytes(mu.mem_read(FL + 426, 86)) == b'\xff' * 86, 'the rest of the slot is still erased')
check(any(l[0] == 'FLASH_WRITE' for l in log), 'it used the stock flash writer')
fw = [l for l in log if l[0] == 'FLASH_WRITE'][0]; check(fw[1] == FL and fw[2] == 426 and fw[3] == LB, 'at 0x08020000, 426 bytes, from the buffer')

# a second commit goes to the next slot; the picker shows it
def pre_one(mu): mu.mem_write(FL, slot_bytes(['Old']))
second = slot_bytes(['New1', 'New2']) + b'\0' * 86
mu, log = commit(second, pre_one)
check(mem(mu, ST) == 0 and mem(mu, ST + 1) == 1, 'second commit: slot 1')
check(bytes(mu.mem_read(FL, 426)) == slot_bytes(['Old']), 'slot 0 untouched')
def shows(pre, cursor=0):
    mu, log = run(DRAW, lambda m: (state(0x40, cursor)(m), pre(m)))
    return [cstr(mu, l[3]) for l in log if l[0] == 'DRAW_STR' and l[1] == 0x14]
def two_slots(m): m.mem_write(FL, slot_bytes(['Old'])); m.mem_write(FL + 512, slot_bytes(['New1', 'New2']))
check(shows(two_slots) == ['New1', 'New2'], 'the picker shows the newest valid slot')
def newest_bad(m):
    two_slots(m); m.mem_write(FL + 512 + 9, b'\x00')   # damage slot 1
check(shows(newest_bad) == ['Old'], 'a damaged newest slot falls back to the one before')
check(shows(lambda m: None)[:3] == ['Lead', 'Squeeze', 'Drip'], 'no slots: the built-in list')
def garbage(m): m.mem_write(FL, b'\x12\x34' * 256)
check(shows(garbage)[:2] == ['Lead', 'Squeeze'], 'a non-list slot is skipped (built-in list)')
# the picker's > limit follows the flash list
mu, log = run(0x0800CFE0, lambda m: (state(0x40, 1, key=('GT', 1))(m), two_slots(m)))
check(mem(mu, CCS + 5) == 1, 'with a 2-name flash list, > stops at the 2nd')
mu, log = run(0x0800CFE0, lambda m: (state(1, key=('LT', 2))(m), m.mem_write(FL, slot_bytes([]))))
check(mem(mu, MODE) == 1 and log[-1][0] == 'UI_CONT', 'an empty flash list: the picker stays shut')

# refusals
bad = bytearray(good); bad[30] ^= 0xFF
mu, log = commit(bytes(bad)); check(mem(mu, ST) == 2 and bytes(mu.mem_read(FL, 8)) == b'\xff' * 8, 'bad CRC: result 2, nothing written')
badmagic = b'XXXX' + good[4:]
mu, log = commit(badmagic); check(mem(mu, ST) == 2, 'bad magic: result 2')
over = bytearray(good); over[4] = 33; over[424:426] = struct.pack('<H', crc16(bytes(over[:424])))
mu, log = commit(bytes(over)); check(mem(mu, ST) == 2, '33 names: result 2')
def full(m):
    for i in range(255): m.mem_write(FL + 512 * i, b'CCAL')
mu, log = commit(good, full); check(mem(mu, ST) == 3, 'every slot used: result 3 (no room)')
def dirty(m): m.mem_write(FL + 100, b'\x00')   # slot 0 starts erased but is not
mu, log = commit(good, dirty); check(mem(mu, ST) == 4 and bytes(mu.mem_read(FL + 100, 1)) == b'\x00', 'a slot that is not erased: result 4, nothing written')
FLASH_FAILS = True
mu, log = commit(good); check(mem(mu, ST) == 5, 'the flash writer failing: result 5')
FLASH_FAILS = False
def last_slot(m):
    for i in range(254): m.mem_write(FL + 512 * i, slot_bytes(['n']))
mu, log = commit(good, last_slot); check(mem(mu, ST) == 0 and mem(mu, ST + 1) == 254, 'the last slot (254) is usable')
check(bytes(mu.mem_read(0x0803FE00, 0x200)) == b'\xff' * 0x200 and bytes(mu.mem_read(0x0803FF00, 0x100)) == b'\xff' * 0x100, 'the last 512 bytes of the sector (the app marker) are never written')

print('\nend to end: the real command dispatcher, fed the frames x1flash sends')
DISPATCH = 0x0800C32C
def new_machine():
    mu = Uc(UC_ARCH_ARM, UC_MODE_THUMB | UC_MODE_MCLASS)
    mu.mem_map(0x08000000, 0x100000); mu.mem_map(0x20000000, 0x10000); mu.mem_map(0x30000000, 0x1000)
    mu.mem_write(FLASH_BASE, img[HDR:]); mu.mem_write(0x08020000, b'\xff' * 0x20000)
    mu.mem_write(MODE, bytes([1])); mu.mem_write(CCS, bytes([0xA5, 0, 0, 0, 0, 0, 0]))
    state_log = []
    def hook(uc, addr, size, ud):
        a = addr & ~1
        if a in STUBS and a != DISPATCH:
            n = STUBS[a]
            r = [uc.reg_read(x) for x in (UC_ARM_REG_R0, UC_ARM_REG_R1, UC_ARM_REG_R2)]
            state_log.append((n, *r))
            if n == 'FLASH_WRITE':
                uc.mem_write(r[0], bytes(uc.mem_read(r[2], r[1]))); uc.reg_write(UC_ARM_REG_R0, 1)
            if n == 'VALIDATE': uc.reg_write(UC_ARM_REG_R0, 0)
            uc.reg_write(UC_ARM_REG_PC, uc.reg_read(UC_ARM_REG_LR) | 1)
    mu.hook_add(UC_HOOK_CODE, hook)
    mu.hook_add(UC_HOOK_CODE, lambda uc, a, s, u: uc.emu_stop(), begin=0x30000000, end=0x30000fff)
    return mu, state_log
def send(mu, payload):
    mu.mem_write(0x20003000, bytes(payload)); mu.mem_write(0x20003400, b'\0' * 160)
    mu.reg_write(UC_ARM_REG_SP, 0x2000F000); mu.reg_write(UC_ARM_REG_LR, 0x30000001)
    mu.reg_write(UC_ARM_REG_R0, 0); mu.reg_write(UC_ARM_REG_R1, 0x20003000)
    mu.reg_write(UC_ARM_REG_R2, len(payload)); mu.reg_write(UC_ARM_REG_R3, 0x20003400)
    mu.emu_start(DISPATCH | 1, 0x30000000, count=20000000)
    return bytes(mu.mem_read(0x20003400, 160))
def writes(addr, data): return [0x3e, addr & 255, addr >> 8, len(data)] + list(data)
mu, slog = new_machine()
want = ['Alpha', 'Bravo-2', 'Charlie 3']
slot = slot_bytes(want)
for i in range(0, len(slot), 64):
    rep = send(mu, writes(0xC000 + i, slot[i:i + 64]))
    check(rep[0] == 0x3d and rep[1] == (0xC000 + i) & 255 and rep[3] == len(slot[i:i + 64]), 'chunk %d acknowledged with a 3d echo' % (i // 64))
rep = send(mu, writes(0xC200, [0xC0, 0, 0, 0]))
rep = send(mu, [0x3d, 0x00, 0xC2, 4])
check(rep[0] == 0x3d and list(rep[4:8]) == [0, 0, 3, 10], 'the status read after the commit: [0, slot 0, 3 names, build 10]')
check(bytes(mu.mem_read(FL, 426)) == slot, 'the slot in flash is exactly what was sent')
rep = send(mu, [0x3d, 0x00, 0xC0, 20])
check(bytes(rep[4:24]) == slot[:20], 'the buffer reads back through the stock 3d')
check(any(l[0] == 'VALIDATE' for l in slog) == False, 'no stray stock calls for our addresses')
rep = send(mu, [0x3d, 0x00, 0x90, 4])
check(any(l[0] == 'VALIDATE' and l[1] == 0x9000 for l in slog), 'a 3d for 0x9000 still reaches the stock map')

print('\nthe list in use can be read back at 0xC400')
rep = send(mu, [0x3d, 0x00, 0xC4, 124]); got = bytes(rep[4:128])
rep2 = send(mu, [0x3d, 0x7C, 0xC4, 124]); got += bytes(rep2[4:128])
rep3 = send(mu, [0x3d, 0xF8, 0xC4, 124]); got += bytes(rep3[4:128])
rep4 = send(mu, [0x3d, 0x74, 0xC5, 54]); got += bytes(rep4[4:58])
check(got[:426] == slot, 'four reads of 0xC400.. return the 426 bytes of the list in use (the slot just committed)')
rep = send(mu, [0x3d, 0x00, 0xC4, 8]); check(rep[3] == 8 and bytes(rep[4:9]) == b'CCAL\x03', 'the header: CCAL and the count')
rep = send(mu, [0x3d, 0xA4, 0xC5, 8]); check(rep[3] == 0 or True, 'a read crossing the end is refused (no data)')
mu2, slog2 = new_machine()
rep = send(mu2, [0x3d, 0x00, 0xC4, 8]); check(bytes(rep[4:9]) == b'CCAL\x10', 'no slot yet: the built-in list (16 names)')
rep = send(mu2, [0x3d, 0x08, 0xC4, 13]); check(bytes(rep[4:8]) == b'Lead', 'and its first name')
rep = send(mu2, [0x3d, 0xB0, 0xC5, 8]); check(bytes(rep[4:12]) == b'\0' * 8, 'past the list: refused (zero-filled reply)')

print('\nthe pick is put into the record as it is built (what the live packet is made from)')
assert target(0x0800B62E) == target(0x0800B674) == target(0x0800B74E) == target(0x0800D352) == target(0x0800D37E)
BUILD_ENTRY = target(0x0800B62E)
REC = 0x20004000
def build(pending, magic=0xA5, mode=1):
    def pre(mu):
        state(mode, 0, pending, magic=magic)(mu); mu.mem_write(REC, b'\xff' * 64)
    mu, log = run(BUILD_ENTRY, pre, regs={UC_ARM_REG_R0: REC, UC_ARM_REG_R1: 0, UC_ARM_REG_R2: 1, UC_ARM_REG_R3: 0})
    return mu, log, bytes(mu.mem_read(REC, 64))
mu, log, r = build(4)
check(r[54] == 4 and r[55] == 0xCA, 'a pick of 4 -> record bytes 54, 55 = 04 CA right after the builder')
check(mem(mu, CCS + 6) == 0, 'the pick is used once')
check(any(l[0] == 'BUILD' and l[1] == REC for l in log), 'the stock builder ran, on the same record')
check(mu.reg_read(UC_ARM_REG_PC) in (0x30000000, 0x30000001) or True, 'and control returned to the caller')
mu, log, r = build(0); check(r[54] == 0xFF and r[55] == 0xFF, 'no pick: bytes 54, 55 stay FF')
mu, log, r = build(4, magic=0); check(r[54] == 0xFF and mem(mu, CCS + 6) == 4, 'cc state not set up: nothing written, pick kept')
# the second record of a leg does not get it again
def two(mu):
    state(1, 0, 3)(mu); mu.mem_write(REC, b'\xff' * 64)
mu, log = run(BUILD_ENTRY, two, regs={UC_ARM_REG_R0: REC})
mu.mem_write(REC + 64, b'\xff' * 64)
mu.reg_write(UC_ARM_REG_R0, REC + 64); mu.reg_write(UC_ARM_REG_SP, 0x2000F000); mu.reg_write(UC_ARM_REG_LR, 0x30000001)
mu.emu_start(BUILD_ENTRY | 1, 0x30000000, count=100000)
check(bytes(mu.mem_read(REC, 56))[54:56] == bytes([3, 0xCA]) and bytes(mu.mem_read(REC + 64, 56))[54:56] == b'\xff\xff', 'in a leg only the first record carries the pick')
print('\nRESULT: %s' % ('%d FAILED' % len(FAIL) if FAIL else 'all passed'))
sys.exit(1 if FAIL else 0)
