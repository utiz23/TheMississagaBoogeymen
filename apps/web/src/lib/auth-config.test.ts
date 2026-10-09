/**
 * Member-login contract (plan: docs/superpowers/plans/2026-10-09-member-logins-step-1.md).
 * Replaces the pre-launch "account system disabled" guards: logins are on, and
 * these pin what they must never become — password sign-in, an email scope, a
 * fallback secret, open sign-up.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DISABLED_AUTH_PATHS,
  DISCORD_SCOPES,
  loginErrorMessage,
  mapDiscordProfile,
  readAuthEnv,
} from './auth-config.ts'

const GOOD = {
  BETTER_AUTH_SECRET: 'x'.repeat(32),
  BETTER_AUTH_URL: 'https://boogeymen.app',
  DISCORD_CLIENT_ID: 'id',
  DISCORD_CLIENT_SECRET: 'secret',
}

void test('readAuthEnv accepts a complete https configuration', () => {
  const env = readAuthEnv(GOOD)
  assert.equal(env.baseURL, 'https://boogeymen.app')
  assert.equal(env.secret, GOOD.BETTER_AUTH_SECRET)
})

void test('readAuthEnv allows plain http only on localhost', () => {
  assert.equal(
    readAuthEnv({ ...GOOD, BETTER_AUTH_URL: 'http://localhost:3000' }).baseURL,
    'http://localhost:3000',
  )
  assert.throws(() => readAuthEnv({ ...GOOD, BETTER_AUTH_URL: 'http://boogeymen.app' }), /https/)
})

void test('readAuthEnv fails closed: no fallback secret, no missing credentials', () => {
  const { BETTER_AUTH_SECRET: _s, ...noSecret } = GOOD
  assert.throws(() => readAuthEnv(noSecret), /BETTER_AUTH_SECRET/)
  assert.throws(() => readAuthEnv({ ...GOOD, BETTER_AUTH_SECRET: 'short' }), /BETTER_AUTH_SECRET/)
  assert.throws(() => readAuthEnv({ ...GOOD, DISCORD_CLIENT_SECRET: '' }), /DISCORD/)
  assert.throws(() => readAuthEnv({ ...GOOD, BETTER_AUTH_URL: '' }), /BETTER_AUTH_URL/)
})

void test('Discord asks for identify only — never the email scope', () => {
  assert.deepEqual([...DISCORD_SCOPES], ['identify'])
})

void test('a Discord profile maps to an undeliverable, per-account address', () => {
  const user = mapDiscordProfile({ id: '123', username: 'silky', global_name: 'Silky' })
  assert.equal(user.email, 'discord-123@users.invalid')
  assert.equal(user.name, 'Silky')
  assert.equal(mapDiscordProfile({ id: '9', username: 'raw', global_name: null }).name, 'raw')
})

void test('password, reset, linking and self-edit endpoints are closed', () => {
  for (const path of [
    '/sign-up/email',
    '/sign-in/email',
    '/request-password-reset',
    '/reset-password',
    '/change-password',
    '/update-user',
    '/delete-user',
    '/link-social',
  ]) {
    assert.ok((DISABLED_AUTH_PATHS as readonly string[]).includes(path), `${path} must be disabled`)
  }
})

void test('login errors come from a fixed dictionary, never the raw code', () => {
  assert.equal(loginErrorMessage(null), null)
  assert.match(loginErrorMessage('invite_expired') ?? '', /expired/)
  const injected = loginErrorMessage('<script>alert(1)</script>')
  assert.ok(injected && !injected.includes('<script>'))
})

void test('the auth instance keeps the invite gate and no password sign-in', () => {
  const src = readFileSync(new URL('./auth.ts', import.meta.url), 'utf8')
  assert.match(src, /emailAndPassword:\s*\{\s*enabled:\s*false\s*\}/)
  assert.match(src, /disableImplicitSignUp:\s*true/)
  assert.match(src, /disableDefaultScope:\s*true/)
  assert.match(src, /accountLinking:\s*\{\s*enabled:\s*false\s*\}/)
  assert.match(src, /user:\s*\{\s*create:\s*\{\s*before:/, 'user.create.before is the invite gate')
  assert.doesNotMatch(src, /dev-only|change-me/i, 'no hardcoded fallback secret')
})
