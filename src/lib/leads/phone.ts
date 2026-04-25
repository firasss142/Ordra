export function normalizePhone(raw: string): string {
  if (!raw) return "";
  // Remove formatting characters: spaces, dashes, dots, parentheses
  let digits = raw.replace(/[\s\-.()\u00A0]/g, "");
  // Strip leading + sign to handle as digits
  if (digits.startsWith("+")) {
    digits = digits.slice(1);
  }
  // Strip 00-prefix international dialing (00216, 00218)
  if (digits.startsWith("00216")) return digits.slice(5);
  if (digits.startsWith("00218")) return digits.slice(5);
  // Strip country codes 216 (Tunisia) or 218 (Libya)
  if (digits.startsWith("216") && digits.length > 3) return digits.slice(3);
  if (digits.startsWith("218") && digits.length > 3) return digits.slice(3);
  return digits;
}
