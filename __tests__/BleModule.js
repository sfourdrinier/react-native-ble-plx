// __tests__/BleModule.js
import { BleModule } from '../src/BleModule'
import NativeBlePlx from '../src/NativeBlePlx'

describe('BleModule', () => {
  test('retains non-enumerable TurboModule methods', () => {
    expect(BleModule.createClient).toBe(NativeBlePlx.createClient)

    BleModule.createClient('test-restoration-id')

    expect(NativeBlePlx.createClient).toHaveBeenCalledWith('test-restoration-id')
  })
})
