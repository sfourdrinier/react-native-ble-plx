// android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/GattOccurrenceResolver.kt

package com.sfourdrinier.unifiedblemanager.radio

import java.util.UUID

/** Returns the next zero-based ordinal for [uuid] and advances its sibling count. */
internal fun nextUuidOccurrence(counts: MutableMap<UUID, Int>, uuid: UUID): Int {
  val occurrence = counts[uuid] ?: 0
  counts[uuid] = occurrence + 1
  return occurrence
}

/** Resolves the zero-based ordinal of an item among siblings sharing its UUID. */
internal fun <T> resolveUuidOccurrence(
  siblings: List<T>,
  expectedUuid: UUID,
  occurrence: Int,
  uuidOf: (T) -> UUID
): T? {
  if (occurrence < 0) return null
  var matchingOccurrence = 0
  for (sibling in siblings) {
    if (uuidOf(sibling) != expectedUuid) continue
    if (matchingOccurrence == occurrence) return sibling
    matchingOccurrence += 1
  }
  return null
}
