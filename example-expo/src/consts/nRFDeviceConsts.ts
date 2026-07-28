// example-expo/src/consts/nRFDeviceConsts.ts

export const deviceTimeService = '00001847-0000-1000-8000-00805f9b34fb'
export const currentTimeCharacteristic = '00002a2b-0000-1000-8000-00805f9b34fb'
export const deviceTimeCharacteristic = '00002b90-0000-1000-8000-00805f9b34fb'
export const monitorExpectedMessage = 'Hi, it works!'

export function writeWithResponseTimeBytes(): Uint8Array {
  return getDateUint8Array(2022, 8, 11, 8, 17, 19)
}

export function writeWithoutResponseTimeBytes(): Uint8Array {
  return getDateUint8Array(2023, 9, 12, 10, 12, 16)
}

export function getDateUint8Array(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number
): Uint8Array {
  return new Uint8Array([(year >>> 8) & 0xff, year & 0xff, month, day, hour, minute, second])
}
