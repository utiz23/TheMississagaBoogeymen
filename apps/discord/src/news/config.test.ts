import test from 'node:test'
import assert from 'node:assert/strict'
import { loadNewsConfig } from './config.ts'

const HOOK = 'https://discord.com/api/webhooks/123/SECRET-NEWS-TOKEN'
const KEY = 'sk-ant-SECRET-KEY-VALUE'
const BASE = {
  DISCORD_INTERNAL_TOKEN: 'x'.repeat(32),
  WEB_INTERNAL_URL: 'http://web:3000/',
  ANTHROPIC_API_KEY: KEY,
}

void test('dry run (unset) with no webhook ⇒ ok, defaults applied', () => {
  const r = loadNewsConfig(BASE)
  assert.ok(r.ok)
  assert.equal(r.config.dryRun, true)
  assert.equal(r.config.webhookUrl, null)
  assert.equal(r.config.webBaseUrl, 'http://web:3000')
  assert.equal(r.config.siteUrl, 'https://boogeymen.app')
  assert.equal(r.config.outDir, '/tmp/news-out')
  assert.equal(r.config.pollIntervalMs, 60000)
  assert.equal(r.config.model, 'claude-opus-5-5')
  assert.equal(r.config.monthlyLimitUsd, 20)
  assert.equal(r.config.apiKeyPresent, true)
})

void test('anything but an explicit 0 is a dry run', () => {
  for (const v of ['1', 'true', 'no', '', ' 0x']) {
    const r = loadNewsConfig({ ...BASE, NEWS_DRY_RUN: v })
    assert.ok(r.ok && r.config.dryRun, `NEWS_DRY_RUN=${v}`)
  }
})

void test('NEWS_DRY_RUN=0 and no webhook ⇒ not ok', () => {
  const r = loadNewsConfig({ ...BASE, NEWS_DRY_RUN: '0' })
  assert.equal(r.ok, false)
})

void test('live with a Discord webhook ⇒ ok, live', () => {
  const r = loadNewsConfig({ ...BASE, NEWS_DRY_RUN: '0', NEWS_WEBHOOK_URL: HOOK })
  assert.ok(r.ok)
  assert.equal(r.config.dryRun, false)
  assert.equal(r.config.webhookUrl, HOOK)
})

void test('missing API key ⇒ not ok, also in a dry run', () => {
  const r = loadNewsConfig({ ...BASE, ANTHROPIC_API_KEY: '  ' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.ok(r.problems.some((p) => p.includes('ANTHROPIC_API_KEY')))
})

void test('short token and missing web URL ⇒ not ok', () => {
  const r = loadNewsConfig({ ANTHROPIC_API_KEY: KEY, DISCORD_INTERNAL_TOKEN: 'short' })
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.problems.length, 2)
})

void test('a problem text never contains the webhook URL or the key', () => {
  const r = loadNewsConfig({
    ...BASE,
    NEWS_WEBHOOK_URL: 'https://evil.example/api/webhooks/SECRET-NEWS-TOKEN',
    NEWS_DRY_RUN: '0',
  })
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.ok(r.problems.some((p) => p.includes('not a Discord webhook URL')))
    for (const p of r.problems) {
      assert.ok(!p.includes('SECRET-NEWS-TOKEN'))
      assert.ok(!p.includes('evil.example'))
      assert.ok(!p.includes(KEY))
    }
  }
})

void test('numbers: bad values fall back to defaults, good ones are used', () => {
  const bad = loadNewsConfig({
    ...BASE,
    NEWS_POLL_INTERVAL_MS: 'soon',
    NEWS_MONTHLY_LIMIT_USD: '-3',
  })
  assert.ok(bad.ok)
  assert.equal(bad.config.pollIntervalMs, 60000)
  assert.equal(bad.config.monthlyLimitUsd, 20)
  const good = loadNewsConfig({
    ...BASE,
    NEWS_POLL_INTERVAL_MS: '30000',
    NEWS_MONTHLY_LIMIT_USD: '7.5',
    NEWS_MODEL: 'claude-sonnet-5-5',
    NEWS_OUT_DIR: '/x',
  })
  assert.ok(good.ok)
  assert.equal(good.config.pollIntervalMs, 30000)
  assert.equal(good.config.monthlyLimitUsd, 7.5)
  assert.equal(good.config.model, 'claude-sonnet-5-5')
  assert.equal(good.config.outDir, '/x')
})

void test('NEWS_TEST_WEBHOOK_URL: a test-mode copy channel; ignored when live, checked as a Discord URL', () => {
  const testHook = 'https://discord.com/api/webhooks/456/SECRET-TEST-TOKEN'
  const dry = loadNewsConfig({ ...BASE, NEWS_TEST_WEBHOOK_URL: testHook })
  assert.ok(dry.ok)
  assert.equal(dry.config.testWebhookUrl, testHook)
  // Live: the test channel is never used.
  const live = loadNewsConfig({
    ...BASE,
    NEWS_DRY_RUN: '0',
    NEWS_WEBHOOK_URL: HOOK,
    NEWS_TEST_WEBHOOK_URL: testHook,
  })
  assert.ok(live.ok)
  assert.equal(live.config.testWebhookUrl, null)
  const bad = loadNewsConfig({ ...BASE, NEWS_TEST_WEBHOOK_URL: 'https://example.com/hook' })
  assert.ok(!bad.ok)
  assert.ok(bad.problems.some((p) => p.includes('NEWS_TEST_WEBHOOK_URL')))
  assert.ok(!bad.problems.join(' ').includes('example.com'))
})
