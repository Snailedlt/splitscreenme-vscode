// Types for scripts/issue-bots.mjs (used by src/test/bots.test.ts).
export const BOT_FIELDS: Record<string, string[]>;
export const DOC_MARKER: string;
export const DETAILS_MARKER: string;
export function field(body: string, label: string): string;
export function checksum(lines: string[]): string;
export function checkDetails(block: string): { lines: string[]; status: 'ok' | 'none' | 'changed' };
export function detailsComment(body: string): string | null;
export function docReviewMember(body: string): string;
export function docReviewComment(member: string, d: { doc: string; basis: string } | undefined, sha: string): string;
export function runReportDetails(args: { github: any; context: any }): Promise<void>;
export function runDocReview(args: { github: any; context: any; docs: Record<string, { doc: string; basis: string }> }): Promise<void>;
