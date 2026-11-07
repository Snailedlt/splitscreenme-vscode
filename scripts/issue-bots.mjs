// The issue bots (.github/workflows/doc-review.yml and report-details.yml): they read an issue opened from an issue form
// and add a comment the reporter can't edit. The logic is here, as plain functions, so src/test/bots.test.ts can test it
// with real issue bodies and check that the forms (.github/ISSUE_TEMPLATE/*.yml) still have the fields it reads.
// Never runs code from the issue: it only reads the body as text.

/** The form fields the bots read, by template: GitHub turns each field's label into a `### <label>` heading. */
export const BOT_FIELDS = {
  'doc-review.yml': ['Which name', 'Details from the workbench'],
  'tester-feedback.yml': ['Details from the workbench'],
};
export const DOC_MARKER = '<!-- doc-review-bot -->';
export const DETAILS_MARKER = '<!-- report-details-bot -->';

/** A form field's answer: the text under `### <label>`, without a code fence; '' when empty or `_No response_`. */
export function field(body, label) {
  const text = String(body || '').replace(/\r\n/g, '\n');
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(`(?:^|\\n)###[ \\t]*${esc}[ \\t]*\\n([\\s\\S]*?)(?=\\n###[ \\t]|$)`));
  if (!m) return '';
  let v = m[1].trim();
  const fence = v.match(/^```\w*\n([\s\S]*?)\n?```$/);
  if (fence) v = fence[1].trim();
  return v === '_No response_' ? '' : v;
}

/** FNV-1a over the lines, the same as checksum() in the workbench (playground/src/report.ts in nucleuscoop-handler-testbench). */
export function checksum(lines) {
  let h = 0x811c9dc5;
  for (const ch of lines.map((l) => l.trim()).filter(Boolean).join('\n')) {
    h ^= ch.codePointAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The "Details from the workbench" check: 'ok', 'none' (no checksum line: typed by hand) or 'changed'. */
export function checkDetails(block) {
  const lines = String(block).split('\n').map((l) => l.trim()).filter(Boolean);
  const sumLine = lines.findIndex((l) => /^Check: [0-9a-f]{8}$/.test(l));
  if (sumLine < 0) return { lines, status: 'none' };
  const ok = sumLine > 0 && sumLine === lines.length - 1 && checksum(lines.slice(0, sumLine)) === lines[sumLine].slice(7);
  return { lines, status: ok ? 'ok' : 'changed' };
}

/** The report-details comment for an issue body, or null when the form's details field is missing or empty. */
export function detailsComment(body) {
  const block = field(body, 'Details from the workbench');
  if (!block) return null;
  const { lines, status } = checkDetails(block);
  const says = {
    ok: '✅ As the workbench filled it in.',
    none: '⚠️ No checksum: typed or pasted by hand, not filled in by the workbench.',
    changed: '⚠️ Changed before sending: it no longer matches its checksum.',
  }[status];
  const safe = lines.join('\n').replace(/```/g, "'''").slice(0, 4000);
  return `${DETAILS_MARKER}\n**Details from the workbench**, as sent. ${says}\n\n\`\`\`text\n${safe}\n\`\`\`\n\nThis copy stays as it is if the issue is edited later.`;
}

/** The member a doc review is about (the form's "Which name"), or ''. */
export function docReviewMember(body) {
  const m = field(body, 'Which name').match(/^`?([A-Za-z_$][\w$.]*)`?/);
  return m ? m[1] : '';
}

/** The doc-review comment: the doc as it is now, with its basis and links to the Nucleus source; or a request for the name. */
export function docReviewComment(member, d, sha) {
  if (!d) return `${DOC_MARKER}\nI couldn't find an AI-written doc for \`${member || '(no name given)'}\`. Please put the exact name in **Which name** (e.g. \`Game.AddOption\`) by editing the issue, and I'll add the doc here.`;
  const search = (file) => `https://github.com/search?q=repo%3ASplitScreen-Me%2Fsplitscreenme-nucleus+path%3A${encodeURIComponent(file)}&type=code`;
  const files = [...new Set(d.basis.match(/[\w.]+\.(cs|cpp|h)\b/g) || [])];
  return `${DOC_MARKER}\n**The AI-written doc** for \`${member}\` (data/claude-docs.json @ ${sha}):\n\n> ${d.doc.replace(/\n/g, '\n> ')}\n\n**Based on:** ${d.basis}\n\n${files.length ? `**Source:** ${files.map((f) => `[${f}](${search(f)})`).join(' · ')}\n\n` : ''}A maintainer checks the report against Nucleus. When it's settled, the doc is fixed or marked \`checkedBy\` in data/claude-docs.json.`;
}

/** report-details.yml: on a new issue, keep the details block as a comment. */
export async function runReportDetails({ github, context }) {
  const text = detailsComment(context.payload.issue.body);
  if (!text) return;
  await github.rest.issues.createComment({ ...context.repo, issue_number: context.payload.issue.number, body: text });
}

/** doc-review.yml: on a new or edited doc review, attach the doc once (it then stays as it was). */
export async function runDocReview({ github, context, docs }) {
  const issue = context.payload.issue;
  const member = docReviewMember(issue.body);
  const d = docs[member];
  const comments = await github.paginate(github.rest.issues.listComments, { ...context.repo, issue_number: issue.number });
  const mine = comments.find((c) => c.user.type === 'Bot' && (c.body || '').includes(DOC_MARKER));
  if (mine && mine.body.includes('**The AI-written doc**')) return;
  const text = docReviewComment(member, d, context.sha.slice(0, 7));
  if (mine) await github.rest.issues.updateComment({ ...context.repo, comment_id: mine.id, body: text });
  else await github.rest.issues.createComment({ ...context.repo, issue_number: issue.number, body: text });
  if (d && !issue.title.includes(member)) await github.rest.issues.update({ ...context.repo, issue_number: issue.number, title: `Doc review: ${member}` });
}
