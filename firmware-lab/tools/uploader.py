#!/usr/bin/env python3
"""Offline re-implementation of what Cavway Assistant (FrmFirmware.cs + UART.cs) would send.

Nothing here opens a port. It only reads a .bin and prints what the uploader would do with it:

  * header check (checkValid): 8-byte ID, big-endian Unix timestamp at 8..11, version at 12..14
  * packetisation (ThreadFWUpgrade): read the file in 128-byte chunks, each pre-filled with 0xFF;
    chunks whose file offset is < 256 (the header) are skipped; the do/while sends one more chunk
    after a short (or zero-length) read, so a file whose length is a multiple of 128 gets an extra
    all-0xFF packet
  * per packet: CRC-16/Modbus over the 128 data bytes, frame 4C idx_lo idx_hi data[128] crc_lo crc_hi
  * end command 4D + uint32 LE checksum, where checksum = sum of all packet CRCs (mod 2^32)

Usage: uploader.py FILE [FILE...]      (stdlib only)
"""
import struct, sys, datetime, hashlib

BIN_ID = bytes([0x11, 0x23, 0x55, 0x6e, 0x7c, 0xef, 0x6d, 0x5b])


def crc16_modbus(data):
    crc = 0xFFFF
    for b in data:
        crc ^= b
        for _ in range(8):
            crc = (crc >> 1) ^ 0xA001 if crc & 1 else crc >> 1
    return crc


def check_valid(blob):
    h = blob[:256]
    if h[:8] != BIN_ID:
        return None
    ts = struct.unpack('>I', h[8:12])[0]
    ver = '%d.%d.%d' % (h[12], h[13], h[14])
    return ver, ts


def packets(blob):
    """Exact mirror of the C# do/while loop."""
    out = []
    offset = 0
    pos = 0
    while True:
        buf = bytearray(b'\xff' * 128)
        chunk = blob[pos:pos + 128]
        res = len(chunk)
        buf[:res] = chunk
        pos += res
        if offset >= 256:
            out.append(bytes(buf))
        offset += 128
        if res != 128:
            break
    return out


def frames(pkts):
    for idx, p in enumerate(pkts):
        c = crc16_modbus(p)
        yield bytes([0x4C, idx & 0xFF, (idx >> 8) & 0xFF]) + p + bytes([c & 0xFF, c >> 8])


def checksum(pkts):
    s = 0
    for p in pkts:
        s = (s + crc16_modbus(p)) & 0xFFFFFFFF
    return s


def report(path):
    blob = open(path, 'rb').read()
    v = check_valid(blob)
    pk = packets(blob)
    cs = checksum(pk)
    fr_hash = hashlib.sha256(b''.join(frames(pk))).hexdigest()
    print('file      %s' % path)
    print('length    %d bytes (payload %d = 0x%x)' % (len(blob), len(blob) - 256, len(blob) - 256))
    if v is None:
        print('header    INVALID (uploader would refuse the file)')
    else:
        ts = datetime.datetime.fromtimestamp(v[1], datetime.timezone.utc)
        print('header    ID ok, version %s, timestamp %d (%s UTC)' % (v[0], v[1], ts.strftime('%Y-%m-%d %H:%M:%S')))
    print('packets   %d x 128 bytes, 0xFF bytes in last packet: %d' % (len(pk), pk[-1].count(b'\xff'[0]) if pk else 0))
    print('first CRC 0x%04x  last CRC 0x%04x' % (crc16_modbus(pk[0]), crc16_modbus(pk[-1])))
    print('checksum  0x%08x  (end frame 4D %s)' % (cs, struct.pack('<I', cs).hex(' ')))
    print('frames    sha256 %s' % fr_hash)
    return blob, pk, cs


if __name__ == '__main__':
    # self-test of the CRC against the standard check value for CRC-16/MODBUS ("123456789" -> 0x4B37)
    assert crc16_modbus(b'123456789') == 0x4B37
    for p in sys.argv[1:]:
        report(p)
        print()
