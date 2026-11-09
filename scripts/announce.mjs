// Posts a release announcement to Discord channels through their webhooks.
//   DISCORD_WEBHOOKS="<url>\n<url>" node scripts/announce.mjs <message.txt | payload.json>
// One webhook URL per line (each server/channel its own). No URLs: nothing is posted. Mentions are
// disabled, so a post can never ping @everyone or a role by accident.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The webhook URLs in DISCORD_WEBHOOKS (one per line). */
export const webhookUrls = (env = '') => env.split(/\s+/).map((u) => u.trim()).filter(Boolean);

/** Only Discord's own webhook URLs get the post. */
export const isDiscordWebhook = (url) => /^https:\/\/(discord\.com|discordapp\.com|ptb\.discord\.com|canary\.discord\.com)\/api\/webhooks\/\d+\/[\w-]+$/.test(url);

/** The webhook payload: a .json file is a whole payload (embeds, username, avatar_url); anything else is the text. */
export function buildPayload(raw, isJson) {
  raw = raw.trim();
  const payload = isJson ? JSON.parse(raw) : { content: raw };
  if (payload.content) payload.content = String(payload.content).slice(0, 2000); // Discord's message limit
  payload.allowed_mentions = { parse: [] }; // never pings, whatever the payload says
  return payload;
}

/** Posts `payload` to each URL. Never throws: a failed post is a warning (the release is already published). */
export async function announce(urls, payload, { fetch: post = globalThis.fetch, log = console.log, allowAnyUrl = false } = {}) {
  let posted = 0;
  let failed = 0;
  for (const [i, url] of urls.entries()) {
    if (!isDiscordWebhook(url) && !allowAnyUrl) {
      log(`::warning::Webhook ${i + 1} doesn't look like a Discord webhook URL; skipped.`);
      failed++;
      continue;
    }
    let res;
    try {
      res = await post(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // No connection, DNS…: a warning like any other failed post, never a failed release.
      failed++;
      log(`::warning::Couldn't reach Discord for webhook ${i + 1}: ${e?.message ?? e}`);
      continue;
    }
    if (res.ok) {
      posted++;
      log(`Announced in channel ${i + 1} of ${urls.length}.`);
    } else {
      failed++;
      log(`::warning::Discord answered ${res.status} for webhook ${i + 1}: ${(await res.text()).slice(0, 200)}`);
    }
  }
  return { posted, failed };
}

async function main() {
  const urls = webhookUrls(process.env.DISCORD_WEBHOOKS ?? '');
  const file = process.argv[2];
  if (!file) throw new Error('usage: node scripts/announce.mjs <message-file>');
  if (!urls.length) {
    console.log('No DISCORD_WEBHOOKS set: nothing announced.');
    process.exit(0);
  }
  const payload = buildPayload(fs.readFileSync(file, 'utf8'), file.endsWith('.json'));
  await announce(urls, payload, { allowAnyUrl: !!process.env.ANNOUNCE_ALLOW_ANY_URL });
  // A failed announcement never fails the release (it's already published); it shows as a warning.
  process.exit(0);
}

// Run as a script (not when a test imports it).
if (process.argv[1] && import.meta.url === pathToFileURL(fs.realpathSync(process.argv[1])).href) await main();
