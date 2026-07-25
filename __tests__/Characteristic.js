/**
 * Thin Characteristic → BleManager spy surface (Base64 + dual-path arity).
 * Platform subscriptionType + real dual-path wiring live in DualPath.bytes.test.js (R2-F079).
 */
jest.mock('../src/BleManager')
const { BleManager } = require('../src/BleManager')
const { Characteristic } = require('../src/Characteristic')
const { Platform } = require('react-native')

describe("Test if Characteristic is properly calling BleManager's utility function:", () => {
  const bleManager = new BleManager()
  const characteristic = new Characteristic(
    { id: 'cId', uuid: 'uuid', serviceUUID: 'serviceUUID', deviceID: 'deviceId' },
    bleManager
  )

  beforeEach(() => {
    Platform.OS = 'android'
    jest.clearAllMocks()
  })

  test('descriptors', async () => {
    await characteristic.descriptors()
    expect(bleManager._descriptorsForCharacteristic).toBeCalledWith('deviceId', 'cId')
  })

  test('read', async () => {
    await characteristic.read('id')
    expect(bleManager._readCharacteristic).toBeCalledWith('deviceId', 'cId', 'id')
  })

  test('writeWithResponse', async () => {
    await characteristic.writeWithResponse('value', 'id')
    expect(bleManager._writeCharacteristicWithResponse).toBeCalledWith('deviceId', 'cId', 'value', 'id')
  })

  test('writeWithoutResponse', async () => {
    await characteristic.writeWithoutResponse('value', 'id')
    expect(bleManager._writeCharacteristicWithoutResponse).toBeCalledWith('deviceId', 'cId', 'value', 'id')
  })

  test('monitor', async () => {
    const listener = jest.fn()
    await characteristic.monitor(listener, 'id')
    // R3-F018: deviceID first so CCCD setup can serialize on the device queue
    expect(bleManager._monitorCharacteristic).toBeCalledWith('deviceId', 'cId', listener, 'id', null)
  })

  test('monitor forwards subscriptionType on Android', () => {
    Platform.OS = 'android'
    const listener = jest.fn()
    characteristic.monitor(listener, 'id', 'indication')
    expect(bleManager._monitorCharacteristic).toBeCalledWith(
      'deviceId',
      'cId',
      listener,
      'id',
      'indication'
    )
  })

  test('monitor omits subscriptionType arg on iOS', () => {
    Platform.OS = 'ios'
    const listener = jest.fn()
    characteristic.monitor(listener, 'id', 'notification')
    // iOS branch: no subscriptionType (deviceID + id + listener + tx)
    expect(bleManager._monitorCharacteristic).toBeCalledWith('deviceId', 'cId', listener, 'id')
    expect(bleManager._monitorCharacteristic.mock.calls[0]).toHaveLength(4)
  })

  test('readAsBytes / write*FromBytes / monitorAsBytes delegate to Base64 methods', async () => {
    bleManager._readCharacteristic = jest.fn().mockResolvedValue(
      new Characteristic(
        { id: 'cId', uuid: 'uuid', serviceUUID: 'serviceUUID', deviceID: 'deviceId', value: 'YQ==' },
        bleManager
      )
    )
    bleManager._writeCharacteristicWithResponse = jest.fn().mockResolvedValue(
      new Characteristic(
        { id: 'cId', uuid: 'uuid', serviceUUID: 'serviceUUID', deviceID: 'deviceId', value: 'YQ==' },
        bleManager
      )
    )
    bleManager._writeCharacteristicWithoutResponse = jest.fn().mockResolvedValue(
      new Characteristic(
        { id: 'cId', uuid: 'uuid', serviceUUID: 'serviceUUID', deviceID: 'deviceId', value: 'YQI=' },
        bleManager
      )
    )
    bleManager._monitorCharacteristic = jest.fn().mockReturnValue({ remove: jest.fn() })

    const read = await characteristic.readAsBytes('tx-r')
    expect(bleManager._readCharacteristic).toBeCalledWith('deviceId', 'cId', 'tx-r')
    expect(read.value).toBeInstanceOf(Uint8Array)

    await characteristic.writeWithResponseFromBytes(new Uint8Array([1]), 'tx-w')
    expect(bleManager._writeCharacteristicWithResponse).toHaveBeenCalled()
    expect(typeof bleManager._writeCharacteristicWithResponse.mock.calls[0][2]).toBe('string')

    await characteristic.writeWithoutResponseFromBytes(new Uint8Array([2, 3]), 'tx-wwr')
    expect(bleManager._writeCharacteristicWithoutResponse).toHaveBeenCalled()
    expect(typeof bleManager._writeCharacteristicWithoutResponse.mock.calls[0][2]).toBe('string')

    const listener = jest.fn()
    characteristic.monitorAsBytes(listener, 'tx-m', 'notification')
    expect(bleManager._monitorCharacteristic).toBeCalledWith(
      'deviceId',
      'cId',
      expect.any(Function),
      'tx-m',
      'notification'
    )
  })

  test('readDescriptor', async () => {
    await characteristic.readDescriptor('uuid', 'transId')
    expect(bleManager._readDescriptorForCharacteristic).toBeCalledWith('deviceId', 'cId', 'uuid', 'transId')
  })

  test('writeDescriptor', async () => {
    await characteristic.writeDescriptor('uuid', 'value', 'transId')
    expect(bleManager._writeDescriptorForCharacteristic).toBeCalledWith(
      'deviceId',
      'cId',
      'uuid',
      'value',
      'transId'
    )
  })
})
