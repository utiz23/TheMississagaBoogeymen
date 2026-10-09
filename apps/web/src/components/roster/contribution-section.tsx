import { SectionHeader } from '@/components/ui/section-header'
import { Panel } from '@/components/ui/panel'
import {
  ContributionWheel,
  type ContributionWheelSeason,
  type ContributionWheelTeammate,
} from './contribution-wheel'

interface Props {
  selectedRole: 'skater' | 'goalie'
  /** EA season row used to compute the contribution wheel. */
  skaterSeason?: ContributionWheelSeason | null
  /** Other team members (used for per-stat ranking on the wheel). */
  teammates?: ContributionWheelTeammate[] | undefined
  /** Focal player's id so they're excluded from the rank pool. */
  playerId?: number | undefined
  gamertag?: string | undefined
  gameTitleName?: string | undefined
  /** Real freshness timestamp for the wheel header. */
  updatedAt?: Date | string | undefined
}

/**
 * The impact-weighted Contribution Wheel, for skaters and (since 2026-10-09,
 * operator) goalies — the goalie view replaced the older normalized donut.
 */
export function ContributionSection({
  selectedRole,
  skaterSeason,
  teammates,
  playerId,
  gamertag,
  gameTitleName,
  updatedAt,
}: Props) {
  const roleGp =
    skaterSeason == null
      ? 0
      : selectedRole === 'goalie'
        ? skaterSeason.goalieGp
        : skaterSeason.gamesPlayed
  if (!skaterSeason || roleGp === 0) {
    return (
      <section id="profile" className="space-y-4 scroll-mt-24">
        <SectionHeader
          label="Contribution Wheel"
          subtitle={`Impact share weighted by gamescore · ${selectedRole} view`}
        />
        <Panel className="flex min-h-[6rem] items-center justify-center">
          <p className="px-4 text-center font-condensed text-sm uppercase tracking-wider text-zinc-500">
            Not enough season data to build the contribution wheel yet.
          </p>
        </Panel>
      </section>
    )
  }
  return (
    <section id="profile" className="scroll-mt-24">
      <ContributionWheel
        role={selectedRole}
        season={skaterSeason}
        teammates={teammates}
        playerId={playerId}
        gamertag={gamertag}
        gameTitleName={gameTitleName}
        updatedAt={updatedAt}
      />
    </section>
  )
}
