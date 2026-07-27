// src/tck/scenario-adapter.ts

import type { TckFact, TckScenarioDefinition } from './contracts'
import { TckAssertionError } from './contracts'

type RunnerControlledScenarioExecutor = (definition: TckScenarioDefinition) => Promise<readonly TckFact[]>

const runnerControlledExecutors = new WeakMap<TckScenarioAdapter, RunnerControlledScenarioExecutor>()

/**
 * Opaque capability issued only by a runner-owned scenario adapter.
 *
 * Backend fixtures may carry this token but cannot create a valid token or
 * attach execution behavior. The runner resolves it through its private
 * registry before it creates a public TCK receipt.
 */
export class TckScenarioAdapter {
  private constructor() {
    Object.freeze(this)
  }

  static createRunnerControlled(executor: RunnerControlledScenarioExecutor): TckScenarioAdapter {
    const adapter = new TckScenarioAdapter()
    runnerControlledExecutors.set(adapter, executor)
    return adapter
  }
}

/** Internal adapter-registration boundary. It is intentionally not exported by a package entrypoint. */
export function createRunnerControlledTckScenarioAdapter(
  executor: RunnerControlledScenarioExecutor
): TckScenarioAdapter {
  return TckScenarioAdapter.createRunnerControlled(executor)
}

/** Runs only behavior registered by a runner-controlled adapter. */
export async function executeRunnerControlledTckScenario(
  adapter: TckScenarioAdapter | undefined,
  definition: TckScenarioDefinition
): Promise<readonly TckFact[]> {
  if (adapter === undefined) {
    throw new TckAssertionError(definition.id, 'fixture lacks a runner-controlled scenario adapter')
  }
  const executor = runnerControlledExecutors.get(adapter)
  if (executor === undefined) {
    throw new TckAssertionError(definition.id, 'fixture supplied an unissued scenario adapter')
  }
  return executor(definition)
}
