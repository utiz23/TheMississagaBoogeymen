/**
 * Shared, shape-agnostic serialization discipline for the local signal and
 * report lines (E3J8A).
 *
 * WHY THIS FILE EXISTS
 * ---------------------
 * E3J7 established a serialize discipline for its health signal:
 * validate → stringify → reparse → re-validate → compare, returning `null`
 * on any doubt and never throwing. E3J8A prints a second JSON line (the
 * monitor-export report) and posts a third (the failure body), and both need
 * exactly that discipline. Writing a weaker copy of it per shape is the
 * failure mode this file exists to prevent, so the loop lives here once and
 * each caller supplies its own two shape-specific predicates.
 *
 * `deepFreeze` moved here verbatim from
 * `internal/backup-cloud-freshness-core.mjs` for the same reason: both the
 * signal and the report are handed out deeply frozen. That move is
 * behaviour-preserving and changed no E3J7 assertion.
 *
 * WHY E3J7 DOES NOT CALL `serializeChecked`
 * ------------------------------------------
 * It was meant to. Rewriting `serializeFreshnessSignal()` as a call to
 * `serializeChecked()` is behaviourally identical, but it breaks an existing,
 * verified E3J7 STATIC assertion — `backup-cloud-freshness.test.mjs`'s
 * "the entrypoint serializes only a projection, never the caller object",
 * which requires the core to contain exactly one `JSON.stringify(projection)`
 * and the literal guard `if (!validateFreshnessSignal(projection)) return null`.
 * Those are deliberate regressions against re-introducing a
 * serialize-the-caller's-object bug, and editing a verified assertion to make
 * a refactor fit is not an acceptable trade (E3J8A plan stop condition S5).
 * So `serializeFreshnessSignal()` keeps its own inline copy of the loop, and
 * `serializeChecked()` below is the SELF-CONTAINED helper the E3J8A report and
 * failure body use. The two are intentionally identical in behaviour; if one
 * ever changes, change both, and prefer changing the loop here first.
 *
 * WHAT THIS FILE DELIBERATELY DOES NOT DO
 * ----------------------------------------
 * E3J7's nested projection machinery is **not** moved here, and this helper
 * never projects anything itself: it must be handed an object its caller
 * already owns. The original E3J8A plan assumed no caller-owned report would
 * ever reach it; that was false, because `validateExportReport()` and
 * `serializeExportReport()` are public APIs. So the export core carries its
 * own small, FLAT report projection (`projectExportReport()`: Proxy refusal
 * without a trap, accessor refusal without invocation, exact
 * `Reflect.ownKeys()` set) and passes only that fresh projection here. The
 * failure body is built inside the core and never leaves it as an object.
 *
 * No I/O, no clock, no environment read, no logging. Nothing here ever throws
 * and nothing here ever echoes a value.
 */

/**
 * Freeze `value` and, recursively, every own enumerable value beneath it.
 *
 * Moved verbatim from `internal/backup-cloud-freshness-core.mjs`; the
 * `Object.isFrozen` short-circuit is what keeps a cyclic structure from
 * recursing forever.
 */
export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const v of Object.values(value)) deepFreeze(v)
    Object.freeze(value)
  }
  return value
}

/**
 * Serialize `value` to JSON text, re-parse the text, and re-check it, so the
 * bytes a caller is about to print are the bytes that were validated.
 *
 * The round trip is not paranoia about `JSON.stringify` itself: a fresh
 * null-prototype object rules out every `toJSON` route except a polluted
 * `Array.prototype.toJSON`, which the reparse-and-compare step catches. The
 * failure mode is therefore "no line", never "a wrong line".
 *
 * Returns `null` on any doubt — a failed validation, a non-string or empty
 * result, an unparseable round trip, a reparsed value that fails the same
 * validation, a projection/reparse mismatch, or anything thrown along the way.
 * It never throws, never prints, and never includes a value or a native error
 * in what it returns, because both can echo the thing being protected.
 *
 * @param {unknown} value the object to serialize — always one the caller
 *   itself owns: for the E3J8A report, its fresh projection; for the failure
 *   body, one assembled from literals and closed codes
 * @param {(candidate: unknown) => boolean} validate the caller's closed-contract check
 * @param {(a: unknown, b: unknown) => boolean} same the caller's structural
 *   equality over that contract's fixed shape
 * @returns {string|null}
 */
export function serializeChecked(value, validate, same) {
  try {
    if (!validate(value)) return null
    const text = JSON.stringify(value)
    if (typeof text !== 'string' || text.length === 0) return null
    const reparsed = JSON.parse(text)
    if (!validate(reparsed)) return null
    if (!same(value, reparsed)) return null
    return text
  } catch {
    return null
  }
}
