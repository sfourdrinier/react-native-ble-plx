// scripts/native-protocol/generate-native-protocol.js

'use strict'

const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '../..')
const schemaPath = path.join(root, 'native/protocol/schema/native-protocol-v1.json')
const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'))
const abiManifestPath = path.join(path.dirname(schemaPath), schema.abiManifest)
const abiManifest = JSON.parse(fs.readFileSync(abiManifestPath, 'utf8'))
const checkOnly = process.argv.includes('--check')

function requireWireId(mapping, name, context) {
  const value = mapping[name]
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`Native Protocol ABI manifest has no valid wire ID for ${context} ${name}`)
  }
  return value
}

function validateAbiManifest() {
  if (abiManifest.version !== schema.abiVersion) {
    throw new Error('Native Protocol ABI manifest version does not match schema abiVersion')
  }
  for (const recordKind of schema.recordKinds) {
    requireWireId(abiManifest.recordKinds, recordKind, 'record kind')
  }
  for (const [enumName, values] of enumEntries()) {
    const manifestValues = abiManifest.enums[enumName]
    if (manifestValues === undefined) {
      throw new Error(`Native Protocol ABI manifest is missing enum ${enumName}`)
    }
    for (const value of values) {
      requireWireId(manifestValues, value, `${enumName} enum value`)
    }
  }
  for (const record of schema.records) {
    const manifestFields = abiManifest.fields[record.name]
    if (manifestFields === undefined) {
      throw new Error(`Native Protocol ABI manifest is missing record ${record.name}`)
    }
    for (const [name] of record.fields) {
      requireWireId(manifestFields, name, `${record.name} field`)
    }
  }
}

function pascal(value) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function screamingSnake(value) {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase()
}

function quote(value) {
  return JSON.stringify(value)
}

function enumWireIds(name) {
  return name === 'recordKind' ? abiManifest.recordKinds : abiManifest.enums[name]
}

function cppEnum(name, values) {
  const wireIds = enumWireIds(name)
  return `enum class ${pascal(name)} : std::uint16_t {\n${values
    .map(value => `  ${value} = ${String(requireWireId(wireIds, value, name))}U`)
    .join(',\n')}\n};`
}

function kotlinEnum(name, values) {
  const wireIds = enumWireIds(name)
  return `enum class ${pascal(name)}(val wireValue: Int) {\n${values
    .map(value => `  ${screamingSnake(value)}(${String(requireWireId(wireIds, value, name))})`)
    .join(',\n')}\n}`
}

function swiftEnum(name, values) {
  const wireIds = enumWireIds(name)
  return `public enum ${pascal(name)}: UInt16, CaseIterable, Sendable {\n${values
    .map(value => `  case ${value} = ${String(requireWireId(wireIds, value, name))}`)
    .join('\n')}\n}`
}

function enumEntries() {
  return Object.entries(schema).filter(
    ([name, value]) => name !== 'recordKinds' && name !== 'records' && Array.isArray(value)
  )
}

function cppOutput() {
  const recordKinds = schema.recordKinds
    .map(value => `  RecordKindDescriptor{RecordKind::${value}, ${quote(value)}}`)
    .join(',\n')
  const enums = enumEntries()
    .map(([name, values]) => cppEnum(name, values))
    .join('\n\n')
  const enumValues = enumEntries()
    .flatMap(([name, values]) => values.map(value => `  EnumValueDescriptor{${quote(name)}, ${quote(value)}}`))
    .join(',\n')
  const fields = schema.records
    .flatMap(record =>
      record.fields.map(
        ([name, type, required]) =>
          `  FieldDescriptor{RecordKind::${record.name}, ${String(
            requireWireId(abiManifest.fields[record.name], name, `${record.name} field`)
          )}U, ${quote(name)}, ${quote(
            type
          )}, ${required ? 'true' : 'false'}}`
      )
    )
    .join(',\n')
  return `// native/protocol/generated/NativeProtocolV1Schema.hpp

#pragma once

#include <array>
#include <cstddef>
#include <cstdint>
#include <string_view>

namespace unified_ble::native_protocol::v1 {

inline constexpr std::uint32_t kProtocolVersion = ${String(schema.version)}U;
inline constexpr std::uint32_t kAbiVersion = ${String(schema.abiVersion)}U;
inline constexpr std::size_t kMaximumControlRecordBytes = ${String(schema.maximumControlRecordBytes)}U;
inline constexpr std::size_t kMaximumBinaryPayloadBytes = ${String(schema.maximumBinaryPayloadBytes)}U;

${cppEnum('recordKind', schema.recordKinds)}

${enums}

struct FieldDescriptor {
  RecordKind record;
  std::uint16_t fieldId;
  std::string_view name;
  std::string_view type;
  bool required;
};

struct EnumValueDescriptor {
  std::string_view type;
  std::string_view value;
};

struct RecordKindDescriptor {
  RecordKind kind;
  std::string_view name;
};

inline constexpr std::array<RecordKindDescriptor, ${String(schema.recordKinds.length)}> kRecordKindDescriptors{{
${recordKinds}
}};

inline constexpr std::array<FieldDescriptor, ${String(
    schema.records.reduce((total, record) => total + record.fields.length, 0)
  )}> kFieldDescriptors{{
${fields}
}};

inline constexpr std::array<EnumValueDescriptor, ${String(
    enumEntries().reduce((total, [, values]) => total + values.length, 0)
  )}> kEnumValueDescriptors{{
${enumValues}
}};

} // namespace unified_ble::native_protocol::v1
`
}

function kotlinOutput() {
  const enums = enumEntries()
    .map(([name, values]) => kotlinEnum(name, values))
    .join('\n\n')
  const fields = schema.records
    .flatMap(record =>
      record.fields.map(
        ([name, type, required]) =>
          `    FieldDescriptor(RecordKind.${screamingSnake(record.name)}, ${String(
            requireWireId(abiManifest.fields[record.name], name, `${record.name} field`)
          )}, ${quote(
            name
          )}, ${quote(type)}, ${required ? 'true' : 'false'})`
      )
    )
    .join(',\n')
  return `// android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/generated/NativeProtocolV1Schema.kt

package com.sfourdrinier.unifiedblemanager.protocol.generated

const val NATIVE_PROTOCOL_VERSION: Int = ${String(schema.version)}
const val NATIVE_PROTOCOL_ABI_VERSION: Int = ${String(schema.abiVersion)}
const val MAXIMUM_CONTROL_RECORD_BYTES: Int = ${String(schema.maximumControlRecordBytes)}
const val MAXIMUM_BINARY_PAYLOAD_BYTES: Int = ${String(schema.maximumBinaryPayloadBytes)}

${kotlinEnum('recordKind', schema.recordKinds)}

${enums}

data class FieldDescriptor(
  val record: RecordKind,
  val fieldId: Int,
  val name: String,
  val type: String,
  val required: Boolean
)

val NATIVE_PROTOCOL_FIELDS: List<FieldDescriptor> = listOf(
${fields}
)
`
}

function swiftOutput() {
  const enums = enumEntries()
    .map(([name, values]) => swiftEnum(name, values))
    .join('\n\n')
  const fields = schema.records
    .flatMap(record =>
      record.fields.map(
        ([name, type, required]) =>
          `    FieldDescriptor(record: .${record.name}, fieldID: ${String(
            requireWireId(abiManifest.fields[record.name], name, `${record.name} field`)
          )}, name: ${quote(
            name
          )}, type: ${quote(type)}, required: ${required ? 'true' : 'false'})`
      )
    )
    .join(',\n')
  return `// ios/Generated/NativeProtocolV1Schema.swift

import Foundation

public let nativeProtocolVersion: UInt32 = ${String(schema.version)}
public let nativeProtocolABIVersion: UInt32 = ${String(schema.abiVersion)}
public let maximumControlRecordBytes: Int = ${String(schema.maximumControlRecordBytes)}
public let maximumBinaryPayloadBytes: Int = ${String(schema.maximumBinaryPayloadBytes)}

${swiftEnum('recordKind', schema.recordKinds)}

${enums}

public struct FieldDescriptor: Equatable, Sendable {
  public let record: RecordKind
  public let fieldID: UInt16
  public let name: String
  public let type: String
  public let required: Bool
}

public let nativeProtocolFields: [FieldDescriptor] = [
${fields}
]
`
}

function typescriptSchemaOutput() {
  const enumConstants = enumEntries()
    .map(
      ([name, values]) =>
        `export const ${name} = Object.freeze([${values.map(value => quote(value)).join(', ')}])\nexport type ${pascal(
          name
        )} = (typeof ${name})[number]`
    )
    .join('\n\n')
  return `// src/native-protocol/generated/native-protocol-v1-schema.ts

export const NATIVE_PROTOCOL_VERSION = ${String(schema.version)}
export const NATIVE_PROTOCOL_ABI_VERSION = ${String(schema.abiVersion)}
export const MAXIMUM_CONTROL_RECORD_BYTES = ${String(schema.maximumControlRecordBytes)}
export const MAXIMUM_BINARY_PAYLOAD_BYTES = ${String(schema.maximumBinaryPayloadBytes)}

export const recordKinds = Object.freeze([${schema.recordKinds.map(value => quote(value)).join(', ')}])
export type RecordKind = (typeof recordKinds)[number]

export const nativeProtocolRecordWireIds: Readonly<Record<RecordKind, number>> = Object.freeze(${JSON.stringify(
  abiManifest.recordKinds
)})

export const nativeProtocolEnumValues: Readonly<Record<string, readonly string[]>> = Object.freeze(${JSON.stringify(
  Object.fromEntries(enumEntries())
)})

${enumConstants}

export type NativeProtocolFieldDescriptor = readonly [
  record: RecordKind,
  fieldId: number,
  name: string,
  type: string,
  required: boolean
]

function nativeProtocolField(
  record: RecordKind,
  fieldId: number,
  name: string,
  type: string,
  required: boolean
): NativeProtocolFieldDescriptor {
  return Object.freeze([record, fieldId, name, type, required])
}

export const nativeProtocolFields: readonly NativeProtocolFieldDescriptor[] = Object.freeze([
${schema.records
  .flatMap(record =>
    record.fields.map(
      ([name, type, required]) =>
        `  nativeProtocolField(${quote(record.name)}, ${String(
          requireWireId(abiManifest.fields[record.name], name, `${record.name} field`)
        )}, ${quote(name)}, ${quote(type)}, ${
          required ? 'true' : 'false'
        })`
    )
  )
  .join(',\n')}
])
`
}

function codegenOutput() {
  return `// src/NativeUnifiedBleProtocolControl.ts

import type { TurboModule } from 'react-native'
import { TurboModuleRegistry } from 'react-native'

export interface NativeProtocolVersionRange {
  minimum: number
  maximum: number
}

export interface NativeProtocolHandshakeRequest {
  nativeProtocol: NativeProtocolVersionRange
  abi: NativeProtocolVersionRange
  backendContract: NativeProtocolVersionRange
  capabilitySchema: NativeProtocolVersionRange
  eventSchema: NativeProtocolVersionRange
  traceFormat: NativeProtocolVersionRange
  attachmentId: string
  backendInstanceId: string
  backendGeneration: string
  adapterId: string
  adapterGeneration: string
  ownerId: string
}

export interface NativeProtocolHandshakeResult {
  nativeProtocol: number
  abi: number
  backendContract: number
  capabilitySchema: number
  eventSchema: number
  traceFormat: number
  maximumControlRecordBytes: number
  maximumBinaryPayloadBytes: number
}

export interface NativeAttachmentIdentity {
  attachmentId: string
  backendInstanceId: string
  backendGeneration: string
  adapterId: string
  adapterGeneration: string
}

export interface NativeOperationCorrelation {
  attachment: NativeAttachmentIdentity
  dispatchEpoch: number
  nonce: string
}

export type NativeRestorationOutcome =
  | 'adopted'
  | 'alreadyConsumed'
  | 'attachmentMismatch'
  | 'backendMismatch'
  | 'namespaceMismatch'
  | 'epochMismatch'

export type NativeCancellationState = 'cancellationRequested' | 'alreadyTerminal' | 'notCancellable'

export interface NativeRestorationAdoptionRequest {
  namespaceValue: string
  attachmentId: string
  expectedBackendInstanceId: string
  expectedEpoch: string
  nativeProtocolMinimum: number
  nativeProtocolMaximum: number
  clientId: string
  hostSessionScope: string
}

export interface NativeRestorationAdoptionControlResult {
  receiptId: string
  outcome: NativeRestorationOutcome
  replayRecordCount: number
}

export interface NativeCancellationControlResult {
  state: NativeCancellationState
}

export interface Spec extends TurboModule {
  handshake(request: NativeProtocolHandshakeRequest): Promise<NativeProtocolHandshakeResult>
  installExecutionRuntime(): Promise<void>
  cancelOperation(correlation: NativeOperationCorrelation): Promise<NativeCancellationControlResult>
  adoptRestoration(request: NativeRestorationAdoptionRequest): Promise<NativeRestorationAdoptionControlResult>
  closeAttachment(attachment: NativeAttachmentIdentity): Promise<void>
}

export default TurboModuleRegistry.getEnforcing<Spec>('UnifiedBleProtocolControl')
`
}

async function main() {
  validateAbiManifest()
  const prettier = await import('prettier')
  const outputs = new Map([
    ['native/protocol/generated/NativeProtocolV1Schema.hpp', cppOutput()],
    [
      'android/src/main/java/com/sfourdrinier/unifiedblemanager/protocol/generated/NativeProtocolV1Schema.kt',
      kotlinOutput()
    ],
    ['ios/Generated/NativeProtocolV1Schema.swift', swiftOutput()],
    ['src/native-protocol/generated/native-protocol-v1-schema.ts', typescriptSchemaOutput()],
    ['src/NativeUnifiedBleProtocolControl.ts', codegenOutput()]
  ])

  let drift = false
  for (const [relativePath, unformattedContent] of outputs) {
    const target = path.join(root, relativePath)
    let content = unformattedContent
    if (relativePath.endsWith('.ts')) {
      const prettierConfig = (await prettier.resolveConfig(target)) ?? {}
      content = await prettier.format(unformattedContent, { ...prettierConfig, filepath: target })
    }
    if (checkOnly) {
      if (!fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== content) {
        console.error(`Generated native protocol binding is stale: ${relativePath}`)
        drift = true
      }
      continue
    }
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }

  if (drift) {
    process.exitCode = 1
  }
}

void main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
