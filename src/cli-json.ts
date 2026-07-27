// src/cli-json.ts

import type { SerializableRecord, SerializableValue } from './backend-contract/primitives'

const maximumJsonDepth = 64

/** Parses JSON without admitting untyped values into the public CLI boundary. */
export function parseCliJson(input: string): SerializableValue {
  const parser = new StrictJsonParser(input)
  const value = parser.parseValue(0)
  parser.skipWhitespace()
  if (!parser.finished()) {
    throw new CliJsonError(parser.offset, 'unexpected trailing input')
  }
  return value
}

export class CliJsonError extends Error {
  constructor(
    readonly offset: number,
    message: string
  ) {
    super(`JSON at offset ${offset}: ${message}`)
    this.name = 'CliJsonError'
  }
}

class StrictJsonParser {
  offset = 0

  constructor(private readonly input: string) {}

  finished(): boolean {
    return this.offset === this.input.length
  }

  skipWhitespace(): void {
    while (this.current() === ' ' || this.current() === '\n' || this.current() === '\r' || this.current() === '\t') {
      this.offset += 1
    }
  }

  parseValue(depth: number): SerializableValue {
    if (depth > maximumJsonDepth) {
      throw new CliJsonError(this.offset, `nesting exceeds ${maximumJsonDepth}`)
    }
    this.skipWhitespace()
    const character = this.current()
    if (character === '{') {
      return this.parseObject(depth + 1)
    }
    if (character === '[') {
      return this.parseArray(depth + 1)
    }
    if (character === '"') {
      return this.parseString()
    }
    if (character === '-' || isDigit(character)) {
      return this.parseNumber()
    }
    if (this.consumeLiteral('true')) {
      return true
    }
    if (this.consumeLiteral('false')) {
      return false
    }
    if (this.consumeLiteral('null')) {
      return null
    }
    throw new CliJsonError(this.offset, 'expected a JSON value')
  }

  private parseObject(depth: number): SerializableRecord {
    this.consume('{')
    this.skipWhitespace()
    const record: { [key: string]: SerializableValue } = {}
    if (this.current() === '}') {
      this.offset += 1
      return Object.freeze(record)
    }
    while (true) {
      this.skipWhitespace()
      if (this.current() !== '"') {
        throw new CliJsonError(this.offset, 'object key must be a string')
      }
      const key = this.parseString()
      if (Object.prototype.hasOwnProperty.call(record, key)) {
        throw new CliJsonError(this.offset, `duplicate object key ${key}`)
      }
      this.skipWhitespace()
      this.consume(':')
      record[key] = this.parseValue(depth)
      this.skipWhitespace()
      if (this.current() === '}') {
        this.offset += 1
        return Object.freeze(record)
      }
      this.consume(',')
    }
  }

  private parseArray(depth: number): readonly SerializableValue[] {
    this.consume('[')
    this.skipWhitespace()
    const values: SerializableValue[] = []
    if (this.current() === ']') {
      this.offset += 1
      return Object.freeze(values)
    }
    while (true) {
      values.push(this.parseValue(depth))
      this.skipWhitespace()
      if (this.current() === ']') {
        this.offset += 1
        return Object.freeze(values)
      }
      this.consume(',')
    }
  }

  private parseString(): string {
    this.consume('"')
    let value = ''
    while (true) {
      const character = this.current()
      if (character === undefined) {
        throw new CliJsonError(this.offset, 'unterminated string')
      }
      if (character === '"') {
        this.offset += 1
        return value
      }
      if (character === '\\') {
        this.offset += 1
        value += this.parseEscape()
        continue
      }
      if (character.charCodeAt(0) < 0x20) {
        throw new CliJsonError(this.offset, 'unescaped control character in string')
      }
      value += character
      this.offset += 1
    }
  }

  private parseEscape(): string {
    const escape = this.current()
    if (escape === undefined) {
      throw new CliJsonError(this.offset, 'unterminated escape sequence')
    }
    this.offset += 1
    if (escape === '"' || escape === '\\' || escape === '/') {
      return escape
    }
    if (escape === 'b') return '\b'
    if (escape === 'f') return '\f'
    if (escape === 'n') return '\n'
    if (escape === 'r') return '\r'
    if (escape === 't') return '\t'
    if (escape === 'u') {
      const hexadecimal = this.input.slice(this.offset, this.offset + 4)
      if (!/^[0-9a-fA-F]{4}$/.test(hexadecimal)) {
        throw new CliJsonError(this.offset, 'invalid unicode escape')
      }
      this.offset += 4
      return String.fromCharCode(Number.parseInt(hexadecimal, 16))
    }
    throw new CliJsonError(this.offset - 1, 'invalid escape sequence')
  }

  private parseNumber(): number {
    const match = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(this.input.slice(this.offset))
    if (match === null || match[0] === undefined) {
      throw new CliJsonError(this.offset, 'invalid number')
    }
    const token = match[0]
    const parsed = Number(token)
    if (!Number.isFinite(parsed)) {
      throw new CliJsonError(this.offset, 'number must be finite')
    }
    this.offset += token.length
    return parsed
  }

  private consume(expected: string): void {
    if (this.current() !== expected) {
      throw new CliJsonError(this.offset, `expected ${expected}`)
    }
    this.offset += 1
  }

  private consumeLiteral(literal: string): boolean {
    if (this.input.slice(this.offset, this.offset + literal.length) !== literal) {
      return false
    }
    this.offset += literal.length
    return true
  }

  private current(): string | undefined {
    return this.input[this.offset]
  }
}

function isDigit(value: string | undefined): boolean {
  return value !== undefined && value >= '0' && value <= '9'
}
