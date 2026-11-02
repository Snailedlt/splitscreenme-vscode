// "Try it": how Nucleus would load a handler and run Game.Play for each player, without Nucleus.
// It runs in a JavaScript engine that is NOT Jint, so it emulates the Jint 2.11.58 behaviours the
// testbench probes confirmed: first-letter-only case matching, silently ignored writes to unknown
// members, array options rejecting non-arrays, booleans becoming 0/1 for enums, wrong argument
// counts throwing, ES5-only built-ins, let/const as var. Syntax Jint can't parse is refused up
// front by the linter. File, registry and process calls are recorded, never performed.
//
// This runs the handler's code. Browsers sandbox it already; in Node (CLI, VS Code) use
// simulateIsolated() from src/sandbox.ts, which runs it in a separate realm with no Node access.
import { api, Member, jintMemberName } from './api';
import { lint, MISSING_GLOBALS, MISSING_METHODS, MISSING_STATIC } from './lint';
import * as acorn from 'acorn';

export interface SimOptions {
  players: number;
  width: number;
  height: number;
  keyboardPlayer: number; // index of the keyboard/mouse player, -1 for none
}

export interface PlayerRun {
  index: number;
  startArguments: string;
  calls: string[];
  /** The same calls in plain language, for the ones that change something. */
  effects: string[];
  /** e.g. "left half of the screen, 960 × 1080" */
  window: string;
  error?: string;
}

export interface SimResult {
  loaded: boolean;
  loadError?: string;
  ignored: string[];
  options: { path: string; value: string }[];
  players: PlayerRun[];
  callbacks: { name: string; calls: string[]; error?: string }[];
  hasPlay: boolean;
}

class JintError extends Error {}

let effects: string[] | null = null;
const base = (p: unknown) => String(p ?? '').split(/[\\/]/).filter(Boolean).pop() ?? String(p);
const plainValue = (v: unknown) => (typeof v === 'string' ? v : v && typeof v === 'object' && 'Value' in (v as any) ? String((v as any).Value) : String(v));

/** A plain-language line for calls that change something on disk or start/stop programs. */
function describeCall(label: string, name: string, args: unknown[]): string | null {
  const a = args;
  if (label === 'Context') {
    switch (name) {
      case 'ModifySaveFile': {
        const infos = (Array.isArray(a[3]) ? a[3] : a.slice(3)) as any[];
        const sets = infos.filter((i) => i && typeof i === 'object' && 'Key' in i).map((i) => `${i.Key} = ${plainValue(i.Value)}`);
        return `Changes ${base(a[1])}${sets.length ? `: ${sets.join(', ')}` : ''}`;
      }
      case 'WriteTextFile': {
        const lines = Array.isArray(a[1]) ? a[1].length : a.length - 1;
        return `Writes ${base(a[0])} (${lines} line${lines === 1 ? '' : 's'})`;
      }
      case 'ReplaceLinesInTextFile':
      case 'ReplacePartialLinesInTextFile': {
        const lines = (Array.isArray(a[1]) ? a[1] : []).map((l: unknown) => String(l).split('|').pop());
        return `Changes ${base(a[0])}${lines.length ? `: ${lines.join(', ')}` : ''}`;
      }
      case 'ChangeXmlAttributeValue':
        return `Changes ${base(a[0])}: ${a[2]} = ${a[3]}`;
      case 'ChangeXmlNodeValue':
      case 'ChangeXmlNodeInnerTextValue':
        return `Changes ${base(a[0])}: ${String(a[1]).replace(/^\/+/, '')} = ${a[2]}`;
      case 'EditRegKey':
      case 'EditRegKeyNoBackup':
        return `Sets registry value ${a[2]} = ${a[3]}`;
      case 'DeleteRegKey':
        return `Deletes registry key ${a[1]}`;
      case 'StartProcess':
        return `Starts ${base(a[0])}`;
      case 'RunAdditionalFiles':
        return `Runs ${(Array.isArray(a[0]) ? a[0] : [a[0]]).map(base).join(', ')}`;
      case 'KillProcessesMatchingProcessName':
      case 'KillProcessesMatchingWindowName':
        return `Closes ${a[0]}`;
      case 'CopyScriptFolder':
        return "Copies the handler's own files into the game folder";
      case 'PatchFile':
      case 'PatchFileFindAll':
      case 'PatchFileFindPattern':
      case 'HexEdit':
        return `Patches ${base(a[1] ?? a[0])}`;
    }
  }
  return null;
}
function describeSystem(path: string, args: unknown[]): string | null {
  if (/IO\.File\.Copy$/.test(path)) return `Copies ${base(args[0])}${base(args[1]) !== base(args[0]) ? ` to ${base(args[1])}` : ''}`;
  if (/IO\.File\.Delete$/.test(path)) return `Deletes ${base(args[0])}`;
  if (/IO\.File\.(WriteAllText|WriteAllLines|AppendAllText)$/.test(path)) return `Writes ${base(args[0])}`;
  if (/IO\.Directory\.CreateDirectory$/.test(path)) return `Creates folder ${base(args[0])}`;
  if (/IO\.Directory\.Delete$/.test(path)) return `Deletes folder ${base(args[0])}`;
  if (/Diagnostics\.Process\.Start$/.test(path)) return `Starts ${base(args[0])}`;
  return null;
}

const fmt = (v: unknown): string => {
  if (v === null) return 'null';
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'function') return 'function () {…}';
  if (Array.isArray(v)) return '[' + v.map(fmt).join(', ') + ']';
  if (typeof v === 'object' && (v as any).__label) return (v as any).__label;
  return String(v);
};

function parseDefault(m: Member): unknown {
  const d = m.default;
  if (m.type === 'boolean') return d === 'true';
  if (m.type === 'number') return d && /^-?[\d.]+$/.test(d) ? Number(d) : d && /^0x/i.test(d) ? parseInt(d, 16) : 0;
  if (m.type === 'string') return d && /^".*"$/.test(d) ? JSON.parse(d) : null;
  if (m.type?.startsWith('enum:')) {
    const e = api.enums[m.type.slice(5)];
    const key = d?.split('.').pop();
    return e && key && key in e.values ? e.values[key] : 0;
  }
  return null;
}

function returnValue(name: string, returns: string, args: unknown[], ctx: Record<string, unknown>): unknown {
  if (returns === 'void') return undefined;
  if (returns === 'boolean') return true;
  if (returns === 'number') return name === 'FindLineNumberInTextFile' ? 5 : 0;
  if (returns === 'string') {
    if (name === 'GetFolder') {
      const v = args[0];
      if (v === api.enums.Folder.values.Documents) return 'C:\\Users\\me\\Documents';
      if (v === api.enums.Folder.values.MainGameFolder) return 'D:\\Games\\TheGame';
      return `C:\\Nucleus\\content\\${ctx.__guid}\\Instance${ctx.__player}`;
    }
    return `<${name}>`;
  }
  if (returns.endsWith('[]')) return [];
  return null;
}

/** A Proxy behaving like a Jint ObjectWrapper around one of Nucleus' .NET objects. */
function clr(type: string, label: string, log: string[], ignored: string[], store: Record<string, unknown>, extra: Record<string, unknown> = {}): any {
  const obj = api.objects[type];
  const members = obj.members;
  for (const [k, m] of Object.entries(members)) {
    if (k in store || k in extra) continue;
    if (m.kind === 'object' && m.ref && api.objects[m.ref]) store[k] = clr(m.ref, `${label}.${k}`, log, ignored, {});
    else if (m.kind !== 'method') store[k] = parseDefault(m);
  }
  const target = { __label: label };
  return new Proxy(target, {
    has: (_t, p) => typeof p === 'string' && !!jintMemberName(members, p),
    get(_t, p) {
      if (p === '__label') return label;
      if (typeof p !== 'string') return undefined;
      if (p.startsWith(NOJINT)) p = p.slice(NOJINT.length); // .NET objects do have e.g. List.Find
      if (p in extra) return extra[p];
      const key = jintMemberName(members, p);
      if (key && key in extra) return extra[key]; // computed values (Context.Width), any first-letter case
      if (!key) return undefined; // Jint: unknown members read as undefined
      const m = members[key];
      if (m.kind === 'method') {
        return (...args: unknown[]) => {
          const ok = (m.overloads ?? []).some((o) => {
            const req = o.params.filter((x) => !x.optional && !x.rest).length;
            const max = o.params.some((x) => x.rest) ? Infinity : o.params.length;
            return args.length >= req && args.length <= max;
          });
          log.push(`${label}.${key}(${args.map(fmt).join(', ')})`);
          const fx = effects && describeCall(label, key, args);
          if (fx) effects!.push(fx);
          if (!ok) throw new JintError('No public methods with the specified arguments were found.');
          const returns = m.overloads?.find((o) => o.params.length === args.length)?.returns ?? m.overloads?.[0]?.returns ?? 'void';
          return returnValue(key, returns, args, store);
        };
      }
      return store[key];
    },
    set(_t, p, value) {
      if (typeof p !== 'string') return true;
      const key = jintMemberName(members, p);
      if (!key) {
        ignored.push(`${label}.${p} = ${fmt(value)} (no such member; Nucleus ignores it)`);
        return false; // ignored in sloppy code; "use strict" code throws, as in Jint
      }
      const m = members[key];
      if (m.kind === 'method' || m.kind === 'object' || m.readonly) {
        ignored.push(`${label}.${key} = ${fmt(value)} (read-only; Nucleus ignores it)`);
        return true;
      }
      const t = m.type ?? 'any';
      if (/\[\]$/.test(t) && value !== null && value !== undefined && !Array.isArray(value)) {
        throw new JintError(`Value of object[] type is expected, but actual type is ${typeof value === 'string' ? 'System.String' : 'System.Double'}. (${label}.${key})`);
      }
      if (t.startsWith('enum:') && typeof value === 'boolean') value = value ? 1 : 0;
      if (t === 'boolean' && typeof value === 'string') value = /^true$/i.test(value);
      if (t === 'number' && typeof value === 'string' && /^\s*-?[\d.]+\s*$/.test(value)) value = Number(value);
      if (t === 'string' && typeof value === 'number') value = String(value);
      store[key] = value;
      return true;
    },
  });
}

/** Fake .NET `System` namespace: records calls, returns plausible values. */
function systemNs(log: string[], path = 'System'): any {
  const fn = function () {} as any;
  return new Proxy(fn, {
    get(_t, p) {
      if (typeof p !== 'string' || p === 'then') return undefined;
      if (p.startsWith(NOJINT)) p = p.slice(NOJINT.length);
      return systemNs(log, `${path}.${p}`);
    },
    apply(_t, _this, args) {
      log.push(`${path}(${args.map(fmt).join(', ')})`);
      const fx = effects && describeSystem(path, args);
      if (fx) effects!.push(fx);
      if (/Path\.Combine$/.test(path)) return args.join('\\');
      if (/\.(Exists)$/.test(path)) return false;
      if (/Path\.GetFileName$/.test(path)) return String(args[0]).split('\\').pop();
      return undefined;
    },
  });
}

function nucleusNs(): any {
  const ns: Record<string, unknown> = {};
  for (const [name, e] of Object.entries(api.enums)) ns[name] = Object.freeze({ ...e.values });
  for (const [name, c] of Object.entries(api.nucleusClasses)) {
    ns[name] = function (this: any, ...args: unknown[]) {
      if (args.length !== c.params.length) throw new JintError('No public methods with the specified arguments were found.');
      this.Section = args[0];
      this.Key = args[1];
      this.Value = args[2];
      this.__label = `${name}(${args.map(fmt).join(', ')})`;
    };
  }
  return ns;
}

/** A .NET System.Drawing.Rectangle as Jint exposes it (first letter of member names case-insensitive). */
function rect(x: number, y: number, width: number, height: number): unknown {
  const r: Record<string, unknown> = { X: x, Y: y, Width: width, Height: height, Left: x, Top: y, Right: x + width, Bottom: y + height, IsEmpty: width === 0 && height === 0 };
  r.Location = { X: x, Y: y };
  r.Size = { Width: width, Height: height };
  return new Proxy(r, { get: (t, p) => (typeof p !== 'string' ? undefined : p in t ? t[p] : t[p[0].toUpperCase() + p.slice(1)]) });
}

const LOAD_BLOCKERS = new Set(['syntax-error', 'es5-only']);

// Make the browser's engine behave like Jint 2.11 where they differ, by rewriting the source:
// - ES2015+ built-ins Jint lacks (`"".includes`, `Object.assign`, `Map`, ...) are renamed so
//   they fail here too;
// - `let`/`const` become `var` (Jint parses them but treats them as `var`);
// - a top-level "use strict" applies to the whole handler (the `with` wrapper hides it).
const NOJINT = '__nojint_';
function withoutModernBuiltins(src: string): { code: string; declared: Set<string> } {
  const declared = new Set<string>();
  let ast: any;
  try {
    ast = acorn.parse(src, { ecmaVersion: 2020, allowReturnOutsideFunction: true });
  } catch {
    return { code: src, declared };
  }
  const nodes: any[] = [];
  const own = new Set<string>();
  const visit = (n: any) => {
    if (!n || typeof n.type !== 'string') return;
    nodes.push(n);
    if (n.type === 'Property' && !n.computed) own.add(n.key.name ?? String(n.key.value));
    if (n.type === 'AssignmentExpression' && n.left.type === 'MemberExpression' && !n.left.computed) own.add(n.left.property.name);
    if (n.type === 'VariableDeclarator' && n.id.type === 'Identifier') declared.add(n.id.name);
    if ((n.type === 'FunctionDeclaration' || n.type === 'FunctionExpression') && n.id) declared.add(n.id.name);
    for (const k of Object.keys(n)) {
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === 'string') visit(v);
    }
  };
  visit(ast);
  const edits: { at: number; end: number; text: string }[] = [];
  for (const n of nodes) {
    if (n.type === 'MemberExpression' && !n.computed && n.property.type === 'Identifier') {
      const name = n.property.name;
      const isStatic = n.object.type === 'Identifier' && MISSING_STATIC[n.object.name]?.includes(name) && !declared.has(n.object.name);
      const onNamespace = n.object.type === 'Identifier' && (n.object.name in MISSING_STATIC || n.object.name === 'JSON');
      if (isStatic || (MISSING_METHODS.has(name) && !own.has(name) && !onNamespace)) edits.push({ at: n.property.start, end: n.property.start, text: NOJINT });
    } else if (n.type === 'VariableDeclaration' && n.kind !== 'var') {
      edits.push({ at: n.start, end: n.start + n.kind.length, text: 'var' });
    } else if (n.type === 'UnaryExpression' && n.operator === 'typeof' && n.argument.type === 'Identifier' && MISSING_GLOBALS.has(n.argument.name) && !declared.has(n.argument.name)) {
      edits.push({ at: n.argument.start, end: n.argument.end, text: '(void 0)' });
    }
  }
  let code = src;
  for (const e of edits.sort((a, b) => b.at - a.at)) code = code.slice(0, e.at) + e.text + code.slice(e.end);
  if (ast.body.some((st: any) => st.type === 'ExpressionStatement' && st.directive === 'use strict')) code = `(function () {\n${code}\n})();`;
  return { code, declared };
}

/** An error as Nucleus would report it. */
function engineError(e: any): string {
  if (e instanceof JintError) return `Jint: ${e.message}`;
  const msg = String(e?.message ?? e);
  const m = msg.match(new RegExp(`${NOJINT}(\\w+)`));
  if (m) return `Jint: Object has no method '${m[1]}'`;
  const strict = msg.match(/'set' on proxy: trap returned falsish for property '([^']+)'/);
  if (strict) return `Jint: "use strict" code can't set \`${strict[1]}\`: no such member`;
  return `${e?.name ?? 'Error'}: ${msg}`;
}

export function simulate(src: string, opt: SimOptions): SimResult {
  const result: SimResult = { loaded: false, ignored: [], options: [], players: [], callbacks: [], hasPlay: false };
  const blocker = lint(src).find((d) => d.severity === 'error' && LOAD_BLOCKERS.has(d.rule));
  if (blocker) {
    result.loadError = `Jint can't parse this handler: ${blocker.message}`;
    return result;
  }

  const loadLog: string[] = [];
  const gameStore: Record<string, unknown> = {};
  const options: { key: string; values: unknown }[] = [];
  const game = clr('Game', 'Game', loadLog, result.ignored, gameStore, {
    AddOption: (name: string, desc: string, key: string, value: unknown) => {
      options.push({ key, values: value });
    },
    Folder: 'C:\\Nucleus\\handlers\\MyHandler',
  });
  const hub = gameStore.Hub;
  const scope: Record<string, unknown> = {
    Game: game,
    Hub: hub,
    Nucleus: nucleusNs(),
    System: systemNs(loadLog),
    importNamespace: () => systemNs(loadLog, 'ns'),
  };
  const { code, declared } = withoutModernBuiltins(src);
  const missing = [...MISSING_GLOBALS].filter((g) => !declared.has(g));
  const scopeProxy = new Proxy(scope, {
    // Context, Player, ... are only in scope while a callback runs; outside, the lookup falls
    // through to the (absent) global, so reads throw and `typeof` gives "undefined", as in Jint.
    has: (_t, p) => typeof p === 'string' && (p in scope || missing.includes(p)),
    get(_t, p) {
      if (typeof p !== 'string') return undefined;
      if (p in scope) return scope[p];
      if (missing.includes(p)) throw new ReferenceError(`${p} is not defined`);
      return undefined;
    },
    set(_t, p, v) {
      scope[p as string] = v;
      return true;
    },
  });

  try {
    // eslint-disable-next-line no-new-func
    new Function('__scope', `with (__scope) {\n${code}\n}`)(scopeProxy);
    result.loaded = true;
  } catch (e: any) {
    result.loadError = engineError(e);
    return result;
  }

  // What the handler configured (values that differ from Nucleus' defaults).
  const snapshot = (label: string, type: string, store: Record<string, unknown>) => {
    for (const [k, m] of Object.entries(api.objects[type].members)) {
      if (m.kind === 'method' || m.kind === 'object' || m.internal) continue;
      const v = store[k];
      if (v === undefined || v === null || v === parseDefault(m)) continue;
      if (Array.isArray(v) && !v.length) continue;
      result.options.push({ path: `${label}.${k}`, value: fmt(v) });
    }
  };
  snapshot('Game', 'Game', gameStore);

  const play = gameStore.Play;
  result.hasPlay = typeof play === 'function';
  const cols = opt.players <= 2 ? opt.players : 2;
  const rows = Math.ceil(opt.players / cols);
  const playerObjs = Array.from({ length: opt.players }, (_, i) => {
    const log: string[] = [];
    const w = Math.floor(opt.width / cols);
    const h = Math.floor(opt.height / rows);
    const bounds = rect((i % cols) * w, Math.floor(i / cols) * h, w, h);
    return clr('PlayerInfo', `PlayerList[${i}]`, log, result.ignored, {
      PlayerID: i,
      Nickname: `Player${i + 1}`,
      ProtoInputInstanceHandle: 100 + i,
      IsKeyboardPlayer: i === opt.keyboardPlayer,
      IsRawKeyboard: i === opt.keyboardPlayer,
      IsRawMouse: i === opt.keyboardPlayer,
      IsXInput: i !== opt.keyboardPlayer,
      GamepadId: i,
      MonitorBounds: bounds,
      DefaultMonitorBounds: bounds,
      OwnerDisplay: rect(0, 0, opt.width, opt.height),
    }, { Owner: { IsFullscreen: () => false, IsDualHorizontal: () => opt.players === 2, IsDualVertical: () => false } });
  });
  const playerList: any = Object.assign([...playerObjs], { Count: opt.players });

  const protoLog: string[] = [];
  const protoValues: Record<string, unknown> = {};
  const protoInput = clr('ProtoInputRuntime', 'ProtoInput', protoLog, result.ignored, protoValues);

  if (result.hasPlay) {
    for (let i = 0; i < opt.players; i++) {
      const calls: string[] = [];
      const ctxStore: Record<string, unknown> = { __guid: gameStore.GUID ?? 'GUID', __player: i };
      // GenericGameInfo.CreateContext copies same-named fields from Game.
      for (const k of Object.keys(api.objects.Context.members)) if (k in gameStore && api.objects.Game.members[k]?.kind !== 'object') ctxStore[k] = gameStore[k];
      const w = Math.floor(opt.width / cols);
      const h = Math.floor(opt.height / rows);
      const nick = `Player${i + 1}`;
      Object.assign(ctxStore, {
        PlayerID: i,
        RootInstallFolder: 'D:\\Games\\TheGame',
        OrigRootFolder: 'D:\\Games\\TheGame',
        RootFolder: `C:\\Nucleus\\content\\${ctxStore.__guid}\\Instance${i}`,
        ExePath: `C:\\Nucleus\\content\\${ctxStore.__guid}\\Instance${i}\\${gameStore.ExecutableName ?? 'game.exe'}`,
        CustomUserGeneralValues: ((gameStore.CustomUserGeneralPrompts as string[]) ?? []).map(() => 'answer'),
        CustomUserPlayerValues: ((gameStore.CustomUserPlayerPrompts as string[]) ?? []).map(() => 'answer'),
        CustomUserInstanceValues: ((gameStore.CustomUserInstancePrompts as string[]) ?? []).map(() => 'answer'),
      });
      const options: Record<string, unknown> = {};
      for (const o of optionsList()) options[o.key] = Array.isArray(o.values) ? o.values[0] : o.values;
      const computed: Record<string, unknown> = {
        Width: w, Height: h, PosX: (i % cols) * w, PosY: Math.floor(i / cols) * h,
        MonitorWidth: opt.width, MonitorHeight: opt.height, NumberOfPlayers: opt.players,
        Nickname: nick, IsKeyboardPlayer: i === opt.keyboardPlayer, HasKeyboardPlayer: opt.keyboardPlayer >= 0,
        GamepadId: i + 1, AspectRatioDecimal: w / h, AspectRatio: `${w}:${h}`, OrigAspectRatioDecimal: opt.width / opt.height,
        OrigAspectRatio: '16:9', Arch: 'x64', Options: options, PlayerSteamID: String(76561199000000000n + BigInt(i)),
        HandlerGUID: ctxStore.__guid, NucleusFolder: 'C:\\Nucleus', ScriptFolder: 'C:\\Nucleus\\handlers\\MyHandler',
        DocumentsPlayer: `C:\\Users\\me\\Documents\\NucleusCoop\\${nick}\\Documents\\`, DocumentsRoot: 'C:\\Users\\me\\Documents\\NucleusCoop\\',
        EnvironmentPlayer: `C:\\Users\\me\\NucleusCoop\\${nick}\\`, EnvironmentRoot: 'C:\\Users\\me\\NucleusCoop\\',
        NucleusUserRoot: `C:\\Users\\me\\NucleusCoop\\${nick}`, UserName: 'me', LocalIP: '192.168.1.10',
        EpicLang: 'en', GogLang: 'english', SteamLang: 'english',
      };
      const ctx = clr('Context', 'Context', calls, result.ignored, ctxStore, computed);
      scope.Context = ctx;
      scope.Player = playerObjs[i];
      scope.PlayerList = playerList;
      scope.Handler = {};
      scope.ProtoInput = protoInput;
      const where = (() => {
        const col = i % cols;
        const row = Math.floor(i / cols);
        if (opt.players === 1) return 'the whole screen';
        if (rows === 1) return cols === 2 ? (col === 0 ? 'the left half of the screen' : 'the right half of the screen') : `column ${col + 1}`;
        return `the ${row === 0 ? 'top' : 'bottom'}-${col === 0 ? 'left' : 'right'} quarter of the screen`;
      })();
      const run: PlayerRun = { index: i, startArguments: '', calls, effects: [], window: `${where}, ${w} × ${h}` };
      effects = run.effects;
      try {
        (play as () => void)();
      } catch (e: any) {
        run.error = engineError(e);
      } finally {
        effects = null;
      }
      run.startArguments = String(ctxStore.StartArguments ?? '');
      run.calls.push(...loadLog.splice(0));
      result.players.push(run);
    }
  }

  const gp = gameStore.ProtoInput as any;
  for (const name of ['OnInputLocked', 'OnInputUnlocked']) {
    const cb = gp?.[name];
    if (typeof cb !== 'function') continue;
    scope.PlayerList = playerList;
    scope.ProtoInput = protoInput;
    protoLog.length = 0;
    const entry: { name: string; calls: string[]; error?: string } = { name: `Game.ProtoInput.${name}`, calls: [] };
    try {
      cb();
    } catch (e: any) {
      entry.error = engineError(e);
    }
    entry.calls = [...protoLog];
    result.callbacks.push(entry);
  }
  return result;

  function optionsList() {
    return options;
  }
}
