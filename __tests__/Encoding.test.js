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
})
