// android/src/main/java/com/sfourdrinier/unifiedblemanager/radio/OwnedAdapterLifecycleCoordinator.kt

package com.sfourdrinier.unifiedblemanager.radio

/**
 * Owns the current adapter generation and the monitor generation for each notify key.
 *
 * Android can complete a binder callback after the corresponding JS transaction has been
 * cancelled, replaced, or destroyed. Callers must retain an ownership token and revalidate it
 * immediately before delivering an asynchronous result to JavaScript.
 */
internal class OwnedAdapterLifecycleCoordinator {
  private val lock = Any()
  private var clientGeneration = 0L
  private var active = false
  private var nextMonitorGeneration = 0L
  private val monitorGenerationsByKey = mutableMapOf<String, Long>()

  fun activate(): OwnedClientOwnership = synchronized(lock) {
    clientGeneration += 1
    active = true
    monitorGenerationsByKey.clear()
    OwnedClientOwnership(clientGeneration)
  }

  fun acquireOperation(): OwnedOperationOwnership? = synchronized(lock) {
    if (!active) {
      null
    } else {
      OwnedOperationOwnership(clientGeneration)
    }
  }

  fun reserveMonitor(notifyKey: String): OwnedMonitorOwnership? = synchronized(lock) {
    if (!active) {
      null
    } else {
      nextMonitorGeneration += 1
      monitorGenerationsByKey[notifyKey] = nextMonitorGeneration
      OwnedMonitorOwnership(clientGeneration, notifyKey, nextMonitorGeneration)
    }
  }

  /** Stops new work and makes all queued callback deliveries ineligible. */
  fun stopAdmission() = synchronized(lock) {
    active = false
  }

  /** Clears the retired generation after terminal callbacks have been claimed. */
  fun invalidateRetiredGeneration() = synchronized(lock) {
    monitorGenerationsByKey.clear()
    clientGeneration += 1
  }

  /** Test/pure-coordinator convenience for a terminal close with no adapter-owned callbacks. */
  fun close() {
    stopAdmission()
    invalidateRetiredGeneration()
  }

  fun owns(ownership: OwnedLifecycleOwnership?): Boolean = synchronized(lock) {
    when (ownership) {
      null -> false
      is OwnedClientOwnership -> active && ownership.clientGeneration == clientGeneration
      is OwnedOperationOwnership -> active && ownership.clientGeneration == clientGeneration
      is OwnedMonitorOwnership ->
        active &&
          ownership.clientGeneration == clientGeneration &&
          monitorGenerationsByKey[ownership.notifyKey] == ownership.monitorGeneration
    }
  }

  /**
   * Releases a monitor token exactly once. This remains valid after [stopAdmission] so destroy
   * can explicitly account for each terminal monitor result before retiring the generation.
   */
  fun releaseMonitor(ownership: OwnedMonitorOwnership?): Boolean = synchronized(lock) {
    if (
      ownership == null ||
        ownership.clientGeneration != clientGeneration ||
        monitorGenerationsByKey[ownership.notifyKey] != ownership.monitorGeneration
    ) {
      false
    } else {
      monitorGenerationsByKey.remove(ownership.notifyKey)
      true
    }
  }
}

internal sealed interface OwnedLifecycleOwnership {
  val clientGeneration: Long
}

internal data class OwnedClientOwnership(
  override val clientGeneration: Long
) : OwnedLifecycleOwnership

internal data class OwnedOperationOwnership(
  override val clientGeneration: Long
) : OwnedLifecycleOwnership

internal data class OwnedMonitorOwnership(
  override val clientGeneration: Long,
  val notifyKey: String,
  val monitorGeneration: Long
) : OwnedLifecycleOwnership
