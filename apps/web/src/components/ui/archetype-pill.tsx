import type { CSSProperties } from 'react'
import type { PlayerArchetype } from '@eanhl/db/schema'
import { ArchetypeIcon } from './archetype-icons'
import './archetype-pill.css'

/**
 * Per-archetype display config: color, RGB string for `rgba(var(--c-rgb))`,
 * compact name fragments (prefix + accented suffix), human-readable category,
 * archetype-flavor descriptor, and the canonical `A·NN` ID stamp.
 */
interface ArchetypeMeta {
  color: string
  rgb: string
  /** Full name displayed in feature/flagship variants. Second tuple element is rendered in the accent color. */
  name: [prefix: string, accent: string]
  /** Compact name for the 22px chip — often abbreviated (e.g. POWER FWD). */
  compactName: [prefix: string, accent: string]
  category: 'Forward' | 'Defenseman'
  /** Short flavor descriptor — appears on feature variant. */
  descriptor: string
  /** A·NN stamp shown on flagship + feature. */
  id: string
}

const META: Record<PlayerArchetype, ArchetypeMeta> = {
  playmaker: {
    color: '#3AB7FF',
    rgb: '58,183,255',
    name: ['PLAY', 'MAKER'],
    compactName: ['', 'PLY'],
    category: 'Forward',
    descriptor: 'Vision · Distribution',
    id: 'A·01',
  },
  sniper: {
    color: '#FF5A4F',
    rgb: '255,90,79',
    name: ['', 'SNIPER'],
    compactName: ['', 'SNP'],
    category: 'Forward',
    descriptor: 'Precision · Finishing',
    id: 'A·02',
  },
  'power-forward': {
    color: '#FF9B42',
    rgb: '255,155,66',
    name: ['POWER ', 'FWD'],
    compactName: ['', 'PWF'],
    category: 'Forward',
    descriptor: 'Strength · Net front',
    id: 'A·03',
  },
  grinder: {
    color: '#C68A2B',
    rgb: '198,138,43',
    name: ['', 'GRINDER'],
    compactName: ['', 'GRN'],
    category: 'Forward',
    descriptor: 'Work rate · Cycle',
    id: 'A·04',
  },
  'two-way-fwd': {
    color: '#47C772',
    rgb: '71,199,114',
    name: ['TWO-WAY ', 'FWD'],
    compactName: ['', 'TWF'],
    category: 'Forward',
    descriptor: 'Balance · Both ends',
    id: 'A·05',
  },
  enforcer: {
    color: '#C92A2A',
    rgb: '201,42,42',
    name: ['', 'ENFORCER'],
    compactName: ['', 'ENF'],
    category: 'Forward',
    descriptor: 'Physical · Protect',
    id: 'A·06',
  },
  'defensive-d': {
    color: '#8FA3B8',
    rgb: '143,163,184',
    name: ['DEFENSIVE ', 'D'],
    compactName: ['', 'DFD'],
    category: 'Defenseman',
    descriptor: 'Shutdown · Box-out',
    id: 'A·07',
  },
  'offensive-d': {
    color: '#4D7CFE',
    rgb: '77,124,254',
    name: ['OFFENSIVE ', 'D'],
    compactName: ['', 'OFD'],
    category: 'Defenseman',
    descriptor: 'Shot · Pinch',
    id: 'A·08',
  },
  'two-way-d': {
    color: '#22B8A7',
    rgb: '34,184,167',
    name: ['TWO-WAY ', 'D'],
    compactName: ['', 'TWD'],
    category: 'Defenseman',
    descriptor: 'Balance · Both ends',
    id: 'A·09',
  },
  'enforcer-d': {
    color: '#7A1E3A',
    rgb: '122,30,58',
    name: ['ENFORCER ', 'D'],
    compactName: ['', 'EFD'],
    category: 'Defenseman',
    descriptor: 'Hammer · Punish',
    id: 'A·10',
  },
  puckmover: {
    color: '#6A5CFF',
    rgb: '106,92,255',
    name: ['PUCK-MOVING ', 'D'],
    compactName: ['', 'PMD'],
    category: 'Defenseman',
    descriptor: 'Transition · Outlet',
    id: 'A·11',
  },
}

function styleVars(meta: ArchetypeMeta): CSSProperties {
  return {
    ['--c' as string]: meta.color,
    ['--c-rgb' as string]: meta.rgb,
  }
}

/**
 * Compact 22px pill — drop-in for tight contexts (table rows, leader tiles).
 *
 * Tooltip prepends the long-form archetype name (e.g. "PLAYMAKER") so users
 * can decode the 3-letter compact code (`PLY`) on hover. Cross-section:
 * benefits Top Performers + Scoresheet + Lineup since they all consume this.
 */
export function ArchetypePillCompact({ archetype }: { archetype: PlayerArchetype }) {
  const meta = META[archetype]
  const [prefix, accent] = meta.compactName
  const longName = `${meta.name[0]}${meta.name[1]}`
  return (
    <span
      className="arc-mini"
      style={styleVars(meta)}
      title={`${longName} · ${meta.category} · ${meta.descriptor}`}
    >
      <span className="ico">
        <ArchetypeIcon archetype={archetype} />
      </span>
      {prefix}
      <b>{accent}</b>
    </span>
  )
}

/**
 * Flagship 38px pill — primary archetype display, used in player cards
 * and any context that wants the full name + role line.
 */
export function ArchetypePillFlagship({ archetype }: { archetype: PlayerArchetype }) {
  const meta = META[archetype]
  const [prefix, accent] = meta.name
  const roleLine = `${meta.category === 'Forward' ? 'FWD' : 'DEF'} · ${meta.id}`
  const stamp = meta.id.replace('A·', '')
  return (
    <span className="arc" style={styleVars(meta)}>
      <span className="ico">
        <ArchetypeIcon archetype={archetype} />
      </span>
      <span className="body">
        <span className="name">
          {prefix}
          <b>{accent}</b>
        </span>
        <span className="role">{roleLine}</span>
      </span>
      <span className="stamp">{stamp}</span>
    </span>
  )
}

/**
 * Feature 84px showcase tile — large hero treatment for the player profile.
 */
export function ArchetypePillFeature({ archetype }: { archetype: PlayerArchetype }) {
  const meta = META[archetype]
  const [prefix, accent] = meta.name
  return (
    <div className="arc-feature" style={styleVars(meta)}>
      <div className="icoslot">
        <ArchetypeIcon archetype={archetype} />
      </div>
      <div className="copy">
        <div className="name">
          {prefix}
          <b>{accent}</b>
        </div>
        <div className="meta">
          <span>{meta.category}</span>
          <span className="div">·</span>
          <span>{meta.descriptor}</span>
        </div>
      </div>
      <div className="stamp">
        <span className="id">{meta.id}</span>
        <span className="lab">Archetype</span>
      </div>
    </div>
  )
}
