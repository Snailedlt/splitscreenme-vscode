// Notepad++ support (splitscreenme-vscode#19, step 1): Nucleus names and call tips in Notepad++'s own auto-completion
// file for JavaScript (`autoCompletion/javascript.xml` in Notepad++'s folder). Tried in Notepad++ 8.9.9.
// Notepad++ reads one file per language, so ours is merged into its own list (its JavaScript words stay). The merge
// happens on the user's PC (`nucleus setup notepad++`), from Notepad++'s original file: we don't ship a copy of it.
import { allEntries } from './lookup';
import { api, type Member } from './api';
import { DOTNET_OBJECTS } from './dotnet';

/** Marks our entries, so setting up again or removing them leaves Notepad++'s own words alone. */
export const NPP_MARKER = 'nucleus-handler-tools';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const oneLine = (doc: string) => (doc || '').split('\n')[0].replace(/[`*_]/g, '').trim().slice(0, 240);

/** Our keyword entries, by name: every handler API name, methods with their overloads as call tips. */
export function nucleusKeywords(): Map<string, string> {
  const out = new Map<string, string>();
  // The handler API, then the .NET members handlers use (System.IO.Path.Combine…), by their full names.
  const entries: { path: string; member: Member }[] = allEntries().map((e) => ({ path: e.path, member: e.member }));
  const walk = (obj: string, prefix: string, depth: number) => {
    for (const [name, m] of Object.entries(DOTNET_OBJECTS[obj]?.members ?? {})) {
      entries.push({ path: `${prefix}.${name}`, member: m });
      if (m.ref && depth < 4) walk(m.ref, `${prefix}.${name}`, depth + 1);
    }
  };
  walk('System', 'System', 0);
  for (const e of entries) {
    const doc = oneLine(e.member.doc);
    if (e.member.kind === 'method' && e.member.overloads?.length) {
      const ov = e.member.overloads
        .map((o) => {
          const params = o.params.map((p) => `\t\t\t\t<Param name="${esc(`${p.csType ?? p.type}${p.rest ? '...' : ''} ${p.name}`)}" />`).join('\n');
          return `\t\t\t<Overload retVal="${esc(o.returns)}" descr="${esc(doc)}">${params ? `\n${params}\n\t\t\t` : ''}</Overload>`;
        })
        .join('\n');
      out.set(e.path, `<KeyWord name="${esc(e.path)}" func="yes">\n${ov}\n\t\t</KeyWord>`);
    } else out.set(e.path, `<KeyWord name="${esc(e.path)}" />`);
  }
  // Enum values (Nucleus.DPIHandling.True) are what option values are written with.
  for (const [name, en] of Object.entries(api.enums)) for (const v of Object.keys(en.values)) out.set(`Nucleus.${name}.${v}`, `<KeyWord name="${esc(`Nucleus.${name}.${v}`)}" />`);
  return out;
}

/** Notepad++'s JavaScript auto-completion file with the Nucleus names added (any earlier ones of ours replaced).
 *  `original` is Notepad++'s own file; its words and settings are kept. */
export function mergeNotepadPP(original: string, version = ''): string {
  const words = new Map<string, string>();
  const body = original.replace(new RegExp(`<!-- ${NPP_MARKER}[\\s\\S]*?${NPP_MARKER} end -->\\s*`, 'g'), '');
  // Notepad++'s own entries: <KeyWord name="x" /> or <KeyWord name="x" func="yes"> … </KeyWord>.
  for (const m of body.matchAll(/<KeyWord\s+name="([^"]+)"[^>]*?(?:\/>|>[\s\S]*?<\/KeyWord>)/g)) words.set(m[1].replace(/&amp;/g, '&'), m[0]);
  const ours = nucleusKeywords();
  for (const [k, v] of ours) words.set(k, v);
  // Notepad++ needs the list sorted (by character code when ignoreCase="no").
  const keys = [...words.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const env = body.match(/<Environment\b[^>]*\/>/)?.[0] ?? '<Environment ignoreCase="no" startFunc="(" stopFunc=")" paramSeparator="," terminal=";" />';
  // "." inside a word, so Game.KillMutex is suggested as one name.
  const envDot = /additionalWordChar="[^"]*\.[^"]*"/.test(env) ? env : /additionalWordChar="/.test(env) ? env.replace(/additionalWordChar="/, 'additionalWordChar=".') : env.replace(/\s*\/>$/, ' additionalWordChar="." />');
  const lang = body.match(/<AutoComplete\b[^>]*>/)?.[0] ?? '<AutoComplete language="JavaScript">';
  return `<?xml version="1.0" encoding="UTF-8" ?>
<!-- ${NPP_MARKER} ${version}: Nucleus Co-op handler names added to Notepad++'s own JavaScript list (\`nucleus setup notepad++\`; \`--remove\` puts the original back). ${NPP_MARKER} end -->
<NotepadPlus>
\t${lang}
\t\t${envDot}
${keys.map((k) => `\t\t${words.get(k)}`).join('\n')}
\t</AutoComplete>
</NotepadPlus>
`;
}

/** Whether a file already has our names, and from which version. */
export function notepadPPVersion(text: string): string | undefined {
  const m = text.match(new RegExp(`<!-- ${NPP_MARKER} ([^:]*):`));
  return m ? m[1].trim() || 'unknown' : undefined;
}
