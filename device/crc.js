// CRC16/MODBUS: init 0xFFFF, reflected poly 0xA001 (UART.cs crc16_modbus).
export function crc16modbus(bytes) {
  let crc = 0xffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let j = 0; j < 8; j++) crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
  }
  return crc;
}
