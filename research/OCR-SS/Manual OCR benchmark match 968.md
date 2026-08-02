<!--
  GROUND-TRUTH LABELING — MATCH 968  (V2 format → import_v2_benchmark_md.py)
  HELD-OUT split. Source video: /mnt/k/NHL/NHL26/match968/2026-05-22_17-21-34.mkv

  PROVENANCE / how this was produced
  - Transcribed by Claude (vision) from the dumped pre-game frames, for operator
    verification ("I transcribe, you verify"). NOT yet operator-confirmed.
  - The 2 s inbox dump (calibration/extras/_inbox/2026-05-22_17-21-34/) only
    captured 3 of the 5 BGM loadout cards. The operator DID cycle every player on
    screen; the missing cards were recovered by re-extracting the loadout window
    (t12–t34) from the .mkv at 4 fps. Frame sources are noted per block below.

  FRAME SOURCES (loadout cards)
    BGM  C  silkyjoker85   → inbox cand-t00015.png
    BGM  LW Stick Menace   → 4fps f_0016 (t15.75)   [missing from 2s dump]
    BGM  RW JoeyFlopfish   → inbox cand-t00016.png
    BGM  LD THEBEAST31054  → 4fps f_0020 (t16.75)   [missing from 2s dump]
    BGM  RD Wisdy8136      → inbox cand-t00022.png
    OPP  C  Oatmeal15942   → 4fps f_0023 (t17.50)
    OPP  LW d_YZFR6        → inbox cand-t00018.png
    OPP  RW VIEUXGAMER1965 → 4fps f_0027 (t18.50)
    OPP  LD JBT20148730    → inbox cand-t00024.png
    OPP  RD SamuraiGeist   → inbox cand-t00025.png
    Lobby (both rosters)   → inbox cand-t00040.png (state-2, both panels visible)

  ⚠️ NEEDS OPERATOR VERIFICATION — lower-confidence cells
  1. X-FACTOR TIERS — read from lobby diamond icon COLOUR only
     (orange=Elite, blue/silver=All Star, gold/bronze=Specialist; anchored on
     BGM-C Power-Forward=all Elite and BGM-RW Playmaker=Elite/All Star/Specialist,
     both matching match 463). Treat every tier below as a guess.
  2. OPP handedness — all 5 opponents read as "Left"; please confirm (esp. RW/LD).
  3. BGM-LW number — read "#96" but could be "#98".
  4. BGM-LW / BGM-LD platform — assumed Xbox (icon not re-verified).
  5. OPP-LW attributes are Δ0 and read IDENTICAL to BGM-RW (both Connor McDavid - PLY) —
     a clean cross-check. OPP C/RW/RD have visible non-zero deltas; OPP LD is Δ0.

  Deltas: left blank per template ("Deltas not needed" → R values only). BGM-LD,
  BGM-RD and the opponents have non-zero on-screen deltas if ever required.
-->

I have gone over the dumped 968 pre-game frames and transcribed them into tables as a canonical reference for the OCR work. (Match 968 — held-out)

## Pre-Game-Lobby

<!-- BGM / Home / "for" side — FIRST table in document order. -->

| Position      | Level       | Gamertag      | Platform | Height | Weight | Player Number | Player Name            | Leader? | X-Factor_1         | X-Factor_2             | X-Factor_3                 |
| ------------- | ----------- | ------------- | -------- | ------ | ------ | ------------- | ---------------------- | ------- | ------------------ | ---------------------- | -------------------------- |
| Center        | P2-Level 47 | silkyjoker85  | Xbox     | 6'2"   | 202lbs | #10           | Silky                  | No      | Big Tipper - Elite | Born Leader - Elite    | Spark Plug - Elite         |
| Left Wing     | P2-Level 38 | Stick Menace  | Xbox     | 6'6"   | 220lbs | #96           | Mikko Rantanen         | No      | Big Rig - All Star | One T - Elite          | Ankle Breaker - Elite      |
| Right Wing    | P2-Level 31 | JoeyFlopfish  | Xbox     | 6'1"   | 194lbs | #48           | Lane Hutson            | Yes     | Wheels - Elite     | Elite Edges - All Star | Ankle Breaker - Specialist |
| Left Defense  | P0-Level 46 | THEBEAST31054 | Xbox     | 6'0"   | 170lbs | #1            | Tortaaaaaa Pounddddder | No      | Rocket - Elite     | Spark Plug - All Star  | Big Rig - Specialist       |
| Right Defense | P3-Level 43 | Wisdy8136     | Xbox     | 6'2"   | 195lbs | #36           | Wiz Niewski            | No      | Truculence - Elite | Tape to Tape - Elite   | Wheels - Specialist        |
| Goalie        | cpu         | cpu           | cpu      | cpu    | cpu    | cpu           | cpu                    | cpu     | cpu                | cpu                    | cpu                        |

<!-- Opponent / Away / "against" side — SECOND table in document order. -->

| Position      | Level       | Gamertag       | Platform | Height | Weight | Player Number | Player Name     | Leader? | X-Factor_1         | X-Factor_2              | X-Factor_3                   |
| ------------- | ----------- | -------------- | -------- | ------ | ------ | ------------- | --------------- | ------- | ------------------ | ----------------------- | ---------------------------- |
| Center        | P1-Level 36 | Oatmeal15942   | Xbox     | 5'9"   | 160lbs | #84           | H. Koch         | No      | Hipster - All Star | Backhand Beauty - Elite | Ankle Breaker - All Star     |
| Left Wing     | P1-Level 9  | d_YZFR6        | PS5      | 6'1"   | 194lbs | #88           | Y. YZFRSIX      | No      | Wheels - Elite     | Elite Edges - All Star  | Ankle Breaker - Specialist   |
| Right Wing    | P1-Level 36 | VIEUXGAMER1965 | Xbox     | 6'2"   | 195lbs | #90           | g. vieux crisse | Yes     | Truculence - Elite | One T - Specialist      | Backhand Beauty - Specialist |
| Left Defense  | P0-Level 36 | JBT20148730    | Xbox     | 6'9"   | 270lbs | #49           | J. DONKE BACK   | No      | Quick Pick - Elite | Truculence - Elite      | Unstoppable - All Star       |
| Right Defense | P1-Level 11 | SamuraiGeist   | PS5      | 6'0"   | 195lbs | #32           | G. Slasher      | No      | Big Rig - Elite    | Tape to Tape - Elite    | Hipster - All Star           |
| Goalie        | cpu         | cpu            | cpu      | cpu    | cpu    | cpu           | cpu             | cpu     | cpu                | cpu                     | cpu                          |

## Pre-Game-Loadouts

<!-- ===== BGM / HOME side — all five skaters fully transcribed (goalie = CPU). ===== -->

### Home-Center

Player Information

| Position | Player_Level | Platform | Name  | Number | GamerTag     | Build_Class_Name      | Height | Weight | Shot Handness |
| -------- | ------------ | -------- | ----- | ------ | ------------ | --------------------- | ------ | ------ | ------------- |
| Center   | P2-Level 47  | Xbox     | Silky | #10    | silkyjoker85 | Matthew Tkachuk - PWF | 6'2"   | 202lbs | Left          |

X-Factors

| X-Factor_1         | X-Factor_2          | X-Factor_3         |
| ------------------ | ------------------- | ------------------ |
| Big Tipper - Elite | Born Leader - Elite | Spark Plug - Elite |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy |     | 93  |
| Slap Shot Accuracy  |     | 90  |
| Speed               |     | 92  |
| Balance             |     | 92  |
| Agility             |     | 90  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power |     | 91  |
| Slap Shot Power  |     | 91  |
| Acceleration     |     | 92  |
| Puck Control     |     | 92  |
| Endurance        |     | 88  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             |     | 94  |
| Offensive Awareness |     | 96  |
| Body Checking       |     | 88  |
| Stick Checking      |     | 85  |
| Defensive Awareness |     | 88  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      |     | 95  |
| Strength      |     | 92  |
| Durability    |     | 80  |
| Shot Blocking |     | 80  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         |     | 93  |
| Faceoffs       |     | 90  |
| Discipline     |     | 75  |
| Fighting Skill |     | 84  |

### Home-Left Wing

Player Information

| Position  | Player_Level | Platform | Name           | Number | GamerTag     | Build_Class_Name    | Height | Weight | Shot Handness |
| --------- | ------------ | -------- | -------------- | ------ | ------------ | ------------------- | ------ | ------ | ------------- |
| Left Wing | P2-Level 38  | Xbox     | Mikko Rantanen | #96    | Stick Menace | Tage Thompson - PWF | 6'6"   | 220lbs | Right         |

X-Factors

| X-Factor_1      | X-Factor_2    | X-Factor_3            |
| --------------- | ------------- | --------------------- |
| Big Rig - Elite | One T - Elite | Ankle Breaker - Elite |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy |     | 92  |
| Slap Shot Accuracy  |     | 90  |
| Speed               |     | 93  |
| Balance             |     | 90  |
| Agility             |     | 94  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power |     | 93  |
| Slap Shot Power  |     | 95  |
| Acceleration     |     | 93  |
| Puck Control     |     | 93  |
| Endurance        |     | 90  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             |     | 90  |
| Offensive Awareness |     | 91  |
| Body Checking       |     | 82  |
| Stick Checking      |     | 80  |
| Defensive Awareness |     | 84  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      |     | 93  |
| Strength      |     | 91  |
| Durability    |     | 87  |
| Shot Blocking |     | 80  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         |     | 93  |
| Faceoffs       |     | 90  |
| Discipline     |     | 82  |
| Fighting Skill |     | 75  |

### Home-Right Wing

Player Information

| Position   | Player_Level | Platform | Name        | Number | GamerTag     | Build_Class_Name     | Height | Weight | Shot Handness |
| ---------- | ------------ | -------- | ----------- | ------ | ------------ | -------------------- | ------ | ------ | ------------- |
| Right Wing | P2-Level 31  | Xbox     | Lane Hutson | #48    | JoeyFlopfish | Connor McDavid - PLY | 6'1"   | 194lbs | Left          |

X-Factors

| X-Factor_1     | X-Factor_2             | X-Factor_3                 |
| -------------- | ---------------------- | -------------------------- |
| Wheels - Elite | Elite Edges - All Star | Ankle Breaker - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy |     | 94  |
| Slap Shot Accuracy  |     | 89  |
| Speed               |     | 98  |
| Balance             |     | 88  |
| Agility             |     | 95  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power |     | 92  |
| Slap Shot Power  |     | 91  |
| Acceleration     |     | 97  |
| Puck Control     |     | 97  |
| Endurance        |     | 85  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             |     | 98  |
| Offensive Awareness |     | 98  |
| Body Checking       |     | 80  |
| Stick Checking      |     | 80  |
| Defensive Awareness |     | 80  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      |     | 93  |
| Strength      |     | 80  |
| Durability    |     | 85  |
| Shot Blocking |     | 75  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         |     | 97  |
| Faceoffs       |     | 90  |
| Discipline     |     | 79  |
| Fighting Skill |     | 65  |

### Home-Left Defense

Player Information

| Position     | Player_Level | Platform | Name                   | Number | GamerTag      | Build_Class_Name       | Height | Weight | Shot Handness |
| ------------ | ------------ | -------- | ---------------------- | ------ | ------------- | ---------------------- | ------ | ------ | ------------- |
| Left Defense | P0-Level 46  | Xbox     | Tortaaaaaa Pounddddder | #1     | THEBEAST31054 | Puck Moving Defenseman | 6'0"   | 170lbs | Right         |

X-Factors

| X-Factor_1     | X-Factor_2         | X-Factor_3           |
| -------------- | ------------------ | -------------------- |
| Rocket - Elite | Spark Plug - Elite | Big Rig - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -9  | 75  |
| Slap Shot Accuracy  | +6  | 90  |
| Speed               | +8  | 95  |
| Balance             | +1  | 86  |
| Agility             | +5  | 92  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -10 | 72  |
| Slap Shot Power  | +6  | 88  |
| Acceleration     | +8  | 95  |
| Puck Control     | +3  | 93  |
| Endurance        | +5  | 93  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +6  | 98  |
| Offensive Awareness | +2  | 90  |
| Body Checking       | +3  | 84  |
| Stick Checking      | -4  | 80  |
| Defensive Awareness | +5  | 90  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +3  | 88  |
| Strength      | +3  | 84  |
| Durability    | +1  | 82  |
| Shot Blocking | +2  | 82  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +7  | 92  |
| Faceoffs       | -5  | 75  |
| Discipline     | +7  | 92  |
| Fighting Skill | -1  | 79  |

### Home-Right Defense

Player Information

| Position      | Player_Level | Platform | Name        | Number | GamerTag  | Build_Class_Name     | Height | Weight | Shot Handness |
| ------------- | ------------ | -------- | ----------- | ------ | --------- | -------------------- | ------ | ------ | ------------- |
| Right Defense | P3-Level 43  | Xbox     | Wiz Niewski | #36    | Wisdy8136 | Defensive Defenseman | 6'2"   | 195lbs | Left          |

X-Factors

| X-Factor_1            | X-Factor_2              | X-Factor_3          |
| --------------------- | ----------------------- | ------------------- |
| Truculence - All Star | Tape to Tape - All star | Wheels - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -9  | 72  |
| Slap Shot Accuracy  | -9  | 73  |
| Speed               | +15 | 97  |
| Balance             | -8  | 82  |
| Agility             | +14 | 97  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -9  | 74  |
| Slap Shot Power  | -9  | 78  |
| Acceleration     | +15 | 97  |
| Puck Control     | -2  | 83  |
| Endurance        | +14 | 97  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | -1  | 81  |
| Offensive Awareness |     | 80  |
| Body Checking       | -9  | 77  |
| Stick Checking      | +8  | 98  |
| Defensive Awareness | +8  | 98  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +8  | 90  |
| Strength      | +5  | 91  |
| Durability    | -12 | 74  |
| Shot Blocking | -5  | 85  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +5  | 80  |
| Faceoffs       | +5  | 85  |
| Discipline     | +9  | 99  |
| Fighting Skill | -13 | 72  |

<!-- ===== OPPONENT / AWAY side — fully transcribed (identity, build, handedness,
     X-Factors, and all 23 attributes per skater). Goalie = CPU. ===== -->

### Away-Center

Player Information

| Position | Player_Level | Platform | Name    | Number | GamerTag     | Build_Class_Name | Height | Weight | Shot Handness |
| -------- | ------------ | -------- | ------- | ------ | ------------ | ---------------- | ------ | ------ | ------------- |
| Center   | P1-Level 36  | Xbox     | H. Koch | #84    | Oatmeal15942 | Sniper           | 5'9"   | 160lbs | Left          |

X-Factors

| X-Factor_1         | X-Factor_2              | X-Factor_3               |
| ------------------ | ----------------------- | ------------------------ |
| Hipster - All Star | Backhand Beauty - Elite | Ankle Breaker - All Star |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -3  | 87  |
| Slap Shot Accuracy  | -10 | 80  |
| Speed               | +10 | 97  |
| Balance             | +2  | 87  |
| Agility             | +9  | 96  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -3  | 87  |
| Slap Shot Power  | -10 | 80  |
| Acceleration     | +10 | 97  |
| Puck Control     | +5  | 92  |
| Endurance        | +8  | 96  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +8  | 90  |
| Offensive Awareness | -1  | 89  |
| Body Checking       | +4  | 85  |
| Stick Checking      | -10 | 65  |
| Defensive Awareness | +7  | 82  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +3  | 91  |
| Strength      | +4  | 85  |
| Durability    | +4  | 85  |
| Shot Blocking | -8  | 67  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +10 | 90  |
| Faceoffs       | +5  | 90  |
| Discipline     | +3  | 85  |
| Fighting Skill | -13 | 67  |

### Away-Left Wing

Player Information

| Position  | Player_Level | Platform | Name       | Number | GamerTag | Build_Class_Name     | Height | Weight | Shot Handness |
| --------- | ------------ | -------- | ---------- | ------ | -------- | -------------------- | ------ | ------ | ------------- |
| Left Wing | P1-Level 9   | PS5      | Y. YZFRSIX | #88    | d_YZFR6  | Connor McDavid - PLY | 6'1"   | 194lbs | Left          |

X-Factors

| X-Factor_1     | X-Factor_2             | X-Factor_3                 |
| -------------- | ---------------------- | -------------------------- |
| Wheels - Elite | Elite Edges - All Star | Ankle Breaker - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy |     | 94  |
| Slap Shot Accuracy  |     | 89  |
| Speed               |     | 98  |
| Balance             |     | 88  |
| Agility             |     | 95  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power |     | 92  |
| Slap Shot Power  |     | 91  |
| Acceleration     |     | 97  |
| Puck Control     |     | 97  |
| Endurance        |     | 85  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             |     | 98  |
| Offensive Awareness |     | 98  |
| Body Checking       |     | 80  |
| Stick Checking      |     | 80  |
| Defensive Awareness |     | 80  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      |     | 93  |
| Strength      |     | 80  |
| Durability    |     | 85  |
| Shot Blocking |     | 75  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         |     | 97  |
| Faceoffs       |     | 90  |
| Discipline     |     | 79  |
| Fighting Skill |     | 65  |

### Away-Right Wing

Player Information

| Position   | Player_Level | Platform | Name            | Number | GamerTag       | Build_Class_Name | Height | Weight | Shot Handness |
| ---------- | ------------ | -------- | --------------- | ------ | -------------- | ---------------- | ------ | ------ | ------------- |
| Right Wing | P1-Level 36  | Xbox     | g. vieux crisse | #90    | VIEUXGAMER1965 | Power Forward    | 6'2"   | 195lbs | Left          |

X-Factors

| X-Factor_1         | X-Factor_2         | X-Factor_3                   |
| ------------------ | ------------------ | ---------------------------- |
| Truculence - Elite | One T - Specialist | Backhand Beauty - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy |     | 85  |
| Slap Shot Accuracy  | +4  | 89  |
| Speed               | +12 | 94  |
| Balance             | -8  | 84  |
| Agility             | +3  | 86  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -2  | 85  |
| Slap Shot Power  | +3  | 91  |
| Acceleration     | +12 | 94  |
| Puck Control     | -1  | 88  |
| Endurance        | +7  | 90  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | -1  | 81  |
| Offensive Awareness | +1  | 87  |
| Body Checking       | +5  | 91  |
| Stick Checking      | +8  | 88  |
| Defensive Awareness | -10 | 67  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      |     | 85  |
| Strength      | +5  | 91  |
| Durability    | +1  | 87  |
| Shot Blocking | -10 | 75  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +1  | 81  |
| Faceoffs       | +5  | 90  |
| Discipline     | +3  | 88  |
| Fighting Skill | +3  | 88  |

### Away-Left Defense

Player Information

| Position     | Player_Level | Platform | Name          | Number | GamerTag    | Build_Class_Name | Height | Weight | Shot Handness |
| ------------ | ------------ | -------- | ------------- | ------ | ----------- | ---------------- | ------ | ------ | ------------- |
| Left Defense | P0-Level 36  | Xbox     | J. DONKE BACK | #49    | JBT20148730 | Grizzer - ENF    | 6'9"   | 270lbs | Left          |

X-Factors

| X-Factor_1         | X-Factor_2         | X-Factor_3             |
| ------------------ | ------------------ | ---------------------- |
| Quick Pick - Elite | Truculence - Elite | Unstoppable - All Star |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy |     | 78  |
| Slap Shot Accuracy  |     | 82  |
| Speed               |     | 90  |
| Balance             |     | 99  |
| Agility             |     | 88  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power |     | 85  |
| Slap Shot Power  |     | 95  |
| Acceleration     |     | 90  |
| Puck Control     |     | 99  |
| Endurance        |     | 83  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             |     | 80  |
| Offensive Awareness |     | 78  |
| Body Checking       |     | 95  |
| Stick Checking      |     | 85  |
| Defensive Awareness |     | 88  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      |     | 80  |
| Strength      |     | 95  |
| Durability    |     | 82  |
| Shot Blocking |     | 80  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         |     | 65  |
| Faceoffs       |     | 85  |
| Discipline     |     | 75  |
| Fighting Skill |     | 95  |

### Away-Right Defense

Player Information

| Position      | Player_Level | Platform | Name       | Number | GamerTag     | Build_Class_Name   | Height | Weight | Shot Handness |
| ------------- | ------------ | -------- | ---------- | ------ | ------------ | ------------------ | ------ | ------ | ------------- |
| Right Defense | P1-Level 11  | PS5      | G. Slasher | #32    | SamuraiGeist | Two-Way Defenseman | 6'0"   | 195lbs | Left          |

X-Factors

| X-Factor_1      | X-Factor_2              | X-Factor_3         |
| --------------- | ----------------------- | ------------------ |
| Big Rig - Elite | Tape to Tape - all star | Hipster - All Star |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | +6  | 90  |
| Slap Shot Accuracy  | -1  | 83  |
| Speed               | +7  | 92  |
| Balance             | -5  | 82  |
| Agility             | +1  | 86  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | +7  | 90  |
| Slap Shot Power  | +1  | 85  |
| Acceleration     | +4  | 89  |
| Puck Control     | -2  | 84  |
| Endurance        | +1  | 87  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | -3  | 84  |
| Offensive Awareness | -2  | 83  |
| Body Checking       | +5  | 88  |
| Stick Checking      | +2  | 90  |
| Defensive Awareness | +2  | 90  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      |     | 84  |
| Strength      | +5  | 88  |
| Durability    | -2  | 81  |
| Shot Blocking |     | 88  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +7  | 85  |
| Faceoffs       | -5  | 75  |
| Discipline     | +8  | 95  |
| Fighting Skill | -12 | 70  |
