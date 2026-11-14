import test from 'node:test'
import assert from 'node:assert/strict'
import { REPORTER_IDS } from '@eanhl/db/news'
import { loadPressConfig, loadPressDiscord } from './config.ts'

const GUILD = '111111111111111111'
const TEST_CH = '222222222222222222'
const LIVE_CH = '333333333333333333'
const GM = '444444444444444444'

const tokenVar = (id: string) => `PRESS_TOKEN_${id.toUpperCase()}`
const TOKENS = Object.fromEntries(REPORTER_IDS.map((id) => [tokenVar(id), `SECRET-TOKEN-${id}`]))

const DISCORD_ENV = {
  ...TOKENS,
  PRESS_GUILD_ID: GUILD,
  PRESS_TEST_CHANNEL_ID: TEST_CH,
  PRESS_LIVE_CHANNEL_ID: LIVE_CH,
  PRESS_GM_USER_ID: GM,
}
const FULL_ENV = {
  ...DISCORD_ENV,
  DISCORD_INTERNAL_TOKEN: 'x'.repeat(32),
  WEB_INTERNAL_URL: 'http://web:3000/',
  ANTHROPIC_API_KEY: 'sk-ant-SECRET-KEY-VALUE',
}

void test('no PRESS_MODE ⇒ trial, channel is the test channel', () => {
  const r = loadPressDiscord(DISCORD_ENV)
  assert.ok(r.ok)
  assert.equal(r.value.mode, 'trial')
  assert.equal(r.value.channelId, TEST_CH)
  assert.equal(r.value.guildId, GUILD)
  assert.equal(r.value.gmUserId, GM)
  assert.equal(r.value.tokens.rink, 'SECRET-TOKEN-rink')
  assert.deepEqual(Object.keys(r.value.tokens).sort(), [...REPORTER_IDS].sort())
})

void test('PRESS_MODE must be exactly "live"; LIVE, " live", true ⇒ trial', () => {
  for (const v of ['LIVE', ' live', 'live ', 'true', '1', '']) {
    const r = loadPressDiscord({ ...DISCORD_ENV, PRESS_MODE: v })
    assert.ok(r.ok, `PRESS_MODE=${v}`)
    assert.equal(r.value.mode, 'trial', `PRESS_MODE=${v}`)
    assert.equal(r.value.channelId, TEST_CH)
  }
})

void test('PRESS_MODE=live ⇒ channel is the live channel', () => {
  const r = loadPressDiscord({ ...DISCORD_ENV, PRESS_MODE: 'live' })
  assert.ok(r.ok)
  assert.equal(r.value.mode, 'live')
  assert.equal(r.value.channelId, LIVE_CH)
})

void test('missing token ⇒ names the variable, never any token value', () => {
  const env: Record<string, string | undefined> = { ...DISCORD_ENV }
  delete env['PRESS_TOKEN_RINK']
  const r = loadPressDiscord(env)
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.deepEqual(r.problems, ['PRESS_TOKEN_RINK is unset'])
  assert.ok(!r.problems.join('\n').includes('SECRET-TOKEN'))
})

void test('blank token counts as unset', () => {
  const r = loadPressDiscord({ ...DISCORD_ENV, PRESS_TOKEN_VOSS: '   ' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.deepEqual(r.problems, ['PRESS_TOKEN_VOSS is unset'])
})

void test('bad snowflake IDs ⇒ problems name the variable, never the value', () => {
  const r = loadPressDiscord({
    ...DISCORD_ENV,
    PRESS_GUILD_ID: 'not-an-id-GUILD',
    PRESS_TEST_CHANNEL_ID: '123',
    PRESS_GM_USER_ID: '',
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.problems.length, 3)
  for (const name of ['PRESS_GUILD_ID', 'PRESS_TEST_CHANNEL_ID', 'PRESS_GM_USER_ID']) {
    assert.ok(
      r.problems.some((p) => p.startsWith(name)),
      name,
    )
  }
  const text = r.problems.join('\n')
  assert.ok(!text.includes('not-an-id-GUILD') && !text.includes('123'))
})

void test('trial does not need the live channel; live does not need the test channel', () => {
  const noLive: Record<string, string | undefined> = { ...DISCORD_ENV }
  delete noLive['PRESS_LIVE_CHANNEL_ID']
  assert.ok(loadPressDiscord(noLive).ok)
  const noTest: Record<string, string | undefined> = { ...DISCORD_ENV, PRESS_MODE: 'live' }
  delete noTest['PRESS_TEST_CHANNEL_ID']
  assert.ok(loadPressDiscord(noTest).ok)
  // ...but each mode needs its own channel.
  const liveNoLive: Record<string, string | undefined> = { ...DISCORD_ENV, PRESS_MODE: 'live' }
  delete liveNoLive['PRESS_LIVE_CHANNEL_ID']
  const r = loadPressDiscord(liveNoLive)
  assert.equal(r.ok, false)
  if (!r.ok) assert.deepEqual(r.problems, ['PRESS_LIVE_CHANNEL_ID is unset or not a Discord ID'])
})

void test('loadPressConfig: defaults applied, API key not stored', () => {
  const r = loadPressConfig(FULL_ENV)
  assert.ok(r.ok)
  assert.equal(r.config.mode, 'trial')
  assert.equal(r.config.internalToken, 'x'.repeat(32))
  assert.equal(r.config.webBaseUrl, 'http://web:3000')
  assert.equal(r.config.siteUrl, 'https://boogeymen.app')
  assert.equal(r.config.model, 'claude-opus-5-5')
  assert.equal(r.config.monthlyLimitUsd, 20)
  assert.equal(r.config.pollIntervalMs, 15000)
  assert.ok(!JSON.stringify(r.config).includes('sk-ant'))
})

void test('loadPressConfig: overrides', () => {
  const r = loadPressConfig({
    ...FULL_ENV,
    PRESS_POLL_INTERVAL_MS: '5000',
    NEWS_MODEL: 'm',
    NEWS_MONTHLY_LIMIT_USD: '7.5',
    DISCORD_SITE_URL: 'https://example.test/',
  })
  assert.ok(r.ok)
  assert.equal(r.config.pollIntervalMs, 5000)
  assert.equal(r.config.model, 'm')
  assert.equal(r.config.monthlyLimitUsd, 7.5)
  assert.equal(r.config.siteUrl, 'https://example.test')
})

void test('loadPressConfig: collects discord and shared problems, no secret values', () => {
  const r = loadPressConfig({
    ...FULL_ENV,
    PRESS_TOKEN_QUILL: undefined,
    ANTHROPIC_API_KEY: ' ',
    DISCORD_INTERNAL_TOKEN: 'short',
    WEB_INTERNAL_URL: '',
  })
  assert.equal(r.ok, false)
  if (r.ok) return
  const text = r.problems.join('\n')
  for (const name of [
    'PRESS_TOKEN_QUILL',
    'ANTHROPIC_API_KEY',
    'DISCORD_INTERNAL_TOKEN',
    'WEB_INTERNAL_URL',
  ]) {
    assert.ok(text.includes(name), name)
  }
  assert.ok(!text.includes('SECRET'))
})

void test('PRESS_TYPED_ANSWERS: on only for exactly "1"; unset, 0, true, yes ⇒ off', () => {
  const on = loadPressConfig({ ...FULL_ENV, PRESS_TYPED_ANSWERS: '1' })
  assert.ok(on.ok)
  assert.equal(on.config.typedAnswers, true)
  assert.equal(loadPressConfig({ ...FULL_ENV, PRESS_TYPED_ANSWERS: ' 1 ' }).ok, true)
  for (const v of [undefined, '', '0', 'true', 'yes', 'on', '11']) {
    const r = loadPressConfig({ ...FULL_ENV, PRESS_TYPED_ANSWERS: v })
    assert.ok(r.ok, `PRESS_TYPED_ANSWERS=${String(v)}`)
    assert.equal(r.config.typedAnswers, false, `PRESS_TYPED_ANSWERS=${String(v)}`)
  }
})

void test('PRESS_WIRE_REPLIES: on only for exactly "1" and only with PRESS_TYPED_ANSWERS=1', () => {
  const both = loadPressConfig({ ...FULL_ENV, PRESS_TYPED_ANSWERS: '1', PRESS_WIRE_REPLIES: '1' })
  assert.ok(both.ok)
  assert.equal(both.config.wireReplies, true)
  const noTyped = loadPressConfig({ ...FULL_ENV, PRESS_WIRE_REPLIES: '1' })
  assert.ok(noTyped.ok)
  assert.equal(noTyped.config.wireReplies, false)
  for (const v of [undefined, '', '0', 'true', 'yes']) {
    const r = loadPressConfig({ ...FULL_ENV, PRESS_TYPED_ANSWERS: '1', PRESS_WIRE_REPLIES: v })
    assert.ok(r.ok)
    assert.equal(r.config.wireReplies, false, `PRESS_WIRE_REPLIES=${String(v)}`)
  }
})
