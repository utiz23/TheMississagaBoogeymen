import test from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from './config.ts'

const TOKEN = 'a'.repeat(32)
const HOOK = 'https://discord.com/api/webhooks/123/abc'

void test('live config (explicit DISCORD_DRY_RUN=0) with defaults', () => {
  const r = loadConfig({
    DISCORD_DRY_RUN: '0',
    DISCORD_WEBHOOK_URL: HOOK,
    DISCORD_INTERNAL_TOKEN: TOKEN,
    WEB_INTERNAL_URL: 'http://web:3000/',
  })
  assert.ok(r.ok)
  assert.equal(r.config.dryRun, false)
  assert.equal(r.config.webBaseUrl, 'http://web:3000')
  assert.equal(r.config.siteUrl, 'https://boogeymen.app')
  assert.equal(r.config.pollIntervalMs, 60000)
})

void test('no webhook and no dry run ⇒ idle (a host nobody opted in never posts)', () => {
  const r = loadConfig({
    DISCORD_DRY_RUN: '0',
    DISCORD_INTERNAL_TOKEN: TOKEN,
    WEB_INTERNAL_URL: 'http://web:3000',
  })
  assert.equal(r.ok, false)
})

void test('dry run unless DISCORD_DRY_RUN is exactly 0 (unset, true, 1, yes all dry)', () => {
  for (const v of [undefined, '', '1', 'true', 'yes', ' 1 ', 'false']) {
    const r = loadConfig({
      DISCORD_DRY_RUN: v,
      DISCORD_WEBHOOK_URL: HOOK,
      DISCORD_INTERNAL_TOKEN: TOKEN,
      WEB_INTERNAL_URL: 'http://web:3000',
    })
    assert.ok(r.ok)
    assert.equal(r.config.dryRun, true, `DISCORD_DRY_RUN=${String(v)}`)
  }
  const live = loadConfig({
    DISCORD_DRY_RUN: ' 0 ',
    DISCORD_WEBHOOK_URL: HOOK,
    DISCORD_INTERNAL_TOKEN: TOKEN,
    WEB_INTERNAL_URL: 'http://web:3000',
  })
  assert.ok(live.ok && !live.config.dryRun)
})

void test('dry run needs no webhook', () => {
  const r = loadConfig({
    DISCORD_DRY_RUN: '1',
    DISCORD_INTERNAL_TOKEN: TOKEN,
    WEB_INTERNAL_URL: 'http://web:3000',
  })
  assert.ok(r.ok)
  assert.equal(r.config.dryRun, true)
  assert.equal(r.config.webhookUrl, null)
})

void test('rejects a non-Discord webhook URL and a short token, without echoing them', () => {
  const r = loadConfig({
    DISCORD_WEBHOOK_URL: 'https://evil.example/hook',
    DISCORD_INTERNAL_TOKEN: 'tiny-s3cret',
    WEB_INTERNAL_URL: 'http://web:3000',
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.problems.length, 2)
    assert.ok(r.problems.every((p) => !p.includes('evil.example') && !p.includes('tiny-s3cret')))
  }
})
