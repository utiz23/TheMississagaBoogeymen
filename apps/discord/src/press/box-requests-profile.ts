import type { ReporterId } from '@eanhl/db/news'
import type { DossierKey, ProfileMaterial } from '@eanhl/db/queries'
import { profileRefusal, writePlayerProfile, type ProfileContext } from '../news/profile.ts'
import type { PressConfig } from './config.ts'
import { onGmInterview } from './interview.ts'
import { interviewStoreOf } from './interview-store.ts'
import type { PressDeps } from './pass.ts'
import { pressRecorder, safeWhy } from './question.ts'
import { relationshipsFor } from './relationships.ts'
import { extrasBudgetLeft } from './rules.ts'

/**
 * Press Box requests that need the press service (task press-box-l2, migration 0081): write or
 * refresh a person's AI profile, and offer a person an interview. The admin page cannot do either
 * (no Anthropic key, no bot tokens), so it writes a request and these run on the next pass.
 *
 * Profile: one click = one `writePlayerProfile` (one write and one review through the desk's
 * checked writer; every call recorded in the monthly spend through `pressRecorder`). "Leave me
 * out" is checked again here, before any read of the person's words or any model call. The
 * extras budget stop (80% of the month) applies, like a scrum.
 *
 * Interview: the same code as `/gm interview`, run as the GM (`onGmInterview`); the offer is
 * posted by the interview pass, as for the command. No model call here.
 *
 * Results are short private lines for the page: never an answer's text.
 */

export interface ProfileStoreMethods {
  getProfileMaterial(key: DossierKey): Promise<ProfileMaterial | null>
  savePlayerProfile(p: {
    key: DossierKey
    displayName: string
    text: string
    model: string
    costUsd: number
    at: Date
  }): Promise<void>
}

export interface ClaimedRequest {
  id: number
  kind: 'testscrum' | 'profile' | 'interview'
  requestedBy: string
  targetPlayerId?: number | null
  targetDiscordUserId?: string | null
  reporter?: ReporterId | null
  topic?: string | null
}

export type RequestOutcome = { status: 'done' | 'failed'; result: string }

const PROFILE_LOOKBACK_MS = 90 * 86_400_000

const reason = (err: unknown): string => (err instanceof Error ? err.message : String(err))
const dollars = (n: number): string => `$${n.toFixed(2)}`

function keyOf(req: ClaimedRequest): DossierKey | null {
  if (req.targetPlayerId !== null && req.targetPlayerId !== undefined) {
    return { playerId: req.targetPlayerId }
  }
  if (req.targetDiscordUserId !== null && req.targetDiscordUserId !== undefined) {
    return { discordUserId: req.targetDiscordUserId }
  }
  return null
}

/** Writes (or refreshes) one profile. Never throws. */
export async function runProfileRequest(
  deps: PressDeps,
  config: PressConfig,
  store: ProfileStoreMethods,
  req: ClaimedRequest,
): Promise<RequestOutcome> {
  const key = keyOf(req)
  if (key === null) return { status: 'failed', result: 'The request names nobody.' }
  try {
    const material = await store.getProfileMaterial(key)
    if (material === null) return { status: 'failed', result: 'No such person.' }
    // "Leave me out": nothing is read and no model is called (the material is empty for them).
    const refused = profileRefusal(material.pressLevel)
    if (refused !== null) return { status: 'failed', result: refused }
    if (!extrasBudgetLeft(await deps.store.monthNewsSpendUsd(deps.now()), config.monthlyLimitUsd)) {
      return {
        status: 'failed',
        result: 'The monthly budget is past the 80% stop: no profile is written until next month.',
      }
    }

    // The latest sheet for the person's night: review context and the names that may not be used.
    const since = new Date(deps.now().getTime() - PROFILE_LOOKBACK_MS)
    const istore = interviewStoreOf(deps.store)
    const night =
      (material.playerId !== null && istore !== null
        ? await istore.latestPlayerNight(material.playerId, since)
        : null) ?? (await deps.store.latestPressNight(since))
    if (night === null)
      return { status: 'failed', result: 'No game in the last 90 days to build a sheet from.' }
    const res = await deps.fetchFacts('night', night)

    const ctx: ProfileContext = {
      facts: res.facts,
      forbiddenNames: res.forbiddenNames,
      person: { name: material.name, role: material.role, pressLevel: material.pressLevel },
      takes: material.takes.map((t) => ({ id: t.id, reporter: t.reporter, take: t.take })),
      relationships:
        material.playerId === null || material.pressLevel === null
          ? []
          : await relationshipsFor(deps, material.playerId, material.pressLevel),
      answers: material.quotes.map((q) => ({
        question: q.question,
        answer: q.text,
        usability: q.usability,
        reporter: q.reporter,
      })),
    }
    const out = await writePlayerProfile(deps.call, ctx, pressRecorder(deps.store))
    if (!out.ok) {
      deps.log(
        `[press] box request ${String(req.id)}: profile not written (${safeWhy(out.reason, [
          ...ctx.answers.map((a) => a.answer),
          ...ctx.takes.map((t) => t.take),
        ])})`,
      )
      return {
        status: 'failed',
        result: `The profile did not pass the writing checks. Nothing was stored. Cost about ${dollars(out.costUsd)}.`,
      }
    }
    await store.savePlayerProfile({
      key,
      displayName: material.name,
      text: out.text,
      model: out.model,
      costUsd: out.costUsd,
      at: deps.now(),
    })
    return {
      status: 'done',
      result: `Profile written for ${material.name}. Cost about ${dollars(out.costUsd)}.`,
    }
  } catch (err: unknown) {
    deps.log(`[press] box request ${String(req.id)}: ${reason(err)}`)
    return { status: 'failed', result: 'The profile could not be written.' }
  }
}

/** Offers one person an interview (the `/gm interview` offer), as the GM. Never throws. */
export async function runInterviewRequest(
  deps: PressDeps,
  config: PressConfig,
  req: ClaimedRequest,
): Promise<RequestOutcome> {
  const st = interviewStoreOf(deps.store)
  if (st === null) return { status: 'failed', result: 'Interviews are off.' }
  try {
    const discordUserId =
      req.targetDiscordUserId ??
      (req.targetPlayerId === null || req.targetPlayerId === undefined
        ? null
        : await st.getPlayerDiscordUserId(req.targetPlayerId))
    if (discordUserId === null)
      return { status: 'failed', result: 'This person has no Discord link.' }
    const reply = await onGmInterview(deps, config, config.gmUserId, {
      player: discordUserId,
      reporter: req.reporter ?? null,
      topic: req.topic ?? null,
    })
    const text = reply.kind === 'ephemeral' ? reply.text : 'Done.'
    // The offer is made when the reply starts "Got it:"; any other line is a refusal.
    return { status: /^Got it:/.test(text) ? 'done' : 'failed', result: text }
  } catch (err: unknown) {
    deps.log(`[press] box request ${String(req.id)}: ${reason(err)}`)
    return { status: 'failed', result: 'The interview could not be offered.' }
  }
}
