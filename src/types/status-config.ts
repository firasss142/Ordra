export const STATUS_SCOPES = ["prospect", "follow_up"] as const;
export type StatusScope = (typeof STATUS_SCOPES)[number];

export interface StatusConfig {
  id: string;
  market_id: string;
  scope: StatusScope;
  key: string;
  label_fr: string;
  label_ar: string;
  color: string;
  sort_order: number;
  is_initial: boolean;
  is_terminal: boolean;
  allowed_transitions: string[];
  created_at: string;
  updated_at: string;
}

export const STATUS_KEY_REGEX = /^[a-z][a-z0-9_]*$/;
