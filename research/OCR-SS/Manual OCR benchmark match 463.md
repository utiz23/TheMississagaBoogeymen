<!--
  GROUND-TRUTH LABELING TEMPLATE — MATCH 463  (V2 format → import_v2_benchmark_md.py)

  HOW TO USE
  1. Open the dumped 463 frames in an image viewer beside this file.
  2. Replace EVERY <...> placeholder with what you read on screen.
  3. CPU / empty slot: put "CPU" in the Level cell and "-" elsewhere — the importer skips it.
  4. Attribute value cells: type the RATING (R) integer you see (e.g. 80). Deltas not needed.
     Leave a value BLANK if you can't read it — the scorer skips unlabeled cells (no penalty).
  5. Tell me when done; I run:
       tools/game_ocr/.venv/bin/python tools/game_ocr/scripts/import_v2_benchmark_md.py \
         --md "research/OCR-SS/Manual OCR benchmark match 463.md" \
         --match-id 463 --split held_out \
         --out tools/game_ocr/calibration/extras/loadout/benchmark/labels/463.json

  WHAT THE IMPORTER ACTUALLY READS (so you know what's required vs optional):
  - LOBBY: only the two tables below (BGM first, opponent second). Source of identity,
    captain (Leader?), level, gamertag, platform, height, weight, number, persona, X-Factors.
  - LOADOUTS: the "### Home-<pos>" blocks → handedness, build class, and the 23 attributes.
    Build class & attributes come from HERE, not the lobby.
  - Scope the heavy attribute work to the 6 BGM (Home) players. Opponent loadouts are OPTIONAL
    (see note at the bottom for how to add them if you navigated to those cards).

  ⚠️ Replace all <...> before importing — placeholders import as literal values.
-->

I have gone over all the data to be ingested and manually inputted them into tables so there is a canonical reference for the OCR work. (Match 463)

## Pre-Game-Lobby

<!-- BGM / Home / "for" side — FIRST table in document order. -->

| Position      | Level       | Gamertag      | Platform | Height | Weight | Player Number | Player Name | Leader? | X-Factor_1            | X-Factor_2<br>         | X-Factor_3                 |
| ------------- | ----------- | ------------- | -------- | ------ | ------ | ------------- | ----------- | ------- | --------------------- | ---------------------- | -------------------------- |
| Center        | P2-Level 34 | Stick Menace  | Xbox     | 6'2"   | 202lbs | #96           | M.Rantanen  | No      | Big Tipper - Elite    | Born Leader - Elite    | Spark Plug - Elite         |
| Left Wing     | P0-Level 45 | Pratt2016     | Xbox     | 6'1"   | 194lbs | #63           | C.Benson    | No      | Wheels - Elite        | Elite Edges - All Star | Ankle Breaker - Specialist |
| Right Wing    | P2-Level 42 | Silkyjoker85  | Xbox     | 5'8"   | 174lbs | #10           | --.Silky    | No      | Quick Release - Elite | One T - All Star       | Pressure+ - All Star       |
| Left Defense  | P2-Level 38 | HenryTheBobJr | Xbox     | 6'0"   | 160lbs | #7            | H.Jenkins   | Yes     | Warrior - All Star    | Wheels - All Star      | Quick Release - Specialist |
| Right Defense | P3-Level 45 | Orygoon-Ducks | PS5      | 6'1"   | 180lbs | #77           | Y.Iafallo   | No      | Tape to Tape - Elite  | Warrior - Elite        | Wheels - Specialist        |
| Goalie        | cpu         | cpu           | cpu      | cpu    | cpu    | cpu           | cpu         | cpu     | cpu                   | cpu                    | cpu                        |

<!-- Opponent / Away / "against" side — SECOND table in document order. -->

| Position      | Level       | Gamertag     | Platform | Height | Weight | Player Number | Player Name  | Leader? | X-Factor_1          | X-Factor_2<br>               | X-Factor_3                 |
| ------------- | ----------- | ------------ | -------- | ------ | ------ | ------------- | ------------ | ------- | ------------------- | ---------------------------- | -------------------------- |
| Center        | P0-Level 43 | DaveL-234    | PS5      | 6'1"   | 194lbs | #88           | H.Yoint      | No      | Wheels - Elite      | Elite Edges - All Star       | Ankle Breaker - Specialist |
| Left Wing     | P0-Level 40 | KLyons023    | Xbox     | 5'11"  | 185lbs | #26           | J.Minogue    | No      | Wheels - Elite      | Backhand Beauty - Specialist | Rocket - Specialist        |
| Right Wing    | P2-Level 1  | DAMICO2323   | Xbox     | 5'9"   | 165lbs | #26           | T.My Yoinnt  | Yes     | Wheels - Specialist | Warrior - Elite              | Quick Release - Specialist |
| Left Defense  | P1-Level 6  | WoolyWetBeef | Xbox     | 6'2"   | 176lbs | #86           | P.Yoint      | No      | Warrior - All Star  | Wheels - All Star            | Elite Edges - Specialist   |
| Right Defense | P1-Level 21 | Thick Ooze   | Xbox     | 6'3"   | 200lbs | #7            | H.O'Yointski | No      | Pressure+ - Elite   | Rocket - Elite               | Born Leader - Specialist   |
| Goalie        | cpu         | cpu          | cpu      | cpu    | cpu    | cpu           | cpu          | cpu     | cpu                 | cpu                          | cpu                        |

## Pre-Game-Loadouts

<!-- ===== BGM / HOME side — fill all six. Goalie attributes differ; if CPU, mark CPU in lobby and delete its block. ===== -->

### Home-Center

Player Information

| Position | Player_Level | Platform | Name           | Number | GamerTag     | Build_Class_Name      | Height | Weight | Shot Handness |
| -------- | ------------ | -------- | -------------- | ------ | ------------ | --------------------- | ------ | ------ | ------------- |
| Center   | P2-Level 34  | Xbox     | Mikko Rantanen | #96    | Stick Menace | Matthew Tkachuk - PWF | 6'2"   | 202lbs | Right         |

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

| Position  | Player_Level | Platform | Name     | Number | GamerTag  | Build_Class_Name     | Height | Weight | Shot Handness |
| --------- | ------------ | -------- | -------- | ------ | --------- | -------------------- | ------ | ------ | ------------- |
| Left Wing | P0-Level 45  | Xbox     | C.Benson | #63    | Pratt2016 | Connor McDavid - PLY | 6'1"   | 194lbs | Left          |

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
| Faceoffs       |     | 80  |
| Discipline     |     | 79  |
| Fighting Skill |     | 65  |

### Home-Right Wing

Player Information

| Position   | Player_Level | Platform | Name     | Number | GamerTag     | Build_Class_Name    | Height | Weight | Shot Handness |
| ---------- | ------------ | -------- | -------- | ------ | ------------ | ------------------- | ------ | ------ | ------------- |
| Right Wing | P2-Level 42  | Xbox     | --.Silky | #10    | Silkyjoker85 | Cole Caufield - SNP | 5'8"   | 174lbs | Left          |

X-Factors

| X-Factor_1            | X-Factor_2       | X-Factor_3           |
| --------------------- | ---------------- | -------------------- |
| Quick Release - Elite | One T - All Star | Pressure+ - All Star |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy |     | 95  |
| Slap Shot Accuracy  |     | 94  |
| Speed               |     | 94  |
| Balance             |     | 82  |
| Agility             |     | 94  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power |     | 93  |
| Slap Shot Power  |     | 93  |
| Acceleration     |     | 93  |
| Puck Control     |     | 89  |
| Endurance        |     | 90  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             |     | 89  |
| Offensive Awareness |     | 93  |
| Body Checking       |     | 83  |
| Stick Checking      |     | 85  |
| Defensive Awareness |     | 84  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      |     | 93  |
| Strength      |     | 80  |
| Durability    |     | 88  |
| Shot Blocking |     | 79  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         |     | 89  |
| Faceoffs       |     | 90  |
| Discipline     |     | 86  |
| Fighting Skill |     | 60  |

### Home-Left Defense

Player Information

| Position     | Player_Level | Platform | Name      | Number | GamerTag      | Build_Class_Name       | Height | Weight | Shot Handness |
| ------------ | ------------ | -------- | --------- | ------ | ------------- | ---------------------- | ------ | ------ | ------------- |
| Left Defense | P2-Level 38  | Xbox     | H.Jenkins | #7     | HenryTheBobJr | Puck Moving Defenseman | 6'0"   | 160lbs | Right         |

X-Factors

| X-Factor_1         | X-Factor_2        | X-Factor_3                 |
| ------------------ | ----------------- | -------------------------- |
| Warrior - All Star | Wheels - All Star | Quick Release - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | +4  | 88  |
| Slap Shot Accuracy  | -6  | 78  |
| Speed               | +9  | 96  |
| Balance             | +1  | 86  |
| Agility             | +2  | 89  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | +6  | 88  |
| Slap Shot Power  | -6  | 76  |
| Acceleration     | +9  | 96  |
| Puck Control     |     | 90  |
| Endurance        | +3  | 91  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | -1  | 91  |
| Offensive Awareness | -5  | 83  |
| Body Checking       | +3  | 84  |
| Stick Checking      | +5  | 89  |
| Defensive Awareness | +5  | 90  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +7  | 92  |
| Strength      | +4  | 85  |
| Durability    | -1  | 80  |
| Shot Blocking | -6  | 74  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +7  | 92  |
| Faceoffs       | -4  | 76  |
| Discipline     | +7  | 92  |
| Fighting Skill |     | 80  |

### Home-Right Defense

Player Information

| Position      | Player_Level | Platform | Name      | Number | GamerTag      | Build_Class_Name       | Height | Weight | Shot Handness |
| ------------- | ------------ | -------- | --------- | ------ | ------------- | ---------------------- | ------ | ------ | ------------- |
| Right Defense | P3-Level 45  | PS5      | Y.Iafallo | #77    | Orygoon-Ducks | Puck Moving Defenseman | 6'1"   | 180lbs | Left          |

X-Factors

| X-Factor_1           | X-Factor_2      | X-Factor_3          |
| -------------------- | --------------- | ------------------- |
| Tape to Tape - Elite | Warrior - Elite | Wheels - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -5  | 79  |
| Slap Shot Accuracy  | -6  | 78  |
| Speed               | +8  | 95  |
| Balance             | +4  | 89  |
| Agility             | +7  | 94  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -7  | 75  |
| Slap Shot Power  | -8  | 74  |
| Acceleration     | +8  | 95  |
| Puck Control     | +7  | 97  |
| Endurance        | +7  | 95  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +2  | 94  |
| Offensive Awareness | +1  | 89  |
| Body Checking       | -11 | 70  |
| Stick Checking      | +8  | 92  |
| Defensive Awareness | +9  | 94  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      |     | 85  |
| Strength      | +6  | 87  |
| Durability    | -5  | 76  |
| Shot Blocking | +9  | 89  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +7  | 92  |
| Faceoffs       | -4  | 76  |
| Discipline     | +7  | 92  |
| Fighting Skill | +1  | 81  |

<!--
  ===== OPPONENT (Away) loadouts — OPTIONAL =====
  Only fill these if you actually navigated to the opponent's loadout cards.
  Identity for the opponent is already captured in the lobby table above.
  To add one, copy a Home block and rename the heading, e.g.:

  ### Away-Center
  (same Player Information / X-Factors / Attributes tables as above)
-->

### Away-Center

Player Information

| Position | Player_Level | Platform | Name    | Number | GamerTag  | Build_Class_Name     | Height | Weight | Shot Handness |
| -------- | ------------ | -------- | ------- | ------ | --------- | -------------------- | ------ | ------ | ------------- |
| Center   | P0-Level 43  | PS5      | H.Yoint | #88    | DaveL-234 | Connor McDavid - PLY | 6'1"   | 194lbs | Right         |

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
| Faceoffs       |     | 80  |
| Discipline     |     | 79  |
| Fighting Skill |     | 65  |

### Away-Left Wing

Player Information

| Position  | Player_Level | Platform | Name      | Number | GamerTag  | Build_Class_Name | Height | Weight | Shot Handness |
| --------- | ------------ | -------- | --------- | ------ | --------- | ---------------- | ------ | ------ | ------------- |
| Left Wing | P0-Level 40  | Xbox     | J.Minogue | #26    | KLyons023 | Sniper           | 5'11"  | 185lbs | right         |

X-Factors

| X-Factor_1     | X-Factor_2                   | X-Factor_3          |
| -------------- | ---------------------------- | ------------------- |
| Wheels - Elite | Backhand Beauty - Specialist | Rocket - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | +2  | 82  |
| Slap Shot Accuracy  |     | 90  |
| Speed               | +6  | 93  |
| Balance             |     | 85  |
| Agility             |     | 87  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | +7  | 97  |
| Slap Shot Power  |     | 90  |
| Acceleration     | +2  | 89  |
| Puck Control     |     | 87  |
| Endurance        |     | 88  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             |     | 82  |
| Offensive Awareness |     | 90  |
| Body Checking       | +4  | 85  |
| Stick Checking      | +6  | 81  |
| Defensive Awareness |     | 75  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +5  | 93  |
| Strength      | +5  | 86  |
| Durability    |     | 81  |
| Shot Blocking |     | 75  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +6  | 86  |
| Faceoffs       | +3  | 88  |
| Discipline     | +3  | 85  |
| Fighting Skill |     | 80  |

### Away-Right Wing

Player Information

| Position   | Player_Level | Platform | Name        | Number | GamerTag   | Build_Class_Name | Height | Weight | Shot Handness |
| ---------- | ------------ | -------- | ----------- | ------ | ---------- | ---------------- | ------ | ------ | ------------- |
| Right Wing | P2-Level 1   | Xbox     | T.My Yoinnt | #26    | DAMICO2323 | playmaker        | 5'9"   | 165lbs | left          |

X-Factors

| X-Factor_1          | X-Factor_2      | X-Factor_3                 |
| ------------------- | --------------- | -------------------------- |
| Wheels - Specialist | Warrior - Elite | Quick Release - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | +1  | 85  |
| Slap Shot Accuracy  | -10 | 74  |
| Speed               | +9  | 96  |
| Balance             | -5  | 80  |
| Agility             | +9  | 96  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | +3  | 85  |
| Slap Shot Power  | -10 | 72  |
| Acceleration     | +9  | 96  |
| Puck Control     | -2  | 90  |
| Endurance        | +8  | 96  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +2  | 94  |
| Offensive Awareness | +6  | 96  |
| Body Checking       | +2  | 83  |
| Stick Checking      | -4  | 76  |
| Defensive Awareness | +2  | 82  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +2  | 90  |
| Strength      | +4  | 85  |
| Durability    | -2  | 79  |
| Shot Blocking | +1  | 79  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +8  | 93  |
| Faceoffs       | -1  | 84  |
| Discipline     | +7  | 92  |
| Fighting Skill | -13 | 67  |

### Away-Left Defense

Player Information

| Position     | Player_Level | Platform | Name    | Number | GamerTag     | Build_Class_Name   | Height | Weight | Shot Handness |
| ------------ | ------------ | -------- | ------- | ------ | ------------ | ------------------ | ------ | ------ | ------------- |
| Left Defense | P1-Level 6   | Xbox     | P.Yoint | #86    | WoolyWetBeef | Two-Way Defenseman | 6'2"   | 176lbs | Left          |

X-Factors

| X-Factor_1         | X-Factor_2        | X-Factor_3               |
| ------------------ | ----------------- | ------------------------ |
| Warrior - All Star | Wheels - All Star | Elite Edges - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -6  | 78  |
| Slap Shot Accuracy  | -6  | 78  |
| Speed               | +11 | 96  |
| Balance             | -6  | 81  |
| Agility             | +9  | 94  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -6  | 77  |
| Slap Shot Power  | -4  | 80  |
| Acceleration     | +11 | 96  |
| Puck Control     |     | 86  |
| Endurance        | +7  | 93  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +6  | 93  |
| Offensive Awareness |     | 85  |
| Body Checking       |     | 83  |
| Stick Checking      | -1  | 87  |
| Defensive Awareness |     | 88  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +3  | 87  |
| Strength      | +7  | 90  |
| Durability    | -6  | 77  |
| Shot Blocking | -10 | 78  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +7  | 85  |
| Faceoffs       | -5  | 75  |
| Discipline     | +7  | 94  |
| Fighting Skill | -13 | 69  |

### Away-Right Defense

Player Information

| Position      | Player_Level | Platform | Name         | Number | GamerTag   | Build_Class_Name | Height | Weight | Shot Handness |
| ------------- | ------------ | -------- | ------------ | ------ | ---------- | ---------------- | ------ | ------ | ------------- |
| Right Defense | P1-Level 21  | Xbox     | H.O'Yointski | #7     | Thick Ooze | Enforcer         | 6'3"   | 200lbs | Right         |

- be advised: in player loadout menu, Thnk Ooze is not fully visable in the left side list, he is cut off at the bottom. his level is not visable in this menu.  
  X-Factors

| X-Factor_1        | X-Factor_2     | X-Factor_3               |
| ----------------- | -------------- | ------------------------ |
| Pressure+ - Elite | Rocket - Elite | Born Leader - Specialist |

Attributes

| Technique           | Δ   | R   |
| ------------------- | --- | --- |
| Wrist Shot Accuracy | -10 | 72  |
| Slap Shot Accuracy  | +5  | 85  |
| Speed               | +13 | 95  |
| Balance             | -13 | 77  |
| Agility             | +7  | 90  |

| Power            | Δ   | R   |
| ---------------- | --- | --- |
| Wrist Shot Power | -10 | 74  |
| Slap Shot Power  | +10 | 95  |
| Acceleration     | +9  | 91  |
| Puck Control     |     | 84  |
| Endurance        | +7  | 90  |

| Playstyle           | Δ   | R   |
| ------------------- | --- | --- |
| Passing             | +1  | 81  |
| Offensive Awareness | -2  | 80  |
| Body Checking       | +5  | 91  |
| Stick Checking      | +2  | 82  |
| Defensive Awareness | +2  | 84  |

| Tenacity      | Δ   | R   |
| ------------- | --- | --- |
| Hand-Eye      | +1  | 82  |
| Strength      | +5  | 91  |
| Durability    | -1  | 85  |
| Shot Blocking | -1  | 81  |

| Tactics        | Δ   | R   |
| -------------- | --- | --- |
| Deking         | +10 | 85  |
| Faceoffs       | -5  | 80  |
| Discipline     | +4  | 84  |
| Fighting Skill | -2  | 83  |

## Appendix A — X-Factor Reference (lookup only — not imported)

All **84** `Name - Tier` combinations (28 X-Factors × 3 tiers), one row per ability. Copy the cell from the column for the tier you need — read the tier from the loadout card. (Icons only come in Blue/Gold/Red branding variants with no tier meaning, so the icon just identifies the ability.)

| Icon                                                                                                                             | X-Factor        | Elite                     | All Star                     | Specialist                     |
| -------------------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- | ---------------------------- | ------------------------------ |
| <img src="../../docs/branding/icons/x-factors/Ankle_Breaker/NHL_26_Ankle_Breaker_X-Factor_Image__Gold__File.png" width="36">     | Ankle Breaker   | `Ankle Breaker - Elite`   | `Ankle Breaker - All Star`   | `Ankle Breaker - Specialist`   |
| <img src="../../docs/branding/icons/x-factors/Backhand_Beauty/NHL_26_Backhand_Beauty_X-Factor_Image__Gold__File.png" width="36"> | Backhand Beauty | `Backhand Beauty - Elite` | `Backhand Beauty - All Star` | `Backhand Beauty - Specialist` |
| <img src="../../docs/branding/icons/x-factors/Big_Rig/NHL_26_Big_Rig_X-Factor_Image__Gold__File.png" width="36">                 | Big Rig         | `Big Rig - Elite`         | `Big Rig - All Star`         | `Big Rig - Specialist`         |
| <img src="../../docs/branding/icons/x-factors/Big_Tipper/NHL_26_Big_Tipper_X-Factor_Image__Gold__File.png" width="36">           | Big Tipper      | `Big Tipper - Elite`      | `Big Tipper - All Star`      | `Big Tipper - Specialist`      |
| <img src="../../docs/branding/icons/x-factors/Born_Leader/NHL_26_Born_Leader_X-Factor_Image__Gold__File.png" width="36">         | Born Leader     | `Born Leader - Elite`     | `Born Leader - All Star`     | `Born Leader - Specialist`     |
| <img src="../../docs/branding/icons/x-factors/Dialed_In/NHL_26_Dialed_In_X-Factor_Image__Gold__File.png" width="36">             | Dialed In       | `Dialed In - Elite`       | `Dialed In - All Star`       | `Dialed In - Specialist`       |
| <img src="../../docs/branding/icons/x-factors/Elite_Edges/NHL_26_Elite_Edges_X-Factor_Image__Gold__File.png" width="36">         | Elite Edges     | `Elite Edges - Elite`     | `Elite Edges - All Star`     | `Elite Edges - Specialist`     |
| <img src="../../docs/branding/icons/x-factors/Hipster/NHL_26_Hipster_X-Factor_Image__Gold__File.png" width="36">                 | Hipster         | `Hipster - Elite`         | `Hipster - All Star`         | `Hipster - Specialist`         |
| <img src="../../docs/branding/icons/x-factors/No_Contest/NHL_26_No_Contest_X-Factor_Image__Gold__File.png" width="36">           | No Contest      | `No Contest - Elite`      | `No Contest - All Star`      | `No Contest - Specialist`      |
| <img src="../../docs/branding/icons/x-factors/One_T/NHL_26_One_T_X-Factor_Image__Gold__File.png" width="36">                     | One T           | `One T - Elite`           | `One T - All Star`           | `One T - Specialist`           |
| <img src="../../docs/branding/icons/x-factors/Post_to_Post/NHL_26_Post_to_Post_X-Factor_Image__Gold__File.png" width="36">       | Post to Post    | `Post to Post - Elite`    | `Post to Post - All Star`    | `Post to Post - Specialist`    |
| <img src="../../docs/branding/icons/x-factors/PressurePlus/NHL_26_PressurePlus_X-Factor_Image__Gold__File.png" width="36">       | Pressure+       | `Pressure+ - Elite`       | `Pressure+ - All Star`       | `Pressure+ - Specialist`       |
| <img src="../../docs/branding/icons/x-factors/Quick_Draw/NHL_26_Quick_Draw_X-Factor_Image__Gold__File.png" width="36">           | Quick Draw      | `Quick Draw - Elite`      | `Quick Draw - All Star`      | `Quick Draw - Specialist`      |
| <img src="../../docs/branding/icons/x-factors/Quickpick/NHL_26_Quickpick_X-Factor_Image__Gold__File.png" width="36">             | Quick Pick      | `Quick Pick - Elite`      | `Quick Pick - All Star`      | `Quick Pick - Specialist`      |
| <img src="../../docs/branding/icons/x-factors/Quick_Release/NHL_26_Quick_Release_X-Factor_Image__Gold__File.png" width="36">     | Quick Release   | `Quick Release - Elite`   | `Quick Release - All Star`   | `Quick Release - Specialist`   |
| <img src="../../docs/branding/icons/x-factors/Recharge/NHL_26_Recharge_X-Factor_Image__Gold__File.png" width="36">               | Recharge        | `Recharge - Elite`        | `Recharge - All Star`        | `Recharge - Specialist`        |
| <img src="../../docs/branding/icons/x-factors/Rocket/NHL_26_Rocket_X-Factor_Image__Gold__File.png" width="36">                   | Rocket          | `Rocket - Elite`          | `Rocket - All Star`          | `Rocket - Specialist`          |
| <img src="../../docs/branding/icons/x-factors/Second_Wind/NHL_26_Second_Wind_X-Factor_Image__Gold__File.png" width="36">         | Second Wind     | `Second Wind - Elite`     | `Second Wind - All Star`     | `Second Wind - Specialist`     |
| <img src="../../docs/branding/icons/x-factors/Send_It/NHL_26_Send_It_X-Factor_Image__Gold__File.png" width="36">                 | Send It         | `Send It - Elite`         | `Send It - All Star`         | `Send It - Specialist`         |
| <img src="../../docs/branding/icons/x-factors/Show_Stopper/NHL_26_Show_Stopper_X-Factor_Image__Gold__File.png" width="36">       | Show Stopper    | `Show Stopper - Elite`    | `Show Stopper - All Star`    | `Show Stopper - Specialist`    |
| <img src="../../docs/branding/icons/x-factors/Spark_Plug/NHL_26_Spark_Plug_X-Factor_Image__Gold__File.png" width="36">           | Spark Plug      | `Spark Plug - Elite`      | `Spark Plug - All Star`      | `Spark Plug - Specialist`      |
| <img src="../../docs/branding/icons/x-factors/Sponge/NHL_26_Sponge_X-Factor_Image__Gold__File.png" width="36">                   | Sponge          | `Sponge - Elite`          | `Sponge - All Star`          | `Sponge - Specialist`          |
| <img src="../../docs/branding/icons/x-factors/Stick_Em_Up/NHL_26_Stick_Em_Up_X-Factor_Image__Gold__File.png" width="36">         | Stick Em Up     | `Stick Em Up - Elite`     | `Stick Em Up - All Star`     | `Stick Em Up - Specialist`     |
| <img src="../../docs/branding/icons/x-factors/Tape_to_Tape/NHL_26_Tape_to_Tape_X-Factor_Image__Gold__File.png" width="36">       | Tape to Tape    | `Tape to Tape - Elite`    | `Tape to Tape - All Star`    | `Tape to Tape - Specialist`    |
| <img src="../../docs/branding/icons/x-factors/Truculence/NHL_26_Truculence_X-Factor_Image__Gold__File.png" width="36">           | Truculence      | `Truculence - Elite`      | `Truculence - All Star`      | `Truculence - Specialist`      |
| <img src="../../docs/branding/icons/x-factors/Unstoppable/NHL_26_Unstoppable_X-Factor_Image__Gold__File.png" width="36">         | Unstoppable     | `Unstoppable - Elite`     | `Unstoppable - All Star`     | `Unstoppable - Specialist`     |
| <img src="../../docs/branding/icons/x-factors/Warrior/NHL_26_Warrior_X-Factor_Image__Gold__File.png" width="36">                 | Warrior         | `Warrior - Elite`         | `Warrior - All Star`         | `Warrior - Specialist`         |
| <img src="../../docs/branding/icons/x-factors/Wheels/NHL_26_Wheels_X-Factor_Image__Gold__File.png" width="36">                   | Wheels          | `Wheels - Elite`          | `Wheels - All Star`          | `Wheels - Specialist`          |
