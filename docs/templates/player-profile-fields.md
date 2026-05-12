# Player Profile Template

Use this sheet to collect the manual fields stored in `player_profiles`.

Relevant DB fields:
- `jersey_number`
- `nationality`
- `preferred_position`
- `bio`
- `club_role_label`

Notes:
- `nationality` should be the display value you want shown on the site.
- `preferred_position` should use the internal position values:
  - `goalie`
  - `leftWing`
  - `center`
  - `rightWing`
  - `defenseMen`
- Leave a field blank if you do not want to set it yet.

---

## Blank Copy

```md
## Player

- Player ID:
- Gamertag:
- Player Name:
- Jersey Number:
- Nationality / Country:
- Preferred Position:
- Club Role Label:

### Bio

Short profile blurb:

### Notes

- 
```

---

## Example

```md
## Player

- Player ID: 2
- Gamertag: silkyjoker85
- Player Name: -, Silky
- Jersey Number: 10
- Nationality / Country: Canada
- Preferred Position: center
- Club Role Label:

### Bio

Started as a goalie with the Speds, transitioned into a scoring winger, and now plays as a playmaking center.

### Notes

- Profile hero already uses this data.
```

---

## Current Roster Sheet

Active title source: `NHL 26` EA roster (`getEARoster()`).

```md
## Player

- Player ID: 1
- Gamertag: HenryTheBobJr
- Player Name: -, Erb
- Jersey Number: 7 
- Nationality / Country: USA
- Preferred Position: Left defenseMen
- Club Role Label: Captain

### Bio

Short profile blurb:

### Notes

- EA favorite position: Left defenseMen
- Current tracked position: Left defenseMen
```

```md
## Player

- Player ID: 2
- Gamertag: silkyjoker85
- Player Name: -. Silky
- Jersey Number: 10
- Nationality / Country: Canada
- Preferred Position: center
- Club Role Label: Assistant Captain

### Bio

Started as a goalie with the Speds, transitioned into a scoring winger, and now plays as a playmaking center.

### Notes

- EA favorite position: center
- Current tracked position: center
```

```md
## Player

- Player ID: 3
- Gamertag: Stick Menace
- Player Name: Igor, Orlov
- Jersey Number: 28
- Nationality / Country: USA
- Preferred Position: leftWing
- Club Role Label: Assistant Captain

### Bio

Short profile blurb: Leading goal scorer

### Notes

- EA favorite position: leftWing
- Current tracked position: leftWing
```

```md
## Player

- Player ID: 5
- Gamertag: JoeyFlopfish
- Player Name: Joey, Flopfish
- Jersey Number: 92 
- Nationality / Country: Canada
- Preferred Position: Right defenseMen
- Club Role Label: Vetren

### Bio

Short profile blurb: Used to play center

### Notes

- EA favorite position: Right defenseMen
- Current tracked position: Right defenseMen
```

```md
## Player

- Player ID: 6
- Gamertag: camrazz
- Player Name: -, Razz  
- Jersey Number: 88 
- Nationality / Country: USA
- Preferred Position: rightWing
- Club Role Label:

### Bio

Short profile blurb:

### Notes

- EA favorite position: rightWing
- Current tracked position: rightWing
```

```md
## Player

- Player ID: 8
- Gamertag: Ordinary_Samich
- Player Name: -, Beev
- Jersey Number: 14
- Nationality / Country: USA
- Preferred Position: leftWing
- Club Role Label: Rookie

### Bio

Short profile blurb:

### Notes

- EA favorite position: leftWing
- Current tracked position: rightWing
```

```md
## Player

- Player ID: 10
- Gamertag: SCOOT BOY 42
- Player Name: -, Scoot
- Jersey Number: 42
- Nationality / Country: USA
- Preferred Position: rightWing
- Club Role Label: Plug

### Bio

Short profile blurb:

### Notes

- EA favorite position: rightWing
- Current tracked position: center
```

```md
## Player

- Player ID: 11
- Gamertag: MrHomiecide
- Player Name: Z, Wang
- Jersey Number: 71
- Nationality / Country: USA
- Preferred Position: center
- Club Role Label: Plug

### Bio

Short profile blurb:

### Notes

- EA favorite position: center
- Current tracked position: center
```

```md
## Player

- Player ID: 12
- Gamertag: Pratt2016
- Player Name: -,Benson
- Jersey Number: 32
- Nationality / Country: USA
- Preferred Position: goalie
- Club Role Label:

### Bio

Short profile blurb:

### Notes

- EA favorite position: goalie
- Current tracked position: goalie
```

```md
## Player

- Player ID: 13
- Gamertag: joseph4577
- Player Name: DaQuarius, McBum
- Jersey Number: 44
- Nationality / Country: USA
- Preferred Position: leftWing
- Club Role Label: Goon

### Bio

Short profile blurb:

### Notes

- EA favorite position: leftWing
- Current tracked position:
```

---

## Optional SQL Skeleton

```sql
UPDATE player_profiles
SET
  jersey_number = ,
  nationality = '',
  preferred_position = '',
  bio = '',
  club_role_label = ''
WHERE player_id = ;
```
