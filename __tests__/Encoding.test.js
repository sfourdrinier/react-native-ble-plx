const { base64ToBytes, bytesToBase64, roundTripBase64 } = require('../src/encoding')

describe('encoding (4.0 dual-path edge codecs)', () => {
  test('empty base64 ↔ empty bytes', () => {
    expect(Array.from(base64ToBytes(''))).toEqual([])
    expect(bytesToBase64(new Uint8Array(0))).toBe('')
  })

  test('known vector: "hi" / aGk=', () => {
    const bytes = base64ToBytes('aGk=')
    expect(Array.from(bytes)).toEqual([104, 105])
    expect(bytesToBase64(bytes)).toBe('aGk=')
  })

  test('roundTripBase64 is identity for standard vectors', () => {
    const vectors = ['', 'YQ==', 'YWI=', 'YWJj', 'aGk=', 'AAECAwQ=']
    for (const v of vectors) {
      expect(roundTripBase64(v)).toBe(v)
    }
  })

  test('rejects non-string / non-Uint8Array', () => {
    expect(() => base64ToBytes(null)).toThrow(TypeError)
    expect(() => bytesToBase64([])).toThrow(TypeError)
  })

  test('rejects invalid Base64 alphabet/padding (F112)', () => {
    expect(() => base64ToBytes('!!!!')).toThrow(TypeError)
    expect(() => base64ToBytes('aGk')).toThrow(TypeError) // missing padding
    expect(() => base64ToBytes('aGk===')).toThrow(TypeError)
    expect(() => base64ToBytes('not base64!!')).toThrow(TypeError)
  })

  test('chunked encode handles large payloads without throw (F112)', () => {
    const large = new Uint8Array(100_000)
    for (let i = 0; i < large.length; i++) large[i] = i & 0xff
    const b64 = bytesToBase64(large)
    expect(typeof b64).toBe('string')
    expect(b64.length).toBeGreaterThan(0)
    const back = base64ToBytes(b64)
    expect(back.length).toBe(large.length)
    expect(back[0]).toBe(large[0])
    expect(back[large.length - 1]).toBe(large[large.length - 1])
  })
})
