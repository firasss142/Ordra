import type { SheetsRowAdapter } from "./types";
import { ConvertySheetsAdapter } from "./converty-sheets-adapter";

const registry: Record<string, () => SheetsRowAdapter> = {
  converty: () => new ConvertySheetsAdapter(),
};

export function getSheetsAdapter(platform: string): SheetsRowAdapter {
  const factory = registry[platform];
  if (!factory) throw new Error(`Unknown sheets adapter platform: ${platform}`);
  return factory();
}
