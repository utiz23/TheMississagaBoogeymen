(function () {
  var ICON = function (n) { return 'url(https://unpkg.com/lucide-static@0.460.0/icons/' + n + '.svg) center / contain no-repeat'; };
  var r = function (a, b, s) { var o = []; for (var x = a; x <= b; x += s) o.push(x); return o; };
  var c = function () { return [].concat.apply([], arguments); };
  // Player ladders (30 = 6 tiers × 5 levels)
  var P_GAMES = [5, 10, 15, 20, 25, 35, 40, 45, 50, 75, 100, 125, 150, 175, 200, 225, 250, 350, 450, 500, 550, 600, 650, 700, 750, 800, 850, 900, 950, 1000];
  var P_B = c(r(1, 1, 1), r(5, 70, 5), [75, 80, 85, 90, 100], r(110, 200, 10));
  var P_C = c(r(5, 100, 5), r(110, 200, 10));
  var P_D = c([5, 10, 25, 50, 75, 100, 125, 150, 200, 250], r(300, 500, 50), r(600, 1000, 100), r(1100, 2000, 100));
  var P_GOALS = c([1, 5, 10, 25, 50], r(100, 550, 50), r(600, 1000, 100), r(1100, 2000, 100));
  var P_AST = c([1, 5, 10, 25, 50, 75, 100, 150, 200, 250], r(300, 500, 50), r(600, 1000, 100), r(1100, 2000, 100));
  var P_HT = c(r(1, 15, 1), r(20, 80, 5), [90, 100]);
  var P_FO = c([25, 50, 75, 100, 150], r(200, 1000, 100), r(1250, 5000, 250));
  var P_SV = c([15, 25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1250], r(1500, 5000, 250));
  var P_BLK = c([1], r(5, 90, 5), r(100, 150, 5));
  var P_GG = [1, 3, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 100, 125, 150, 175, 200, 225, 250, 275, 300, 400, 500];
  var P_SO = c(r(1, 15, 1), [20, 25, 30, 40, 50], r(60, 150, 10));
  // Team ladders (20 = 4 tiers × 5 levels)
  var T_A = [5, 10, 15, 20, 25, 35, 40, 45, 50, 75, 100, 125, 150, 175, 200, 225, 250, 325, 400, 500];
  var T_B = c([1, 5, 10, 15, 25], r(30, 80, 5), [90, 100, 150, 200]);
  var T_W = c(r(5, 50, 5), r(75, 300, 25));
  var T_C = c([1], r(5, 90, 5), [100]);
  var T_G = c([5, 10, 25, 50, 75, 100, 125, 150, 200, 250], r(300, 500, 50), r(600, 1000, 100));
  var T_PP = c([1], r(5, 50, 5), r(60, 100, 10), [125, 150, 175, 200]);

  var F = function (id, name, short, glyph, group, ladder, unit) { return { id: id, name: name, short: short, glyph: glyph, icon: ICON(glyph), group: group, ladder: ladder, unit: unit }; };
  var PLAYER = [
    F('p3v3', '3v3 Games Completed', '3V3 GP', 'users', 'games', P_GAMES, '3v3 games'),
    F('p6v6', '6v6 Games Completed', '6V6 GP', 'hexagon', 'games', P_GAMES, '6v6 games'),
    F('p6g', "6's with Goalie", '6S + G', 'shield-check', 'games', P_B, 'games with goalie'),
    F('pwins', 'Wins', 'WINS', 'trophy', 'games', P_C, 'wins'),
    F('pgoals', 'Goals', 'GOALS', 'siren', 'scoring', P_GOALS, 'goals'),
    F('pasts', 'Assists', 'ASSISTS', 'apple', 'scoring', P_AST, 'assists'),
    F('pshots', 'Shots', 'SHOTS', 'crosshair', 'scoring', P_D, 'shots'),
    F('pdekes', 'Dekes', 'DEKES', 'traffic-cone', 'scoring', P_D, 'dekes'),
    F('pht', 'Hat-Tricks', 'HAT TRICKS', 'sparkles', 'scoring', P_HT, 'hat tricks'),
    F('pbrk', 'Breakaways', 'BREAKAWAYS', 'unlink', 'scoring', P_B, 'breakaways'),
    F('phits', 'Hits', 'HITS', 'hammer', 'physical', P_D, 'hits'),
    F('pfo', 'Faceoffs Won', 'FACEOFFS', 'circle-dot', 'defense', P_FO, 'faceoffs won'),
    F('ptka', 'Takeaways', 'TAKEAWAYS', 'magnet', 'defense', P_D, 'takeaways'),
    F('pblk', 'Blocked Shots', 'BLOCKS', 'shield', 'defense', P_BLK, 'blocked shots'),
    F('pfight', 'Fights Won', 'FIGHTS', 'swords', 'physical', P_B, 'fights won'),
    F('gg', 'Goalie Games Completed', 'STARTS', 'scan-face', 'goalie', P_GG, 'goalie games'),
    F('gw', 'Goalie Wins', 'G WINS', 'award', 'goalie', P_C, 'goalie wins'),
    F('gsv', 'Saves', 'SAVES', 'hand', 'goalie', P_SV, 'saves'),
    F('gdsv', 'Desperation Saves', 'DESPERATION', 'heart-pulse', 'goalie', P_C, 'desperation saves'),
    F('gpoke', 'Goalie Poke-Checks', 'POKE CHECKS', 'sword', 'goalie', P_C, 'poke-checks'),
    F('gso', 'Shutouts', 'SHUTOUTS', 'brick-wall', 'goalie', P_SO, 'shutouts')
  ];
  // Team badges parked for now (20-level tables).
  var TEAM = [
    F('t3v3', '3v3 Games Completed', '3V3 GP', 'users', 'team', T_A, '3v3 games'),
    F('t6v6', '6v6 Games Completed', '6V6 GP', 'hexagon', 'team', T_A, '6v6 games'),
    F('tgp', 'Games Completed', 'GAMES', 'calendar-check', 'team', T_A, 'games'),
    F('t6p', '6 Player Games Completed', '6 SKATERS', 'users-round', 'team', T_B, '6-player games'),
    F('t6g', "6's Games with Goalie", '6S + G', 'shield-check', 'team', T_B, 'games with goalie'),
    F('twins', 'Wins', 'WINS', 'trophy', 'team', T_W, 'wins'),
    F('twg', 'Wins with Goalie', 'WINS + G', 'award', 'team', T_B, 'wins with goalie'),
    F('tw6', 'Wins · 6 Players', 'WINS 6P', 'medal', 'team', T_B, '6-player wins'),
    F('tblow', 'Blowout Wins (+5)', 'BLOWOUTS', 'flame', 'team', T_C, 'blowout wins'),
    F('tgoals', 'Goals', 'GOALS', 'siren', 'team', T_G, 'goals'),
    F('tpp', 'Power-Play Goals', 'PP GOALS', 'zap', 'team', T_PP, 'power-play goals'),
    F('tso', 'Shutouts', 'SHUTOUTS', 'brick-wall', 'team', T_C, 'shutouts'),
    F('t1ga', '1 Goal or Fewer', '≤1 GA', 'lock', 'team', T_C, 'games'),
    F('t2ga', '2 Goals or Fewer', '≤2 GA', 'lock-keyhole', 'team', T_B, 'games'),
    F('tpk', 'Perfect PK', 'PERFECT PK', 'shield-x', 'team', T_C, 'games')
  ];
  var GROUPS = {
    games: { id: 'games', scope: 'player', name: 'Games & Wins', shape: 'hex', desc: 'Participation and results' },
    scoring: { id: 'scoring', scope: 'player', name: 'Scoring', shape: 'round', desc: 'Puck-on-stick offense' },
    physical: { id: 'physical', scope: 'player', name: 'Physical', shape: 'invtri', desc: 'Hits and fights' },
    defense: { id: 'defense', scope: 'player', name: 'Defense & Possession', shape: 'square', desc: 'Faceoffs, takeaways, blocks' },
    goalie: { id: 'goalie', scope: 'player', name: 'Goalie', shape: 'octagon', desc: 'Crease stats' },
    team: { id: 'team', scope: 'team', name: 'Team', shape: 'banner', desc: 'Club-wide, hung like a banner' }
  };
  var GROUP_LIST = ['games', 'scoring', 'physical', 'defense', 'goalie'].map(function (k) {
    var g = GROUPS[k]; g.members = PLAYER.concat(TEAM).filter(function (f) { return f.group === k; }); return g;
  });
  var THEME_ORDER = ['away', 'home', 'alternate', 'carbon', 'futureB', 'frozen', 'futureC', 'inferno', 'stormLive', 'olympus'];
  var NOTES = [
    'Theme bands (3 levels) and data tiers (5 levels) do not line up. Tier 2 Level 1 is level 6, which lands mid-Home. Thresholds follow the tables; themes follow level count.',
    'Player "6\' Games Completed" read as 6v6.'
  ];
  var SILVER = 'linear-gradient(160deg, #ffffff, #71717a 45%, #d4d4d8 70%, #52525b)';
  var SKINS = {
    away: { theme: 'away', def: 'paper', variants: [
      { id: 'silver', name: 'Silver Rim', desc: 'Away card lifted 1:1. White face, silver bevel rim, charcoal glyph. Double step opens a white channel between rims.',
        skin: { outer: SILVER, fill: 'linear-gradient(180deg, #ffffff, #ececed)', icon: '#121011', label: '#3f3f46', inset: 2, gap: '#ffffff', filter: 'none' } },
      { id: 'hairline', name: 'Red Hairline', desc: 'Silver rim with a red hairline inside it, the same red the Away card uses for its lead stat. Dark channel on the double step.',
        skin: { outer: SILVER, inner: '#b02a18', fill: 'linear-gradient(180deg, #ffffff, #ececed)', icon: '#121011', label: '#3f3f46', inset: 2, gap: '#121011', filter: 'none' } },
      { id: 'paper', name: 'Paper', desc: 'Lowest-key read for a Common tier. Matte grey face, dimmer pewter rim, grey glyph. Sits below Home without competing.',
        skin: { outer: 'linear-gradient(160deg, #d4d4d8, #71717a 50%, #a1a1aa)', inner: '#c9c9cc', fill: 'linear-gradient(180deg, #f4f4f5, #dcdcde)', icon: '#52525b', label: '#52525b', inset: 2, gap: '#e9e9eb', filter: 'none' } }
    ] }
  };
  SKINS.home = { theme: 'home', def: 'charcoal', variants: [
    { id: 'charcoal', name: 'Charcoal', desc: 'Home card lifted 1:1. Charcoal face, flat grey rim, light glyph. Grey rule at rest, same as the card.',
      skin: { outer: '#52525b', fill: 'linear-gradient(180deg, #1f1d1e, #131112)', icon: '#d4d4d8', label: '#a1a1aa', inset: 1.8, gap: '#0c0b0c', filter: 'none' } },
    { id: 'redrule', name: 'Red Rule', desc: 'Charcoal face and grey rim with a red hairline inside, the hover rule from the Home card made permanent.',
      skin: { outer: '#52525b', inner: '#e84131', fill: 'linear-gradient(180deg, #1f1d1e, #131112)', icon: '#d4d4d8', label: '#a1a1aa', inset: 1.8, gap: '#0c0b0c', filter: 'none' } },
    { id: 'steel', name: 'Steel', desc: 'Charcoal face with a brushed steel rim and white glyph. Brightest of the three; one step up from Paper in contrast.',
      skin: { outer: 'linear-gradient(160deg, #a1a1aa, #3f3f46 50%, #71717a)', inner: '#2a2829', fill: 'linear-gradient(180deg, #1f1d1e, #131112)', icon: '#fafafa', label: '#d4d4d8', inset: 2, gap: '#0c0b0c', filter: 'none' } }
  ] };
  var ALT_RIM = 'linear-gradient(160deg, #ffd9d4, #e84131 35%, #7a1a10 65%, #ef6a5e)', ALT_RED = 'linear-gradient(180deg, #f0503e 0%, #d23a28 40%, #8e1f12 100%)';
  SKINS.alternate = { theme: 'alternate', def: 'block', variants: [
    { id: 'gloss', name: 'Red Gloss', desc: 'Red face with gloss inside a white rim, white glyph. First tier to carry gloss.',
      skin: { outer: 'linear-gradient(160deg, #ffffff, #d4d4d8 50%, #ffffff)', fill: ALT_RED, icon: '#ffffff', label: '#ef6a5e', inset: 2, gap: '#d23a28', gloss: true, filter: 'none' } },
    { id: 'block', name: 'Black Block', desc: 'Black face inside the red bevel rim, white glyph. Borrows the jersey block from the card.',
      skin: { outer: ALT_RIM, inner: '#7a1a10', fill: 'linear-gradient(180deg, #1a1213, #0c0707)', icon: '#ffffff', label: '#ef6a5e', inset: 2, gap: '#0c0707', filter: 'none' } },
    { id: 'inverse', name: 'Red Face', desc: 'Red gloss face, white rim, black glyph. Red channel between the rims on step II.',
      skin: { outer: 'linear-gradient(160deg, #ffffff, #d4d4d8 50%, #ffffff)', fill: ALT_RED, icon: '#0c0707', label: '#ef6a5e', inset: 2, gap: '#d23a28', gloss: true, filter: 'none' } },
    { id: 'cut', name: 'Diagonal Cut', desc: 'Red gloss face with the card\'s two diagonal cuts running through it. White glyph.',
      skin: { outer: ALT_RIM, fill: 'linear-gradient(118deg, transparent 0 60%, rgba(0,0,0,0.18) 60% 68%, transparent 68% 73%, rgba(0,0,0,0.10) 73% 77%, transparent 77%), ' + ALT_RED, icon: '#ffffff', label: '#ef6a5e', inset: 2, gap: '#121011', gloss: true, filter: 'none' } }
  ] };
  var weave = function (t) { var q = t / 4, h = t / 2;
    return ['linear-gradient(118deg, rgba(255,255,255,0.10) 0%, transparent 30%, transparent 56%, rgba(255,255,255,0.06) 68%, transparent 80%)',
      'linear-gradient(27deg, #0c0c0c ' + q + 'px, transparent ' + q + 'px) 0 ' + q + 'px/' + t + 'px ' + t + 'px',
      'linear-gradient(207deg, #0c0c0c ' + q + 'px, transparent ' + q + 'px) ' + h + 'px 0/' + t + 'px ' + t + 'px',
      'linear-gradient(27deg, #2c2c2e ' + q + 'px, transparent ' + q + 'px) 0 ' + h + 'px/' + t + 'px ' + t + 'px',
      'linear-gradient(207deg, #2c2c2e ' + q + 'px, transparent ' + q + 'px) ' + h + 'px ' + q + 'px/' + t + 'px ' + t + 'px',
      'linear-gradient(90deg, #1c1c1d ' + h + 'px, transparent ' + h + 'px) 0 0/' + t + 'px ' + t + 'px',
      'linear-gradient(#262628 25%, #151516 25%, #151516 50%, transparent 50%, transparent 75%, #303033 75%, #303033) 0 0/' + t + 'px ' + t + 'px',
      'linear-gradient(#0e0e0e, #0e0e0e)'].join(', '); };
  var CARBON_RIM = 'linear-gradient(135deg, #f4f4f5 0%, #71717a 14%, #27272a 28%, #e84131 40%, #7a1a10 46%, #a1a1aa 58%, #3f3f46 72%, #e4e4e7 86%, #52525b 100%)';
  var STEEL = 'linear-gradient(160deg, #f4f4f5, #a1a1aa 30%, #e4e4e7 50%, #71717a 75%, #d4d4d8)';
  SKINS.carbon = { theme: 'carbon', def: 'twill', variants: [
    { id: 'twill', name: 'Twill', desc: 'Carbon card lifted 1:1. Twill weave face, steel rim with the red accent band, white glyph.',
      skin: { outer: CARBON_RIM, fill: weave(10), icon: '#ffffff', label: '#e4e4e7', inset: 2, gap: '#0c0c0c', filter: 'none' } },
    { id: 'redline', name: 'Red Line', desc: 'Twill face inside a plain steel rim, with a red hairline between them. Red sits on the line instead of the rim.',
      skin: { outer: STEEL, inner: '#e84131', fill: weave(10), icon: '#ffffff', label: '#e4e4e7', inset: 2, gap: '#0c0c0c', filter: 'none' } },
    { id: 'plate', name: 'Steel Plate', desc: 'Brushed-steel face from the jersey plate, carbon rim, black glyph. Weave shows only in the rim.',
      skin: { outer: weave(8), inner: '#3f3f46', fill: 'linear-gradient(118deg, rgba(255,255,255,0.35) 0%, transparent 30%, transparent 60%, rgba(255,255,255,0.2) 72%, transparent 84%), linear-gradient(180deg, #e4e4e7, #a1a1aa 55%, #71717a)', icon: '#121011', label: '#e4e4e7', inset: 2.4, gap: '#e84131', filter: 'none' } }
  ] };
  var HL_RIM = 'linear-gradient(160deg, #ef6a5e 0%, #3a1410 22%, #0b0c14 50%, #3a1410 78%, #e84131 100%)';
  var HL_BASE = 'linear-gradient(180deg, #07080e 0%, #05060a 60%, #030305 100%)';
  var HL_GLOW = 'radial-gradient(70% 26% at 50% 54%, rgba(232,65,49,0.55), transparent 70%)';
  var HL_GRID = 'linear-gradient(180deg, transparent 54%, rgba(239,106,94,0.85) 54% 55.5%, transparent 55.5% 61%, rgba(232,65,49,0.55) 61% 62%, transparent 62% 71%, rgba(232,65,49,0.45) 71% 72%, transparent 72% 85%, rgba(232,65,49,0.4) 85% 86.5%, transparent 86.5%), linear-gradient(180deg, transparent 54%, rgba(0,0,0,0) 54%), repeating-conic-gradient(from 90deg at 50% 54%, rgba(232,65,49,0.5) 0deg 1.4deg, transparent 1.4deg 16deg)';
  var HL_COVER = 'linear-gradient(180deg, #07080e 0 54%, transparent 54%)';
  SKINS.futureB = { theme: 'futureB', def: 'grid', variants: [
    { id: 'grid', name: 'Horizon Grid', desc: 'Hardlight card lifted 1:1. Red perspective grid running into a glowing horizon behind the glyph. Red-to-black rim. First tier with a glow.',
      skin: { outer: HL_RIM, fill: HL_GLOW + ', ' + HL_COVER + ', ' + HL_GRID + ', ' + HL_BASE, icon: '#ffffff', label: '#ffc2bb', inset: 2, gap: '#05060a', filter: 'drop-shadow(0 0 8px rgba(232,65,49,0.45))' } },
    { id: 'scan', name: 'Scan Line', desc: 'Black face with fine red scanlines and one bright scan bar crossing it. Solid red rim with a pale hairline inside.',
      skin: { outer: '#e84131', inner: '#ffc2bb', fill: 'linear-gradient(180deg, transparent 34%, rgba(255,194,187,0.30) 34% 37%, transparent 37%), repeating-linear-gradient(180deg, rgba(232,65,49,0.16) 0 1px, transparent 1px 3px), ' + HL_GLOW + ', ' + HL_BASE, icon: '#ffffff', label: '#ffc2bb', inset: 1.8, gap: '#05060a', filter: 'drop-shadow(0 0 8px rgba(232,65,49,0.45))' } },
    { id: 'neon', name: 'Neon Glyph', desc: 'Near-black face with only the horizon glow. The glyph itself is lit red, inside the red-to-black rim.',
      skin: { outer: HL_RIM, inner: '#3a1410', fill: HL_GLOW + ', ' + HL_BASE, icon: '#ff6a5a', label: '#ffc2bb', inset: 2, gap: '#05060a', filter: 'drop-shadow(0 0 10px rgba(232,65,49,0.55))' } }
  ] };
  var ICE_RIM = 'linear-gradient(150deg, #ffffff 0%, #bfe3f2 18%, #4f7d96 38%, #eaf7fc 54%, #3a6075 74%, #d4eef8 100%)';
  var ICE_TEX = "url('assets/tex-ice-glacier.png') center/cover no-repeat";
  var ICE_GLOW = 'drop-shadow(0 0 8px rgba(190,228,245,0.35))';
  SKINS.frozen = { theme: 'frozen', def: 'glacier', variants: [
    { id: 'glacier', name: 'Glacier', desc: 'Frozen card lifted 1:1. Glacier ice texture, bright at the top and deep at the bottom, pale ice rim, ice-white glyph. Cold glow.',
      skin: { outer: ICE_RIM, fill: 'radial-gradient(70% 40% at 20% 0%, rgba(225,243,251,0.30), transparent 70%), linear-gradient(180deg, rgba(10,32,46,0.20) 0%, rgba(8,26,38,0.45) 40%, rgba(5,16,24,0.75) 70%, rgba(3,9,14,0.92) 100%), ' + ICE_TEX + ', #060c11', icon: '#eaf7fc', label: '#d4eef8', inset: 2.2, gap: '#071620', filter: ICE_GLOW } },
    { id: 'glass', name: 'Frost Glass', desc: 'Translucent ice panel from the jersey block. Deep blue face with a frosted sheen, pale hairline under the ice rim, white glyph.',
      skin: { outer: ICE_RIM, inner: 'rgba(220,240,250,0.65)', fill: 'linear-gradient(160deg, rgba(210,238,250,0.28), rgba(120,175,200,0.04) 55%), linear-gradient(180deg, #0c202d, #071620)', icon: '#ffffff', label: '#d4eef8', inset: 2, gap: '#071620', filter: ICE_GLOW } },
    { id: 'white', name: 'White Ice', desc: 'Inverted. Bright ice face fading to deep ice at the base, over the glacier texture. Dark glyph, ice rim.',
      skin: { outer: ICE_RIM, inner: '#ffffff', fill: 'linear-gradient(180deg, rgba(234,247,252,0.92) 0%, rgba(191,227,242,0.80) 45%, rgba(79,125,150,0.85) 100%), ' + ICE_TEX + ', #bfe3f2', icon: '#071620', label: '#d4eef8', inset: 2, gap: '#eaf7fc', filter: ICE_GLOW } }
  ] };
  var CY_RIM = 'linear-gradient(160deg, #f1e8ff 0%, #8a5cff 22%, #2a1655 46%, #d9c6ff 62%, #ff4fd8 80%, #5b34c9 100%)';
  var CY_TEX = "url('assets/tex-future-circuit.webp') center/cover no-repeat";
  var CY_GLOW = 'drop-shadow(0 0 9px rgba(160,110,255,0.45))';
  SKINS.futureC = { theme: 'futureC', def: 'circuit', variants: [
    { id: 'circuit', name: 'Circuit', desc: 'Cyber card lifted 1:1. Ultraviolet crystal circuit texture darkening toward the base, violet-chrome rim, pale violet glyph. Violet glow.',
      skin: { outer: CY_RIM, fill: 'linear-gradient(180deg, rgba(5,3,11,0) 0%, rgba(5,3,11,0.2) 40%, rgba(5,3,11,0.6) 70%, rgba(5,3,11,0.8) 100%), ' + CY_TEX + ', #0a0616', icon: '#f1e8ff', label: '#e9dcff', inset: 2, gap: '#0a0616', filter: CY_GLOW } },
    { id: 'current', name: 'Current', desc: 'Deep violet face with a magenta-white current running under the rim as a hairline, white glyph. Circuit texture stays faint.',
      skin: { outer: CY_RIM, inner: '#ff4fd8', fill: 'radial-gradient(70% 50% at 50% 40%, rgba(160,110,255,0.28), transparent 70%), linear-gradient(180deg, rgba(10,6,22,0.55), rgba(10,6,22,0.92)), ' + CY_TEX + ', #0a0616', icon: '#ffffff', label: '#e9dcff', inset: 2, gap: '#ff4fd8', filter: 'drop-shadow(0 0 9px rgba(255,79,216,0.40))' } },
    { id: 'crystal', name: 'Crystal', desc: 'Bright crystal face, violet at the top to magenta at the base, with the circuit texture showing through. Deep violet glyph.',
      skin: { outer: CY_RIM, inner: '#f1e8ff', fill: 'linear-gradient(170deg, rgba(217,198,255,0.85) 0%, rgba(138,92,255,0.75) 50%, rgba(255,79,216,0.7) 100%), ' + CY_TEX + ', #5b34c9', icon: '#140a2e', label: '#e9dcff', inset: 2, gap: '#2a1655', filter: CY_GLOW } }
  ] };
  var INF_RIM = 'linear-gradient(160deg, #c9a07a 0%, #a8361a 14%, #2a0c06 34%, #140806 50%, #6e1c0c 70%, #b0451c 88%, #c9a07a 100%)';
  var INF_CRACK = "url('assets/tex-inferno-cracks.webp') center/cover no-repeat";
  var INF_GATE = "url('assets/tex-inferno-gate.webp') center 30%/cover no-repeat";
  var INF_GLOW = 'drop-shadow(0 0 10px rgba(255,90,20,0.45))';
  SKINS.inferno = { theme: 'inferno', def: 'hellfire', variants: [
    { id: 'hellfire', name: 'Hellfire', desc: 'Inferno card lifted 1:1. Hell-gate texture with fire glowing up from the base, burnt-bronze rim, ember-orange glyph. Fire glow.',
      skin: { outer: INF_RIM, fill: 'radial-gradient(80% 45% at 50% 100%, rgba(255,90,20,0.55), transparent 70%), linear-gradient(180deg, rgba(8,4,4,0.55) 0%, rgba(8,4,4,0.35) 40%, rgba(6,3,3,0.55) 100%), ' + INF_GATE + ', #0c0403', icon: '#ffb085', label: '#ffb085', inset: 2, gap: '#0c0403', filter: INF_GLOW } },
    { id: 'lava', name: 'Lava Crack', desc: 'Black basalt face split by glowing lava cracks, burnt-bronze rim with an ember hairline, white-hot glyph.',
      skin: { outer: INF_RIM, inner: '#e8602a', fill: INF_CRACK + ', radial-gradient(70% 60% at 50% 60%, rgba(120,30,8,0.6), transparent 75%), linear-gradient(180deg, #1a0a06, #070202)', icon: '#fff1e6', label: '#ffb085', inset: 2, gap: '#e8602a', filter: INF_GLOW } },
    { id: 'forge', name: 'Forge', desc: 'Molten face, white-hot at the core cooling to deep red at the edge. Dark iron rim, black glyph.',
      skin: { outer: 'linear-gradient(160deg, #3a1a10, #140806 50%, #2a0c06)', inner: '#b0451c', fill: 'radial-gradient(60% 55% at 50% 45%, #ffe0b0 0%, #ff9a3c 30%, #e8602a 55%, #8a1f0a 85%, #3a0c04 100%)', icon: '#140806', label: '#ffb085', inset: 2.2, gap: '#e8602a', filter: INF_GLOW } }
  ] };
  var ST_RIM = 'linear-gradient(160deg, #f2f9ff 0%, #6fb6ff 16%, #1b2a44 38%, #cfeaff 54%, #24365a 74%, #8fd0ff 100%)';
  var ST_TEX = "url('assets/tex-storm-clouds.png') center top/cover no-repeat";
  var ST_SHADE = 'linear-gradient(180deg, rgba(8,16,32,0) 0%, rgba(8,16,32,0.2) 34%, rgba(8,14,28,0.45) 60%, rgba(6,12,24,0.7) 100%)';
  var ST_GLOW = 'drop-shadow(0 0 9px rgba(111,182,255,0.45))';
  SKINS.stormLive = { theme: 'stormLive', def: 'thunder', variants: [
    { id: 'thunder', name: 'Thunderhead', desc: 'Storm card lifted 1:1. Thunderhead cloud texture lit from above, electric-blue chrome rim, pale blue glyph. Blue glow.',
      skin: { outer: ST_RIM, fill: 'radial-gradient(90% 45% at 50% 8%, rgba(120,190,255,0.30), transparent 70%), ' + ST_SHADE + ', ' + ST_TEX + ', #0a1424', icon: '#dff1ff', label: '#cfeaff', inset: 2, gap: '#0a1424', filter: ST_GLOW } },
    { id: 'charged', name: 'Charged', desc: 'Darker cloud face with a lightning flash breaking at the top, electric hairline under the rim, white glyph. Stronger glow.',
      skin: { outer: ST_RIM, inner: '#8fd0ff', fill: 'radial-gradient(55% 30% at 50% 0%, rgba(235,246,255,0.75), rgba(120,190,255,0.25) 45%, transparent 75%), linear-gradient(180deg, rgba(5,8,14,0.25), rgba(3,4,8,0.85)), ' + ST_TEX + ', #05070b', icon: '#ffffff', label: '#cfeaff', inset: 2, gap: '#8fd0ff', filter: 'drop-shadow(0 0 12px rgba(143,208,255,0.6))' } },
    { id: 'rain', name: 'Rain', desc: 'Cloud face with slanted rain streaks over it, the calm between strikes on the card. White glyph.',
      skin: { outer: ST_RIM, fill: 'repeating-linear-gradient(104deg, rgba(210,235,255,0.16) 0 1px, transparent 1px 5px), ' + ST_SHADE + ', ' + ST_TEX + ', #0a1424', icon: '#ffffff', label: '#cfeaff', inset: 2, gap: '#0a1424', filter: ST_GLOW } }
  ] };
  var MX_RIM = 'linear-gradient(150deg, #fff6d8 0%, #d4a845 16%, #8a6416 34%, #f7e3a0 50%, #a77a22 68%, #fff2c4 86%, #b8892a 100%)';
  var MX_TEX = "url('assets/tex-olympus-temple.png') center top/cover no-repeat";
  var MX_GOLD = 'linear-gradient(90deg, rgba(255,255,255,0) 0, rgba(255,250,225,0.40) 50%, rgba(255,255,255,0) 100%), linear-gradient(160deg, #f6e3a1 0%, #d2a548 40%, #a7781f 78%, #e7c46a 100%)';
  var MX_GLOW = 'drop-shadow(0 0 10px rgba(242,210,122,0.45))';
  SKINS.olympus = { theme: 'olympus', def: 'marble', variants: [
    { id: 'marble', name: 'Gilded Marble', desc: 'Maximus card lifted 1:1. Marble temple above the clouds, gilded rim, dark bronze glyph. Gold glow. Only light-faced badge above T1.',
      skin: { outer: MX_RIM, fill: 'linear-gradient(180deg, rgba(253,250,242,0) 0%, rgba(253,250,242,0.25) 42%, rgba(250,245,234,0.85) 62%, rgba(246,240,228,0.92) 100%), ' + MX_TEX + ', #f6f0e2', icon: '#2a1f0a', label: '#f2d27a', inset: 2.2, gap: '#f6f0e2', filter: MX_GLOW } },
    { id: 'plate', name: 'Gold Plate', desc: 'Solid gilded face from the jersey plate with a light sweep across it, marble-white hairline under the gold rim, dark bronze glyph.',
      skin: { outer: MX_RIM, inner: '#fdfaf2', fill: MX_GOLD, icon: '#2a1f0a', label: '#f2d27a', inset: 2, gap: '#fdfaf2', filter: MX_GLOW } },
    { id: 'rays', name: 'Divine Light', desc: 'Pale marble face with light rays fanning down from the top, gold hairline, gold glyph.',
      skin: { outer: MX_RIM, inner: '#b8892a', fill: 'repeating-conic-gradient(from 160deg at 50% -10%, rgba(255,236,170,0.55) 0deg 3deg, transparent 3deg 9deg), radial-gradient(80% 60% at 50% 0%, #fffaf0, transparent 75%), linear-gradient(180deg, #fbf6ea, #ece2c8)', icon: '#8a6416', label: '#f2d27a', inset: 2, gap: '#b8892a', filter: MX_GLOW } }
  ] };
  var SKIN_KEY = 'bgm-badge-skins';
  var skinPicks = function () { try { return JSON.parse(localStorage.getItem(SKIN_KEY) || '{}'); } catch (e) { return {}; } };
  var skinFor = function (theme) {
    var S = SKINS[theme]; if (!S) return null;
    var id = skinPicks()[theme] || S.def;
    var v = S.variants.filter(function (x) { return x.id === id; })[0] || S.variants[0];
    return v.skin;
  };
  var setSkin = function (theme, id) { var p = skinPicks(); p[theme] = id; try { localStorage.setItem(SKIN_KEY, JSON.stringify(p)); } catch (e) {} };
  window.BGM_LEVELS = { SKINS: SKINS, skinFor: skinFor, skinPicks: skinPicks, setSkin: setSkin,  PLAYER: PLAYER, TEAM: TEAM, ALL: PLAYER, GROUPS: GROUPS, GROUP_LIST: GROUP_LIST, THEME_ORDER: THEME_ORDER, NOTES: NOTES };
})();
