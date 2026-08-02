<!--
  GROUND-TRUTH LABELING TEMPLATE — MATCH 967  (V2 format → import_v2_benchmark_md.py)

  Source video: K:\NHL\NHL26\match967\2026-05-22_16-41-18.mkv  (pre-game = first ~52s)
  Staged frames: K:\NHL\NHL26\match967-label-frames\  (see README.txt there)

  STATUS: Claude has PRE-FILLED everything it could read from the staged frames —
  identity AND all 23 attribute values for the 5 BGM cards (+ deltas on the two
  AP-boosted cards, LD & RD). These are MACHINE READS — review and correct by hand.

  CONFIDENCE NOTES (where to look hardest during review):
  - C / LW / RW cards are un-boosted (no Δ chips) — values only, high confidence.
  - LD (ParkerMcLovin) & RD (APOLLO11X7) are AP-boosted: every value has a Δ chip
    (red = negative, green = positive). Signs are reliable (chip colour); a few
    magnitudes are the least-certain reads — verify against the loadout/ cards.
  - RW JoeyFlopfish's McDavid-PLY numbers match the same build in match 463 almost
    exactly (cross-check), so those are trustworthy.
  - X-FACTOR TIERS are the ONE thing not readable from these frames (the cards show
    the ability icons but no tier text; icon colour is branding, not tier). Each
    tier is left as "<tier>" — replace with Elite / All Star / Specialist, or if
    undeterminable, change the cell to "Name -" (trailing dash) to keep the name and
    leave the tier unlabeled (scorer skips it). Do NOT import with "<tier>" literal.
  - Platform is a best-guess (Xbox) — not a scored field.

  WHEN DONE: tell Claude; it runs:
    tools/game_ocr/.venv/bin/python tools/game_ocr/scripts/import_v2_benchmark_md.py \
      --md "research/OCR-SS/Manual OCR benchmark match 967.md" \
      --match-id 967 --split held_out \
      --out tools/game_ocr/calibration/extras/loadout/benchmark/labels/967.json
-->

I have gone over the pre-game data and filled the canonical reference from the staged frames. (Match 967)

## Pre-Game-Lobby

<!-- BGM / Home / "for" side — FIRST table in document order. -->

| Position      | Level       | Gamertag      | Platform | Height | Weight | Player Number | Player Name    | Leader? | X-Factor_1             | X-Factor_2            | X-Factor_3               |
| ------------- | ----------- | ------------- | -------- | ------ | ------ | ------------- | -------------- | ------- | ---------------------- | --------------------- | ------------------------ |
| Center        | P2-Level 47 | silkyjoker85  | Xbox     | 6'2"   | 220lbs | #10           | Silky          | No      | Quick Release - <tier> | One T - <tier>        | Backhand Beauty - <tier> |
| Left Wing     | P2-Level 38 | Stick Menace  | Xbox     | 6'6"   | 220lbs | #96           | Mikko Rantanen | No      | Big Rig - <tier>       | One T - <tier>        | Ankle Breaker - <tier>   |
| Right Wing    | P2-Level 30 | JoeyFlopfish  | Xbox     | 6'1"   | 194lbs | #48           | Lane Hutson    | Yes     | Wheels - <tier>        | Elite Edges - <tier>  | Ankle Breaker - <tier>   |
| Left Defense  | P1-Level 29 | ParkerMcLovin | Xbox     | 6'0"   | 180lbs | #13           | Mack Parker    | No      | Quick Pick - <tier>    | Elite Edges - <tier>  | Warrior - <tier>         |
| Right Defense | Level 22    | APOLLO11X7    | Xbox     | 6'2"   | 195lbs | #26           | Jordan NHL     | No      | Stick Em Up - <tier>   | Tape to Tape - <tier> | No Contest - <tier>      |
| Goalie        | cpu         | cpu           | cpu      | cpu    | cpu    | cpu           | cpu            | cpu     | cpu                    | cpu                   | cpu                      |

<!-- Opponent / Away / "against" side — SECOND table in document order.
     Identity read off the lobby (lobby/lobby_UKNIGHTED_zoom.png) — VERIFY; opponent
     reads are lower-confidence and loadout cards were not labeled for them. -->

| Position      | Level       | Gamertag       | Platform | Height | Weight | Player Number | Player Name                | Leader? | X-Factor_1 | X-Factor_2 | X-Factor_3 |
| ------------- | ----------- | -------------- | -------- | ------ | ------ | ------------- | -------------------------- | ------- | ---------- | ---------- | ---------- |
| Center        | P5-Level 22 | Blunt x 51     | PS5      | 6'0"   | 160lbs | #51           | My Forwards Are Bad        | No      | <X1>       | <X2>       | <X3>       |
| Left Wing     | P4-Level 8  | NotoriousNG3   | Xbox     | 5'9"   | 160lbs | #3            | Your Girls Favorite player | No      | <X1>       | <X2>       | <X3>       |
| Right Wing    | Max Level   | Adel Bjorn5293 | Xbox     | 5'10"  | 160lbs | #19           | Doan                       | No      | <X1>       | <X2>       | <X3>       |
| Left Defense  | Max Level   | Sport De Salon | Xbox     | 6'1"   | 180lbs | #17           | S. Teamplay                | No      | <X1>       | <X2>       | <X3>       |
| Right Defense | P5-Level 8  | clewdzii       | Xbox     | 6'1"   | 180lbs | #16           | clewdzii                   | Yes     | <X1>       | <X2>       | <X3>       |
| Goalie        | cpu         | cpu            | cpu      | cpu    | cpu    | cpu           | cpu                        | cpu     | cpu        | cpu        | cpu        |

## Pre-Game-Loadouts

<!-- ===== BGM / HOME side. Attribute values are MACHINE READS — verify. Goalie is CPU (no card). ===== -->

### Home-Center

Player Information

| Position | Player_Level | Platform | Name  | Number | GamerTag     | Build_Class_Name | Height | Weight | Shot Handness |
| -------- | ------------ | -------- | ----- | ------ | ------------ | ---------------- | ------ | ------ | ------------- |
| Center   | P2-Level 47  | Xbox     | Silky | #10    | silkyjoker85 | Bullseye - SNP   | 6'2"   | 220lbs | Left          |

X-Factors

| X-Factor_1                  | X-Factor_2              | X-Factor_3                          |
| --------------------------- | ----------------------- | ----------------------------------- |
| Quick Release - Elite (Red) | One T - All Star (Blue) | Backhand Beauty - Specialist (Gold) |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy |     | 99  |
| Slap Shot Accuracy  |     | 99  |
| Speed               |     | 92  |
| Balance             |     | 88  |
| Agility             |     | 89  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power |     | 95  |
| Slap Shot Power  |     | 95  |
| Acceleration     |     | 94  |
| Puck Control     |     | 90  |
| Endurance        |     | 88  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             |     | 82  |
| Offensive Awareness |     | 92  |
| Body Checking       |     | 88  |
| Stick Checking      |     | 82  |
| Defensive Awareness |     | 78  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      |     | 90  |
| Strength      |     | 90  |
| Durability    |     | 80  |
| Shot Blocking |     | 78  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         |     | 80  |
| Faceoffs       |     | 90  |
| Discipline     |     | 80  |
| Fighting Skill |     | 80  |

### Home-Left Wing

Player Information

| Position  | Player_Level | Platform | Name           | Number | GamerTag     | Build_Class_Name    | Height | Weight | Shot Handness |
| --------- | ------------ | -------- | -------------- | ------ | ------------ | ------------------- | ------ | ------ | ------------- |
| Left Wing | P2-Level 38  | Xbox     | Mikko Rantanen | #96    | Stick Menace | Tage Thompson - PWF | 6'6"   | 220lbs | Right         |

X-Factors

| X-Factor_1            | X-Factor_2          | X-Factor_3                  |
| --------------------- | ------------------- | --------------------------- |
| Big Rig - Elite (Red) | One T - Elite (Red) | Ankle Breaker - Elite (Red) |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy |     | 93  |
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
| Right Wing | P2-Level 30  | Xbox     | Lane Hutson | #48    | JoeyFlopfish | Connor McDavid - PLY | 6'1"   | 194lbs | Left          |

X-Factors

| X-Factor_1           | X-Factor_2                    | X-Factor_3                        |
| -------------------- | ----------------------------- | --------------------------------- |
| Wheels - Elite (Red) | Elite Edges - All Star (Blue) | Ankle Breaker - Specialist (Gold) |

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

<!-- AP-boosted card: every value has a Δ chip (red = -, green = +). -->

Player Information

| Position     | Player_Level | Platform | Name        | Number | GamerTag      | Build_Class_Name   | Height | Weight | Shot Handness |
| ------------ | ------------ | -------- | ----------- | ------ | ------------- | ------------------ | ------ | ------ | ------------- |
| Left Defense | P1-Level 29  | Xbox     | Mack Parker | #13    | ParkerMcLovin | Two-Way Defenseman | 6'0"   | 180lbs | Right         |

X-Factors

| X-Factor_1                     | X-Factor_2                    | X-Factor_3                |
| ------------------------------ | ----------------------------- | ------------------------- |
| Quick Pick - Specialist (Gold) | Elite Edges - All Star (Blue) | Warrior - All Star (Blue) |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -4  | 80  |
| Slap Shot Accuracy  | +2  | 86  |
| Speed               | +11 | 96  |
| Balance             | -5  | 82  |
| Agility             | +8  | 93  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -3  | 80  |
| Slap Shot Power  | +4  | 88  |
| Acceleration     | +8  | 93  |
| Puck Control     | +2  | 88  |
| Endurance        | +6  | 92  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +6  | 93  |
| Offensive Awareness | -6  | 79  |
| Body Checking       | -3  | 80  |
| Stick Checking      | +2  | 90  |
| Defensive Awareness | +8  | 96  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +2  | 86  |
| Strength      | +4  | 87  |
| Durability    | -3  | 80  |
| Shot Blocking | +3  | 91  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +7  | 85  |
| Faceoffs       | -5  | 75  |
| Discipline     | +9  | 96  |
| Fighting Skill | -4  | 78  |

### Home-Right Defense

<!-- AP-boosted card: most values have a Δ chip (red = -, green = +).
     Puck Control / Body Checking / Durability have NO chip → no boost (Δ left blank = 0). -->

Player Information

| Position      | Player_Level | Platform | Name       | Number | GamerTag   | Build_Class_Name   | Height | Weight | Shot Handness |
| ------------- | ------------ | -------- | ---------- | ------ | ---------- | ------------------ | ------ | ------ | ------------- |
| Right Defense | Level 22     | Xbox     | Jordan NHL | #26    | APOLLO11X7 | Two-Way Defenseman | 6'2"   | 195lbs | Left          |

X-Factors

| X-Factor_1                | X-Factor_2                     | X-Factor_3                   |
| ------------------------- | ------------------------------ | ---------------------------- |
| Stick Em Up - Elite (Red) | Tape to Tape - All Star (Blue) | No Contest - All Star (Blue) |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -4  | 80  |
| Slap Shot Accuracy  | +1  | 85  |
| Speed               | +10 | 95  |
| Balance             | -4  | 83  |
| Agility             | +6  | 91  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -3  | 80  |
| Slap Shot Power  | +1  | 85  |
| Acceleration     | +10 | 95  |
| Puck Control     |     | 86  |
| Endurance        | +3  | 89  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +1  | 88  |
| Offensive Awareness | +1  | 86  |
| Body Checking       |     | 83  |
| Stick Checking      | +2  | 90  |
| Defensive Awareness | +4  | 92  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +4  | 88  |
| Strength      | +1  | 84  |
| Durability    |     | 83  |
| Shot Blocking | +2  | 90  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +7  | 85  |
| Faceoffs       | -5  | 75  |
| Discipline     | +9  | 96  |
| Fighting Skill | -5  | 77  |

<!-- ===== AWAY / OPPONENT side. TO LABEL BY OPERATOR. =====
     Identity columns are pre-filled from the away lobby table — VERIFY against the
     loadout cards and correct if wrong. Fill the BLANK fields from each away card:
       - Build_Class_Name  (e.g. "Bullseye - SNP"; canonicalized on import)
       - Shot Handness     (Left / Right)
       - every attribute R value (and Δ chip if the card is AP-boosted)
     ATTRIBUTE RULES (3-col | Δ | R | layout, same as the BGM cards above):
       - R blank   → attribute left UNLABELED (scorer skips it).
       - Δ blank   → treated as 0 (no boost). Only fill Δ when the card shows a chip
                     (red = negative, green = positive).
     X-FACTORS for the away side are NOT read from here — fill their names + tiers in
     the Pre-Game-Lobby AWAY table above (the <X1>/<X2>/<X3> cells). That lobby table
     is the import source for X-Factors. Goalie is CPU → no card, leave out. -->

### Away-Center

Player Information

| Position | Player_Level | Platform | Name                | Number | GamerTag   | Build_Class_Name | Height | Weight | Shot Handness |
| -------- | ------------ | -------- | ------------------- | ------ | ---------- | ---------------- | ------ | ------ | ------------- |
| Center   | P5-Level 22  | PS5      | My Forwards Are Bad | #51    | Blunt x 51 | Playmaker        | 6'0"   | 160lbs | Left          |

X-Factors

| X-Factor_1                    | X-Factor_2                | X-Factor_3                        |
| ----------------------------- | ------------------------- | --------------------------------- |
| Elite Edges - All Star (Blue) | Warrior - All Star (Blue) | Quick Release - Specialist (Gold) |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -5  | 79  |
| Slap Shot Accuracy  | -4  | 80  |
| Speed               | +9  | 96  |
| Balance             | +2  | 87  |
| Agility             | +9  | 96  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -2  | 80  |
| Slap Shot Power  | -2  | 80  |
| Acceleration     | +9  | 96  |
| Puck Control     |     | 92  |
| Endurance        | +9  | 97  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +3  | 95  |
| Offensive Awareness |     | 90  |
| Body Checking       | +2  | 83  |
| Stick Checking      |     | 80  |
| Defensive Awareness | +5  | 85  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +7  | 95  |
| Strength      | +4  | 85  |
| Durability    |     | 81  |
| Shot Blocking | -9  | 69  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +9  | 94  |
| Faceoffs       | +1  | 86  |
| Discipline     | +7  | 92  |
| Fighting Skill | -12 | 68  |

### Away-Left Wing

Player Information

| Position  | Player_Level | Platform | Name                       | Number | GamerTag     | Build_Class_Name | Height | Weight | Shot Handness |
| --------- | ------------ | -------- | -------------------------- | ------ | ------------ | ---------------- | ------ | ------ | ------------- |
| Left Wing | P4-Level 8   | Xbox     | Your Girls Favorite player | #3     | NotoriousNG3 | Playmaker        | 5'9"   | 160lbs | Right         |

X-Factors

| X-Factor_1                    | X-Factor_2                        | X-Factor_3                |
| ----------------------------- | --------------------------------- | ------------------------- |
| Elite Edges - All Star (Blue) | Quick Release - Specialist (Gold) | Warrior - All Star (Blue) |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -4  | 80  |
| Slap Shot Accuracy  | -4  | 80  |
| Speed               | +10 | 97  |
| Balance             |     | 85  |
| Agility             | +9  | 96  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -2  | 80  |
| Slap Shot Power  | -2  | 80  |
| Acceleration     | +10 | 97  |
| Puck Control     | +1  | 93  |
| Endurance        | +8  | 96  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +2  | 94  |
| Offensive Awareness | +9  | 99  |
| Body Checking       | +4  | 85  |
| Stick Checking      | +4  | 84  |
| Defensive Awareness | -10 | 70  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +7  | 95  |
| Strength      | +4  | 85  |
| Durability    | -1  | 80  |
| Shot Blocking | -9  | 69  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +9  | 94  |
| Faceoffs       | -4  | 81  |
| Discipline     | +7  | 92  |
| Fighting Skill | -5  | 75  |

### Away-Right Wing

Player Information

| Position   | Player_Level | Platform | Name | Number | GamerTag       | Build_Class_Name | Height | Weight | Shot Handness |
| ---------- | ------------ | -------- | ---- | ------ | -------------- | ---------------- | ------ | ------ | ------------- |
| Right Wing | Max Level    | Xbox     | Doan | #19    | Adel Bjorn5293 | Playmaker        | 5'10"  | 160lbs | Left          |

X-Factors

| X-Factor_1               | X-Factor_2                        | X-Factor_3                |
| ------------------------ | --------------------------------- | ------------------------- |
| Wheels - All Star (Blue) | Quick Release - Specialist (Gold) | Warrior - All Star (Blue) |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | +6  | 90  |
| Slap Shot Accuracy  | -7  | 77  |
| Speed               | +10 | 97  |
| Balance             | -9  | 76  |
| Agility             | +9  | 96  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | +6  | 88  |
| Slap Shot Power  | -6  | 76  |
| Acceleration     | +10 | 97  |
| Puck Control     | +1  | 93  |
| Endurance        | +2  | 90  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +7  | 99  |
| Offensive Awareness | +6  | 96  |
| Body Checking       | -8  | 73  |
| Stick Checking      |     | 80  |
| Defensive Awareness | +6  | 86  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +7  | 95  |
| Strength      | +4  | 85  |
| Durability    | -2  | 79  |
| Shot Blocking | -6  | 72  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +9  | 94  |
| Faceoffs       | +5  | 90  |
| Discipline     | +4  | 89  |
| Fighting Skill | -13 | 67  |

### Away-Left Defense

Player Information

| Position     | Player_Level | Platform | Name           | Number | GamerTag       | Build_Class_Name       | Height | Weight | Shot Handness |
| ------------ | ------------ | -------- | -------------- | ------ | -------------- | ---------------------- | ------ | ------ | ------------- |
| Left Defense | Max Level    | Xbox     | Sport Teamplay | #17    | Sport De Salon | Puck Moving Defenseman | 6'1"   | 180lbs | Right         |

X-Factors

| X-Factor_1               | X-Factor_2               | X-Factor_3                       |
| ------------------------ | ------------------------ | -------------------------------- |
| Quick Pick - Elite (Red) | No Contest - Elite (Red) | Tape to Tape - Specialist (Gold) |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -9  | 75  |
| Slap Shot Accuracy  | +4  | 88  |
| Speed               | +9  | 96  |
| Balance             |     | 85  |
| Agility             | +8  | 95  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -7  | 75  |
| Slap Shot Power  | +6  | 88  |
| Acceleration     | +9  | 96  |
| Puck Control     | +5  | 95  |
| Endurance        | +2  | 90  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | -2  | 90  |
| Offensive Awareness | -9  | 82  |
| Body Checking       | +3  | 84  |
| Stick Checking      | +6  | 90  |
| Defensive Awareness | +5  | 90  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +5  | 90  |
| Strength      | +4  | 85  |
| Durability    | +3  | 84  |
| Shot Blocking | -10 | 70  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +5  | 90  |
| Faceoffs       | +5  | 85  |
| Discipline     | +7  | 92  |
| Fighting Skill | -5  | 75  |

### Away-Right Defense

Player Information

| Position      | Player_Level | Platform | Name     | Number | GamerTag | Build_Class_Name   | Height | Weight | Shot Handness |
| ------------- | ------------ | -------- | -------- | ------ | -------- | ------------------ | ------ | ------ | ------------- |
| Right Defense | P5-Level 8   | Xbox     | clewdzii | #16    | clewdzii | Two-Way Defenseman | 6'1"   | 180lbs | Left          |

X-Factors

| X-Factor_1                 | X-Factor_2                   | X-Factor_3                     |
| -------------------------- | ---------------------------- | ------------------------------ |
| Wheels - Specialist (Gold) | Truculence - All Star (Blue) | Tape to Tape - All Star (Blue) |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -7  | 77  |
| Slap Shot Accuracy  |     | 84  |
| Speed               | +11 | 96  |
| Balance             | -4  | 83  |
| Agility             | +11 | 96  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power |     | 83  |
| Slap Shot Power  | +2  | 86  |
| Acceleration     | +11 | 96  |
| Puck Control     | -4  | 82  |
| Endurance        | +6  | 92  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +4  | 91  |
| Offensive Awareness | -7  | 78  |
| Body Checking       | -3  | 80  |
| Stick Checking      | +5  | 93  |
| Defensive Awareness | +7  | 95  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +2  | 86  |
| Strength      | +7  | 90  |
| Durability    | -3  | 80  |
| Shot Blocking | -1  | 87  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +7  | 85  |
| Faceoffs       | -4  | 76  |
| Discipline     | +9  | 96  |
| Fighting Skill | -4  | 78  |
