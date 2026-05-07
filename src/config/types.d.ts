export interface RevixConfig {
  reviewers: { enabled: string[]; disabled: string[] };
  skills: { paths: string[] };
  quality: { extends: string[]; overrides: object };
  paths: {
    contracts: string[];
    ignored: string[];
    security_sensitive: string[];
    performance_sensitive: string[];
  };
  selection: { rules: object[] };
  severity: { overrides: Record<string, unknown> };
  labels: { skip: string[]; force_reviewers: Record<string, string[]> };
  output: { format: "markdown" | "json" | "github-comment" };
  provider: {
    name: "mock" | "openai" | "anthropic";
    fixture_dir: string;
    model: string;
    temperature: number;
    timeout_ms: number;
    max_retries: number;
  };
  verdict: { fail_on_request_changes: boolean };
}

export class RevixConfigError extends Error {}
export const DEFAULT_CONFIG: Readonly<RevixConfig>;
export function loadRevixConfig(projectRoot?: string): Readonly<RevixConfig>;
export function mergeRevixConfig(defaultConfig?: RevixConfig, rawConfig?: object): Readonly<RevixConfig>;
export function shouldSkipReview(config: RevixConfig, labels?: string[]): boolean;
export function forcedReviewersForLabels(config: RevixConfig, labels?: string[]): readonly string[];
