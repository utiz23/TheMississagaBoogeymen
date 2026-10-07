(function () {
  var hex = 'polygon(50% 0, 100% 25%, 100% 75%, 50% 100%, 0 75%, 0 25%)';
  var RED_RULE = 'linear-gradient(90deg, rgba(232,65,49,0.55) 0%, rgba(232,65,49,0.95) 18%, rgba(232,65,49,0.95) 82%, rgba(232,65,49,0.55) 100%)';
  var baselinePortrait = 'radial-gradient(ellipse at 50% 28%, rgba(232,65,49,0.12), transparent 55%), linear-gradient(180deg, #2a2829, #18181b 70%, #0f0e10)';

  var THEMES = {
    away: { name: 'Away', tier: 1, desc: 'White face, silver bevel rim. No gloss.',
      layers: ['linear-gradient(180deg, #ffffff, #ececed)'], border: null, grad: 'linear-gradient(160deg, #ffffff, #71717a 45%, #d4d4d8 70%, #52525b)',
      rule: '#a1a1aa', ruleHot: RED_RULE, jersey: '#ffffff', jerseyEdge: '1px 1px 0 rgba(0,0,0,0.06)', num: '#121011', texture: null, light: true,
      innerRim: 'rgba(0,0,0,0.07)', backHead: 'linear-gradient(180deg, #f4f4f5, #e9e9eb)', backHeadLine: 'rgba(0,0,0,0.12)', backHeadSub: '#52525b', backHeadSh: 'inset 0 1px 0 #ffffff',
      ledgerBg: 'linear-gradient(135deg, transparent 0 80%, rgba(176,42,24,0.12) 80% 81.5%, transparent 81.5%), linear-gradient(180deg, #f6f6f7, #ebebed)', ledgerBorder: '1px solid rgba(0,0,0,0.10)', ledgerSh: 'inset 0 1px 0 #ffffff, inset 0 -1px 0 rgba(0,0,0,0.04)', ledgerLine: 'rgba(0,0,0,0.14)', ledgerLine2: 'rgba(0,0,0,0.07)',
      portrait: 'radial-gradient(ellipse at 50% 28%, rgba(232,65,49,0.10), transparent 55%), linear-gradient(180deg, #f2f2f3, #dcdcde 70%, #c9c9cc)', silh: '#a1a1a8', shadow: '',
      tk: { ink: '#0a0909', sv: '#1a1819', sl: '#52525b', rec: '#3f3f46', pct: '#121011', line: 'rgba(26,24,25,0.28)', lead: '#b02a18', leadL: '#b02a18', pipOn: '#c2321f', pipOff: '#bcbcc1', edition: '#52525b', chipC: '#3f3f46', chipB: '#71717a', backHead: '#71717a', backLabel: '#71717a', backFoot: '#71717a', badgeLabel: '#3f3f46' } },
    home: { name: 'Home', tier: 2, desc: 'The current site card: charcoal field, grey rule at rest, red on hover.',
      layers: ['linear-gradient(180deg, #1f1d1e, #131112)'], border: '#2a2829', grad: null,
      rule: '#3f3f46', ruleHot: RED_RULE, jersey: '#0c0b0c', jerseyEdge: '1px 1px 0 #2a2829', num: '#d4d4d8', texture: null,
      innerRim: 'rgba(255,255,255,0.035)', backHead: 'linear-gradient(180deg, #232122, #171516)', backHeadLine: '#2a2829', backHeadSub: '#71717a', backHeadSh: 'inset 0 1px 0 rgba(255,255,255,0.05)',
      ledgerBg: 'linear-gradient(135deg, transparent 0 80%, rgba(232,65,49,0.14) 80% 81.5%, transparent 81.5%), linear-gradient(180deg, #0e0d0e, #0a090a)', ledgerBorder: '1px solid #2a2829', ledgerSh: 'inset 0 1px 2px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.03)', ledgerLine: '#2a2829', ledgerLine2: 'rgba(42,40,41,0.6)',
      portrait: baselinePortrait, silh: '#27272a', shadow: '',
      tk: { backHead: '#71717a', backLabel: '#71717a', backFoot: '#6e6b6c', badgeLabel: '#a1a1aa' } },
    alternate: { name: 'Alternate', tier: 3, desc: 'Red gloss, red-to-white bevel rim, black jersey block, diagonal cuts.',
      layers: ['linear-gradient(118deg, transparent 0 74%, rgba(0,0,0,0.12) 74% 79%, transparent 79% 82%, rgba(0,0,0,0.07) 82% 84%, transparent 84%)', 'linear-gradient(180deg, #f0503e 0%, #d23a28 40%, #8e1f12 100%)'], border: null, grad: 'linear-gradient(160deg, #ffd9d4, #e84131 35%, #7a1a10 65%, #ef6a5e)', gloss: true, texture: null,
      innerRim: 'rgba(255,230,226,0.22)', jerseyClip: 'polygon(0 0, 100% 0, 100% calc(100% - 16px), calc(100% - 16px) 100%, 0 100%)',
      backHead: 'linear-gradient(118deg, transparent 0 66%, rgba(232,65,49,0.32) 66% 71%, transparent 71% 75%, rgba(232,65,49,0.16) 75% 78%, transparent 78%), linear-gradient(180deg, #1a1213, #0c0707)',
      careerPanel: 'linear-gradient(118deg, transparent 0 72%, rgba(232,65,49,0.14) 72% 76%, transparent 76%), linear-gradient(180deg, #221615, #0c0707)',
      ledgerBorder: '0', ledgerSh: 'inset 0 1px 0 rgba(255,217,212,0.10), 0 6px 14px rgba(60,10,4,0.45)', ledgerLine: 'rgba(239,106,94,0.28)', ledgerLine2: 'rgba(255,255,255,0.07)',
      backHeadSh: 'inset 0 -1px 0 rgba(239,106,94,0.35), 0 4px 12px rgba(60,10,4,0.35)', backHeadLine: 'rgba(0,0,0,0.6)', backHeadSub: '#ffd9d4',
      rule: 'rgba(0,0,0,0.35)', ruleHot: '#ffffff', jersey: '#121011', num: '#e84131',
      portrait: 'linear-gradient(118deg, transparent 0 58%, rgba(232,65,49,0.30) 58% 64%, transparent 64% 68%, rgba(232,65,49,0.16) 68% 71%, transparent 71%), radial-gradient(ellipse at 50% 30%, rgba(232,65,49,0.18), transparent 60%), linear-gradient(180deg, #221615, #0c0707)',
      clip: 'polygon(0 0, 100% 0, 100% calc(100% - 22px), calc(100% - 22px) 100%, 0 100%)', silh: '#3a1f1b', shadow: '',
      tk: { ink: '#ffffff', sv: '#ffffff', sl: 'rgba(255,255,255,0.72)', rec: 'rgba(255,255,255,0.72)', pct: '#ffffff', line: 'rgba(255,255,255,0.6)', lead: '#ffffff', leadL: '#ffd9d4', pipOn: '#ffffff', pipOff: 'rgba(0,0,0,0.28)', edition: 'rgba(255,255,255,0.7)', backLabel: '#ffe4e0', backHead: '#d4d4d8', backFoot: 'rgba(255,255,255,0.85)', careerLead: '#ef6a5e', badgeLabel: '#ffffff' } },
    carbon: { name: 'Carbon-Fiber', tier: 4, desc: 'High-contrast twill weave, brushed-steel jersey plate, chamfered HUD portrait, steel rim with red accent.',
      layers: [
        'linear-gradient(118deg, rgba(255,255,255,0.10) 0%, transparent 24%, transparent 56%, rgba(255,255,255,0.06) 68%, transparent 80%)',
        'radial-gradient(120% 55% at 50% 0%, rgba(232,65,49,0.12), transparent 60%)',
        'linear-gradient(180deg, rgba(0,0,0,0) 45%, rgba(0,0,0,0.45) 100%)',
        'linear-gradient(27deg, #0c0c0c 4px, transparent 4px) 0 4px/16px 16px',
        'linear-gradient(207deg, #0c0c0c 4px, transparent 4px) 8px 0/16px 16px',
        'linear-gradient(27deg, #2c2c2e 4px, transparent 4px) 0 8px/16px 16px',
        'linear-gradient(207deg, #2c2c2e 4px, transparent 4px) 8px 4px/16px 16px',
        'linear-gradient(90deg, #1c1c1d 8px, transparent 8px) 0 0/16px 16px',
        'linear-gradient(#262628 25%, #151516 25%, #151516 50%, transparent 50%, transparent 75%, #303033 75%, #303033) 0 0/16px 16px',
        'linear-gradient(#0e0e0e, #0e0e0e)'
      ], border: null,
      grad: 'linear-gradient(135deg, #f4f4f5 0%, #71717a 14%, #27272a 28%, #e84131 40%, #7a1a10 46%, #a1a1aa 58%, #3f3f46 72%, #e4e4e7 86%, #52525b 100%)',
      rule: RED_RULE, ruleHot: '#e84131',
      jersey: 'linear-gradient(90deg, rgba(255,255,255,0) 0, rgba(255,255,255,0.18) 50%, rgba(255,255,255,0) 100%), repeating-linear-gradient(180deg, rgba(255,255,255,0.05) 0 1px, rgba(0,0,0,0.04) 1px 2px), linear-gradient(160deg, #e4e4e7, #a1a1aa 45%, #71717a 100%)',
      jerseyEdge: 'inset 0 -1px 0 rgba(0,0,0,0.5), inset -1px 0 0 rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.6), 0 0 0 1px #e84131',
      num: '#121011',
      portrait: 'radial-gradient(ellipse at 50% 30%, rgba(232,65,49,0.20), transparent 60%), linear-gradient(180deg, rgba(14,14,15,0.80), rgba(4,4,4,0.92))',
      clip: 'polygon(18px 0, 100% 0, 100% calc(100% - 18px), calc(100% - 18px) 100%, 0 100%, 0 18px)',
      hud: false, bevel: true, silh: '#2e2e30',
      plates: { clip: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)',
        bg: 'linear-gradient(180deg, rgba(24,24,26,0.88), rgba(6,6,7,0.92))', sh: 'inset 0 1px 0 rgba(255,255,255,0.09), inset 0 -1px 0 rgba(0,0,0,0.6)',
        lead: 'linear-gradient(180deg, rgba(232,65,49,0.26), rgba(40,8,5,0.92) 70%)', leadSh: 'inset 0 2px 0 #e84131, inset 0 -1px 0 rgba(0,0,0,0.6)',
        lc: '#a1a1aa', vc: '#e4e4e7', leadL: '#ef6a5e', leadV: '#e84131' },
      backNum: '#e84131', backHead: 'linear-gradient(180deg, rgba(10,10,11,0.92), rgba(4,4,5,0.88))', backHeadLine: 'rgba(232,65,49,0.45)', backHeadSub: '#a1a1aa',
      careerPanel: 'linear-gradient(135deg, transparent 0 80%, rgba(232,65,49,0.16) 80% 81.5%, transparent 81.5%), linear-gradient(180deg, rgba(24,24,26,0.9), rgba(6,6,7,0.94))',
      ledgerClip: 'polygon(10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%, 0 10px)', ledgerBorder: '0', ledgerSh: 'inset 0 1px 0 rgba(255,255,255,0.09), inset 0 -1px 0 rgba(0,0,0,0.6)', ledgerLine: 'rgba(232,65,49,0.35)', ledgerLine2: 'rgba(161,161,170,0.12)',
      backHeadSh: 'inset 0 1px 0 rgba(255,255,255,0.10), 0 1px 0 rgba(232,65,49,0.25)', barGlow: '0 0 6px rgba(232,65,49,0.45)',
      shadow: ', 0 0 22px rgba(232,65,49,0.16)',
      tk: { ink: '#fafafa', sv: '#e4e4e7', sl: '#a1a1aa', rec: '#27272a', pct: '#121011', line: 'rgba(161,161,170,0.24)', lead: '#e84131', leadL: '#ef6a5e', pipOn: '#e84131', pipOff: 'rgba(255,255,255,0.12)', edition: '#71717a', backLabel: '#a1a1aa', backHead: '#a1a1aa', backFoot: '#a1a1aa', careerLead: '#ef6a5e', badgeLabel: '#d4d4d8' } },
    frozen: { name: 'Frozen', tier: 5, desc: 'Glacier ice texture, bright at the top fading to deep ice at the bottom, translucent ice jersey block, pale ice rim.',
      layers: [
        'radial-gradient(70% 38% at 0% 0%, rgba(225,243,251,0.26), transparent 70%)',
        'radial-gradient(60% 34% at 100% 100%, rgba(225,243,251,0.20), transparent 70%)',
        'radial-gradient(40% 22% at 100% 0%, rgba(225,243,251,0.10), transparent 70%)',
        'conic-gradient(from 205deg at 72% 38%, rgba(255,255,255,0.06), transparent 18%, rgba(190,228,245,0.05) 34%, transparent 52%, rgba(255,255,255,0.04) 70%, transparent 86%)',
        'linear-gradient(180deg, rgba(10,32,46,0.28) 0%, rgba(8,26,38,0.50) 35%, rgba(5,16,24,0.78) 65%, rgba(3,9,14,0.92) 100%)',
        "url('assets/tex-ice-glacier.png') center/cover no-repeat",
        'linear-gradient(#060c11, #060c11)'
      ], border: null,
      grad: 'linear-gradient(150deg, #ffffff 0%, #bfe3f2 18%, #4f7d96 38%, #eaf7fc 54%, #3a6075 74%, #d4eef8 100%)',
      rule: 'linear-gradient(90deg, rgba(191,227,242,0.45), #eaf7fc 50%, rgba(191,227,242,0.45))', ruleHot: RED_RULE,
      jersey: 'linear-gradient(160deg, rgba(210,238,250,0.16), rgba(120,175,200,0.04)), linear-gradient(180deg, #0c202d, #071620)',
      jerseyEdge: 'inset -1px -1px 0 rgba(220,240,250,0.40), inset 0 1px 0 rgba(255,255,255,0.25)',
      num: '#eaf7fc',
      portrait: 'transparent',
      frost: true, icePanel: true, silh: '#1f3647',
      shelf: { bg: 'transparent',
        sh: 'inset 0 1px 0 rgba(255,255,255,0.65), inset 0 -1px 0 rgba(210,238,250,0.30), inset 0 0 0 1px rgba(210,238,250,0.16), inset 0 0 24px rgba(200,235,250,0.08)' },
      backNum: '#eaf7fc', unlockBg: 'linear-gradient(180deg, rgba(4,14,22,0.5), rgba(4,14,22,0.3))', backHead: 'linear-gradient(180deg, rgba(4,14,22,0.72), rgba(4,14,22,0.55))', backHeadLine: 'rgba(225,243,251,0.45)', backHeadSub: '#b4d3e2',
      careerPanel: 'linear-gradient(180deg, rgba(225,243,251,0.14), rgba(4,14,22,0.55) 30%, rgba(4,14,22,0.68))',
      careerSh: 'inset 0 1px 0 rgba(255,255,255,0.65), inset 0 -1px 0 rgba(210,238,250,0.30), inset 0 0 0 1px rgba(210,238,250,0.18), inset 0 0 24px rgba(200,235,250,0.10)',
      ledgerR: '10px', ledgerLine: 'rgba(225,243,251,0.40)', ledgerLine2: 'rgba(210,238,250,0.10)',
      backHeadSh: 'inset 0 1px 0 rgba(255,255,255,0.35), 0 1px 8px rgba(200,235,250,0.18)', barGlow: '0 0 6px rgba(212,238,248,0.55)',
      shadow: ', 0 0 26px rgba(160,215,240,0.18)',
      tk: { ink: '#f4fbfe', sv: '#e3f2f9', sl: '#9dbfd0', rec: '#b4d3e2', pct: '#f4fbfe', line: 'rgba(170,215,235,0.22)', lead: '#e84131', leadL: '#ef6a5e', pipOn: '#d4eef8', pipOff: 'rgba(191,227,242,0.14)', edition: '#7fa3b6', chipC: null, backLabel: '#d4eef8', backHead: '#b4d3e2', backFoot: '#b4d3e2', careerLead: '#ef6a5e', badgeLabel: '#e3f2f9' } },
    storm: { name: 'Storm', tier: 6, mythic: true, desc: 'Mythic. Calm thunderhead field; every 16s the live storm footage rolls in for ~4s at full intensity, then clears.',
      layers: [
        'linear-gradient(180deg, rgba(5,8,14,0.10) 0%, rgba(5,8,14,0.30) 34%, rgba(4,6,11,0.55) 60%, rgba(3,4,8,0.78) 100%)',
        "url('assets/tex-storm-clouds.png') center top/cover no-repeat",
        'linear-gradient(#05070b, #05070b)'
      ], border: null,
      grad: 'linear-gradient(160deg, #f2f9ff 0%, #6fb6ff 16%, #1b2a44 38%, #cfeaff 54%, #24365a 74%, #8fd0ff 100%)',
      rule: 'linear-gradient(90deg, rgba(111,182,255,0.45), #eaf6ff 50%, rgba(111,182,255,0.45))', ruleHot: RED_RULE,
      jersey: 'linear-gradient(160deg, rgba(160,205,255,0.16), rgba(60,90,140,0.04)), linear-gradient(180deg, rgba(8,12,20,0.78), rgba(4,6,10,0.88))',
      jerseyEdge: 'inset -1px -1px 0 rgba(160,210,255,0.45), inset 0 1px 0 rgba(255,255,255,0.18)',
      num: '#dff1ff',
      portrait: 'radial-gradient(ellipse at 50% 22%, rgba(150,205,255,0.18), transparent 60%), linear-gradient(180deg, rgba(10,16,28,0.45), rgba(4,6,10,0.80))',
      storm: true, silh: '#1c2638', edition: 'MYTHIC · STORM',
      pulse: 'rgba(160,210,255,0.9)', foilTint: 'rgba(150,205,255,0.18)',
      art: { clouds: null, bolt: null, burst: 'assets/tex-storm-live.webp', rain: null, noRain: true, noFlash: true },
      shadow: ', 0 0 30px rgba(111,182,255,0.24)',
      tk: { ink: '#f2f8ff', sv: '#e1ecf8', sl: '#93a7c2', rec: '#a8bbd4', pct: '#f2f8ff', line: 'rgba(140,180,230,0.22)', lead: '#e84131', leadL: '#ef6a5e', pipOn: '#cfeaff', pipOff: 'rgba(160,200,255,0.14)', edition: '#8fa3bd', chipC: null } },
    stormLive: null,
    smoke: { name: 'Smoke', tier: 5, draft: true, desc: 'Draft. Black/red smoke, skull watermark, legendary glow.',
      layers: ['radial-gradient(120% 60% at 15% 85%, rgba(194,50,31,0.35), transparent 60%)', 'radial-gradient(90% 50% at 85% 15%, rgba(232,65,49,0.20), transparent 60%)', 'linear-gradient(180deg, #0d0909, #040303)'], border: null,
      grad: 'linear-gradient(160deg, #e84131, #3a0d08 35%, #120606 60%, #c2321f)',
      rule: '#e84131', ruleHot: '#e84131', jersey: 'rgba(0,0,0,0.82)', num: '#e84131',
      portrait: 'radial-gradient(ellipse at 50% 35%, rgba(232,65,49,0.28), transparent 62%), linear-gradient(180deg, rgba(30,12,10,0.75), rgba(5,3,3,0.92))', watermark: true, silh: '#2d1714', shadow: ', 0 0 34px rgba(232,65,49,0.30)' },
    throwback: { name: 'Throwback', tier: 0, archive: true, desc: 'Old-card paper, print dots, Archive Series.',
      layers: ['radial-gradient(rgba(235,225,200,0.07) 0.8px, transparent 1.2px) 0 0/4px 4px', 'linear-gradient(180deg, #221e19, #14110e)'], border: '#5c5040', grad: null,
      rule: '#8a7658', ruleHot: '#b39a72', jersey: '#0e0c0a', num: '#8a7a60',
      portrait: 'radial-gradient(ellipse at 50% 30%, rgba(214,196,160,0.12), transparent 60%), linear-gradient(180deg, #2a251f, #15120f)', frame: true, silh: '#3a3329', edition: 'ARCHIVE SERIES', shadow: '', pip: '#b39a72' },
    glitch: { name: 'Glitch', tier: 0, archive: true, desc: 'Cyber grid, RGB split, heavy scan lines.',
      layers: ['linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px) 0 0/100% 14px', 'linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px) 0 0/14px 100%', 'linear-gradient(180deg, #0f1113, #07080a)'], border: '#2b3036', grad: null,
      rule: 'linear-gradient(90deg, #e84131 0 50%, #13dfc8 50% 100%)', ruleHot: 'linear-gradient(90deg, #e84131 0 50%, #13dfc8 50% 100%)', jersey: '#050607', num: '#3d4248',
      portrait: 'radial-gradient(ellipse at 50% 30%, rgba(19,223,200,0.10), transparent 55%), linear-gradient(180deg, #1a1d20, #0b0c0e)', glitch: true, silh: '#22262a', edition: 'SYSTEM // NHL 26', shadow: '' }
  };

  // Final 10, in order: Away · Home · Alternate · Carbon-Fiber · Grid · Frozen · Cyber · Inferno · Storm · Maximus.
  THEMES.stormLive = Object.assign({}, THEMES.storm, { name: 'Storm', desc: 'Mythic. Rain over thunderheads for a random 6–16s, then the live lightning footage cuts in for 1–2s.',
    layers: [
      'radial-gradient(90% 45% at 50% 8%, rgba(120,190,255,0.30), transparent 70%)', 'radial-gradient(80% 40% at 50% 70%, rgba(80,150,255,0.18), transparent 70%)', 'linear-gradient(180deg, rgba(8,16,32,0) 0%, rgba(8,16,32,0.14) 34%, rgba(8,14,28,0.36) 60%, rgba(6,12,24,0.58) 100%)',
      "url('assets/tex-storm-clouds.png') center top/cover no-repeat",
      'linear-gradient(#0a1424, #0a1424)'
    ],
    portrait: 'radial-gradient(ellipse at 50% 22%, rgba(170,220,255,0.22), transparent 62%)',
    edition: 'MYTHIC · STORM', silh: '#2c4468',
    jersey: 'linear-gradient(180deg, rgba(190,225,255,0.18), transparent 45%), linear-gradient(160deg, #24406a, #0e1a30)',
    jerseyEdge: 'inset 0 1px 0 rgba(220,240,255,0.30), inset -1px -1px 0 rgba(120,180,255,0.40)',
    numGlow: '0 0 12px rgba(120,195,255,0.75)',
    plates: null, arc: { fill: 'rgba(40,110,220,0.16)', line: 'rgba(150,210,255,0.75)', core: '#f2faff', glow: '#4fa8ff' },
    backNum: '#cfeaff', backHead: 'linear-gradient(180deg, rgba(14,30,58,0.88), rgba(14,30,58,0.68))', backHeadLine: '#8fd0ff', backHeadSub: '#b4c8e0',
    backHeadSh: '0 1px 8px rgba(111,182,255,0.55)',
    unlockBg: 'linear-gradient(180deg, rgba(6,10,18,0.66), rgba(6,10,18,0.45))',
    careerPanel: 'linear-gradient(180deg, rgba(16,32,60,0.84), rgba(8,16,32,0.9))',
    careerSh: 'inset 0 1px 0 #8fd0ff, inset 0 0 0 1px rgba(120,180,255,0.22), inset 0 0 18px rgba(79,168,255,0.12), 0 -1px 8px rgba(111,182,255,0.30)',
    ledgerClip: 'polygon(9px 0, calc(100% - 9px) 0, 100% 9px, 100% calc(100% - 9px), calc(100% - 9px) 100%, 9px 100%, 0 calc(100% - 9px), 0 9px)', ledgerBorder: '0', ledgerLine: 'rgba(143,208,255,0.50)', ledgerLine2: 'rgba(120,180,255,0.12)',
    barGlow: '0 0 6px rgba(111,182,255,0.75)',
    backHeadSh: '0 1px 8px rgba(111,182,255,0.55), inset 0 1px 0 rgba(207,234,255,0.22)',
    shadow: ', 0 0 34px rgba(79,168,255,0.40)',
    tk: Object.assign({}, THEMES.storm.tk, { sl: '#a9bdd6', arch: '#a9bdd6', badgeLabel: '#cfe3f7', backLabel: '#cfe3f7', backHead: '#b4c8e0', backFoot: '#b4c8e0', careerLead: '#8fd0ff' }),
    art: { clouds: null, bolt: null, burst: 'assets/tex-storm-live.webp', rain: 'assets/fx-storm-rain.gif', noFlash: true, rimAlways: true, jitter: '1.6s' } });
  delete THEMES.storm;
  var svgUri = function (s) { return 'url("data:image/svg+xml,' + encodeURIComponent(s) + '")'; };
  var veinTable = function (w) { var t = []; for (var i = 0; i <= 40; i++) { var d = Math.abs(i - 20); t.push(d === 0 ? 0.38 : d <= w ? (0.38 * (1 - d / (w + 1))).toFixed(2) : 0); } return t.join(' '); };
  var marble = function (seed, f, w, c) { return svgUri("<svg xmlns='http://www.w3.org/2000/svg' width='300' height='460'><filter id='m' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='" + f + "' numOctaves='5' seed='" + seed + "'/><feColorMatrix values='0 0 0 0 " + c[0] + " 0 0 0 0 " + c[1] + " 0 0 0 0 " + c[2] + " 1 0 0 0 0'/><feComponentTransfer><feFuncA type='table' tableValues='" + veinTable(w) + "'/></feComponentTransfer></filter><rect width='100%' height='100%' filter='url(#m)'/></svg>"); };
  var MEANDER = svgUri("<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><path d='M0 0.7H12M0 11.3H12M2 11.3V3H9V8.5H5V5.5' fill='none' stroke='#b8892a' stroke-width='1.3'/></svg>");
  THEMES.olympus = { name: 'Maximus', tier: 6, mythic: true, desc: 'Mythic. Marble temple above the clouds, gilded rim and jersey plate, Greek key band, slow divine light rays and rising gold motes.',
    layers: [
      'linear-gradient(180deg, rgba(253,250,242,0) 0%, rgba(253,250,242,0.10) 42%, rgba(250,245,234,0.80) 58%, rgba(246,240,228,0.88) 100%)',
      "url('assets/tex-olympus-temple.png') center top/cover no-repeat",
      'linear-gradient(#f6f0e2, #f6f0e2)'
    ], border: null,
    grad: 'linear-gradient(150deg, #fff6d8 0%, #d4a845 16%, #8a6416 34%, #f7e3a0 50%, #a77a22 68%, #fff2c4 86%, #b8892a 100%)',
    rule: 'linear-gradient(90deg, rgba(184,137,42,0.55), #f2d27a 50%, rgba(184,137,42,0.55))', ruleHot: RED_RULE,
    jersey: 'linear-gradient(90deg, rgba(255,255,255,0) 0, rgba(255,250,225,0.40) 50%, rgba(255,255,255,0) 100%), linear-gradient(160deg, #f6e3a1 0%, #d2a548 40%, #a7781f 78%, #e7c46a 100%)',
    jerseyEdge: 'inset 0 -1px 0 rgba(90,60,10,0.45), inset -1px 0 0 rgba(90,60,10,0.30), inset 0 1px 0 rgba(255,250,225,0.8)',
    num: '#2a1f0a',
    portrait: 'radial-gradient(ellipse at 50% 0%, rgba(255,248,225,0.35), transparent 70%), linear-gradient(180deg, rgba(255,248,225,0.05), rgba(255,244,215,0.30))',
    plates: { clip: 'none', radius: '2px',
      bg: 'linear-gradient(180deg, #b8892a 0 2px, rgba(255,250,232,0.95) 2px 3px, transparent 3px calc(100% - 3px), rgba(255,250,232,0.95) calc(100% - 3px) calc(100% - 2px), #b8892a calc(100% - 2px)), linear-gradient(180deg, rgba(255,253,247,0.94), rgba(240,231,211,0.94))',
      sh: 'inset 1px 0 0 rgba(184,137,42,0.55), inset -1px 0 0 rgba(184,137,42,0.55), inset 0 0 10px rgba(214,164,52,0.14)',
      lead: 'linear-gradient(180deg, #8a6416 0 2px, #fff2c4 2px 3px, transparent 3px calc(100% - 3px), #fff2c4 calc(100% - 3px) calc(100% - 2px), #8a6416 calc(100% - 2px)), linear-gradient(160deg, #f8e7ab 0%, #d8ad4c 42%, #b8892a 78%, #ecca70 100%)',
      leadSh: 'inset 1px 0 0 #8a6416, inset -1px 0 0 #8a6416, inset 0 0 12px rgba(255,244,200,0.45), 0 0 10px rgba(230,190,90,0.45)',
      lc: '#6f5f40', vc: '#16120a', leadL: '#4a3508', leadV: '#1a1206' },
    olympus: true, meander: MEANDER, silh: '#c4a668', posInk: { c: '#5a4310', b: 'rgba(140,100,30,0.55)', bg: 'rgba(255,248,225,0.55)' },
    backHead: 'radial-gradient(80% 120% at 50% 0%, rgba(255,248,220,0.9), transparent 70%), linear-gradient(180deg, rgba(252,248,238,0.96), rgba(248,241,226,0.90))', backHeadLine: 'rgba(184,137,42,0.55)', backHeadSub: '#6f5f40', backHeadSh: 'inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 0 rgba(255,250,225,0.8)',
    backNum: '#8a6416', numGlow: '0 1px 0 rgba(255,250,225,0.9)', backMeander: true,
    ledgerBg: 'linear-gradient(180deg, #b8892a 0 2px, rgba(255,250,232,0.95) 2px 3px, transparent 3px calc(100% - 3px), rgba(255,250,232,0.95) calc(100% - 3px) calc(100% - 2px), #b8892a calc(100% - 2px)), radial-gradient(90% 60% at 50% 0%, rgba(255,248,220,0.7), transparent 70%), linear-gradient(180deg, rgba(255,253,247,0.95), rgba(240,231,211,0.95))',
    ledgerBorder: '0', ledgerR: '2px', ledgerSh: 'inset 1px 0 0 rgba(184,137,42,0.55), inset -1px 0 0 rgba(184,137,42,0.55), inset 0 0 14px rgba(214,164,52,0.16), 0 4px 14px rgba(120,90,30,0.18)',
    ledgerLine: 'rgba(184,137,42,0.55)', ledgerLine2: 'rgba(140,110,50,0.16)', unlockBg: 'linear-gradient(180deg, rgba(250,245,234,0.80), rgba(250,245,234,0.66))', edition: 'MYTHIC · MAXIMUS',
    pulse: 'rgba(255,214,120,0.95)', foilTint: 'rgba(255,220,140,0.30)',
    shadow: ', 0 0 30px rgba(230,190,90,0.30)',
    tk: { ink: '#16120a', sv: '#2a2216', sl: '#6f5f40', rec: '#3d2e10', pct: '#1a1206', line: 'rgba(140,110,50,0.30)', lead: '#b02a18', leadL: '#b02a18', pipOn: '#b8892a', pipOff: 'rgba(140,110,50,0.20)', edition: '#7a6640', arch: '#6f5f40', badgeLabel: '#4a3d22', backLabel: '#8a6416', backHead: '#6f5f40', backFoot: '#6f5f40', careerLead: '#8a6416', chipC: null } };
  var CIRCUIT = svgUri("<svg xmlns='http://www.w3.org/2000/svg' width='72' height='72'><g fill='none' stroke='#000' stroke-width='1'><path d='M0 18H20L28 26H72M34 0V10L42 18H52M8 72V52L16 44H44L52 52V72M60 26V36L66 42H72'/></g><g fill='#000'><circle cx='52' cy='18' r='2'/><circle cx='44' cy='44' r='2'/><circle cx='60' cy='36' r='1.6'/></g></svg>");
  var FUT_DARK_TK = { ink: '#f5f7ff', sv: '#e4e7f2', sl: '#9aa0b4', rec: '#b8bdd0', pct: '#f5f7ff', line: 'rgba(170,180,220,0.22)', lead: '#e84131', leadL: '#ef6a5e', pipOn: '#e8ecff', pipOff: 'rgba(170,180,220,0.22)', edition: '#8d93a8', arch: '#9aa0b4', badgeLabel: '#9aa0b4', chipC: null };
  var RAINBOW = 'repeating-linear-gradient(135deg, #ff2e88 0%, #ff9a2e 5%, #f4ff3a 10%, #2eff9a 15%, #2ec8ff 20%, #8a2eff 25%, #ff2e88 30%)';
  THEMES.futureA = { name: 'Future · Holo', tier: 6, mythic: true, archive: true, future: 'holo', rainbow: RAINBOW, desc: 'Black foil field under a saturated diagonal rainbow holo that drifts across the card, etched foil grain, rainbow-chrome rim.',
    layers: ['radial-gradient(90% 40% at 50% 0%, rgba(200,215,255,0.08), transparent 70%)', 'linear-gradient(180deg, #0a0a10 0%, #050508 55%, #020203 100%)'], border: null,
    grad: 'linear-gradient(135deg, #ff2e88 0%, #ffffff 10%, #ff9a2e 20%, #f4ff3a 30%, #2eff9a 42%, #ffffff 50%, #2ec8ff 60%, #8a2eff 74%, #ffffff 84%, #ff2e88 100%)',
    rule: 'linear-gradient(90deg, #ff2e88, #ff9a2e 20%, #f4ff3a 40%, #2eff9a 60%, #2ec8ff 80%, #8a2eff)', ruleHot: RED_RULE,
    jersey: 'linear-gradient(135deg, rgba(255,46,136,0.38), rgba(244,255,58,0.30) 30%, rgba(46,255,154,0.30) 55%, rgba(46,200,255,0.38) 78%, rgba(138,46,255,0.38)), linear-gradient(160deg, #f4f6fb 0%, #b9bdca 40%, #7b8091 72%, #e2e5ee 100%)',
    jerseyEdge: 'inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(0,0,0,0.4)',
    num: '#0c0d12',
    portrait: 'linear-gradient(180deg, rgba(14,14,22,0.55), rgba(4,4,8,0.92))',
    silh: '#1d1e27', edition: 'MYTHIC · FUTURE', pulse: 'rgba(255,255,255,0.95)', foilTint: 'rgba(255,120,220,0.22)',
    shadow: ', 0 0 28px rgba(160,120,255,0.24)', tk: Object.assign({}, FUT_DARK_TK, { rec: '#16171f', pct: '#0c0d12', pipOn: '#ffffff' }) };
  THEMES.futureB = { name: 'Hardlight', tier: 5, future: 'grid', desc: 'Hardlight HUD: red perspective grid runs toward a glowing horizon, corner brackets, a scan line sweeps the card.',
    layers: ['radial-gradient(70% 22% at 50% 0%, rgba(232,65,49,0.10), transparent 70%)', 'linear-gradient(180deg, #07080e 0%, #05060a 60%, #030305 100%)'], border: null,
    grad: 'linear-gradient(160deg, #ef6a5e 0%, #3a1410 22%, #0b0c14 50%, #3a1410 78%, #e84131 100%)',
    rule: '#e84131', ruleHot: '#ffffff',
    jersey: 'linear-gradient(180deg, rgba(232,65,49,0.16), rgba(232,65,49,0.04)), #07080e',
    jerseyEdge: 'inset -1px 0 0 rgba(232,65,49,0.55), inset 0 -1px 0 rgba(232,65,49,0.55)',
    num: '#e84131',
    portrait: 'linear-gradient(180deg, #040406 0%, #08060a 35%, #1a0709 58%, #050306 59%, #050306 100%)',
    silh: '#0e0b0f', pulse: 'rgba(232,65,49,0.95)', foilTint: 'rgba(232,65,49,0.14)',
    plates: { clip: 'none', radius: '3px',
      bg: 'linear-gradient(180deg, rgba(232,65,49,0.10), rgba(232,65,49,0.015) 70%), rgba(5,6,10,0.6)',
      sh: 'inset 0 0 0 1px rgba(232,65,49,0.42), inset 0 0 14px rgba(232,65,49,0.10)',
      lead: 'linear-gradient(180deg, rgba(232,65,49,0.30), rgba(232,65,49,0.06) 75%), rgba(5,6,10,0.6)',
      leadSh: 'inset 0 0 0 1px #ff6b5c, inset 0 0 18px rgba(232,65,49,0.35), 0 0 12px rgba(232,65,49,0.45)',
      lc: '#c98a84', vc: '#f5f7ff', leadL: '#ffc2bb', leadV: '#ffffff',
      glow: '0 0 8px rgba(232,65,49,0.55)', glowLead: '0 0 6px rgba(255,120,100,0.9), 0 0 16px rgba(232,65,49,0.8)' },
    numGlow: '0 0 10px rgba(232,65,49,0.75), 0 0 22px rgba(232,65,49,0.35)',
    nameGlow: '0 0 10px rgba(232,65,49,0.45)',
    barGlow: '0 0 6px rgba(232,65,49,0.9)',
    backHead: 'linear-gradient(180deg, rgba(232,65,49,0.14), rgba(232,65,49,0) 85%), #07080e', backHeadLine: '#ff6b5c', backHeadSub: '#c98a84',
    backHeadSh: '0 1px 10px rgba(232,65,49,0.55), inset 0 1px 0 rgba(255,107,92,0.25)',
    careerPanel: 'linear-gradient(180deg, rgba(232,65,49,0.08), rgba(232,65,49,0.01) 70%), rgba(5,6,10,0.6)',
    careerSh: 'inset 0 0 0 1px rgba(232,65,49,0.42), inset 0 0 18px rgba(232,65,49,0.10), 0 0 10px rgba(232,65,49,0.18)',
    ledgerClip: 'none', ledgerBorder: '0', ledgerLine: 'rgba(255,107,92,0.55)', ledgerLine2: 'rgba(232,65,49,0.14)',
    shadow: ', 0 0 24px rgba(232,65,49,0.22)', tk: Object.assign({}, FUT_DARK_TK, { line: 'rgba(232,65,49,0.22)', pipOn: '#e84131', pipOff: 'rgba(232,65,49,0.18)', backLabel: '#c98a84', backHead: '#c98a84', backFoot: '#c98a84', careerLead: '#ff6b5c', badgeLabel: '#ffc2bb' }) };
  THEMES.futureC = { name: 'Cyber', tier: 6, mythic: true, future: 'lab', circuit: "url('assets/fx-future-mask.png')", desc: 'Mythic. Ultraviolet crystal field with etched circuit glyphs along the edges; a magenta-white current runs through the traces, violet-chrome rim.',
    layers: ['linear-gradient(180deg, rgba(5,3,11,0) 0%, rgba(5,3,11,0.15) 40%, rgba(5,3,11,0.55) 62%, rgba(5,3,11,0.72) 100%)', "url('assets/tex-future-circuit.webp') center/cover no-repeat", 'linear-gradient(#0a0616, #0a0616)'], border: null,
    grad: 'linear-gradient(160deg, #f1e8ff 0%, #8a5cff 22%, #2a1655 46%, #d9c6ff 62%, #ff4fd8 80%, #5b34c9 100%)',
    rule: 'linear-gradient(90deg, #5b34c9, #ff4fd8 50%, #5b34c9)', ruleHot: RED_RULE,
    jersey: 'linear-gradient(180deg, rgba(160,110,255,0.24), rgba(160,110,255,0.06)), rgba(10,6,24,0.88)',
    jerseyEdge: 'inset -1px 0 0 rgba(170,130,255,0.55), inset 0 -1px 0 rgba(170,130,255,0.55)',
    num: '#c9b3ff',
    portrait: 'radial-gradient(ellipse at 50% 20%, rgba(190,150,255,0.18), transparent 62%), linear-gradient(180deg, rgba(14,8,30,0.20), rgba(6,4,14,0.70))',
    traces: { line: 'rgba(180,140,255,0.6)', hot: '#ff4fd8' },
    backNum: '#c9b3ff', backHead: 'linear-gradient(180deg, rgba(10,6,22,0.88), rgba(10,6,22,0.72))', backHeadLine: 'rgba(255,79,216,0.55)', backHeadSub: '#c4b8e6',
    unlockBg: 'linear-gradient(180deg, rgba(10,6,22,0.62), rgba(10,6,22,0.4))',
    careerPanel: 'linear-gradient(180deg, rgba(10,6,22,0.82), rgba(10,6,22,0.9))',
    careerSh: 'inset 0 0 0 1px rgba(180,140,255,0.35), inset 0 1px 0 rgba(255,79,216,0.5), inset 0 0 18px rgba(150,100,255,0.12)',
    ledgerClip: 'polygon(9px 0, calc(100% - 9px) 0, 100% 9px, 100% calc(100% - 9px), calc(100% - 9px) 100%, 9px 100%, 0 calc(100% - 9px), 0 9px)', ledgerBorder: '0', ledgerLine: 'rgba(255,79,216,0.45)', ledgerLine2: 'rgba(170,130,255,0.14)',
    backHeadSh: 'inset 0 1px 0 rgba(201,179,255,0.20), 0 1px 10px rgba(255,79,216,0.35)', barGlow: '0 0 6px rgba(233,220,255,0.6)', numGlow: '0 0 10px rgba(160,110,255,0.6)',
    silh: '#22173f', edition: 'MYTHIC · CYBER', pulse: 'rgba(255,90,220,0.95)', foilTint: 'rgba(180,130,255,0.22)',
    shadow: ', 0 0 26px rgba(150,100,255,0.26)',
    tk: Object.assign({}, FUT_DARK_TK, { sl: '#b3a7d6', rec: '#c4b8e6', line: 'rgba(170,130,255,0.24)', pipOn: '#e9dcff', pipOff: 'rgba(170,130,255,0.20)', edition: '#9d8fc7', arch: '#b3a7d6', badgeLabel: '#d9c6ff', backLabel: '#d9c6ff', backHead: '#b3a7d6', backFoot: '#c4b8e6', careerLead: '#ff7ae0' }) };
  var crackSvg = function (pk) { var t = []; for (var i = 0; i <= 40; i++) { var d = Math.abs(i - 20); t.push(d === 0 ? pk : d === 1 ? (pk * 0.55).toFixed(2) : d === 2 ? (pk * 0.15).toFixed(2) : 0); } return svgUri("<svg xmlns='http://www.w3.org/2000/svg' width='300' height='460'><filter id='c' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.016 0.022' numOctaves='4' seed='11'/><feColorMatrix values='0 0 0 0 1 0 0 0 0 0.42 0 0 0 0 0.10 1 0 0 0 0'/><feComponentTransfer><feFuncA type='table' tableValues='" + t.join(' ') + "'/></feComponentTransfer></filter><rect width='100%' height='100%' filter='url(#c)'/></svg>"); };
  var FLAME = svgUri("<svg xmlns='http://www.w3.org/2000/svg' width='264' height='300'><filter id='f' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='0.035 0.075' numOctaves='3' seed='3' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 1 0.9 0 0 0 -0.08 0 0 0 0 0.06 2.6 0 0 0 -1.15'/></filter><rect width='100%' height='100%' filter='url(#f)'/></svg>");
  THEMES.inferno = { name: 'Inferno', tier: 6, mythic: true, desc: 'Mythic. Gothic hell-gate over a lava wasteland, hellfire licking up from the bottom edge, rising embers, a slow-turning rune sigil behind the player, forged-iron jersey plate and a molten rim.',
    layers: [
      'linear-gradient(180deg, rgba(8,4,4,0.40) 0%, rgba(8,4,4,0.22) 22%, rgba(8,4,4,0.40) 46%, rgba(6,3,3,0.72) 62%, rgba(5,2,2,0.82) 100%)',
      'linear-gradient(90deg, rgba(6,3,3,0.45), transparent 30%, transparent 70%, rgba(6,3,3,0.35))',
      "url('assets/tex-inferno-gate.webp') center 30%/cover no-repeat",
      'linear-gradient(#0c0403, #0c0403)'
    ], border: null,
    grad: 'linear-gradient(160deg, #c9a07a 0%, #a8361a 14%, #2a0c06 34%, #140806 50%, #6e1c0c 70%, #b0451c 88%, #c9a07a 100%)',
    rule: 'linear-gradient(90deg, rgba(180,60,20,0.45), #d98a5a 50%, rgba(180,60,20,0.45))', ruleHot: RED_RULE,
    jersey: 'linear-gradient(180deg, rgba(255,120,40,0.05), transparent 45%), repeating-linear-gradient(135deg, rgba(255,255,255,0.025) 0 2px, transparent 2px 5px), linear-gradient(160deg, #2a1610, #0f0605)',
    jerseyEdge: 'inset -1px -1px 0 rgba(255,120,40,0.35), inset 0 1px 0 rgba(255,200,150,0.10)',
    num: '#e8602a',
    portrait: 'radial-gradient(70% 55% at 50% 100%, rgba(255,90,20,0.14), transparent 70%), linear-gradient(180deg, rgba(8,4,4,0.15), rgba(14,6,4,0.50))',
    plates: { clip: 'polygon(7px 0, 100% 0, 100% calc(100% - 7px), calc(100% - 7px) 100%, 0 100%, 0 7px)',
      bg: 'linear-gradient(180deg, rgba(30,12,8,0.86), rgba(8,3,2,0.92))', sh: 'inset 0 1px 0 rgba(255,150,90,0.22), inset 0 -1px 0 rgba(0,0,0,0.6)',
      lead: 'linear-gradient(180deg, rgba(255,90,20,0.30), rgba(40,10,4,0.92) 70%)', leadSh: 'inset 0 2px 0 #ff7a2a, inset 0 -1px 0 rgba(0,0,0,0.6)',
      lc: '#c9ada2', vc: '#f3dccb', leadL: '#ffb085', leadV: '#ff7a2a' },
    backNum: '#e8602a', backHead: 'linear-gradient(180deg, rgba(10,4,3,0.88), rgba(10,4,3,0.72))', backHeadLine: '#ff7a2a', backHeadSub: '#d9b8a6',
    backHeadSh: '0 1px 8px rgba(255,90,20,0.6)',
    unlockBg: 'linear-gradient(180deg, rgba(10,4,3,0.66), rgba(10,4,3,0.45))',
    careerPanel: 'linear-gradient(180deg, rgba(14,6,4,0.86), rgba(6,2,2,0.92))',
    careerSh: 'inset 0 1px 0 #ff9a50, inset 0 0 0 1px rgba(255,110,40,0.22), inset 0 -14px 18px -12px rgba(255,90,20,0.18), 0 -1px 8px rgba(255,90,20,0.35)',
    ledgerClip: 'polygon(9px 0, 100% 0, 100% calc(100% - 9px), calc(100% - 9px) 100%, 0 100%, 0 9px)', ledgerBorder: '0', ledgerLine: 'rgba(255,122,42,0.45)', ledgerLine2: 'rgba(255,150,90,0.10)',
    barGlow: '0 0 6px rgba(255,100,30,0.7)', numGlow: '0 0 10px rgba(255,90,20,0.55)',
    inferno: true, crack: crackSvg(1), noCrack: true, embers: 'assets/fx-inferno-embers-slow.gif', fire: 'assets/fx-inferno-fire.gif', flame: FLAME, silh: '#140705', edition: 'MYTHIC · INFERNO',
    pulse: 'rgba(255,120,40,0.55)', foilTint: 'rgba(255,120,40,0.10)',
    shadow: ', 0 0 22px rgba(255,80,20,0.14)',
    tk: { ink: '#fff4ea', sv: '#f3dccb', sl: '#a8918a', rec: '#c9bab4', pct: '#fff4ea', line: 'rgba(255,255,255,0.12)', lead: '#e84131', leadL: '#ef6a5e', pipOn: '#e8602a', pipOff: 'rgba(255,110,40,0.18)', edition: '#8a7670', arch: '#a8918a', badgeLabel: '#d9b8a6', chipC: null, backLabel: '#f3c9a8', backHead: '#c9a898', backFoot: '#d9b8a6', careerLead: '#ff8a4a', sl: '#c9ada2' } };
  THEMES.infernoB = Object.assign({}, THEMES.inferno, { archive: true, name: 'Inferno · Molten', desc: 'Mythic. Black volcanic stone split by molten cracks that pulse with heat, hellfire licking up from the bottom edge, rising embers, a slow-turning rune sigil, forged-iron jersey plate and a molten rim.',
    layers: [
      'linear-gradient(180deg, rgba(6,3,3,0.30) 0%, rgba(6,3,3,0.10) 30%, rgba(6,3,3,0.25) 55%, rgba(6,3,3,0.50) 100%)',
      "url('assets/tex-inferno-cracks.webp') center/cover no-repeat",
      'linear-gradient(#0a0403, #0a0403)'
    ],
    portrait: 'radial-gradient(70% 55% at 50% 100%, rgba(255,90,20,0.14), transparent 70%), linear-gradient(180deg, rgba(8,4,4,0.28), rgba(14,6,4,0.58))',
    crack: "url('assets/tex-inferno-cracks.webp')", noCrack: false });
  Object.assign(THEMES.frozen, { tier: 6, mythic: true, edition: 'MYTHIC · FROZEN', desc: 'Mythic. ' + THEMES.frozen.desc });
  THEMES.frozenBefore = (function () {
    var b = Object.assign({}, THEMES.frozen, { archive: true, name: 'Frozen (before)', portrait: 'linear-gradient(64deg, transparent 0 70%, rgba(225,243,251,0.16) 70.2% 70.6%, transparent 70.8%), radial-gradient(ellipse at 50% 30%, rgba(160,215,240,0.22), transparent 60%), linear-gradient(180deg, rgba(16,34,46,0.78), rgba(4,9,12,0.92))' });
    ['shelf', 'icePanel', 'footHalo', 'backNum', 'unlockBg', 'backHead', 'backHeadLine', 'backHeadSub', 'careerPanel', 'careerSh'].forEach(function (k) { delete b[k]; });
    b.jersey = 'linear-gradient(160deg, rgba(210,238,250,0.16), rgba(120,175,200,0.04)), linear-gradient(180deg, rgba(6,22,32,0.62), rgba(4,14,22,0.72))';
    b.tk = Object.assign({}, b.tk); ['backLabel', 'backHead', 'backFoot', 'careerLead'].forEach(function (k) { delete b.tk[k]; });
    return b;
  })();
  delete THEMES.smoke;
  var SV1L = ['radial-gradient(90% 38% at 50% 0%, rgba(150,200,255,0.20), transparent 70%)', 'radial-gradient(60% 30% at 18% 32%, rgba(96,116,156,0.26), transparent 70%)', 'radial-gradient(55% 28% at 86% 58%, rgba(72,88,128,0.24), transparent 70%)', 'radial-gradient(70% 24% at 50% 100%, rgba(111,182,255,0.10), transparent 70%)', 'linear-gradient(180deg, #151b28 0%, #0b0f18 50%, #05070b 100%)'];
  var SV2L = THEMES.stormLive.layers;
  var SVLIVE = ['linear-gradient(180deg, rgba(5,8,14,0.05) 0%, rgba(5,8,14,0.30) 40%, rgba(4,6,11,0.62) 66%, rgba(3,4,8,0.85) 100%)', 'linear-gradient(90deg, rgba(5,8,14,0.35), transparent 30%, transparent 70%, rgba(5,8,14,0.35))', "url('assets/tex-storm-live.webp') 58% center/cover no-repeat", 'linear-gradient(#070b14, #070b14)'];
  var P1 = 'radial-gradient(ellipse at 50% 18%, rgba(150,205,255,0.30), transparent 58%), radial-gradient(60% 40% at 20% 40%, rgba(90,110,150,0.20), transparent 70%), linear-gradient(180deg, rgba(20,28,44,0.88), rgba(4,6,10,0.96))';
  var P2 = 'radial-gradient(ellipse at 50% 22%, rgba(150,205,255,0.18), transparent 60%), linear-gradient(180deg, rgba(10,16,28,0.45), rgba(4,6,10,0.80))';
  var P3 = 'linear-gradient(180deg, rgba(10,16,28,0.20), rgba(4,6,10,0.65))';
  var STORM_VERSIONS = [
    ['stormV1', 'v1 · Code only', 'Gradient clouds, code rain, white flash every 7s', SV1L, P1, { mode: 'loop', cycle: 7, elec: false, cloudDur: 16 }],
    ['stormV2', 'v2 · Clouds + bolt', 'Cloud texture, first bolt image, flash every 7s', SV2L, P2, { mode: 'loop', cycle: 7, elec: false, cloudDur: 16, bolt: 'assets/fx-storm-bolt.png', boltBox: 'full' }],
    ['stormV3', 'v3 · Electric rim', 'v2 plus constant crackling rim, streaks, sparks', SV2L, P2, { mode: 'constant', cycle: 7, cloudDur: 16, jitter: '0.8s', bolt: 'assets/fx-storm-bolt.png', boltBox: 'full' }],
    ['stormV4', 'v4 · Slowed + footage', '16s cycle, single bolt, footage screened in faintly', SV2L, P2, { mode: 'loop', cycle: 16, noRain: true, bolt: 'assets/fx-storm-bolt-2.png', liveBlend: 'assets/tex-storm-live.webp' }],
    ['stormV5', 'v5 · Fixed bursts', 'Clouds; footage for ~3s every 16s', SV2L, P2, { mode: 'loop', cycle: 16, noRain: true, noFlash: true, burst: 'assets/tex-storm-live.webp' }],
    ['stormV6', 'v6 · Live constant', 'Footage as the card field, always on', SVLIVE, P3, { mode: 'loop', cycle: 16, noRain: true, noFlash: true, noCloud: true }]
  ];
  STORM_VERSIONS.forEach(function (v) { THEMES[v[0]] = Object.assign({}, THEMES.stormLive, { name: 'Storm ' + v[1], desc: v[2], archive: true, layers: v[3], portrait: v[4], art: v[5] }); });
  var STORM_VERSION_KEYS = STORM_VERSIONS.map(function (v) { return v[0]; }).concat(['stormLive']);
  var MYTHIC_THEMES = ['Frozen', 'Cyber', 'Inferno', 'Storm', 'Maximus'];
  var THEME_ORDER = ['away', 'home', 'alternate', 'carbon', 'futureB', 'frozen', 'futureC', 'inferno', 'stormLive', 'olympus'];
  var TIERS = [
    null,
    { n: 1, label: 'Prospect', rarity: 'Common', theme: 'away', chip: { c: '#71717a', b: '#3f3f46', bg: 'transparent' }, silh: 130 },
    { n: 2, label: 'Rookie', rarity: 'Uncommon', theme: 'home', chip: { c: '#d4d4d8', b: '#52525b', bg: 'transparent' }, silh: 132 },
    { n: 3, label: 'Stud', rarity: 'Rare', theme: 'alternate', chip: { c: '#f4f4f5', b: '#a1a1aa', bg: 'rgba(255,255,255,0.04)' }, silh: 140 },
    { n: 4, label: 'Elite', rarity: 'Epic', theme: 'carbon', chip: { c: '#ef6a5e', b: 'rgba(232,65,49,0.6)', bg: 'rgba(232,65,49,0.10)' }, silh: 146 },
    { n: 5, label: 'Franchise', rarity: 'Legendary', theme: 'futureB', chip: { c: '#ffffff', b: '#e84131', bg: '#c2321f' }, silh: 156 },
    { n: 6, label: 'Legend', rarity: 'Mythic', theme: 'stormLive', chip: { c: '#ffffff', b: '#e84131', bg: '#c2321f' }, silh: 156 }
  ];

  var BADGE_TIERS = [
    null,
    { n: 1, name: 'Rookie', rarity: 'Common', roman: 'I', outer: '#3f3f46', fill: '#151314', icon: '#71717a', label: '#71717a', inset: 1.5, filter: 'none' },
    { n: 2, name: 'Regular', rarity: 'Uncommon', roman: 'II', outer: '#71717a', fill: '#1a1819', icon: '#d4d4d8', label: '#a1a1aa', inset: 1.5, filter: 'none' },
    { n: 3, name: 'Proven', rarity: 'Rare', roman: 'III', outer: 'linear-gradient(160deg, #f4f4f5, #71717a 50%, #d4d4d8)', fill: '#121011', icon: '#f4f4f5', label: '#d4d4d8', inset: 2, filter: 'none' },
    { n: 4, name: 'Veteran', rarity: 'Epic', roman: 'IV', outer: 'linear-gradient(160deg, #ef6a5e, #c2321f 50%, #ef6a5e)', fill: 'linear-gradient(180deg, #2a1210, #0f0707)', icon: '#ef6a5e', label: '#ef6a5e', inset: 2, filter: 'drop-shadow(0 0 6px rgba(232,65,49,0.35))' },
    { n: 5, name: 'Franchise', rarity: 'Legendary', roman: 'V', outer: 'linear-gradient(160deg, #ffd9d4, #e84131 40%, #7a1a10)', fill: 'linear-gradient(180deg, #e84131, #7a1a10)', icon: '#ffffff', label: '#ef6a5e', inset: 2, filter: 'drop-shadow(0 0 10px rgba(232,65,49,0.55))' },
    { n: 6, name: 'Legend', rarity: 'Mythic', roman: 'VI', outer: 'linear-gradient(160deg, #ffffff, #e84131 45%, #ffffff)', fill: '#050404', icon: '#ffffff', label: '#ebebeb', inset: 2.5, filter: 'drop-shadow(0 0 12px rgba(255,255,255,0.25))' }
  ];

  var ICON = function (n) { return 'url(https://unpkg.com/lucide-static@0.460.0/icons/' + n + '.svg) center / contain no-repeat'; };

  var FAMILIES = [
    { id: 'goals', role: 'skater', name: 'Goals', short: 'GOALS', icon: ICON('crosshair'), stat: 'G', unit: 'goals', ladder: [1, 100, 350, 600, 1100, 1600] },
    { id: 'assists', role: 'skater', name: 'Assists', short: 'ASSISTS', icon: ICON('route'), stat: 'A', unit: 'assists', ladder: [1, 75, 300, 600, 1100, 1600] },
    { id: 'shots', role: 'skater', name: 'Shots', short: 'SHOTS', icon: ICON('target'), stat: 'SOG', unit: 'shots', ladder: [5, 100, 300, 600, 1100, 1600] },
    { id: 'hits', role: 'skater', name: 'Hits', short: 'HITS', icon: ICON('swords'), stat: 'HITS', unit: 'hits', ladder: [5, 100, 300, 600, 1100, 1600] },
    { id: 'takeaways', role: 'skater', name: 'Takeaways', short: 'TAKEAWAYS', icon: ICON('hand'), stat: 'TKA', unit: 'takeaways', ladder: [5, 100, 300, 600, 1100, 1600] },
    { id: 'faceoffs', role: 'skater', name: 'Faceoffs Won', short: 'FACEOFFS', icon: ICON('circle-dot'), stat: 'FOW', unit: 'faceoffs won', ladder: [25, 200, 700, 1500, 2750, 4000] },
    { id: 'blocks', role: 'skater', name: 'Blocked Shots', short: 'BLOCKS', icon: ICON('shield'), stat: 'BLK', unit: 'blocked shots', ladder: [1, 25, 50, 75, 105, 130] },
    { id: 'hattricks', role: 'skater', name: 'Hat Tricks', short: 'HAT TRICKS', icon: ICON('flame'), stat: 'HT', unit: 'hat tricks', ladder: [1, 6, 11, 20, 45, 70] },
    { id: 'wins', role: 'skater', name: 'Wins', short: 'WINS', icon: ICON('trophy'), stat: 'W', unit: 'wins', ladder: [5, 30, 55, 80, 110, 160] },
    { id: 'games', role: 'skater', name: 'Games Completed', short: 'GAMES', icon: ICON('calendar-check'), stat: 'GP', unit: 'games', ladder: [5, 35, 100, 225, 550, 800] },
    { id: 'saves', role: 'goalie', name: 'Saves', short: 'SAVES', icon: ICON('brick-wall'), stat: 'SV', unit: 'saves', ladder: [15, 150, 500, 1500, 2750, 4000] },
    { id: 'shutouts', role: 'goalie', name: 'Shutouts', short: 'SHUTOUTS', icon: ICON('lock'), stat: 'SO', unit: 'shutouts', ladder: [1, 6, 11, 20, 60, 110] },
    { id: 'gwins', role: 'goalie', name: 'Goalie Wins', short: 'WINS', icon: ICON('trophy'), stat: 'W', unit: 'goalie wins', ladder: [5, 30, 55, 80, 110, 160] },
    { id: 'ggames', role: 'goalie', name: 'Goalie Games', short: 'STARTS', icon: ICON('calendar-check'), stat: 'GP', unit: 'goalie games', ladder: [1, 20, 45, 70, 125, 250] }
  ];

  var POS = { C: '#c0061c', LW: '#23cf1d', RW: '#2659cf', LD: '#13dfc8', RD: '#ece335', G: '#6f00a5' };

  var STAT_LABELS = { GP: 'Games played', G: 'Goals', A: 'Assists', PTS: 'Points', SOG: 'Shots', HITS: 'Hits', TKA: 'Takeaways', FOW: 'Faceoffs won', BLK: 'Blocked shots', HT: 'Hat tricks', W: 'Wins', L: 'Losses', 'SV%': 'Save %', GAA: 'Goals against avg', SV: 'Saves', SO: 'Shutouts' };
  var DEFAULT_STATS = { skater: ['GP', 'G', 'A', 'PTS'], goalie: ['GP', 'SV%', 'GAA', 'W'] };

  var G_SAMPLE = { rec: [8, 6, 1], last10: { gp: 10, rec: [6, 3, 1], sv: '.824', gaa: '3.10', so: 1 }, stats: { GP: 15, W: 8, L: 6, 'SV%': '.812', GAA: '3.40', SV: 66, SO: 1 } };
  var PLAYERS = {
    igor: { name: 'Igor Orlov', num: 28, pos: 'LW', flag: true, arch: 'Sniper', bio: 'Shoot-first winger off the left half-wall. Club goal leader two titles running.', careerPm: 29,
      skater: { rec: [35, 30, 3], pm: 21, last10: { gp: 10, g: 9, a: 8, pm: 6 }, stats: { GP: 68, G: 65, A: 65, PTS: 130, SOG: 248, HITS: 212, TKA: 141, FOW: 96, BLK: 38, HT: 4, W: 35 } },
      goalie: G_SAMPLE, career: [['NHL 25', 54, 41, 38, 79], ['NHL 26', 68, 65, 65, 130]] },
    joey: { name: 'JoeyFlopfish', num: 91, pos: 'C', flag: true, arch: 'Playmaker', tier: 2, level: 6, badge: { fam: 'assists', tier: 2 },
      skater: { rec: [36, 31, 4], stats: { GP: 71, G: 31, A: 64, PTS: 95 } } },
    silky: { name: 'silkyjoker85', num: 4, pos: 'LD', flag: false, arch: 'Offensive-D', tier: 3, level: 3, badge: { fam: 'faceoffs', tier: 3 },
      skater: { rec: [38, 29, 3], stats: { GP: 70, G: 38, A: 66, PTS: 104 } } },
    trollet: { name: 'trollet06', num: 17, pos: 'RW', flag: true, arch: 'Sniper', tier: 3, level: 8, badge: { fam: 'goals', tier: 2 },
      skater: { rec: [27, 22, 3], stats: { GP: 52, G: 49, A: 41, PTS: 90 } } },
    crease: { name: 'CreaseDemon31', num: 31, pos: 'G', bio: 'Starter in 6s. Strong post-to-post, long rebounds on point shots.', flag: false, tier: 1, level: 4, badge: null, goalie: G_SAMPLE },
    bardown: { name: 'BarDownBandit', num: 44, pos: 'RD', flag: true, arch: 'Defensive-D', tier: 1, level: 5, badge: null,
      skater: { rec: [12, 14, 2], stats: { GP: 28, G: 4, A: 11, PTS: 15 } } },
    pete: { name: 'Pylon_Pete', num: 12, pos: 'C', flag: false, arch: 'Grinder', tier: 2, level: 2, badge: { fam: 'hits', tier: 1 },
      skater: { rec: [20, 18, 1], stats: { GP: 39, G: 9, A: 17, PTS: 26 } } }
  };

  var POS_INK = {
    carbon: { c: '#121011', b: 'rgba(18,16,17,0.55)', bg: 'rgba(255,255,255,0.35)' },
    futureB: { c: '#ffc2bb', b: 'rgba(232,65,49,0.70)', bg: 'rgba(232,65,49,0.16)' },
    frozen: { c: '#eaf7fc', b: 'rgba(212,238,248,0.60)', bg: 'rgba(210,238,250,0.14)' },
    futureC: { c: '#e9dcff', b: 'rgba(201,179,255,0.60)', bg: 'rgba(160,110,255,0.20)' },
    inferno: { c: '#ffb085', b: 'rgba(232,96,42,0.65)', bg: 'rgba(232,96,42,0.16)' },
    storm: { c: '#dff1ff', b: 'rgba(207,234,255,0.55)', bg: 'rgba(160,205,255,0.14)' }
  };
  ['storm', 'stormLive'].concat(STORM_VERSION_KEYS).forEach(function (k) { if (THEMES[k]) POS_INK[k] = POS_INK.storm; });
  POS_INK.frozenBefore = POS_INK.frozen;
  Object.keys(POS_INK).forEach(function (k) { if (THEMES[k]) THEMES[k].posInk = POS_INK[k]; });

  window.BGM_CARD = { hex: hex, THEME_ORDER: THEME_ORDER, THEMES: THEMES, TIERS: TIERS, BADGE_TIERS: BADGE_TIERS, FAMILIES: FAMILIES, POS: POS, STAT_LABELS: STAT_LABELS, DEFAULT_STATS: DEFAULT_STATS, PLAYERS: PLAYERS, RED_RULE: RED_RULE, STORM_VERSION_KEYS: STORM_VERSION_KEYS };
})();
