// Posts a release announcement to Discord channels through their webhooks.
//   DISCORD_WEBHOOKS="<url>\n<url>" node scripts/announce.mjs <message.txt | payload.json>
// One webhook URL per line (each server/channel its own). No URLs: nothing is posted. Mentions are
// disabled, so a post can never ping @everyone or a role by accident.
import fs from 'node:fs';

const urls = (process.env.DISCORD_WEBHOOKS ?? '')
  .split(/\s+/)
  .map((u) => u.trim())
  .filter(Boolean);
const file = process.argv[2];
if (!file) throw new Error('usage: node scripts/announce.mjs <message-file>');
if (!urls.length) {
  console.log('No DISCORD_WEBHOOKS set: nothing announced.');
  process.exit(0);
}
// A .json file is a whole webhook payload (embeds, username, avatar_url); anything else is the text.
const raw = fs.readFileSync(file, 'utf8').trim();
const payload = file.endsWith('.json') ? JSON.parse(raw) : { content: raw };
if (payload.content) payload.content = String(payload.content).slice(0, 2000); // Discord's message limit
payload.allowed_mentions = { parse: [] }; // never pings, whatever the payload says
let failed = 0;
for (const [i, url] of urls.entries()) {
  if (!/^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(url) && !process.env.ANNOUNCE_ALLOW_ANY_URL) {
    console.log(`::warning::Webhook ${i + 1} doesn't look like a Discord webhook URL; skipped.`);
    failed++;
    continue;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (res.ok) console.log(`Announced in channel ${i + 1} of ${urls.length}.`);
  else {
    failed++;
    console.log(`::warning::Discord answered ${res.status} for webhook ${i + 1}: ${(await res.text()).slice(0, 200)}`);
  }
}
// A failed announcement never fails the release (it's already published); it shows as a warning.
process.exit(0);
