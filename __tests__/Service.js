jest.mock('../src/BleManager')
const { BleManager } = require('../src/BleManager')
const { Service } = require('../src/Service')

describe("Test if Service is properly calling BleManager's utility function:", () => {
  const bleManager = new BleManager()
  const service = new Service({ id: 'serviceId', uuid: 'serviceUUID', deviceID: 'deviceId' }, bleManager)

  test('characteristics', async () => {
    await service.characteristics()
    expect(bleManager._characteristicsForService).toBeCalledWith('deviceId', 'serviceId')
  })

  test('descriptorsForCharacteristic', async () => {
    await service.descriptorsForCharacteristic('characteristicUUID')
    expect(bleManager._descriptorsForService).toBeCalledWith('deviceId', 'serviceId', 'characteristicUUID')
  })

  test('readCharacteristic', async () => {
    await service.readCharacteristic('bbbb', 'id')
    expect(bleManager._readCharacteristicForService).toBeCalledWith('deviceId', 'serviceId', 'bbbb', 'id')
  })

  test('writeCharacteristicWithResponse', async () => {
    await service.writeCharacteristicWithResponse('bbbb', 'value', 'id')
    expect(bleManager._writeCharacteristicWithResponseForService).toBeCalledWith(
      'deviceId',
      'serviceId',
      'bbbb',
      'value',
      'id'
    )
  })

  test('writeCharacteristicWithoutResponse', async () => {
    await service.writeCharacteristicWithoutResponse('bbbb', 'value', 'id')
    expect(bleManager._writeCharacteristicWithoutResponseForService).toBeCalledWith(
      'deviceId',
      'serviceId',
      'bbbb',
      'value',
      'id'
    )
  })

  test('monitorCharacteristic', async () => {
    const listener = jest.fn()
    await service.monitorCharacteristic('bbbb', listener, 'id')
    expect(bleManager._monitorCharacteristicForService).toBeCalledWith('serviceId', 'bbbb', listener, 'id')
  })

  test('readDescriptorForCharacteristic', async () => {
    await service.readDescriptorForCharacteristic('characteristicUUID', 'descriptorUUID', 'transactionId')
    expect(bleManager._readDescriptorForService).toBeCalledWith(
      'deviceId',
      'serviceId',
      'characteristicUUID',
      'descriptorUUID',
      'transactionId'
    )
  })

  test('writeDescriptorForCharacteristic', async () => {
    await service.writeDescriptorForCharacteristic('characteristicUUID', 'descriptorUUID', 'value', 'transactionId')
    expect(bleManager._writeDescriptorForService).toBeCalledWith(
      'deviceId',
      'serviceId',
      'characteristicUUID',
      'descriptorUUID',
      'value',
      'transactionId'
    )
  })
})
