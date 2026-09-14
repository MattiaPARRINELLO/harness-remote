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
 *
 * NOTE: The ?directory= query parameter is OpenCode-specific. OpenCode ignores it when absent (all
 * sessions share the working directory). Mimocode (and other OpenCode-like backends) use it to
 * scope status reads to a specific project directory, matching the OpenCode convention. This test
 * verifies that the adapter always forwards the directory so both backends work correctly.
 */

globalThis.window ??= globalThis
globalThis.localStorage ??= {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
}

const { api } = await import('./api.ts')
const directories = []
let listStatusesCalls = 0
let statuses = {}
api.listStatuses = async (_config, directory) => {
  listStatusesCalls += 1
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

test('a cancelled Session is not resurrected by an external busy status', async () => {
  const registration = registerNativeSessionV3Adapter(target(), () => {})
  try {
    statuses = { s1: { type: 'busy' } }
    const busy = await registration.controller.refreshConversation(CONFIG, registration.conversation.id)
    assert.equal(busy.status, 'running', 'must adopt busy to running')

    const originalFetch = globalThis.fetch
    globalThis.fetch = async (_url, init) => {
      if (init?.method === 'POST' && String(_url).includes('/stop')) {
        return new Response(JSON.stringify({ status: 'accepted' }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return originalFetch?.(_url, init) ?? new Response('not found', { status: 404 })
    }
    try {
      await registration.controller.stopConversation(CONFIG, registration.conversation.id)
      await new Promise((resolve) => setTimeout(resolve, 10))
      assert.equal(registration.conversation.status, 'completed', 'cancelled must render as completed')

      statuses = { s1: { type: 'busy' } }
      const after = await registration.controller.refreshConversation(CONFIG, registration.conversation.id)
      assert.equal(after.status, 'cancelled', 'cancelled must stay cancelled when a subsequent busy edge arrives')
    } finally {
      globalThis.fetch = originalFetch
    }
  } finally {
    registration.dispose()
  }
})

test('listStatuses receives the directory for OpenCode-like backends', async () => {
  const registration = registerNativeSessionV3Adapter(target(), () => {})
  try {
    statuses = {}
    await registration.controller.refreshConversation(CONFIG, registration.conversation.id)
    assert.equal(directories.at(-1), '/repo', 'directory must be forwarded to the status endpoint')
  } finally {
    registration.dispose()
  }
})

test('an internal idle pre-Send OpenCode Session does not call listStatuses at all', async () => {
  const registration = registerNativeSessionV3Adapter(target({ external: false }), () => {})
  try {
    listStatusesCalls = 0
    statuses = { s1: { type: 'busy' } }
    await registration.controller.refreshConversation(CONFIG, registration.conversation.id)
    assert.equal(listStatusesCalls, 0, 'internal idle sessions must not call listStatuses (#351 contract)')
    assert.equal(registration.conversation.status, 'completed', 'must remain completed, not adopt the busy status')
  } finally {
    registration.dispose()
  }
})
