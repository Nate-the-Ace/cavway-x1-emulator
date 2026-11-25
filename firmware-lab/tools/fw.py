"""Shared helpers for the Cavway X1 firmware lab (read-only analysis).

Image layout (established in ANALYSIS.md):
  file[0:256]   container header (ID, timestamp, version), not sent to device
  file[256:]    payload, flashed at FLASH_BASE (0x08004000)
"""
import struct, sys
from capstone import Cs, CS_ARCH_ARM, CS_MODE_THUMB, CS_MODE_MCLASS

HDR = 256
FLASH_BASE = 0x08004000

def load(path):
    return open(path, 'rb').read()

def a2o(addr):  # flash address -> file offset
    return addr - FLASH_BASE + HDR

def o2a(off):
    return off - HDR + FLASH_BASE

def u32(d, off):
    return struct.unpack_from('<I', d, off)[0]

_md = None
def md():
    global _md
    if _md is None:
        _md = Cs(CS_ARCH_ARM, CS_MODE_THUMB | CS_MODE_MCLASS)
        _md.detail = True
    return _md

def dis(d, addr, n=40, end=None):
    """Disassemble from flash address addr. Returns list of capstone insns."""
    off = a2o(addr)
    stop = a2o(end) if end else off + n * 4
    out = []
    a = addr
    while a2o(a) < stop:
        o = a2o(a)
        got = list(md().disasm(d[o:o + 4], a, 1))
        if not got:
            out.append(None); a += 2; continue
        out.append(got[0]); a += got[0].size
    return out

def show(d, addr, n=40, end=None, file=sys.stdout):
    for i in dis(d, addr, n, end):
        if i is None:
            continue
        extra = ''
        if i.mnemonic.startswith('ldr') and '[pc' in i.op_str:
            t = (i.address + 4) & ~3
            try:
                imm = int(i.op_str.split('#')[-1].rstrip(']'), 0)
                t += imm
                extra = '   ; =0x%08x' % u32(d, a2o(t))
            except Exception:
                pass
        print('%08x  %-10s %-8s %s%s' % (i.address, i.bytes.hex(), i.mnemonic, i.op_str, extra), file=file)

from capstone.arm import ARM_OP_IMM, ARM_OP_MEM, ARM_REG_PC

def linear(d):
    """Linear sweep of the whole payload; yields capstone insns (data gets misdecoded, fine for xrefs)."""
    m = md()
    m.skipdata = True
    for i in m.disasm(d[HDR:], FLASH_BASE):
        yield i
    m.skipdata = False

def pcrel_target(i):
    """Return the address an ADR / LDR [pc,#] / ADDW rX,pc refers to, or None."""
    if i.mnemonic in ('adr', 'adr.w', 'addw') or i.mnemonic.startswith('ldr') or i.mnemonic.startswith('vldr'):
        ops = i.operands
        for op in ops:
            if op.type == ARM_OP_MEM and op.mem.base == ARM_REG_PC:
                return ((i.address + 4) & ~3) + op.mem.disp
        if i.mnemonic.startswith('adr') and ops and ops[-1].type == ARM_OP_IMM:
            return ((i.address + 4) & ~3) + ops[-1].imm
    return None

def xrefs(d):
    """Map target address -> list of (insn address, kind). Kind 'lit' means the target value
    was loaded from a literal pool word; 'adr' means pc-relative address computation."""
    refs = {}
    for i in linear(d):
        if i.id == 0:
            continue
        t = pcrel_target(i)
        if t is None:
            continue
        if i.mnemonic.startswith('ldr') and 0 <= a2o(t) < len(d) - 3:
            refs.setdefault(u32(d, a2o(t)), []).append((i.address, 'lit'))
        else:
            refs.setdefault(t, []).append((i.address, 'adr'))
    return refs
