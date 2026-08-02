# OCR vs Manual benchmark — match 250 (side-by-side)

## Box Score (only mismatched cells shown)

| Period | Stat     | Side | Manual | OCR | Match? |
| ------ | -------- | ---- | ------ | --- | ------ |
| 2nd    | shots    | BGM  | `9`    | `6` | ✗      |
| OT     | shots    | BGM  | `9`    | `6` | ✗      |
| OT     | shots    | OPP  | `2`    | `7` | ✗      |
| OT     | faceoffs | OPP  | `3`    | `1` | ✗      |

## Goals — Manual Events screen (time-remaining) vs DB (mixed sources)

| Period   | Manual clock | Manual scorer | DB clock | DB scorer   | DB source(s) | Note                                                    |
| -------- | ------------ | ------------- | -------- | ----------- | ------------ | ------------------------------------------------------- |
| 2nd      | 06:19        | -, SIlky      | 06:19    | Silky       | ocr          | clock=remaining                                         |
| 2nd      | 06:19        | -, SIlky      | 13:41    | SILKY       | ocr          | clock=elapsed                                           |
| 2nd      | 14:53        | M. Rantanen   | 14:53    | M. Rantanen | ocr          | clock=remaining                                         |
| 2nd      | 14:53        | M. Rantanen   | 5:07     | M. RANTANEN | ocr          | clock=elapsed                                           |
| 3rd      | 08:35        | -, Toews      | 08:35    | Toews       | ocr          | clock=remaining                                         |
| 3rd      | 08:35        | -, Toews      | 11:25    | TOEWS       | ocr          | clock=elapsed                                           |
| 3rd      | 08:35        | -, Toews      | 18:51    | Toews       | ocr          | clock-mismatch (manual=remaining 08:35 ≡ elapsed 11:25) |
| 3rd      | 08:35        | -, Toews      | 1:09     | TOEWS       | ocr          | clock-mismatch (manual=remaining 08:35 ≡ elapsed 11:25) |
| 3rd      | 13:58        | -, SIlky      | 13:58    | Silky       | ocr          | clock=remaining                                         |
| 3rd      | 13:58        | -, SIlky      | 6:02     | SILKY       | ocr          | clock=elapsed                                           |
| 3rd      | 18:51        | -, Toews      | 08:35    | Toews       | ocr          | clock-mismatch (manual=remaining 18:51 ≡ elapsed 01:09) |
| 3rd      | 18:51        | -, Toews      | 11:25    | TOEWS       | ocr          | clock-mismatch (manual=remaining 18:51 ≡ elapsed 01:09) |
| 3rd      | 18:51        | -, Toews      | 18:51    | Toews       | ocr          | clock=remaining                                         |
| 3rd      | 18:51        | -, Toews      | 1:09     | TOEWS       | ocr          | clock=elapsed                                           |
| 3rd      | 19:08        | S. Zubov      | 0:52     | S. ZUBOV    | ocr          | clock=elapsed                                           |
| 3rd      | 19:08        | S. Zubov      | 19:08    | S. Zubov    | ocr          | clock=remaining                                         |
| Overtime | 17:23        | E. Wanhg      | 17:23    | E. Wanhg    | ocr          | clock=remaining                                         |
| Overtime | 17:23        | E. Wanhg      | 2:37     | E. WANHG    | ocr          | clock=elapsed                                           |

## Action Tracker discrepancies (per period)

### 2nd period

#### Missing from DB (2) — manual says present, OCR didn't catch

| Manual type | Manual clock | Manual initiator | Manual receiver |
| ----------- | ------------ | ---------------- | --------------- |
| faceoff     | 04:42        | -, Toews         | E. Wanhg        |
| faceoff     | 10:07        | -, Toews         | E. Wanhg        |

#### Extra in DB (3) — OCR captured, no manual entry

| DB type | DB clock | DB actor    | DB target  | Suspected cause                                         |
| ------- | -------- | ----------- | ---------- | ------------------------------------------------------- |
| goal    | 06:19    | Silky       |            | likely Events/Action Tracker clock-convention duplicate |
| shot    | 11:23    | SIlKY       | M. LEHMANN | OCR letter misread of '-, Silky'                        |
| goal    | 14:53    | M. Rantanen |            | likely Events/Action Tracker clock-convention duplicate |

### 3rd period

#### Extra in DB (7) — OCR captured, no manual entry

| DB type | DB clock | DB actor | DB target   | Suspected cause                                         |
| ------- | -------- | -------- | ----------- | ------------------------------------------------------- |
| goal    | 08:35    | Toews    |             | likely Events/Action Tracker clock-convention duplicate |
| goal    | 13:58    | Silky    |             | likely Events/Action Tracker clock-convention duplicate |
| goal    | 18:51    | Toews    |             | likely Events/Action Tracker clock-convention duplicate |
| goal    | 19:08    | S. Zubov |             | likely Events/Action Tracker clock-convention duplicate |
| hit     | 2:09     | WILOE    | M. RANTANEN | OCR letter misread of '-, WIlde'                        |
| shot    | 2:35     | fOEWS    | J. WAGNER   | OCR letter misread of '-, Toews'                        |
| hit     | 6:51     | WILOE    | H. JENKINS  | OCR letter misread of '-, WIlde'                        |

### OT period

#### Extra in DB (2) — OCR captured, no manual entry

| DB type | DB clock | DB actor | DB target  | Suspected cause                                         |
| ------- | -------- | -------- | ---------- | ------------------------------------------------------- |
| goal    | 17:23    | E. Wanhg |            | likely Events/Action Tracker clock-convention duplicate |
| shot    | 71:10    | SILKY    | M. LEHMANN | bogus clock (>20:00)                                    |
