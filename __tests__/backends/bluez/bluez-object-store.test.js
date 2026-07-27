// __tests__/backends/bluez/bluez-object-store.test.js

const { BluezObjectStore } = require('../../../src/backends/bluez/bluez-object-store')
const {
  BLUEZ_ADAPTER_INTERFACE,
  BLUEZ_DEVICE_INTERFACE,
  InMemoryBluezObjectManager
} = require('../../../test-support/bluez/in-memory-bluez-object-manager')

describe('BluezObjectStore', () => {
  test('subscribes before bootstrap and applies buffered signals in ingress order', async () => {
    const objectManager = new InMemoryBluezObjectManager([
      {
        path: '/org/bluez/hci0',
        interfaces: [
          {
            name: BLUEZ_ADAPTER_INTERFACE,
            properties: {
              Address: { signature: 's', value: '00:11:22:33:44:55' },
              Powered: { signature: 'b', value: true }
            }
          }
        ]
      }
    ])
    objectManager.pauseBootstrap()
    const storePromise = BluezObjectStore.open(objectManager)
    objectManager.emitInterfacesAdded('/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', [
      {
        name: BLUEZ_DEVICE_INTERFACE,
        properties: {
          Address: { signature: 's', value: 'AA:BB:CC:DD:EE:FF' },
          Connected: { signature: 'b', value: false }
        }
      }
    ])
    objectManager.emitPropertiesChanged('/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', BLUEZ_DEVICE_INTERFACE, {
      Connected: { signature: 'b', value: true }
    })
    objectManager.resumeBootstrap()

    const store = await storePromise

    expect(store.stringProperty('/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', BLUEZ_DEVICE_INTERFACE, 'Address')).toBe(
      'AA:BB:CC:DD:EE:FF'
    )
    expect(store.booleanProperty('/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF', BLUEZ_DEVICE_INTERFACE, 'Connected')).toBe(
      true
    )
    expect(objectManager.listenerCount()).toBe(3)

    store.close()
    expect(objectManager.listenerCount()).toBe(0)
  })

  test('removes interfaces and invalidates the object when its final interface disappears', async () => {
    const objectManager = new InMemoryBluezObjectManager([
      {
        path: '/org/bluez/hci0',
        interfaces: [
          {
            name: BLUEZ_ADAPTER_INTERFACE,
            properties: { Powered: { signature: 'b', value: true } }
          }
        ]
      }
    ])
    const store = await BluezObjectStore.open(objectManager)

    objectManager.emitInterfacesRemoved('/org/bluez/hci0', [BLUEZ_ADAPTER_INTERFACE])

    expect(store.hasObject('/org/bluez/hci0')).toBe(false)
    store.close()
    expect(objectManager.listenerCount()).toBe(0)
  })

  test('rejects a property whose runtime value violates its D-Bus signature', async () => {
    const objectManager = new InMemoryBluezObjectManager([
      {
        path: '/org/bluez/hci0',
        interfaces: [
          {
            name: BLUEZ_ADAPTER_INTERFACE,
            properties: { Powered: { signature: 'b', value: 'yes' } }
          }
        ]
      }
    ])

    await expect(BluezObjectStore.open(objectManager)).rejects.toThrow(
      'org.bluez.Adapter1.Powered expected D-Bus signature b with a boolean value'
    )
    expect(objectManager.listenerCount()).toBe(0)
  })
})
