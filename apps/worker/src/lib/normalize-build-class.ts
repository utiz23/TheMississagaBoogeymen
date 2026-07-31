/**
 * Re-export shim. The normalizer moved to `@eanhl/db` so the lineup read path
 * can use it too: `getMatchLineups` recovers build-class (and the bio fields)
 * straight from the stored loadout-view payloads, which are raw OCR strings
 * like "COLECAUFIELD-SNP" and need the same normalization the consolidator
 * applies on write.
 *
 * Worker call sites keep importing from here.
 */
export { BUILD_CANONICAL_NAMES, normalizeBuildClass } from '@eanhl/db/lib/normalize-build-class'
