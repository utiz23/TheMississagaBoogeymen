import type { Metadata } from 'next'
import type { ReactNode } from 'react'
import { ScoreCalculator } from '@/components/game-score/score-calculator'
import {
  ANCHOR_HENRY_BIG,
  ANCHOR_SILKY,
  EXAMPLE_CAMRAZZ,
  EXAMPLE_GAME,
  EXAMPLE_HENRY,
  EXAMPLE_LEHMANN,
  GOALIE_FULL_WEIGHT_SHOTS,
  STAR_MIN_GOALIE_SV_PCT,
  goalieWeightRows,
  scoreGoalieLine,
  scoreSkaterLine,
  skaterWeightGroups,
  type ScoredLine,
} from '@/lib/game-score-explainer'

// Temporary explainer for teammates (task docs/tasks/2026-11-21-web-game-score-page.md).
// No nav link. Every number comes from the real score functions in lib/match-recap.

export const metadata: Metadata = { title: 'Game Score — Club Stats' }

const pts = (x: number) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(2)}`
const gs = (x: number) => x.toFixed(1)
const svText = STAR_MIN_GOALIE_SV_PCT.toFixed(3).replace(/^0/, '')

function H2({ eyebrow, children }: { eyebrow: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <p className="font-condensed text-xs font-bold uppercase tracking-[0.28em] text-accent">
        {eyebrow}
      </p>
      <h2 className="font-condensed text-2xl font-black uppercase tracking-wide text-fg-1 sm:text-3xl">
        {children}
      </h2>
    </div>
  )
}

function Callout({ children }: { children: ReactNode }) {
  return (
    <div className="space-y-2 border-l-[3px] border-accent bg-accent/10 px-4 py-3 text-fg-2">
      {children}
    </div>
  )
}

/** One player's stat-by-stat math, from the real breakdown. */
function MathTable({ name, line, note }: { name: string; line: ScoredLine; note?: ReactNode }) {
  return (
    <div className="min-w-0 space-y-2">
      <h3 className="font-condensed text-lg font-bold uppercase tracking-wider text-fg-1">
        {name}
      </h3>
      <table className="w-full text-sm">
        <tbody>
          {line.parts
            .filter((p) => p.contribution !== 0)
            .map((p) => (
              <tr key={p.label}>
                <td className="py-1 text-fg-2">
                  {p.label === 'Win Bonus'
                    ? 'Win bonus'
                    : `${p.label === 'SV%' ? p.value.toFixed(3) : String(p.value)} ${p.label} × ${p.weight.toFixed(2)}`}
                </td>
                <td
                  className={`py-1 text-right font-semibold tabular-nums ${p.contribution < 0 ? 'text-loss' : 'text-fg-1'}`}
                >
                  {pts(p.contribution)}
                </td>
              </tr>
            ))}
          <tr className="border-t-2 border-accent">
            <td className="pt-2 font-condensed text-lg font-black uppercase">Game score</td>
            <td className="pt-2 text-right font-condensed text-lg font-black tabular-nums">
              {line.total.toFixed(2)}
            </td>
          </tr>
        </tbody>
      </table>
      {note}
    </div>
  )
}

export default function GameScorePage() {
  const skaterGroups = skaterWeightGroups()
  const goalieRows = goalieWeightRows()
  const camrazz = scoreSkaterLine(EXAMPLE_CAMRAZZ, true)
  const lehmann = scoreGoalieLine(EXAMPLE_LEHMANN, true)
  const henry = scoreSkaterLine(EXAMPLE_HENRY, true)
  const lehmannFull = scoreGoalieLine(
    { ...EXAMPLE_LEHMANN, saves: GOALIE_FULL_WEIGHT_SHOTS, shotsAgainst: GOALIE_FULL_WEIGHT_SHOTS },
    true,
  )
  const silky = scoreSkaterLine(ANCHOR_SILKY, true)
  const henryBig = scoreSkaterLine(ANCHOR_HENRY_BIG, true)
  const maxSkaterWeight = Math.max(
    ...skaterGroups.flatMap((g) => g.rows.map((r) => Math.abs(r.weight))),
  )

  const stars = [
    { rank: '1st star', name: 'camrazz', line: '2 G · 2 A · +4', score: camrazz.total },
    {
      rank: '2nd star',
      name: 'Matteo Lehmann',
      line: '10 saves on 10 shots · AI goalie',
      score: lehmann.total,
    },
    {
      rank: '3rd star',
      name: 'HenryTheBobJr',
      line: '1 G · 1 A · +4 · 2 penalties drawn',
      score: henry.total,
    },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-12 pb-8 text-fg-2">
      <header className="space-y-3 border-b-2 border-accent pb-5">
        <p className="inline-block border border-zinc-800 px-2.5 py-1 font-condensed text-[11px] font-bold uppercase tracking-widest text-fg-4">
          Temporary page · for the team
        </p>
        <h1 className="font-condensed text-5xl font-black uppercase tracking-wide text-fg-1 sm:text-6xl">
          Game <span className="text-accent">Score</span>
        </h1>
        <p className="max-w-prose text-lg">
          Every player in every game gets one number: the game score. The three highest scores are
          that game’s three stars. This page shows how the number is made.
        </p>
      </header>

      <section className="space-y-4">
        <H2 eyebrow="The short version">Four things to know</H2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            [
              'Points for good plays',
              'Each stat in the EA box score is worth some points. Goals and assists are worth the most.',
            ],
            ['Points off for mistakes', 'Giveaways and penalty minutes take points away.'],
            [
              '+1 for the win',
              'Every player on the winning team gets 1 extra point. A DNF or a tie gives nobody the bonus.',
            ],
            [
              'Both teams are ranked',
              'Opponents get a score too. So an opponent can take a star in our game.',
            ],
          ].map(([title, body]) => (
            <div
              key={title}
              className="min-w-0 space-y-1 border-t-[3px] border-accent bg-surface p-4"
            >
              <p className="font-condensed text-lg font-bold uppercase tracking-wide text-fg-1">
                {title}
              </p>
              <p className="text-sm text-fg-3">{body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <H2 eyebrow="Skaters">What each stat is worth</H2>
        <p className="max-w-prose">
          Take your box score line and multiply each stat by its points, then add everything up. One
          goal = 4 points. Three takeaways = 3 × 0.55 = 1.65 points.
        </p>
        <div className="overflow-x-auto border border-zinc-800 bg-surface">
          <table className="w-full min-w-[520px] text-sm sm:text-base">
            <thead>
              <tr className="border-b border-zinc-800 font-condensed text-xs uppercase tracking-widest text-fg-4">
                <th className="px-3 py-2 text-left font-bold">Stat</th>
                <th className="px-3 py-2 text-right font-bold">Each one</th>
                <th className="px-3 py-2 text-left font-bold">Size</th>
                <th className="px-3 py-2 text-left font-bold">Why</th>
              </tr>
            </thead>
            <tbody>
              {skaterGroups.map((g) => (
                <GroupRows key={g.group} group={g.group}>
                  {g.rows.map((r) => (
                    <tr key={r.label} className="border-t border-border-subtle">
                      <td className="px-3 py-2 text-fg-1">{r.label}</td>
                      <td
                        className={`px-3 py-2 text-right font-condensed text-lg font-black tabular-nums ${r.weight < 0 ? 'text-loss' : 'text-win'}`}
                      >
                        {pts(r.weight)}
                      </td>
                      <td className="w-[38%] px-3 py-2">
                        <div className="relative h-2.5 bg-surface-raised">
                          <div
                            className={`absolute inset-y-0 left-0 min-w-[2px] ${r.weight < 0 ? 'bg-loss' : 'bg-win'}`}
                            style={{
                              width: `${((Math.abs(r.weight) / maxSkaterWeight) * 100).toFixed(1)}%`,
                            }}
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2 text-sm text-fg-4">{r.note}</td>
                    </tr>
                  ))}
                </GroupRows>
              ))}
            </tbody>
          </table>
        </div>
        <Callout>
          <p>
            <strong className="text-fg-1">An assist is worth almost as much as a goal</strong> (3.25
            against 4). EA does not tell us which assists were primary and which were secondary, so
            all assists get the same value. The goal-to-assist ratio comes from public NHL
            game-score models (Dom Luszczyszyn’s Game Score and others).
          </p>
          <p>
            <strong className="text-fg-1">No shot attempt numbers?</strong> NHL models use
            shot-attempt differentials (Corsi) to measure who drove play. EA does not give us those.
            Takeaways, interceptions and blocks do that job here.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <H2 eyebrow="Goalies">Goalies have their own list</H2>
        <div className="overflow-x-auto border border-zinc-800 bg-surface">
          <table className="w-full text-sm sm:text-base">
            <thead>
              <tr className="border-b border-zinc-800 font-condensed text-xs uppercase tracking-widest text-fg-4">
                <th className="px-3 py-2 text-left font-bold">Stat</th>
                <th className="px-3 py-2 text-right font-bold">Each one</th>
                <th className="px-3 py-2 text-left font-bold">Note</th>
              </tr>
            </thead>
            <tbody>
              {goalieRows.map((r, i) => (
                <tr key={r.label} className={i > 0 ? 'border-t border-border-subtle' : ''}>
                  <td className="px-3 py-2 text-fg-1">{r.label}</td>
                  <td
                    className={`whitespace-nowrap px-3 py-2 text-right font-condensed text-lg font-black tabular-nums ${r.weight < 0 ? 'text-loss' : 'text-win'}`}
                  >
                    {i === 0 ? `up to ${pts(r.weight)}` : pts(r.weight)}
                  </td>
                  <td className="px-3 py-2 text-sm text-fg-4">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Callout>
          <p>
            <strong className="text-fg-1">Few shots = smaller save % value.</strong> Save % counts
            in full only from {GOALIE_FULL_WEIGHT_SHOTS} shots faced. Below that it shrinks with the
            shots: on 10 shots it is worth up to 10, on 4 shots up to 4. Before this rule, a goalie
            with 2 saves on 4 shots could beat a skater with a goal and an assist.
          </p>
          <p>
            <strong className="text-fg-1">A goalie needs {svText} or better to be a star.</strong>{' '}
            Under {svText} the goalie still gets a score, but never a star. A goalie who faced no
            shots can’t be a star either. The AI goalies (Lehmann and Wagner) follow the same rules
            and can be stars.
          </p>
          <p className="text-sm text-fg-4">
            Both goalie rules started on Nov 9, 2026, after the team said the goalie scores were
            broken.
          </p>
        </Callout>
      </section>

      <section className="space-y-4">
        <H2 eyebrow="A real game">
          Worked example: the {EXAMPLE_GAME.scoreFor}-{EXAMPLE_GAME.scoreAgainst} win over{' '}
          {EXAMPLE_GAME.opponent}
        </H2>
        <p className="max-w-prose">
          Here is the math for that game’s three stars, with the real numbers from the site.
        </p>
        <div className="border border-zinc-800 bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800 px-4 py-3">
            <p className="font-condensed text-2xl font-black uppercase tracking-wide text-fg-1">
              <span className="mr-2 text-win">W</span>BGM {EXAMPLE_GAME.scoreFor} –{' '}
              {EXAMPLE_GAME.scoreAgainst} {EXAMPLE_GAME.opponent}
            </p>
            <p className="text-sm text-fg-4">
              {EXAMPLE_GAME.date} · {EXAMPLE_GAME.mode}
            </p>
          </div>
          <div className="grid gap-px bg-zinc-800 sm:grid-cols-3">
            {stars.map((s) => (
              <div key={s.name} className="min-w-0 space-y-1 bg-surface p-4">
                <p className="font-condensed text-xs font-bold uppercase tracking-widest text-amber-300">
                  ★ {s.rank}
                </p>
                <p className="break-words font-condensed text-xl font-bold text-fg-1">{s.name}</p>
                <p className="text-sm text-fg-4">{s.line}</p>
                <p className="pt-1 font-condensed text-4xl font-black leading-none tabular-nums text-fg-1">
                  {gs(s.score)}
                  <span className="ml-1 text-xs tracking-widest text-fg-4">GS</span>
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-6 border-t border-zinc-800 p-4 md:grid-cols-3">
            <MathTable name="camrazz" line={camrazz} />
            <MathTable
              name="Matteo Lehmann"
              line={lehmann}
              note={
                <p className="text-xs text-fg-4">
                  Only 10 shots, so save % counts × 10, not × {GOALIE_FULL_WEIGHT_SHOTS}. A perfect
                  night on {GOALIE_FULL_WEIGHT_SHOTS} shots would have been worth{' '}
                  {lehmannFull.total.toFixed(2)}.
                </p>
              }
            />
            <MathTable name="HenryTheBobJr" line={henry} />
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <H2 eyebrow="The three stars">How the stars are picked</H2>
        <ul className="max-w-prose list-disc space-y-2 pl-5">
          <li>
            Every player from both teams who did something in the game gets a score. A player with a
            completely empty line is left out.
          </li>
          <li>All scores are sorted from high to low.</li>
          <li>
            The top three who are allowed to be stars become the 1st, 2nd and 3rd star. Skaters are
            always allowed. Goalies need {svText} or better.
          </li>
          <li>Opponents count. On a bad night all three stars can be on the other team.</li>
        </ul>
      </section>

      <section className="space-y-4">
        <H2 eyebrow="Reading the number">Is my score good?</H2>
        <p className="max-w-prose">There is no maximum. Here are some real and typical lines:</p>
        <ul className="divide-y divide-border-subtle border border-zinc-800 bg-surface">
          {[
            [
              '~5',
              'A quiet defensive game with no points: some blocks, takeaways and a clean puck.',
            ],
            [gs(silky.total), 'silkyjoker85, 1 G 1 A −1 in a 4-3 win (Nov 9).'],
            ['~14', '2 G 1 A, +2, few giveaways.'],
            [gs(camrazz.total), 'camrazz, 2 G 2 A +4 in the 4-0 win (above).'],
            [gs(henryBig.total), 'HenryTheBobJr, 2 G 3 A +6 in a 6-0 win (Oct 8).'],
          ].map(([v, text]) => (
            <li key={text} className="grid grid-cols-[3.5rem_1fr] items-baseline gap-3 px-4 py-2.5">
              <span className="text-right font-condensed text-2xl font-black tabular-nums text-fg-1">
                {v}
              </span>
              <span className="text-sm">{text}</span>
            </li>
          ))}
        </ul>
        <p className="text-sm text-fg-4">
          A score can go below zero. That takes a game with no points and a lot of giveaways or
          penalty minutes.
        </p>
      </section>

      <section className="space-y-4">
        <H2 eyebrow="Try it">Work out your own score</H2>
        <p className="max-w-prose">
          Type in a box score line. The fields start with camrazz’s line from the example (and
          Lehmann’s for goalies).
        </p>
        <ScoreCalculator />
      </section>

      <section className="space-y-4">
        <H2 eyebrow="Where it shows up">Where you see the score</H2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            [
              'Game page',
              'The three star cards at the top. Under them, “show all player scores” lists every player from both teams with the full breakdown.',
            ],
            [
              'Discord game post',
              'The line-up picture shows each player’s score (GS 17.53) and marks the stars.',
            ],
            [
              'Vs your season average',
              'The game page shows if you played above or below your own average score for the season so far.',
            ],
            ['News desk', 'The bots get the stars and scores when they write the game recap.'],
          ].map(([title, body]) => (
            <div key={title} className="min-w-0 space-y-1 border border-zinc-800 bg-surface p-4">
              <p className="font-condensed text-base font-bold uppercase tracking-wide text-fg-1">
                {title}
              </p>
              <p className="text-sm text-fg-3">{body}</p>
            </div>
          ))}
        </div>
        <p className="max-w-prose text-sm text-fg-4">
          The Contribution Wheel on your player page is a different thing. It uses the textbook NHL
          Game Score weights to show which stats your season comes from. Its numbers do not match
          the per-game score on this page.
        </p>
      </section>

      <section className="space-y-4">
        <H2 eyebrow="Be fair to it">What the score can’t see</H2>
        <ul className="max-w-prose list-disc space-y-2 pl-5">
          <li>
            <strong className="text-fg-1">Only what EA counts.</strong> A perfect screen, a good
            pinch or smart positioning only shows up if it turns into a stat.
          </li>
          <li>
            <strong className="text-fg-1">No ice time adjustment.</strong> A player who played half
            the game is compared with full-game players.
          </li>
          <li>
            <strong className="text-fg-1">All goals are equal.</strong> An empty-net goal counts the
            same as an overtime winner.
          </li>
          <li>
            <strong className="text-fg-1">All assists are equal.</strong> EA does not split primary
            and secondary assists.
          </li>
          <li>
            <strong className="text-fg-1">Plus / minus is small on purpose</strong> (0.20 each). It
            mostly reflects the whole line, not one player.
          </li>
        </ul>
      </section>

      <section className="space-y-4">
        <H2 eyebrow="Questions">Common questions</H2>
        <div className="space-y-2">
          {[
            [
              'Why did a goalie with fewer saves beat me?',
              `Save % is the biggest single item in the whole system. On ${String(GOALIE_FULL_WEIGHT_SHOTS)} or more shots, a .930 game alone is worth about 14 points. A skater needs roughly 2 goals and 1 assist for that.`,
            ],
            [
              'I won 60% of my faceoffs. Why did it barely help?',
              'Faceoffs count as wins minus losses, at 0.08 each. Winning 12 and losing 10 gives +2 × 0.08 = +0.16. Faceoffs matter in the game, but EA’s numbers can’t show which wins led to anything.',
            ],
            [
              'Why do giveaways hurt so much?',
              'A giveaway (−0.45) costs as much as an interception earns (+0.45). This keeps a player who forces risky passes from scoring the same as a player who keeps the puck safe.',
            ],
            [
              'Can the formula change?',
              'Yes. It last changed on Nov 9, 2026 (the goalie fix). Any change is tested first on recent real games, and the old and new stars are compared side by side before it goes live.',
            ],
          ].map(([q, a]) => (
            <details key={q} className="group border border-zinc-800 bg-surface">
              <summary className="flex cursor-pointer list-none justify-between gap-3 px-4 py-3 font-semibold text-fg-1 [&::-webkit-details-marker]:hidden">
                {q}
                <span className="font-condensed text-xl font-black leading-none text-accent group-open:hidden">
                  +
                </span>
                <span className="hidden font-condensed text-xl font-black leading-none text-accent group-open:inline">
                  –
                </span>
              </summary>
              <p className="px-4 pb-4 text-sm text-fg-3">{a}</p>
            </details>
          ))}
        </div>
      </section>

      <footer className="space-y-1 border-t border-border-subtle pt-3 text-xs text-fg-5">
        <p>
          Temporary explainer for Boogeymen players. The numbers on this page come from the same
          code that picks the stars on the game page.
        </p>
        <p>Questions, or does a score look wrong? Ask Silky.</p>
      </footer>
    </div>
  )
}

function GroupRows({ group, children }: { group: string; children: ReactNode }) {
  return (
    <>
      <tr className="bg-surface-raised">
        <td
          colSpan={4}
          className="px-3 py-1.5 font-condensed text-xs font-bold uppercase tracking-widest text-fg-4"
        >
          {group}
        </td>
      </tr>
      {children}
    </>
  )
}
