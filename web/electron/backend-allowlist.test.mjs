import assert from 'node:assert/strict'
import { test } from 'node:test'

const { validateDesktopProfile } = await import('../dist-electron/electron/profile-registry.js')

const baseProfile = {
  host: '127.0.0.1',
  port: 4096,
  username: 'user',
  password: 'secret'
}

test('profile registry accepts mimocode backend', () => {
  const profile = { ...baseProfile, id: 'mimocode-test', backend: 'mimocode' }
  const validated = validateDesktopProfile(profile)
  assert.equal(validated.backend, 'mimocode')
})

test('profile registry accepts all known backends', () => {
  for (const backend of ['opencode', 'mimocode', 'omp', 'pi', 'claude', 'codex']) {
    const profile = { ...baseProfile, id: `test-${backend}`, backend }
    const validated = validateDesktopProfile(profile)
    assert.equal(validated.backend, backend)
  }
})

test('profile registry rejects an unknown backend', () => {
  assert.throws(
    () => validateDesktopProfile({ ...baseProfile, id: 'unknown', backend: 'unknown' }),
    /backend/i
  )
})
