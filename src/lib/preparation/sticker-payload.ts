/**
 * Is this what a Darb Assabil sticker scan looks like?
 *
 * The pre-printed sticker carries a plain number and its QR encodes exactly
 * that number — nothing else (confirmed on the physical rolls). So a payload
 * with anything but digits is a mis-scan: a URL, a Tunisian label's uuid, a
 * mistyped code. Darb binds ANY string without complaint, which is why this
 * is checked before the network is touched. Leading zeros are allowed (some
 * printers pad); no length rule, since reference formats differ per account
 * age.
 */
export function isDarbStickerPayload(raw: string): boolean {
  return /^[0-9]+$/.test(raw.trim());
}
