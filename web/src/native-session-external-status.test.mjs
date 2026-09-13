import assert from 'node:assert/strict'
import test from 'node:test'

/*
 * A Session can be busy without the app ever having sent the prompt: the terminal is attached to the
 * same managed server, so its turn is authoritative even though HR has no local request identity.
 *
 * The status endpoint is directory-scoped on OpenCode. Reading it without the directory makes every
 * child Session look idle, so a busy external turn rendered as completed and the transcript heuristic
 * painted a false "Response interrupted" while the agent was still working. These guards keep the
 * directory in the read and keep the busy edge able to adopt the turn.
 */

globalThis.window ??= globalThis
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
}

const { api } = await import('./api.ts')
const directories = []
let statuses = {}
api.listStatuses = async (_config, directory) => {
  directories.push(directory)
  return statuses
}
api.loadMessagePage = async () => ({ messages: [], hasMore: false })

const { registerNativeSessionV3Adapter } = await import('./native-session-v3-adapter.ts')

const CONFIG = { backend: 'opencode', host: '127.0.0.1', port: 4098, username: 'harness', password: 'pw', agentId: 'opencode' }

function target(overrides = {}) {
  return {
    key: 'machine:opencode:s1',
    ref: { machineID: 'machine', agentID: 'opencode', sessionID: 's1', directory: '/repo' },
    machineID: 'machine',
    agentID: 'opencode',
    agentLabel: 'OpenCode',
    backend: 'opencode',
    transport: 'http',
    sessionID: 's1',
    directory: '/repo',
    title: 'Session',
    external: true,
    modelsSupported: true,
    model: null,
    requiresExplicitClaim: false,
    canStop: true,
    config: CONFIG,
    status: { type: 'idle' },
    ...overrides
  }
}

test('a busy status adopts an OpenCode Session that was started outside the app', async () => {
  const registration = registerNativeSessionV3Adapter(target(), () => {})
  try {
    statuses = { s1: { type: 'busy' } }
    const busy = await registration.controller.refreshConversation(CONFIG, registration.conversation.id)
    assert.equal(busy.status, 'running', 'an externally busy Session must render as working')
    assert.equal(directories.at(-1), '/repo', 'the status read must forward the Session directory')
  } finally {
    registration.dispose()
  }
})

test('an idle external Session settles back to completed', async () => {
  const registration = registerNativeSessionV3Adapter(target(), () => {})
  try {
    statuses = { s1: { type: 'busy' } }
    const busy = await registration.controller.refreshConversation(CONFIG, registration.conversation.id)
    assert.equal(busy.status, 'running')

    statuses = { s1: { type: 'idle' } }
    await registration.controller.refreshConversation(CONFIG, registration.conversation.id)
    await new Promise((resolve) => setTimeout(resolve, 800))
    const settled = await registration.controller.refreshConversation(CONFIG, registration.conversation.id)
    assert.equal(settled.status, 'completed', 'a confirmed idle edge must finish the external turn')
  } finally {
    registration.dispose()
  }
})
