// The user's settings that more than one part of the extension reads.
import * as vscode from 'vscode';
import type { RuleId, Severity } from './core/lint';

/** splitscreenme.lint.rules: a severity (or off) per rule. */
export function ruleOverrides(): Partial<Record<RuleId, Severity | 'off'>> {
  return vscode.workspace.getConfiguration('splitscreenme').get('lint.rules', {});
}
