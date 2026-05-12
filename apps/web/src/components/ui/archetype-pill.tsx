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
    color: '#38bdf8',
    rgb: '56,189,248',
    name: ['PLAY', 'MAKER'],
    compactName: ['PLAY', 'MAKER'],
    category: 'Forward',
    descriptor: 'Vision · Distribution',
    id: 'A·01',
  },
  sniper: {
    color: '#ef4444',
    rgb: '239,68,68',
    name: ['', 'SNIPER'],
    compactName: ['', 'SNIPER'],
    category: 'Forward',
    descriptor: 'Precision · Finishing',
    id: 'A·02',
  },
  'power-forward': {
    color: '#fb923c',
    rgb: '251,146,60',
    name: ['POWER ', 'FWD'],
    compactName: ['POWER ', 'FWD'],
    category: 'Forward',
    descriptor: 'Strength · Net front',
    id: 'A·03',
  },
  grinder: {
    color: '#d97706',
    rgb: '217,119,6',
    name: ['', 'GRINDER'],
    compactName: ['', 'GRINDER'],
    category: 'Forward',
    descriptor: 'Work rate · Cycle',
    id: 'A·04',
  },
  'two-way-fwd': {
    color: '#22c55e',
    rgb: '34,197,94',
    name: ['TWO-WAY ', 'FWD'],
    compactName: ['TWO-WAY ', 'F'],
    category: 'Forward',
    descriptor: 'Balance · Both ends',
    id: 'A·05',
  },
  enforcer: {
    color: '#dc2626',
    rgb: '220,38,38',
    name: ['', 'ENFORCER'],
    compactName: ['', 'ENFORCER'],
    category: 'Forward',
    descriptor: 'Physical · Protect',
    id: 'A·06',
  },
  'defensive-d': {
    color: '#94a3b8',
    rgb: '148,163,184',
    name: ['DEFENSIVE ', 'D'],
    compactName: ['DEF ', 'D'],
    category: 'Defenseman',
    descriptor: 'Shutdown · Box-out',
    id: 'A·07',
  },
  'offensive-d': {
    color: '#a855f7',
    rgb: '168,85,247',
    name: ['OFFENSIVE ', 'D'],
    compactName: ['OFF ', 'D'],
    category: 'Defenseman',
    descriptor: 'Shot · Pinch',
    id: 'A·08',
  },
  'two-way-d': {
    color: '#14b8a6',
    rgb: '20,184,166',
    name: ['TWO-WAY ', 'D'],
    compactName: ['TWO-WAY ', 'D'],
    category: 'Defenseman',
    descriptor: 'Balance · Both ends',
    id: 'A·09',
  },
  'enforcer-d': {
    color: '#9f1239',
    rgb: '159,18,57',
    name: ['ENFORCER ', 'D'],
    compactName: ['ENF ', 'D'],
    category: 'Defenseman',
    descriptor: 'Hammer · Punish',
    id: 'A·10',
  },
  puckmover: {
    color: '#6366f1',
    rgb: '99,102,241',
    name: ['PUCK-MOVING ', 'D'],
    compactName: ['PUCK-', 'MV'],
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
 */
export function ArchetypePillCompact({ archetype }: { archetype: PlayerArchetype }) {
  const meta = META[archetype]
  const [prefix, accent] = meta.compactName
  return (
    <span
      className="arc-mini"
      style={styleVars(meta)}
      title={`${meta.category} · ${meta.descriptor}`}
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
