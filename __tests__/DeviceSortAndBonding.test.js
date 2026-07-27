// __tests__/DeviceSortAndBonding.test.js

/**
 * Device list sorting + FakeBlePort simulated bonding (paired list / unpair).
 */
const { sortDevices } = require('../src/discovery/deviceSort')
const { FakeBlePort } = require('../src/port/BlePort')
const { PortBleManager } = require('../src/port/PortBleManager')
const { BleErrorCode } = require('../src/BleError')

describe('sortDevices (package helper)', () => {
  const devices = [
    { id: 'a', name: 'Zebra', rssi: -70, lastSeen: 100 },
    { id: 'b', name: 'Alpha', rssi: -40, lastSeen: 300 },
    { id: 'c', name: null, rssi: -55, lastSeen: 200 }
  ]

  test('sort by rssi descending (strongest first)', () => {
    const s = sortDevices(devices, { key: 'rssi', order: 'desc' })
    expect(s.map(d => d.id)).toEqual(['b', 'c', 'a'])
  })

  test('sort by name ascending (null names last)', () => {
    const s = sortDevices(devices, { key: 'name', order: 'asc' })
    expect(s[0].id).toBe('b')
    expect(s[1].id).toBe('a')
    expect(s[2].id).toBe('c')
  })

  test('sort by lastSeen descending', () => {
    const s = sortDevices(devices, { key: 'lastSeen' })
    expect(s.map(d => d.id)).toEqual(['b', 'c', 'a'])
  })

  test('does not mutate input', () => {
    const copy = devices.slice()
    sortDevices(devices, { key: 'rssi' })
    expect(devices.map(d => d.id)).toEqual(copy.map(d => d.id))
  })
})

describe('FakeBlePort bonding list', () => {
  test('createBond / listBondedDevices / removeBond', async () => {
    const port = new FakeBlePort({
      advertisements: [
        { id: 'polar-1', name: 'Polar H10', rssi: -50 },
        { id: 'other', name: 'Other', rssi: -60 }
      ]
    })
    const mgr = new PortBleManager({ port, host: 'fake' })
    expect(mgr.supports('bonding')).toBe(true)
    expect(await mgr.bondedDevices()).toEqual([])
    await mgr.createBond('polar-1')
    expect(await mgr.getBondState('polar-1')).toBe('bonded')
    const list = await mgr.bondedDevices()
    // Prefer seed / advertisement casing over normalized map keys
    expect(list).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'polar-1', name: 'Polar H10' })]))
    await mgr.removeBond('polar-1')
    expect(await mgr.getBondState('polar-1')).toBe('none')
    expect(await mgr.bondedDevices()).toEqual([])
  })

  test('electron host rejects bonding even with FakeBlePort (R2-F029/R2-F114)', async () => {
    const port = new FakeBlePort({
      advertisements: [{ id: 'polar-1', name: 'Polar H10', rssi: -50 }]
    })
    const mgr = new PortBleManager({ port, host: 'electron' })
    expect(mgr.supports('bonding')).toBe(false)
    await expect(mgr.createBond('polar-1')).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })
    await expect(mgr.bondedDevices()).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })
    await expect(mgr.getBondState('polar-1')).rejects.toMatchObject({
      errorCode: BleErrorCode.OperationNotSupported
    })
  })
})
