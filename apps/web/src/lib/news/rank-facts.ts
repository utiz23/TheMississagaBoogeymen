// Fact ranking for the news desk fact sheets (Part C2.7, spec §12.17-2): the
// sheet's labels and values turned into short factual sentences with an
// importance weight, most important first. Pure. Every text is built only
// from values and labels already on the sheet (no new numbers), so the fact
// check's allowed numbers do not grow. C3 gives each piece the top 5 as "the
// story" and the rest as background.
//
// Weights (Claude's call; documented here, pinned by tests):
//   100  a new club record
//    60  result panic; 65 a big upset
//    55  result blip; a title milestone at a multiple of 100 (else 45)
//    50  result turnaround; biggest win / worst loss of the season
//    45  result slide; an upset; a career high; a hat trick or 5+ points
//        (player without a norm); a thread closed tonight
//    40  result rolling; a shutout
//    40 + 3 x margin (at most 75)  a blowout
//    35  other team notes; first hat trick of the season
//    25 + 10 x (goals - average), 20 + 8 x (points - average),
//    15 + 8 x (assists - average)  "big for him" lines
//    30  a club debut; the night swept or lost
//    25  a season high; first goal of the season; a slump ended (+1/game)
//    20  a thread still open; a return; an AI goalie steal; revenge rematch
//    15  a title debut; a rematch; other streak facts (scaled by length)
//    12  a coming milestone (18 when 1 away); a broken team pattern; firsts
//     8  chemistry; unusual team numbers; quiet nights; shots/hits big
//     5  an ended-early game; unlocks
//     2  a pattern held as usual
import type {
  NewsFacts,
  NewsGameFacts,
  NewsPlayerLine,
  NewsTopFact,
  NormLabelKey,
  PlayerNormStat,
} from '@eanhl/db/news'

/** Readable names of the team label keys (C2 fix B). */
const TEAM_STAT_NAME: Record<NormLabelKey, string> = {
  hitsFor: 'hits',
  hitsAgainst: 'hits against',
  shotsFor: 'shots',
  shotsAgainst: 'shots against',
  timeOnAttack: 'time on attack',
  passPct: 'pass completion',
}

/** At most this many ranked facts on a sheet (C2 fix B). */
export const MAX_TOP_FACTS = 25

/**
 * Facts that describe a running state (a streak's length, the night so far,
 * a coming milestone, form, a streak result label, a longest-streak note):
 * on a sheet with several games only the latest one per subject stays (C2
 * fix B). The key is the id without its game prefix, the running part fixed.
 */
export function runningKey(id: string): string | null {
  const part = id.replace(/^g\d+:/, '')
  const rules: [RegExp, string][] = [
    [/^(p\d+:)streak:(\w+):\w+$/, '$1streak:$2'],
    [/^(p\d+:)approaching:(\w+)$/, '$1approaching:$2'],
    [/^(p\d+:)form$/, '$1form'],
    [/^night:.*$/, 'night'],
    [/^result:(rolling|slide|panic)$/, 'result:$1'],
    [/^team:longest (win|losing) streak.*$/, 'team:longest $1 streak'],
  ]
  for (const [re, to] of rules) if (re.test(part)) return part.replace(re, to)
  return null
}

const RESULT_WEIGHT = { panic: 60, blip: 55, turnaround: 50, slide: 45, rolling: 40 } as const
export const WEIGHT_NEW_RECORD = 100
export const WEIGHT_BLOWOUT_BASE = 40
export const WEIGHT_BLOWOUT_PER_GOAL = 3
export const WEIGHT_BLOWOUT_MAX = 75

const s = (n: number) => String(n)
const round = (n: number) => Math.round(n)

/** "11-2 win over X", "6-2 loss to X", "4-3 overtime loss to X": winner first. */
export function scoreText(g: NewsGameFacts): string {
  const ot = g.overtime ? 'overtime ' : ''
  return g.result === 'WIN'
    ? `${s(g.scoreFor)}-${s(g.scoreAgainst)} ${ot}win over ${g.opponentName}`
    : `${s(g.scoreAgainst)}-${s(g.scoreFor)} ${ot}loss to ${g.opponentName}`
}

const STAT_WORD: Record<PlayerNormStat, [string, string]> = {
  goals: ['goal', 'goals'],
  assists: ['assist', 'assists'],
  points: ['point', 'points'],
  shots: ['shot', 'shots'],
  hits: ['hit', 'hits'],
}
const statText = (k: PlayerNormStat, v: number) => `${s(v)} ${STAT_WORD[k][v === 1 ? 0 : 1]}`

type Push = (id: string, text: string, weight: number, subject: string | null) => void

function lineValue(p: NewsPlayerLine, k: PlayerNormStat): number | null {
  return k === 'points' ? p.points : p[k]
}

function playerFacts(g: NewsGameFacts, p: NewsPlayerLine, push: Push, titleName: string): void {
  const id = (part: string) => `g${s(g.matchId)}:p${s(p.playerId)}:${part}`
  const who = p.name
  const vs = ` vs ${g.opponentName}`
  if (p.norm !== null) {
    const norm = p.norm
    // The norm's scope (C2 fix I2): this title, the game's mode, his position.
    const scope = `${g.gameMode ?? ''} avg as ${p.position}`.trim()
    for (const k of ['goals', 'assists', 'points', 'shots', 'hits'] as const) {
      const v = lineValue(p, k)
      if (v === null) continue
      const label = norm.labels[k]
      const avg = norm.perGame[k]
      if (label === 'big for him') {
        const diff = v - avg
        const w =
          k === 'goals'
            ? 25 + 10 * diff
            : k === 'points'
              ? 20 + 8 * diff
              : k === 'assists'
                ? 15 + 8 * diff
                : 8
        push(
          id(`big:${k}`),
          `${who}: ${statText(k, v)}${vs} — big for him (${scope} ${s(avg)} over ${s(norm.games)} games)`,
          w,
          who,
        )
      } else if (label === 'quiet for him') {
        push(
          id(`quiet:${k}`),
          `${who}: ${statText(k, v)}${vs} — quiet for him (${scope} ${s(avg)} over ${s(norm.games)} games)`,
          k === 'points' ? 8 : 4,
          who,
        )
      }
    }
  } else {
    if (p.goals >= 3)
      push(id('hat-trick'), `${who}: hat trick (${statText('goals', p.goals)})${vs}`, 45, who)
    if (p.points >= 5) push(id('points'), `${who}: ${statText('points', p.points)}${vs}`, 45, who)
  }
  for (const b of p.bests) {
    const k = b.split(' ').pop() as PlayerNormStat
    const v = lineValue(p, k)
    push(
      id(b),
      `${who}: ${b}${v === null ? '' : ` (${s(v)})`}${vs}`,
      b.startsWith('career') ? 45 : 25,
      who,
    )
  }
  for (const f of p.firsts) {
    const w =
      f === 'first hat trick of the season' ? 35 : f === 'first goal of the season' ? 25 : 12
    push(id(f), `${who}: ${f}${vs}`, w, who)
  }
  for (const st of p.streaks) {
    const n = st.games
    let text: string
    let w: number
    if (st.kind === 'noGoal') {
      ;[text, w] =
        st.status === 'ended'
          ? [`${who}: scored${vs}, ending ${s(n)} games without a goal`, 25 + n]
          : [`${who}: no goal in ${s(n)} games`, 10 + n]
    } else {
      const what = st.kind === 'points' ? 'point' : 'goal'
      ;[text, w] =
        st.status === 'extended'
          ? [`${who}: ${what}s in ${s(n)} straight games`, (st.kind === 'goals' ? 20 : 15) + 3 * n]
          : [`${who}: ${s(n)}-game ${what} streak ended`, (st.kind === 'goals' ? 8 : 10) + n]
    }
    push(id(`streak:${st.kind}:${st.status}`), text, w, who)
  }
  if (p.debut === 'club') push(id('debut'), `${who}: first game for the club`, 30, who)
  if (p.debut === 'title') push(id('debut'), `${who}: first game of ${titleName}`, 15, who)
  if (p.returnAfterDays !== undefined) {
    push(id('return'), `${who}: back after ${s(p.returnAfterDays)} days`, 20, who)
  }
  if (p.form !== null) push(id('form'), `${who}: ${p.form}`, p.form === 'heating up' ? 18 : 12, who)
  for (const a of p.approaching) {
    const word = a.stat === 'games' ? 'game' : a.stat.slice(0, -1)
    push(
      id(`approaching:${a.stat}`),
      `${who}: ${s(a.remaining)} ${a.remaining === 1 ? word : `${word}s`} from ${s(a.value)} this title`,
      a.remaining === 1 ? 18 : 12,
      who,
    )
  }
}

function gameFacts(facts: NewsFacts, g: NewsGameFacts, push: Push): void {
  const id = (part: string) => `g${s(g.matchId)}:${part}`
  const score = scoreText(g)
  const opp = g.opponentName
  for (const r of g.newRecords) {
    const old = facts.records.find((x) => x.stat === r.stat)
    const was =
      old === undefined
        ? ''
        : ` (the record was ${s(old.value)}${old.holder === null ? '' : ` by ${old.holder}`}, ${old.title})`
    push(
      id(`record:${r.stat}:${r.name}`),
      `New club record: ${r.name}, ${s(r.value)} ${r.stat} this season${was}`,
      WEIGHT_NEW_RECORD,
      r.name,
    )
  }
  if (g.endedEarly) push(id('ended-early'), `Ended early: ${score}`, 5, null)
  const c = g.context
  if (c !== null) {
    const before = c.streakBefore
    const after = c.streakAfter
    if (c.result !== 'normal') {
      const why =
        c.result === 'rolling'
          ? `${s(after?.count ?? 0)} straight wins`
          : c.result === 'blip'
            ? `the first loss after ${s(before?.count ?? 0)} straight wins`
            : c.result === 'turnaround'
              ? `a win after ${s(before?.count ?? 0)} straight losses`
              : after?.kind === 'L' && after.count >= 3
                ? `${s(after.count)} losses in a row`
                : `${s(c.last10.wins)}-${s(c.last10.losses)}-${s(c.last10.otl)} in the last 10`
      push(
        id(`result:${c.result}`),
        `Result: ${c.result} — ${score}, ${why}`,
        RESULT_WEIGHT[c.result],
        null,
      )
    }
    if (c.margin === 'blowout') {
      const diff = Math.abs(g.scoreFor - g.scoreAgainst)
      push(
        id('blowout'),
        `Blowout: ${score}`,
        Math.min(WEIGHT_BLOWOUT_MAX, WEIGHT_BLOWOUT_BASE + WEIGHT_BLOWOUT_PER_GOAL * diff),
        null,
      )
    }
    if (c.surprise !== 'expected') {
      push(
        id('surprise'),
        `Surprise: ${c.surprise} — ${score}`,
        c.surprise === 'big upset' ? 65 : 45,
        opp,
      )
    }
    for (const n of c.night) {
      const big = n === 'swept the night' || n === 'lost every game of the night'
      push(id(`night:${n}`), `Night: ${n}`, big ? 30 : 10, null)
    }
  }
  if (g.result === 'WIN' && g.scoreAgainst === 0 && !g.endedEarly) {
    push(id('shutout'), `Shutout: ${score}`, 40, null)
  }
  for (const n of g.teamNotes) {
    const best = /^(biggest (3s |6s )?win|worst (3s |6s )?loss) of the season/.test(n)
    push(id(`team:${n}`), `Team: ${n}`, best ? 50 : 35, null)
  }
  const h = g.headToHead
  if (h !== null) {
    const lm = h.lastMeeting
    const last =
      lm.result === 'WIN'
        ? `a ${s(lm.scoreFor)}-${s(lm.scoreAgainst)} win`
        : `a ${s(lm.scoreAgainst)}-${s(lm.scoreFor)} ${lm.result === 'OTL' ? 'overtime ' : ''}loss`
    push(
      id('rematch'),
      `Rematch with ${opp}: ${s(h.wins)}-${s(h.losses)}-${s(h.otl)} before this game; last meeting ${last} on ${lm.night}`,
      lm.result === 'WIN' ? 15 : 20,
      opp,
    )
  }
  const ai = g.aiGoalie
  if (ai !== null && ai.savePct !== null) {
    const line = `${ai.name} (AI goalie): ${s(ai.saves)} saves on ${s(ai.shotsAgainst)} shots, ${s(ai.savePct)}%`
    if (ai.savePct < 75 && ai.shotsAgainst >= 10)
      push(id('ai-goalie'), `${line} — a meltdown`, 25, ai.name)
    else if (ai.savePct >= 92 && ai.shotsAgainst >= 15)
      push(id('ai-goalie'), `${line} — a steal`, 20, ai.name)
  }
  if (g.labels !== null && g.team !== null) {
    const t = g.team
    const value: Record<string, number | null> = {
      hitsFor: t.hitsFor,
      hitsAgainst: t.hitsAgainst,
      shotsFor: t.shotsFor,
      shotsAgainst: t.shotsAgainst,
      timeOnAttack: t.timeOnAttackSeconds,
      passPct: t.passPct,
    }
    for (const [k, label] of Object.entries(g.labels)) {
      if (label === null || label === 'typical') continue
      const v = value[k]
      const name = TEAM_STAT_NAME[k as NormLabelKey]
      push(
        id(`label:${k}`),
        `Team ${name}${v === null || v === undefined ? '' : ` ${s(v)}${k === 'timeOnAttack' ? ' s' : k === 'passPct' ? '%' : ''}`}: ${label}`,
        8,
        null,
      )
    }
  }
  for (const p of g.patterns) {
    push(id(`pattern:${p}`), `Pattern: ${p}`, p.endsWith('as usual') ? 2 : 12, null)
  }
  for (const pair of g.chemistry) {
    push(
      id(`chemistry:${pair.pair.join('+')}`),
      `${pair.pair[0]} and ${pair.pair[1]} together: ${s(pair.wins)}-${s(pair.losses)}-${s(pair.otl)} in ${s(pair.games)} games`,
      8,
      null,
    )
  }
  for (const p of g.players) playerFacts(g, p, push, facts.gameTitleName)
}

/**
 * The sheet's facts with their weights, most important first (ties keep the
 * sheet order), running facts only in their latest state, at most 25. `subject` = the player, opponent or AI goalie a fact is
 * about, null for the team.
 */
export function rankFacts(facts: NewsFacts): NewsTopFact[] {
  const out: NewsTopFact[] = []
  const seen = new Set<string>()
  const push: Push = (id, text, weight, subject) => {
    if (seen.has(id)) return
    seen.add(id)
    out.push({ id, text, weight: round(weight), subject })
  }
  for (const g of facts.games) gameFacts(facts, g, push)
  for (const m of facts.milestones) {
    push(
      `milestone:${m.name}:${m.stat}`,
      `${m.name}: reached ${s(m.value)} ${m.stat} this title`,
      m.value % 100 === 0 ? 55 : 45,
      m.name,
    )
  }
  for (const t of facts.threads) {
    push(
      `thread:${t.key}`,
      `Thread (${t.status === 'open' ? 'open' : 'closed tonight'}): ${t.summary}`,
      t.status === 'open' ? 20 : 45,
      t.subject,
    )
  }
  for (const u of facts.unlocks)
    push(`unlock:${u.name}:${u.text}`, `${u.name}: ${u.text}`, 5, u.name)
  // Running facts: the latest per key wins (the facts are in sheet order).
  const latest = new Map<string, number>()
  out.forEach((f, i) => {
    const k = runningKey(f.id)
    if (k !== null) latest.set(k, i)
  })
  return out
    .map((f, i) => ({ f, i }))
    .filter(({ f, i }) => {
      const k = runningKey(f.id)
      return k === null || latest.get(k) === i
    })
    .sort((a, b) => b.f.weight - a.f.weight || a.i - b.i)
    .slice(0, MAX_TOP_FACTS)
    .map(({ f }) => f)
}
