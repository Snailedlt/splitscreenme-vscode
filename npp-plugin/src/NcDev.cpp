// "Nucleus Co-op handlers" for Notepad++ (splitscreenme-vscode#19, step 2): problems underlined in the code, docs on
// hover, suggestions that know where you are, parameter hints, quick fixes, Fix all, Format, Try it and a Problems
// panel. All the logic is in the standalone tool (`ncdev lsp`, the same Language Server other editors use); this
// plugin only shows it, so it rarely needs to change. Built with MinGW (npp-plugin/build.sh).
#ifndef UNICODE
#define UNICODE
#endif
#ifndef _UNICODE
#define _UNICODE
#endif
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <commctrl.h>
#include <uxtheme.h>
#include <shlobj.h>
#include <shellapi.h>
#include <shobjidl.h>
#include <urlmon.h>
#include <bcrypt.h>

#include <algorithm>
#include <atomic>
#include <memory>
#include <deque>
#include <functional>
#include <map>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

#include "../include/Scintilla.h"
#include "json.h"

using json::Value;
using json::Object;
using json::Array;

// ---------------------------------------------------------------------------------------------------------------
// Notepad++'s plugin interface (the message numbers and structs of its documented plugin API)

#define NPPMSG (WM_USER + 1000)
#define NPPM_GETCURRENTSCINTILLA (NPPMSG + 4)
#define NPPM_SETSTATUSBAR (NPPMSG + 24)
#define NPPM_GETMENUHANDLE (NPPMSG + 25)
#define NPPM_DMMSHOW (NPPMSG + 30)
#define NPPM_DMMHIDE (NPPMSG + 31)
#define NPPM_DMMUPDATEDISPINFO (NPPMSG + 32)
#define NPPM_DMMREGASDCKDLG (NPPMSG + 33)
#define DWS_ADDINFO 0x00000004
#define NPPM_SAVECURRENTFILE (NPPMSG + 38)
#define NPPM_SETMENUITEMCHECK (NPPMSG + 40)
#define NPPM_GETPLUGINSCONFIGDIR (NPPMSG + 46)
#define NPPM_MENUCOMMAND (NPPMSG + 48)
#define NPPM_GETFULLPATHFROMBUFFERID (NPPMSG + 58)
#define NPPM_GETCURRENTBUFFERID (NPPMSG + 60)
#define NPPM_DOOPEN (NPPMSG + 77)
#define NPPM_GETPLUGINHOMEPATH (NPPMSG + 97)
#define NPPM_ISDARKMODEENABLED (NPPMSG + 107)
#define NPPM_GETDARKMODECOLORS (NPPMSG + 108)
#define NPPM_ALLOCATEINDICATOR (NPPMSG + 113)
#define NPPPLUGINMENU 0
#define STATUSBAR_DOC_TYPE 0
#define IDM_FILE_NEW 41001

#define NPPN_FIRST 1000
#define NPPN_READY (NPPN_FIRST + 1)
#define NPPN_FILEBEFORECLOSE (NPPN_FIRST + 3)
#define NPPN_FILESAVED (NPPN_FIRST + 8)
#define NPPN_SHUTDOWN (NPPN_FIRST + 9)
#define NPPN_BUFFERACTIVATED (NPPN_FIRST + 10)
#define NPPN_FILERENAMED (NPPN_FIRST + 23)
#define NPPN_DARKMODECHANGED (NPPN_FIRST + 27)

#define CONT_BOTTOM 3
#define DWS_DF_CONT_BOTTOM (CONT_BOTTOM << 28)
#define CONT_RIGHT 1
#define DWS_DF_CONT_RIGHT (CONT_RIGHT << 28)
#define DMN_CLOSE (1050 + 1)

struct NppData {
  HWND _nppHandle;
  HWND _scintillaMainHandle;
  HWND _scintillaSecondHandle;
};
struct ShortcutKey {
  bool _isCtrl, _isAlt, _isShift;
  UCHAR _key;
};
typedef void(__cdecl* PFUNCPLUGINCMD)();
struct FuncItem {
  wchar_t _itemName[64];
  PFUNCPLUGINCMD _pFunc;
  int _cmdID;
  bool _init2Check;
  ShortcutKey* _pShKey;
};
struct DockedWidgetData {
  HWND hClient;
  const wchar_t* pszName;
  int dlgID;
  UINT uMask;
  HICON hIconTab;
  const wchar_t* pszAddInfo;
  RECT rcFloat;
  int iPrevCont;
  const wchar_t* pszModuleName;
};
struct DarkColors {
  COLORREF background, softerBackground, hotBackground, pureBackground, errorBackground, text, darkerText, disabledText, linkText, edge, hotEdge, disabledEdge;
};

static const wchar_t* PLUGIN_NAME = L"Nucleus Co-op handlers";
static const char* PLUGIN_VERSION = "1.0.0";

static NppData npp;
static HINSTANCE hModule;

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

static std::string utf8(const std::wstring& w) {
  if (w.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string s(n, '\0');
  WideCharToMultiByte(CP_UTF8, 0, w.data(), (int)w.size(), &s[0], n, nullptr, nullptr);
  return s;
}
static std::wstring wide(const std::string& s, UINT cp = CP_UTF8) {
  if (s.empty()) return {};
  int n = MultiByteToWideChar(cp, 0, s.data(), (int)s.size(), nullptr, 0);
  std::wstring w(n, L'\0');
  MultiByteToWideChar(cp, 0, s.data(), (int)s.size(), &w[0], n);
  return w;
}

static void logLine(const std::string& s) {
  static std::wstring file = [] {
    wchar_t buf[MAX_PATH] = L"";
    return GetEnvironmentVariableW(L"NCDEV_PLUGIN_LOG", buf, MAX_PATH) ? std::wstring(buf) : std::wstring();
  }();
  if (file.empty()) return;
  HANDLE h = CreateFileW(file.c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, nullptr, OPEN_ALWAYS, 0, nullptr);
  if (h == INVALID_HANDLE_VALUE) return;
  std::string line = s.substr(0, 2000) + "\n";
  DWORD w;
  WriteFile(h, line.data(), (DWORD)line.size(), &w, nullptr);
  CloseHandle(h);
}

static HWND curSci() {
  int which = -1;
  SendMessage(npp._nppHandle, NPPM_GETCURRENTSCINTILLA, 0, (LPARAM)&which);
  return which == 1 ? npp._scintillaSecondHandle : npp._scintillaMainHandle;
}
static sptr_t sci(HWND h, UINT m, uptr_t w = 0, sptr_t l = 0) { return SendMessage(h, m, w, l); }

static std::wstring pathOfBuffer(UINT_PTR buffer) {
  wchar_t buf[MAX_PATH * 2] = L"";
  SendMessage(npp._nppHandle, NPPM_GETFULLPATHFROMBUFFERID, buffer, (LPARAM)buf);
  return buf;
}
static UINT_PTR curBuffer() { return (UINT_PTR)SendMessage(npp._nppHandle, NPPM_GETCURRENTBUFFERID, 0, 0); }

static bool isJs(const std::wstring& p) {
  if (p.size() < 4) return false;
  std::wstring e = p.substr(p.size() - 3);
  std::transform(e.begin(), e.end(), e.begin(), ::towlower);
  return e == L".js";
}
static std::wstring baseName(const std::wstring& p) {
  size_t i = p.find_last_of(L"\\/");
  return i == std::wstring::npos ? p : p.substr(i + 1);
}
static bool exists(const std::wstring& p) { return GetFileAttributesW(p.c_str()) != INVALID_FILE_ATTRIBUTES; }

/** file:///C:/Games/My%20Game.js */
static std::string uriOf(const std::wstring& path) {
  std::string p = utf8(path), out = "file:///";
  for (unsigned char c : p) {
    if (c == '\\') out += '/';
    else if (isalnum(c) || strchr("-._~/:!$&'()*+,;=@", c) || c >= 0x80) {
      if (c >= 0x80) {
        char b[4];
        snprintf(b, sizeof b, "%%%02X", c);
        out += b;
      } else out += (char)c;
    } else {
      char b[4];
      snprintf(b, sizeof b, "%%%02X", c);
      out += b;
    }
  }
  return out;
}

static std::wstring configDir() {
  wchar_t buf[MAX_PATH] = L"";
  SendMessage(npp._nppHandle, NPPM_GETPLUGINSCONFIGDIR, MAX_PATH, (LPARAM)buf);
  return buf;
}
static std::wstring iniFile() { return configDir() + L"\\NcDev.ini"; }
static std::wstring iniGet(const wchar_t* section, const std::wstring& key) {
  wchar_t buf[2048] = L"";
  GetPrivateProfileStringW(section, key.c_str(), L"", buf, 2048, iniFile().c_str());
  return buf;
}
static void iniSet(const wchar_t* section, const std::wstring& key, const wchar_t* value) {
  WritePrivateProfileStringW(section, key.c_str(), value, iniFile().c_str());
}

static void status(const std::wstring& text) { SendMessage(npp._nppHandle, NPPM_SETSTATUSBAR, STATUSBAR_DOC_TYPE, (LPARAM)text.c_str()); }

// ---------------------------------------------------------------------------------------------------------------
// Documents: the text in UTF-8, positions between Scintilla (bytes) and LSP (line, UTF-16 column)

static std::string docText(HWND h) {
  sptr_t len = sci(h, SCI_GETLENGTH);
  std::string s(len + 1, '\0');
  sci(h, SCI_GETTEXT, len + 1, (sptr_t)&s[0]);
  s.resize(len);
  int cp = (int)sci(h, SCI_GETCODEPAGE);
  if (cp != SC_CP_UTF8) s = utf8(wide(s, CP_ACP));
  return s;
}
/** Text from the server (UTF-8) in the document's own encoding: an ANSI document gets ANSI bytes, as docText()
 *  converts the other way. */
static std::string toDoc(HWND h, const std::string& text) {
  if ((int)sci(h, SCI_GETCODEPAGE) == SC_CP_UTF8) return text;
  std::wstring w = wide(text);
  if (w.empty()) return "";
  int n = WideCharToMultiByte(CP_ACP, 0, w.c_str(), (int)w.size(), nullptr, 0, nullptr, nullptr);
  std::string out(n, '\0');
  WideCharToMultiByte(CP_ACP, 0, w.c_str(), (int)w.size(), &out[0], n, nullptr, nullptr);
  return out;
}
static Value lspPos(HWND h, sptr_t pos) {
  sptr_t line = sci(h, SCI_LINEFROMPOSITION, pos);
  sptr_t start = sci(h, SCI_POSITIONFROMLINE, line);
  return Value(Object{{"line", Value((long long)line)}, {"character", Value((long long)sci(h, SCI_COUNTCODEUNITS, start, pos))}});
}
static sptr_t sciPos(HWND h, const Value& p) {
  sptr_t lines = sci(h, SCI_GETLINECOUNT);
  sptr_t line = p["line"].num();
  if (line >= lines) return sci(h, SCI_GETLENGTH);
  sptr_t start = sci(h, SCI_POSITIONFROMLINE, line);
  sptr_t end = sci(h, SCI_GETLINEENDPOSITION, line);
  sptr_t pos = sci(h, SCI_POSITIONRELATIVECODEUNITS, start, p["character"].num());
  return pos <= 0 && p["character"].num() > 0 ? end : std::min(pos, end);
}

struct Doc {
  std::wstring path;
  std::string uri;
  int version = 0;
  bool open = false;
  bool dirty = false;
  unsigned long long sent = 0;  // hash of the text the server has
};
static std::map<UINT_PTR, Doc> docs;
static unsigned long long textHash(HWND h);
static std::map<std::string, Value> diagnostics;  // uri -> the server's diagnostics

static Doc* currentDoc() {
  UINT_PTR b = curBuffer();
  auto it = docs.find(b);
  if (it != docs.end() && it->second.path == pathOfBuffer(b)) return &it->second;
  std::wstring p = pathOfBuffer(b);
  if (!isJs(p)) return nullptr;
  Doc d;
  d.path = p;
  d.uri = uriOf(p);
  docs[b] = d;
  return &docs[b];
}

// ---------------------------------------------------------------------------------------------------------------
// The tool: finding ncdev, downloading it when it's missing

static std::wstring localTool() {
  wchar_t buf[MAX_PATH] = L"";
  GetEnvironmentVariableW(L"LOCALAPPDATA", buf, MAX_PATH);
  return std::wstring(buf) + L"\\ncdev\\ncdev.exe";
}
/** The command line that starts the tool (without arguments), or empty. */
static std::wstring findTool() {
  std::wstring p = iniGet(L"ncdev", L"path");
  if (!p.empty() && exists(p)) return L"\"" + p + L"\"";
  if (exists(localTool())) return L"\"" + localTool() + L"\"";
  wchar_t home[MAX_PATH] = L"";
  SendMessage(npp._nppHandle, NPPM_GETPLUGINHOMEPATH, MAX_PATH, (LPARAM)home);
  std::wstring beside = std::wstring(home) + L"\\NcDev\\ncdev.exe";
  if (home[0] && exists(beside)) return L"\"" + beside + L"\"";
  wchar_t found[MAX_PATH];
  if (SearchPathW(nullptr, L"ncdev.exe", nullptr, MAX_PATH, found, nullptr)) return L"\"" + std::wstring(found) + L"\"";
  // Installed with npm (`npm i -g` makes ncdev.cmd): run it through cmd.
  if (SearchPathW(nullptr, L"ncdev.cmd", nullptr, MAX_PATH, found, nullptr)) return L"cmd.exe /d /s /c \"\"" + std::wstring(found) + L"\"";
  return L"";
}

/** The environment for ncdev: Notepad++'s own, plus NCDEV_CLIENT, so its Hub requests say they come from this
 *  plugin (a tool id, nothing about the person). Only ncdev's processes get it, not Notepad++'s other children. */
static std::vector<wchar_t> childEnv() {
  std::vector<wchar_t> env;
  wchar_t* block = GetEnvironmentStringsW();
  for (wchar_t* p = block; p && *p; p += wcslen(p) + 1)
    if (_wcsnicmp(p, L"NCDEV_CLIENT=", 13) != 0) env.insert(env.end(), p, p + wcslen(p) + 1);
  if (block) FreeEnvironmentStringsW(block);
  const wchar_t me[] = L"NCDEV_CLIENT=notepadpp-plugin";
  env.insert(env.end(), me, me + wcslen(me) + 1);
  env.push_back(0);
  return env;
}

struct ToolResult {
  std::string out;
  DWORD code = 1;
  bool started = false, timedOut = false, cancelled = false;
};

/** Runs the tool and collects what it prints (stdout and stderr), on the calling thread. Reads while it runs and
 *  stops it (TerminateProcess) after `timeoutMs` or when `cancel` is set; never waits for the pipe to close, which
 *  a program the tool starts (Nucleus Co-op, for Test) could keep open for ever. */
static ToolResult execTool(const std::wstring& args, DWORD timeoutMs, const std::atomic<bool>* cancel = nullptr) {
  ToolResult r;
  std::wstring tool = findTool();
  if (tool.empty()) return r;
  SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
  HANDLE rd, wr;
  if (!CreatePipe(&rd, &wr, &sa, 0)) return r;
  SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);
  HANDLE nulIn = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, nullptr);
  STARTUPINFOW si{sizeof si};
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdOutput = wr;
  si.hStdError = wr;
  si.hStdInput = nulIn;
  PROCESS_INFORMATION pi{};
  std::wstring cmd = tool + L" " + args + (tool.rfind(L"cmd.exe", 0) == 0 ? L"\"" : L"");
  std::vector<wchar_t> env = childEnv();
  BOOL ok = CreateProcessW(nullptr, &cmd[0], nullptr, nullptr, TRUE, CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, env.data(), nullptr, &si, &pi);
  CloseHandle(wr);
  if (nulIn != INVALID_HANDLE_VALUE) CloseHandle(nulIn);
  if (ok) {
    r.started = true;
    ULONGLONG deadline = GetTickCount64() + timeoutMs;
    char buf[4096];
    auto drain = [&] {
      DWORD avail = 0, n = 0;
      while (PeekNamedPipe(rd, nullptr, 0, nullptr, &avail, nullptr) && avail && ReadFile(rd, buf, std::min<DWORD>(avail, sizeof buf), &n, nullptr) && n) r.out.append(buf, n);
    };
    for (;;) {
      drain();
      if (WaitForSingleObject(pi.hProcess, 50) == WAIT_OBJECT_0) break;
      if (cancel && *cancel) {
        r.cancelled = true;
        break;
      }
      if (GetTickCount64() >= deadline) {
        r.timedOut = true;
        break;
      }
    }
    if (r.timedOut || r.cancelled) {
      TerminateProcess(pi.hProcess, 1);
      WaitForSingleObject(pi.hProcess, 2000);
    }
    drain();
    GetExitCodeProcess(pi.hProcess, &r.code);
    if (r.timedOut) r.code = WAIT_TIMEOUT;
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
  }
  CloseHandle(rd);
  return r;
}

/** Runs the tool and returns what it prints, on the calling thread: only for quick commands (rules, --version, a
 *  status check) or from a thread of our own. Anything slow goes through runToolAsync(). */
static std::string runTool(const std::wstring& args, DWORD* exitCode = nullptr, DWORD timeoutMs = 30000) {
  ToolResult r = execTool(args, timeoutMs);
  if (exitCode) *exitCode = r.code;
  return r.out;
}

static std::string sha256File(const std::wstring& file) {
  HANDLE f = CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
  if (f == INVALID_HANDLE_VALUE) return "";
  BCRYPT_ALG_HANDLE alg;
  BCRYPT_HASH_HANDLE hash;
  std::string hex;
  if (BCryptOpenAlgorithmProvider(&alg, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0) {
    if (BCryptCreateHash(alg, &hash, nullptr, 0, nullptr, 0, 0) == 0) {
      std::vector<unsigned char> buf(1 << 20);
      DWORD n;
      while (ReadFile(f, buf.data(), (DWORD)buf.size(), &n, nullptr) && n) BCryptHashData(hash, buf.data(), n, 0);
      unsigned char digest[32];
      BCryptFinishHash(hash, digest, 32, 0);
      for (unsigned char c : digest) {
        char b[3];
        snprintf(b, sizeof b, "%02x", c);
        hex += b;
      }
      BCryptDestroyHash(hash);
    }
    BCryptCloseAlgorithmProvider(alg, 0);
  }
  CloseHandle(f);
  return hex;
}
static std::string readFile(const std::wstring& file) {
  HANDLE f = CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr);
  if (f == INVALID_HANDLE_VALUE) return "";
  std::string s;
  char buf[65536];
  DWORD n;
  while (ReadFile(f, buf, sizeof buf, &n, nullptr) && n) s.append(buf, n);
  CloseHandle(f);
  return s;
}

#define WM_LSP (WM_APP + 1)
#define WM_LSP_DIED (WM_APP + 2)
#define WM_DOWNLOADED (WM_APP + 3)
#define WM_UPDATE_INFO (WM_APP + 4)
#define WM_TOOL_DONE (WM_APP + 5)
#define TOOL_TIMER 2
static HWND msgWnd;

// Slow tool commands (hub search and fetch, install, package, test, update) run on a thread of their own, so
// Notepad++ never freezes: the result comes back to its thread through msgWnd (WM_TOOL_DONE), the status bar says
// what is running (with the seconds), a command that is already running says so instead of starting twice, and a
// tool that doesn't finish in time is stopped.
struct ToolJob {
  std::wstring what, args;
  DWORD timeoutMs = 0;
  ULONGLONG startedAt = 0;
  std::function<void(const ToolResult&)> done;
  std::atomic<bool> cancel{false};
  ToolResult res;
};
static std::map<std::wstring, std::shared_ptr<ToolJob>> toolJobs;  // what -> the run, one at a time each
static std::atomic<int> toolThreads{0};

/** Runs `ncdev <args>` off Notepad++'s thread and calls `done` on it afterwards (not when cancelled). `what` names it
 *  in the status bar ("downloading Racer"). Another run of the same `what` is refused (false) unless `replace`, which
 *  stops the old one (a new search replaces the previous). */
static bool runToolAsync(const std::wstring& what, const std::wstring& args, DWORD timeoutMs, std::function<void(const ToolResult&)> done, bool replace = false) {
  auto it = toolJobs.find(what);
  if (it != toolJobs.end()) {
    if (!replace) {
      MessageBoxW(npp._nppHandle, (L"Already " + what + L": wait for it to finish (the status bar shows it).").c_str(), PLUGIN_NAME, MB_OK | MB_ICONINFORMATION);
      return false;
    }
    it->second->cancel = true;
    toolJobs.erase(it);
  }
  auto job = std::make_shared<ToolJob>();
  job->what = what;
  job->args = args;
  job->timeoutMs = timeoutMs;
  job->startedAt = GetTickCount64();
  job->done = std::move(done);
  toolJobs[what] = job;
  status(L"Nucleus: " + what + L"…");
  SetTimer(msgWnd, TOOL_TIMER, 1000, nullptr);
  toolThreads++;
  std::thread([job] {
    job->res = execTool(job->args, job->timeoutMs, &job->cancel);
    if (!PostMessage(msgWnd, WM_TOOL_DONE, 0, (LPARAM) new std::shared_ptr<ToolJob>(job))) {}
    toolThreads--;
  }).detach();
  return true;
}
/** A run's message when it timed out or didn't start. */
static std::wstring toolFailure(const ToolResult& r, const std::wstring& what) {
  if (!r.started) return L"Couldn't start ncdev.";
  if (r.timedOut) return L"ncdev took too long " + what + L" and was stopped. Is this PC online? Try again in a moment.";
  return L"";
}
static bool downloading = false, declined = false;

/** Downloads ncdev.exe from the newest GitHub release that has it, checked against the release's SHA256SUMS.txt. */
static void downloadTool() {
  if (downloading) return;
  downloading = true;
  status(L"Nucleus: downloading the handler tools (ncdev.exe)…");
  std::thread([] {
    std::wstring err;
    wchar_t tmp[MAX_PATH];
    GetTempPathW(MAX_PATH, tmp);
    std::wstring list = std::wstring(tmp) + L"ncdev-releases.json";
    std::wstring dest = localTool();
    CreateDirectoryW(dest.substr(0, dest.find_last_of(L'\\')).c_str(), nullptr);
    std::wstring part = dest + L".part";
    if (URLDownloadToFileW(nullptr, L"https://api.github.com/repos/Snailedlt/splitscreenme-vscode/releases?per_page=20", list.c_str(), 0, nullptr) != S_OK) err = L"Couldn't reach GitHub.";
    std::string exeUrl, sumsUrl;
    if (err.empty()) {
      Value releases;
      json::parse(readFile(list), releases);
      for (auto& r : releases.arr()) {
        if (r["draft"].boolean()) continue;
        std::string e, s;
        for (auto& a : r["assets"].arr()) {
          if (a["name"].str() == "ncdev.exe") e = a["browser_download_url"].str();
          if (a["name"].str() == "SHA256SUMS.txt") s = a["browser_download_url"].str();
        }
        if (!e.empty() && !s.empty()) {
          exeUrl = e;
          sumsUrl = s;
          break;
        }
      }
      if (exeUrl.empty()) err = L"No release has ncdev.exe yet.";
    }
    std::string want;
    if (err.empty()) {
      std::wstring sums = std::wstring(tmp) + L"ncdev-SHA256SUMS.txt";
      if (URLDownloadToFileW(nullptr, wide(sumsUrl).c_str(), sums.c_str(), 0, nullptr) == S_OK) {
        std::string t = readFile(sums);
        size_t i = t.find("  ncdev.exe");
        if (i != std::string::npos && i >= 64) want = t.substr(i - 64, 64);
      }
      if (want.empty()) err = L"Couldn't read the release's SHA256SUMS.txt.";
    }
    if (err.empty() && URLDownloadToFileW(nullptr, wide(exeUrl).c_str(), part.c_str(), 0, nullptr) != S_OK) err = L"The download failed.";
    if (err.empty() && sha256File(part) != want) err = L"The download doesn't match its SHA-256; it was not used.";
    if (err.empty() && !MoveFileExW(part.c_str(), dest.c_str(), MOVEFILE_REPLACE_EXISTING)) err = L"Couldn't save " + dest + L".";
    DeleteFileW(part.c_str());
    PostMessage(msgWnd, WM_DOWNLOADED, 0, (LPARAM) new std::wstring(err));
  }).detach();
}

// ---------------------------------------------------------------------------------------------------------------
// The Language Server: `ncdev lsp` over pipes, Content-Length framed JSON-RPC

namespace lsp {
static HANDLE proc, inWrite, outRead;
static std::mutex mx;
static std::deque<std::string> inbox;
static bool running = false, ready = false;
static int nextId = 1;
static std::map<int, std::function<void(const Value&)>> pending;
static std::vector<std::string> queued;  // sent once `initialize` has answered
static int restarts = 0;

static void write(const std::string& body) {
  if (!running) return;
  std::string msg = "Content-Length: " + std::to_string(body.size()) + "\r\n\r\n" + body;
  DWORD w;
  WriteFile(inWrite, msg.data(), (DWORD)msg.size(), &w, nullptr);
}
static void send(const Value& v, bool early = false) {
  std::string body = json::stringify(v);
  logLine("> " + body);
  if (!ready && !early) queued.push_back(body);
  else write(body);
}
static void notify(const std::string& method, const Value& params) { send(Value(Object{{"jsonrpc", "2.0"}, {"method", method}, {"params", params}})); }
static int request(const std::string& method, const Value& params, std::function<void(const Value&)> cb, bool early = false) {
  int id = nextId++;
  pending[id] = cb;
  send(Value(Object{{"jsonrpc", "2.0"}, {"id", id}, {"method", method}, {"params", params}}), early);
  return id;
}

static void reader() {
  std::string buf;
  char chunk[65536];
  DWORD n;
  while (ReadFile(outRead, chunk, sizeof chunk, &n, nullptr) && n) {
    buf.append(chunk, n);
    for (;;) {
      size_t sep = buf.find("\r\n\r\n");
      if (sep == std::string::npos) break;
      std::string head = buf.substr(0, sep);
      std::transform(head.begin(), head.end(), head.begin(), ::tolower);
      size_t cl = head.find("content-length:");
      if (cl == std::string::npos) {
        buf.erase(0, sep + 4);
        continue;
      }
      size_t len = strtoul(head.c_str() + cl + 15, nullptr, 10);
      if (buf.size() < sep + 4 + len) break;
      {
        std::lock_guard<std::mutex> g(mx);
        inbox.push_back(buf.substr(sep + 4, len));
      }
      buf.erase(0, sep + 4 + len);
      PostMessage(msgWnd, WM_LSP, 0, 0);
    }
  }
  PostMessage(msgWnd, WM_LSP_DIED, 0, 0);
}

/** A section of NcDev.ini as name -> value (gameFolders, rules). */
static Value iniSection(const wchar_t* section) {
  Object m;
  wchar_t buf[32768] = L"";
  DWORD n = GetPrivateProfileSectionW(section, buf, 32768, iniFile().c_str());
  for (wchar_t* p = buf; p < buf + n && *p; p += wcslen(p) + 1) {
    std::wstring kv = p;
    size_t eq = kv.find(L'=');
    if (eq != std::wstring::npos) m[utf8(kv.substr(0, eq))] = Value(utf8(kv.substr(eq + 1)));
  }
  return Value(m);
}
static Value gameFolders() {
  Object m;
  wchar_t buf[32768] = L"";
  DWORD n = GetPrivateProfileSectionW(L"gameFolders", buf, 32768, iniFile().c_str());
  for (wchar_t* p = buf; p < buf + n && *p; p += wcslen(p) + 1) {
    std::wstring kv = p;
    size_t eq = kv.find(L'=');
    if (eq != std::wstring::npos) m[utf8(kv.substr(0, eq))] = Value(utf8(kv.substr(eq + 1)));
  }
  return Value(m);
}
/** What the server is told: the linked game folders, rule severities and the format style (Settings…, NcDev.ini). */
static Value settings() {
  std::wstring quotes = iniGet(L"format", L"quotes"), semis = iniGet(L"format", L"semicolons");
  Object format;
  if (!quotes.empty()) format["quotes"] = Value(utf8(quotes));
  if (!semis.empty()) format["semicolons"] = Value(utf8(semis));
  return Value(Object{{"nucleus", Value(Object{{"gameFolders", gameFolders()}, {"lint", Value(Object{{"workspace", false}, {"rules", iniSection(L"rules")}})}, {"format", Value(format)}})}});
}

void openCurrent();

static void start() {
  if (running) return;
  std::wstring tool = findTool();
  if (tool.empty()) {
    if (!declined && !downloading) {
      declined = true;  // asked once per session
      if (MessageBoxW(npp._nppHandle,
                      L"The Nucleus Co-op handler tools (ncdev.exe, about 95 MB) aren't on this PC yet. They check handlers, "
                      L"explain the API and run Try it, all offline.\n\nDownload them from GitHub now? (Saved in %LOCALAPPDATA%\\ncdev.)",
                      PLUGIN_NAME, MB_YESNO | MB_ICONQUESTION) == IDYES)
        downloadTool();
    }
    return;
  }
  SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
  HANDLE inRead, outWrite;
  CreatePipe(&inRead, &inWrite, &sa, 0);
  CreatePipe(&outRead, &outWrite, &sa, 0);
  SetHandleInformation(inWrite, HANDLE_FLAG_INHERIT, 0);
  SetHandleInformation(outRead, HANDLE_FLAG_INHERIT, 0);
  // The tool's own messages: nowhere, or next to the plugin log when NCDEV_PLUGIN_LOG is set.
  wchar_t logPath[MAX_PATH] = L"";
  HANDLE nul = GetEnvironmentVariableW(L"NCDEV_PLUGIN_LOG", logPath, MAX_PATH)
                   ? CreateFileW((std::wstring(logPath) + L".stderr").c_str(), FILE_APPEND_DATA, FILE_SHARE_READ | FILE_SHARE_WRITE, &sa, OPEN_ALWAYS, 0, nullptr)
                   : CreateFileW(L"NUL", GENERIC_WRITE, FILE_SHARE_WRITE, &sa, OPEN_EXISTING, 0, nullptr);
  STARTUPINFOW si{sizeof si};
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdInput = inRead;
  si.hStdOutput = outWrite;
  si.hStdError = nul;
  PROCESS_INFORMATION pi{};
  std::wstring cmd = tool + L" lsp" + (tool.rfind(L"cmd.exe", 0) == 0 ? L"\"" : L"");
  std::vector<wchar_t> env = childEnv();
  BOOL ok = CreateProcessW(nullptr, &cmd[0], nullptr, nullptr, TRUE, CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT, env.data(), nullptr, &si, &pi);
  CloseHandle(inRead);
  CloseHandle(outWrite);
  CloseHandle(nul);
  if (!ok) {
    CloseHandle(inWrite);
    CloseHandle(outRead);
    status(L"Nucleus: couldn't start " + tool);
    return;
  }
  proc = pi.hProcess;
  CloseHandle(pi.hThread);
  running = true;
  ready = false;
  std::thread(reader).detach();
  Value caps(Object{
      {"textDocument", Value(Object{{"completion", Value(Object{{"completionItem", Value(Object{{"snippetSupport", false}, {"documentationFormat", Value(Array{Value("plaintext"), Value("markdown")})}})}})},
                                    {"hover", Value(Object{{"contentFormat", Value(Array{Value("plaintext"), Value("markdown")})}})},
                                    {"publishDiagnostics", Value(Object{{"relatedInformation", false}})}})},
      {"workspace", Value(Object{{"applyEdit", true}})},
      {"general", Value(Object{{"positionEncodings", Value(Array{Value("utf-16")})}})}});
  request("initialize",
          Value(Object{{"processId", Value((long long)GetCurrentProcessId())},
                       {"clientInfo", Value(Object{{"name", "Notepad++"}, {"version", PLUGIN_VERSION}})},
                       {"rootUri", Value()},
                       {"capabilities", caps},
                       {"initializationOptions", settings()}}),
          [](const Value&) {
            ready = true;
            notify("initialized", Value(Object{}));
            for (auto& b : queued) write(b);
            queued.clear();
            openCurrent();
          },
          true);
}
static void stop() {
  if (!running) return;
  request("shutdown", Value(), [](const Value&) {});
  notify("exit", Value());
  WaitForSingleObject(proc, 1500);
  TerminateProcess(proc, 0);
  CloseHandle(proc);
  CloseHandle(inWrite);
  running = ready = false;
}
}  // namespace lsp

// ---------------------------------------------------------------------------------------------------------------
// Problems: squiggles in the code and the Problems panel

static int indError = 12, indWarning = 13, indInfo = 14;
static bool stylesSet = false;
static void setupIndicators() {
  int first = 0;
  if (SendMessage(npp._nppHandle, NPPM_ALLOCATEINDICATOR, 3, (LPARAM)&first) && first > 0) {
    indError = first;
    indWarning = first + 1;
    indInfo = first + 2;
  }
  for (HWND h : {npp._scintillaMainHandle, npp._scintillaSecondHandle}) {
    sci(h, SCI_INDICSETSTYLE, indError, INDIC_SQUIGGLEPIXMAP);
    sci(h, SCI_INDICSETFORE, indError, RGB(228, 50, 50));
    sci(h, SCI_INDICSETSTYLE, indWarning, INDIC_SQUIGGLEPIXMAP);
    sci(h, SCI_INDICSETFORE, indWarning, RGB(215, 150, 0));
    sci(h, SCI_INDICSETSTYLE, indInfo, INDIC_DOTS);
    sci(h, SCI_INDICSETFORE, indInfo, RGB(60, 140, 230));
    // Hover help needs dwell notifications; Notepad++ leaves them off.
    if (sci(h, SCI_GETMOUSEDWELLTIME) >= SC_TIME_FOREVER) sci(h, SCI_SETMOUSEDWELLTIME, 500);
  }
  stylesSet = true;
}

struct Range {
  sptr_t start, end;
};
static Range diagRange(HWND h, const Value& d) {
  sptr_t s = sciPos(h, d["range"]["start"]), e = sciPos(h, d["range"]["end"]);
  if (e <= s) {
    e = sci(h, SCI_WORDENDPOSITION, s, 1);
    if (e <= s) e = std::min(s + 1, (sptr_t)sci(h, SCI_GETLENGTH));
  }
  return {s, e};
}

static void refreshPanel();
static void refreshOutline();
static std::string plain(const std::string& md, size_t maxLines = 24);
static void applyDiagnostics() {
  Doc* d = currentDoc();
  HWND h = curSci();
  if (!stylesSet) setupIndicators();
  sptr_t len = sci(h, SCI_GETLENGTH);
  for (int ind : {indError, indWarning, indInfo}) {
    sci(h, SCI_SETINDICATORCURRENT, ind);
    sci(h, SCI_INDICATORCLEARRANGE, 0, len);
  }
  if (d) {
    for (auto& x : diagnostics[d->uri].arr()) {
      int sev = x["severity"].num(1);
      sci(h, SCI_SETINDICATORCURRENT, sev == 1 ? indError : sev == 2 ? indWarning : indInfo);
      Range r = diagRange(h, x);
      sci(h, SCI_INDICATORFILLRANGE, r.start, r.end - r.start);
    }
  }
  refreshPanel();
  refreshOutline();
}

// The Problems panel (dockable, bottom): every problem in the current handler; double-click or Enter jumps to it.
static HWND panel, list;
static bool panelShown = false, panelRegistered = false;
static int panelCmd = 0;
static std::vector<Value> panelItems;
static wchar_t panelInfo[128] = L"";
static void cmdQuickFix();

static void gotoProblem(int i) {
  if (i < 0 || i >= (int)panelItems.size()) return;
  HWND h = curSci();
  Range r = diagRange(h, panelItems[i]);
  sci(h, SCI_GOTOPOS, r.start);
  sci(h, SCI_SETSEL, r.start, r.end);
  SetFocus(h);
}
static void themeList(HWND list) {
  if (!list) return;
  DarkColors c{};
  const bool dark = SendMessage(npp._nppHandle, NPPM_ISDARKMODEENABLED, 0, 0) && SendMessage(npp._nppHandle, NPPM_GETDARKMODECOLORS, sizeof c, (LPARAM)&c);
  // The column header and the scroll bars are drawn by the Windows theme, not by the list's colours: Windows' own
  // dark themes for them (the ones Notepad++ uses for its lists), or the normal ones in light mode.
  SetWindowTheme(ListView_GetHeader(list), dark ? L"DarkMode_ItemsView" : nullptr, nullptr);
  SetWindowTheme(list, dark ? L"DarkMode_Explorer" : L"Explorer", nullptr);
  if (dark) {
    ListView_SetBkColor(list, c.background);
    ListView_SetTextBkColor(list, c.background);
    ListView_SetTextColor(list, c.text);
  } else {
    ListView_SetBkColor(list, GetSysColor(COLOR_WINDOW));
    ListView_SetTextBkColor(list, GetSysColor(COLOR_WINDOW));
    ListView_SetTextColor(list, GetSysColor(COLOR_WINDOWTEXT));
  }
  InvalidateRect(list, nullptr, TRUE);
}
static HWND outList;
static void themePanel() {
  themeList(list);
  themeList(outList);
}
static void refreshPanel() {
  if (!list || !panelShown) return;
  Doc* d = currentDoc();
  HWND h = curSci();
  panelItems = d ? diagnostics[d->uri].arr() : Array{};
  std::sort(panelItems.begin(), panelItems.end(), [](const Value& a, const Value& b) {
    int la = a["range"]["start"]["line"].num(), lb = b["range"]["start"]["line"].num();
    return la != lb ? la < lb : a["severity"].num(1) < b["severity"].num(1);
  });
  SendMessage(list, WM_SETREDRAW, FALSE, 0);
  ListView_DeleteAllItems(list);
  int i = 0;
  for (auto& x : panelItems) {
    int sev = x["severity"].num(1);
    std::wstring line = std::to_wstring(x["range"]["start"]["line"].num() + 1);
    std::wstring kind = sev == 1 ? L"Error" : sev == 2 ? L"Warning" : L"Info";
    std::wstring msg = wide(plain(x["message"].str(), 3));
    std::replace(msg.begin(), msg.end(), L'\n', L' ');
    LVITEMW it{};
    it.mask = LVIF_TEXT;
    it.iItem = i;
    it.pszText = &line[0];
    ListView_InsertItem(list, &it);
    ListView_SetItemText(list, i, 1, &kind[0]);
    ListView_SetItemText(list, i, 2, &msg[0]);
    i++;
  }
  if (!i) {
    std::wstring none = d ? L"" : L"";
    std::wstring text = d ? L"No problems in this handler." : L"Open a handler (.js) to see its problems.";
    LVITEMW it{};
    it.mask = LVIF_TEXT;
    it.iItem = 0;
    it.pszText = &none[0];
    ListView_InsertItem(list, &it);
    ListView_SetItemText(list, 0, 2, &text[0]);
  }
  SendMessage(list, WM_SETREDRAW, TRUE, 0);
  // "2 errors, 1 warning" next to the panel's name.
  int ne = 0, nw = 0, ni = 0;
  for (auto& x : panelItems) (x["severity"].num(1) == 1 ? ne : x["severity"].num(1) == 2 ? nw : ni)++;
  std::wstring info;
  auto add = [&](int n, const wchar_t* one, const wchar_t* many) {
    if (!n) return;
    if (!info.empty()) info += L", ";
    info += std::to_wstring(n) + L" " + (n == 1 ? one : many);
  };
  add(ne, L"error", L"errors");
  add(nw, L"warning", L"warnings");
  add(ni, L"note", L"notes");
  wcsncpy(panelInfo, info.c_str(), 127);
  SendMessage(npp._nppHandle, NPPM_DMMUPDATEDISPINFO, 0, (LPARAM)panel);
  (void)h;
}
static LRESULT CALLBACK panelProc(HWND hw, UINT m, WPARAM w, LPARAM l) {
  switch (m) {
    case WM_SIZE:
      if (list) {
        MoveWindow(list, 0, 0, LOWORD(l), HIWORD(l), TRUE);
        ListView_SetColumnWidth(list, 2, std::max(200, (int)LOWORD(l) - 140));
      }
      return 0;
    case WM_NOTIFY: {
      auto* nm = (NMHDR*)l;
      if (nm->code == DMN_CLOSE) {
        panelShown = false;
        SendMessage(npp._nppHandle, NPPM_SETMENUITEMCHECK, panelCmd, FALSE);
        return 0;
      }
      if (nm->hwndFrom == list && nm->code == NM_DBLCLK) gotoProblem(((NMITEMACTIVATE*)l)->iItem);
      // Right-click: jump there and offer its fixes.
      if (nm->hwndFrom == list && nm->code == NM_RCLICK && ((NMITEMACTIVATE*)l)->iItem >= 0 && ((NMITEMACTIVATE*)l)->iItem < (int)panelItems.size()) {
        gotoProblem(((NMITEMACTIVATE*)l)->iItem);
        cmdQuickFix();
      }
      if (nm->hwndFrom == list && nm->code == LVN_KEYDOWN && ((NMLVKEYDOWN*)l)->wVKey == VK_RETURN) gotoProblem(ListView_GetNextItem(list, -1, LVNI_SELECTED));
      return 0;
    }
  }
  return DefWindowProcW(hw, m, w, l);
}
static void createPanel() {
  WNDCLASSW wc{};
  wc.lpfnWndProc = panelProc;
  wc.hInstance = hModule;
  wc.lpszClassName = L"NcDevProblems";
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  RegisterClassW(&wc);
  panel = CreateWindowExW(0, L"NcDevProblems", L"Nucleus problems", WS_CHILD | WS_CLIPCHILDREN, 0, 0, 600, 200, npp._nppHandle, nullptr, hModule, nullptr);
  list = CreateWindowExW(0, WC_LISTVIEWW, L"", WS_CHILD | WS_VISIBLE | LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS, 0, 0, 600, 200, panel, nullptr, hModule, nullptr);
  ListView_SetExtendedListViewStyle(list, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER);
  const wchar_t* cols[] = {L"Line", L"Kind", L"Problem"};
  int widths[] = {60, 80, 600};
  for (int i = 0; i < 3; i++) {
    LVCOLUMNW c{};
    c.mask = LVCF_TEXT | LVCF_WIDTH;
    c.pszText = (LPWSTR)cols[i];
    c.cx = widths[i];
    ListView_InsertColumn(list, i, &c);
  }
  static DockedWidgetData data{};
  data.hClient = panel;
  data.pszName = L"Nucleus problems";
  data.dlgID = panelCmd;
  data.uMask = DWS_DF_CONT_BOTTOM | DWS_ADDINFO;
  data.pszAddInfo = panelInfo;
  data.pszModuleName = L"NcDev.dll";
  SendMessage(npp._nppHandle, NPPM_DMMREGASDCKDLG, 0, (LPARAM)&data);
  panelRegistered = true;
  themePanel();
}


// ---------------------------------------------------------------------------------------------------------------
// The outline panel: the handler's functions, options and variables (the server's document symbols), a click away

static HWND outPanel;
static bool outShown = false, outRegistered = false;
static int outCmd = 0, outRequest = 0;
static std::vector<Value> outRanges;  // the selectionRange of each row
static void refreshOutline();
static void outRow(int i, const std::wstring& name, const std::wstring& kind) {
  LVITEMW it{};
  it.mask = LVIF_TEXT;
  it.iItem = i;
  std::wstring n = name;
  it.pszText = &n[0];
  ListView_InsertItem(outList, &it);
  std::wstring k = kind;
  ListView_SetItemText(outList, i, 1, &k[0]);
}
static void outMessage(const std::wstring& text) {
  ListView_DeleteAllItems(outList);
  outRanges.clear();
  outRow(0, text, L"");
}
static void refreshOutline() {
  if (!outList || !outShown) return;
  Doc* d = currentDoc();
  if (!d) return outMessage(L"Open a handler (.js) to see its outline.");
  if (!lsp::ready || !d->open) return;  // comes again once the server has the handler
  int mine = ++outRequest;
  std::string uri = d->uri;
  lsp::request("textDocument/documentSymbol", Value(Object{{"textDocument", Value(Object{{"uri", uri}})}}), [mine, uri](const Value& r) {
    Doc* now = currentDoc();
    if (mine != outRequest || !now || now->uri != uri || !outList) return;  // a newer request, or another tab
    int top = ListView_GetTopIndex(outList);
    SendMessage(outList, WM_SETREDRAW, FALSE, 0);
    ListView_DeleteAllItems(outList);
    outRanges.clear();
    int i = 0;
    std::function<void(const Value&, int)> add = [&](const Value& syms, int depth) {
      for (auto& x : syms.arr()) {
        int k = x["kind"].num(0);
        std::wstring kind = k == 12 ? L"function" : k == 7 ? L"option" : k == 3 ? L"object" : L"variable";
        std::string detail = x["detail"].str();
        if (!detail.empty()) kind = wide(detail);
        outRow(i++, std::wstring(depth * 4, L' ') + wide(x["name"].str()), kind);
        outRanges.push_back(x["selectionRange"]);
        if (x["children"].size()) add(x["children"], depth + 1);
      }
    };
    if (r.isArr()) add(r, 0);
    if (!i) outRow(0, L"Nothing to show yet: no functions, options or variables.", L"");
    SendMessage(outList, WM_SETREDRAW, TRUE, 0);
    ListView_EnsureVisible(outList, std::min(top + ListView_GetCountPerPage(outList) - 1, i - 1), FALSE);
  });
}
static void gotoOutline(int i) {
  if (i < 0 || i >= (int)outRanges.size()) return;
  HWND h = curSci();
  sptr_t s = sciPos(h, outRanges[i]["start"]), e = sciPos(h, outRanges[i]["end"]);
  sci(h, SCI_GOTOPOS, s);
  sci(h, SCI_SETSEL, s, e);
  sci(h, SCI_SCROLLCARET);
  SetFocus(h);
}
static LRESULT CALLBACK outProc(HWND hw, UINT m, WPARAM w, LPARAM l) {
  switch (m) {
    case WM_SIZE:
      if (outList) {
        MoveWindow(outList, 0, 0, LOWORD(l), HIWORD(l), TRUE);
        int w = LOWORD(l) - GetSystemMetrics(SM_CXVSCROLL) - 4;
        ListView_SetColumnWidth(outList, 0, w * 3 / 5);
        ListView_SetColumnWidth(outList, 1, w - w * 3 / 5);
      }
      return 0;
    case WM_NOTIFY: {
      auto* nm = (NMHDR*)l;
      if (nm->code == DMN_CLOSE) {
        outShown = false;
        SendMessage(npp._nppHandle, NPPM_SETMENUITEMCHECK, outCmd, FALSE);
        return 0;
      }
      if (nm->hwndFrom == outList && (nm->code == NM_CLICK || nm->code == NM_DBLCLK)) gotoOutline(((NMITEMACTIVATE*)l)->iItem);
      if (nm->hwndFrom == outList && nm->code == LVN_KEYDOWN && ((NMLVKEYDOWN*)l)->wVKey == VK_RETURN) gotoOutline(ListView_GetNextItem(outList, -1, LVNI_SELECTED));
      return 0;
    }
  }
  return DefWindowProcW(hw, m, w, l);
}
static void createOutline() {
  WNDCLASSW wc{};
  wc.lpfnWndProc = outProc;
  wc.hInstance = hModule;
  wc.lpszClassName = L"NcDevOutline";
  wc.hCursor = LoadCursor(nullptr, IDC_ARROW);
  RegisterClassW(&wc);
  outPanel = CreateWindowExW(0, L"NcDevOutline", L"Nucleus outline", WS_CHILD | WS_CLIPCHILDREN, 0, 0, 300, 400, npp._nppHandle, nullptr, hModule, nullptr);
  outList = CreateWindowExW(0, WC_LISTVIEWW, L"", WS_CHILD | WS_VISIBLE | LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS, 0, 0, 300, 400, outPanel, nullptr, hModule, nullptr);
  ListView_SetExtendedListViewStyle(outList, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER);
  const wchar_t* cols[] = {L"Name", L"Value"};
  int widths[] = {170, 110};
  for (int i = 0; i < 2; i++) {
    LVCOLUMNW c{};
    c.mask = LVCF_TEXT | LVCF_WIDTH;
    c.pszText = (LPWSTR)cols[i];
    c.cx = widths[i];
    ListView_InsertColumn(outList, i, &c);
  }
  static DockedWidgetData data{};
  data.hClient = outPanel;
  data.pszName = L"Nucleus outline";
  data.dlgID = outCmd;
  data.uMask = DWS_DF_CONT_RIGHT;
  data.pszModuleName = L"NcDev.dll";
  SendMessage(npp._nppHandle, NPPM_DMMREGASDCKDLG, 0, (LPARAM)&data);
  outRegistered = true;
  themeList(outList);
}

// ---------------------------------------------------------------------------------------------------------------
// Syncing the open handler

void lsp::openCurrent() {
  Doc* d = currentDoc();
  if (!d || !lsp::ready) return;
  if (!d->open) {
    d->open = true;
    d->version = 1;
    d->dirty = false;
    d->sent = textHash(curSci());
    lsp::notify("textDocument/didOpen", Value(Object{{"textDocument", Value(Object{{"uri", d->uri}, {"languageId", "javascript"}, {"version", d->version}, {"text", docText(curSci())}})}}));
  }
  applyDiagnostics();
}
/** FNV-1a of the document's text: notices a change no SCN_MODIFIED told us about (a reload from disk). */
static unsigned long long textHash(HWND h) {
  const char* p = (const char*)sci(h, SCI_GETCHARACTERPOINTER);
  sptr_t n = sci(h, SCI_GETLENGTH);
  unsigned long long x = 1469598103934665603ULL;
  for (sptr_t i = 0; p && i < n; i++) x = (x ^ (unsigned char)p[i]) * 1099511628211ULL;
  return x;
}
static void flushChange() {
  Doc* d = currentDoc();
  if (!d || !d->open || !d->dirty) return;
  d->dirty = false;
  d->version++;
  d->sent = textHash(curSci());
  lsp::notify("textDocument/didChange", Value(Object{{"textDocument", Value(Object{{"uri", d->uri}, {"version", d->version}})}, {"contentChanges", Value(Array{Value(Object{{"text", docText(curSci())}})})}}));
}
static void closeBuffer(UINT_PTR b) {
  auto it = docs.find(b);
  if (it == docs.end()) return;
  if (it->second.open) lsp::notify("textDocument/didClose", Value(Object{{"textDocument", Value(Object{{"uri", it->second.uri}})}}));
  diagnostics.erase(it->second.uri);
  docs.erase(it);
}
/** The open handler, ready for a request: the server running and the latest text sent. */
static Doc* active() {
  Doc* d = currentDoc();
  if (!d) return nullptr;
  if (!lsp::running) lsp::start();
  if (!lsp::running) return nullptr;
  if (!d->open) lsp::openCurrent();
  flushChange();
  return d;
}
static Value docId(Doc* d) { return Value(Object{{"uri", d->uri}}); }

static void applyEdits(HWND h, const Value& edits) {
  std::vector<std::pair<Range, std::string>> list;
  for (auto& e : edits.arr()) list.push_back({{sciPos(h, e["range"]["start"]), sciPos(h, e["range"]["end"])}, toDoc(h, e["newText"].str())});
  std::sort(list.begin(), list.end(), [](auto& a, auto& b) { return a.first.start > b.first.start; });
  // The server writes new lines as \n; a CRLF (or CR) document gets its own line ending, never a mix.
  int eol = (int)sci(h, SCI_GETEOLMODE);
  if (eol != SC_EOL_LF)
    for (auto& [r, text] : list) {
      std::string t;
      for (size_t i = 0; i < text.size(); i++) {
        if (text[i] == '\r' && i + 1 < text.size() && text[i + 1] == '\n') continue;  // already \r\n: one ending
        t += text[i] == '\n' ? (eol == SC_EOL_CRLF ? "\r\n" : "\r") : std::string(1, text[i]);
      }
      text = t;
    }
  sci(h, SCI_BEGINUNDOACTION);
  for (auto& [r, text] : list) {
    sci(h, SCI_SETTARGETRANGE, r.start, r.end);
    sci(h, SCI_REPLACETARGET, text.size(), (sptr_t)text.c_str());
  }
  sci(h, SCI_ENDUNDOACTION);
}
/** A WorkspaceEdit: only the open handler's edits apply. */
static bool applyWorkspaceEdit(const Value& edit) {
  Doc* d = currentDoc();
  if (!d) return false;
  const Value& mine = edit["changes"][d->uri];
  if (mine.isArr()) {
    applyEdits(curSci(), mine);
    return true;
  }
  for (auto& dc : edit["documentChanges"].arr())
    if (dc["textDocument"]["uri"].str() == d->uri) {
      applyEdits(curSci(), dc["edits"]);
      return true;
    }
  return false;
}

// Markdown (hover docs) as plain text for a call tip.
static std::string plain(const std::string& md, size_t maxLines) {
  std::string out, line;
  std::vector<std::string> lines;
  size_t i = 0;
  while (i <= md.size()) {
    size_t j = md.find('\n', i);
    if (j == std::string::npos) j = md.size();
    lines.push_back(md.substr(i, j - i));
    i = j + 1;
  }
  int blank = 0;
  size_t n = 0;
  for (auto l : lines) {
    if (l.rfind("```", 0) == 0 || l == "---") continue;
    // A line that is only a link ("[Handler API docs](https://…)") means nothing in a call tip.
    if (l.size() > 2 && l[0] == '[' && l.back() == ')' && l.find("](") != std::string::npos && l.find("](") == l.find(']')) continue;
    std::string t;
    bool code = false;
    auto word = [&](size_t at) { return at < l.size() && (isalnum((unsigned char)l[at]) || l[at] == '_'); };
    for (size_t k = 0; k < l.size(); k++) {
      if (l[k] == '`') {
        code = !code;
        continue;
      }
      if (!code && l[k] == '*' && k + 1 < l.size() && l[k + 1] == '*') {
        k++;
        continue;
      }
      // _italic_: an underscore that opens or closes a phrase, never one inside a name (snake_case, __guid, code).
      if (!code && l[k] == '_' && !(k > 0 && word(k - 1) && word(k + 1)) && !(k > 0 && l[k - 1] == '_') && !(k + 1 < l.size() && l[k + 1] == '_')) continue;
      if (l[k] == '[') {  // [text](url) -> text
        size_t close = l.find("](", k);
        size_t end = close == std::string::npos ? close : l.find(')', close);
        if (end != std::string::npos) {
          // A feedback link ("Is it wrong? Tell us", a GitHub issue form) needs a click: a call tip can't.
          if (l.substr(close + 2, end - close - 2).find("/issues/new") != std::string::npos) {
            while (!t.empty() && t.back() == ' ') t.pop_back();
            k = end;
            continue;
          }
          t += l.substr(k + 1, close - k - 1);
          k = end;
          continue;
        }
      }
      if (l[k] == '\\' && k + 1 < l.size()) continue;
      t += l[k];
    }
    while (!t.empty() && t[0] == '#') t.erase(0, 1);
    // The ⓘ and ✎ marks: not in every editor font (a box in Notepad++'s default call-tip font).
    for (const char* mark : {"\xE2\x93\x98", "\xE2\x9C\x8E"})
      for (size_t k; (k = t.find(mark)) != std::string::npos;) t.erase(k, 3 + (k + 3 < t.size() && t[k + 3] == ' '));
    while (!t.empty() && t[0] == ' ' && t.find_first_not_of(' ') != std::string::npos && out.empty()) t.erase(0, 1);
    if (t.empty() || t.find_first_not_of(" ") == std::string::npos) {
      if (++blank > 1 || out.empty()) continue;
    } else blank = 0;
    // Wrap long lines (call tips don't wrap).
    while (t.size() > 110) {
      size_t cut = t.rfind(' ', 110);
      if (cut == std::string::npos || cut < 40) cut = 110;
      out += t.substr(0, cut) + "\n";
      t = t.substr(cut + (t[cut] == ' ' ? 1 : 0));
      if (++n >= maxLines) break;
    }
    out += t + "\n";
    if (++n >= maxLines) {
      out += "…\n";
      break;
    }
  }
  while (!out.empty() && (out.back() == '\n' || out.back() == ' ')) out.pop_back();
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Hover, completion, signature help

static enum { TIP_NONE, TIP_HOVER, TIP_SIGNATURE } tip = TIP_NONE;
static void showTip(HWND h, sptr_t pos, const std::string& text, int kind, bool above = false) {
  sci(h, SCI_CALLTIPSETPOSITION, above);
  sci(h, SCI_CALLTIPSHOW, pos, (sptr_t)text.c_str());
  tip = (decltype(tip))kind;
}

static void hoverAt(HWND h, sptr_t pos, bool fromMouse) {
  Doc* d = active();
  if (!d) return;
  std::string problems;
  for (auto& x : diagnostics[d->uri].arr()) {
    Range r = diagRange(h, x);
    if (pos >= r.start && pos <= r.end) {
      int sev = x["severity"].num(1);
      problems += std::string(sev == 1 ? "Error: " : sev == 2 ? "Warning: " : "Note: ") + plain(x["message"].str(), 8) + "\n";
    }
  }
  std::string uri = d->uri;
  lsp::request("textDocument/hover", Value(Object{{"textDocument", docId(d)}, {"position", lspPos(h, pos)}}), [=](const Value& r) {
    if (fromMouse && tip == TIP_NONE && !problems.empty() && r.isNull()) {
    }
    std::string text = problems;
    const Value& c = r["contents"];
    std::string md = c.isStr() ? c.str() : c["value"].str();
    if (!md.empty()) text += (text.empty() ? "" : "\n") + plain(md);
    while (!text.empty() && text.back() == '\n') text.pop_back();
    if (text.empty()) {
      if (!fromMouse) status(L"Nucleus: no docs here");
      return;
    }
    Doc* now = currentDoc();
    if (!now || now->uri != uri) return;
    showTip(h, pos, text, TIP_HOVER);
  });
}

struct Item {
  std::string label, text, detail, doc;
  bool hasEdit = false;
  Value editStart;
};
static std::vector<Item> items;
static int completionSeq = 0;  // the newest completion request; older answers are dropped
static bool ourList = false;
static bool isWord(int c) { return isalnum(c) || c == '_' || c == '$' || c >= 0x80; }
static sptr_t wordStart(HWND h, sptr_t pos) {
  while (pos > 0 && isWord((unsigned char)sci(h, SCI_GETCHARAT, pos - 1))) pos--;
  return pos;
}

static void complete(HWND h, bool explicitly) {
  Doc* d = active();
  if (!d) return;
  sptr_t pos = sci(h, SCI_GETCURRENTPOS);
  int seq = ++completionSeq;
  lsp::request("textDocument/completion", Value(Object{{"textDocument", docId(d)}, {"position", lspPos(h, pos)}, {"context", Value(Object{{"triggerKind", explicitly ? 1 : 2}})}}), [=](const Value& r) {
    if (seq != completionSeq) return;  // typed on: a newer request is on its way, and its answer is the one to show
    const Value& arr = r.isArr() ? r : r["items"];
    sptr_t caret = sci(h, SCI_GETCURRENTPOS);
    if (caret < pos || sci(h, SCI_LINEFROMPOSITION, caret) != sci(h, SCI_LINEFROMPOSITION, pos)) return;
    if (!arr.size()) {
      if (explicitly) status(L"Nucleus: no suggestions here");
      return;
    }
    std::vector<std::pair<std::string, Item>> sorted;
    for (auto& x : arr.arr()) {
      Item it;
      it.label = x["label"].str();
      it.detail = x["detail"].str();
      const Value& doc = x["documentation"];
      it.doc = doc.isStr() ? doc.str() : doc["value"].str();
      if (x["textEdit"].isObj()) {
        it.hasEdit = true;
        it.editStart = x["textEdit"]["range"]["start"];
        it.text = x["textEdit"]["newText"].str();
      } else it.text = x["insertText"].isStr() ? x["insertText"].str() : it.label;
      if (it.label.empty()) continue;
      sorted.push_back({x["sortText"].str(it.label), it});
    }
    std::stable_sort(sorted.begin(), sorted.end(), [](auto& a, auto& b) { return a.first < b.first; });
    // Only what starts with the typed word (as VS Code narrows its list), when anything does.
    sptr_t ws0 = wordStart(h, caret);
    std::string typed;
    for (sptr_t p = ws0; p < caret; p++) typed += (char)tolower((int)sci(h, SCI_GETCHARAT, p));
    if (!typed.empty()) {
      auto starts = [&](const std::string& l) {
        if (l.size() < typed.size()) return false;
        for (size_t k = 0; k < typed.size(); k++)
          if (tolower((unsigned char)l[k]) != (unsigned char)typed[k]) return false;
        return true;
      };
      if (std::any_of(sorted.begin(), sorted.end(), [&](auto& p) { return starts(p.second.label); }))
        sorted.erase(std::remove_if(sorted.begin(), sorted.end(), [&](auto& p) { return !starts(p.second.label); }), sorted.end());
    }
    items.clear();
    std::string listText;
    for (auto& p : sorted) {
      if (std::any_of(items.begin(), items.end(), [&](const Item& i) { return i.label == p.second.label; })) continue;
      if (!listText.empty()) listText += '\n';
      listText += p.second.label;
      items.push_back(p.second);
    }
    sptr_t ws = wordStart(h, caret);
    sci(h, SCI_AUTOCSETSEPARATOR, '\n');
    sci(h, SCI_AUTOCSETTYPESEPARATOR, 0x1E);
    sci(h, SCI_AUTOCSETORDER, SC_ORDER_CUSTOM);
    sci(h, SCI_AUTOCSETIGNORECASE, 1);
    sci(h, SCI_AUTOCSETAUTOHIDE, 1);
    sci(h, SCI_AUTOCSETCHOOSESINGLE, 0);
    sci(h, SCI_AUTOCSETMAXHEIGHT, 12);
    sci(h, SCI_AUTOCSHOW, caret - ws, (sptr_t)listText.c_str());
    ourList = true;
  });
}

static void signatureHelp(HWND h);
static void onSelected(HWND h, const char* label) {
  auto it = std::find_if(items.begin(), items.end(), [&](const Item& i) { return i.label == label; });
  if (!ourList || it == items.end()) return;
  Item item = *it;
  sci(h, SCI_AUTOCCANCEL);  // insert it ourselves: the replaced range and the text can differ from the label
  ourList = false;
  sptr_t caret = sci(h, SCI_GETCURRENTPOS);
  sptr_t start = item.hasEdit ? std::min(sciPos(h, item.editStart), caret) : wordStart(h, caret);
  sptr_t end = caret;
  while (end < sci(h, SCI_GETLENGTH) && isWord((unsigned char)sci(h, SCI_GETCHARAT, end)) && !item.hasEdit) end++;
  // A snippet over several lines: each later line gets this line's indentation, and its tabs Notepad++'s indent.
  if (item.text.find('\n') != std::string::npos) {
    sptr_t line = sci(h, SCI_LINEFROMPOSITION, start);
    std::string indent;
    for (sptr_t p = sci(h, SCI_POSITIONFROMLINE, line); p < start; p++) {
      int c = (int)sci(h, SCI_GETCHARAT, p);
      if (c != ' ' && c != '\t') break;
      indent += (char)c;
    }
    std::string tab = sci(h, SCI_GETUSETABS) ? "\t" : std::string((size_t)std::max<sptr_t>(1, sci(h, SCI_GETINDENT)), ' ');
    std::string eol = sci(h, SCI_GETEOLMODE) == SC_EOL_CRLF ? "\r\n" : "\n";
    std::string out;
    for (char c : item.text) {
      if (c == '\n') out += eol + indent;
      else if (c == '\t') out += tab;
      else out += c;
    }
    item.text = out;
  }
  item.text = toDoc(h, item.text);
  sci(h, SCI_SETTARGETRANGE, start, end);
  sci(h, SCI_REPLACETARGET, item.text.size(), (sptr_t)item.text.c_str());
  // A function: the cursor between its parentheses, with its parameters shown.
  bool call = item.text.size() > 2 && item.text.compare(item.text.size() - 2, 2, "()") == 0;
  sci(h, SCI_GOTOPOS, start + item.text.size() - (call ? 1 : 0));
  if (call) signatureHelp(h);
}
/** The highlighted suggestion's type and first line of docs, in the status bar (a call tip would close the list). */
static void onItemHighlighted(HWND, const char* label) {
  auto it = std::find_if(items.begin(), items.end(), [&](const Item& i) { return i.label == label; });
  if (!ourList || it == items.end()) return;
  // The first line of the docs that says something new (the docs start with the signature, already in detail).
  std::string all = plain(it->doc, 6), doc;
  for (size_t i = 0; i <= all.size();) {
    size_t j = all.find('\n', i);
    if (j == std::string::npos) j = all.size();
    std::string line = all.substr(i, j - i);
    while (!line.empty() && line[0] == ' ') line.erase(0, 1);
    if (!line.empty() && line != it->detail && line != it->label) {
      doc = line;
      break;
    }
    i = j + 1;
  }
  std::string text = it->detail.empty() ? doc : doc.empty() ? it->detail : it->detail + "  —  " + doc;
  if (!text.empty()) status(wide(text));
}

static void signatureHelp(HWND h) {
  Doc* d = active();
  if (!d) return;
  sptr_t pos = sci(h, SCI_GETCURRENTPOS);
  lsp::request("textDocument/signatureHelp", Value(Object{{"textDocument", docId(d)}, {"position", lspPos(h, pos)}}), [=](const Value& r) {
    const Value& sig = r["signatures"][(size_t)r["activeSignature"].num()];
    if (!sig.isObj()) {
      if (tip == TIP_SIGNATURE) sci(h, SCI_CALLTIPCANCEL), tip = TIP_NONE;
      return;
    }
    std::string label = sig["label"].str();
    std::string text = label;
    int ap = r["activeParameter"].num(sig["activeParameter"].num(0));
    const Value& p = sig["parameters"][(size_t)ap];
    // The parameter being typed first (what to pass), then the method's own docs.
    const Value& pd = p["documentation"];
    std::string pds = plain(pd.isStr() ? pd.str() : pd["value"].str(), 3);
    if (!pds.empty() && p["label"].isStr()) {
      // Wrapped at about 100 characters: a call tip doesn't wrap by itself.
      std::string line = p["label"].str() + ": ", word;
      std::string wrapped;
      for (size_t i = 0; i <= pds.size(); i++) {
        if (i == pds.size() || pds[i] == ' ' || pds[i] == '\n') {
          if (line.size() + word.size() > 100 && line.size() > 2) wrapped += line + "\n", line = "  ";
          line += word + (i < pds.size() ? " " : "");
          word.clear();
        } else word += pds[i];
      }
      text += "\n" + wrapped + line;
    }
    const Value& doc = sig["documentation"];
    std::string ds = plain(doc.isStr() ? doc.str() : doc["value"].str(), pds.empty() ? 4 : 2);
    if (!ds.empty()) text += "\n" + ds;
    sptr_t caret = sci(h, SCI_GETCURRENTPOS);
    showTip(h, caret, text, TIP_SIGNATURE);
    if (p["label"].isStr()) {
      size_t at = label.find(p["label"].str(), label.find('('));
      if (at != std::string::npos) sci(h, SCI_CALLTIPSETHLT, at, at + p["label"].str().size());
    } else if (p["label"].isArr()) sci(h, SCI_CALLTIPSETHLT, p["label"][(size_t)0].num(), p["label"][(size_t)1].num());
  });
}

// ---------------------------------------------------------------------------------------------------------------
// Menu commands

static POINT caretPoint(HWND h) {
  sptr_t pos = sci(h, SCI_GETCURRENTPOS);
  POINT p{(LONG)sci(h, SCI_POINTXFROMPOSITION, 0, pos), (LONG)(sci(h, SCI_POINTYFROMPOSITION, 0, pos) + sci(h, SCI_TEXTHEIGHT, 0))};
  ClientToScreen(h, &p);
  return p;
}
/** A small menu at the caret; returns the chosen index or -1. */
static int pickAtCaret(HWND h, const std::vector<std::wstring>& choices) {
  HMENU m = CreatePopupMenu();
  for (size_t i = 0; i < choices.size(); i++) {
    // Titles come as Markdown (`code`); a menu shows plain text, and & would underline the next letter.
    std::wstring t;
    for (wchar_t c : choices[i]) {
      if (c == L'`') continue;
      if (c == L'&') t += L'&';
      t += c;
    }
    AppendMenuW(m, t.empty() ? MF_SEPARATOR : MF_STRING, i + 1, t.c_str());
  }
  POINT p = caretPoint(h);
  int r = TrackPopupMenu(m, TPM_RETURNCMD | TPM_NONOTIFY | TPM_LEFTALIGN | TPM_TOPALIGN, p.x, p.y, 0, npp._nppHandle, nullptr);
  DestroyMenu(m);
  return r - 1;
}

static void needHandler() { MessageBoxW(npp._nppHandle, L"Open a handler (.js) first.", PLUGIN_NAME, MB_OK | MB_ICONINFORMATION); }

static void cmdQuickFix() {
  HWND h = curSci();
  Doc* d = active();
  if (!d) return needHandler();
  sptr_t pos = sci(h, SCI_GETCURRENTPOS);
  sptr_t line = sci(h, SCI_LINEFROMPOSITION, pos);
  Array here;
  for (auto& x : diagnostics[d->uri].arr()) {
    Range r = diagRange(h, x);
    if (sci(h, SCI_LINEFROMPOSITION, r.start) <= line && sci(h, SCI_LINEFROMPOSITION, r.end) >= line) here.push_back(x);
  }
  Value range(Object{{"start", lspPos(h, pos)}, {"end", lspPos(h, pos)}});
  lsp::request("textDocument/codeAction", Value(Object{{"textDocument", docId(d)}, {"range", range}, {"context", Value(Object{{"diagnostics", Value(here)}, {"only", Value(Array{Value("quickfix")})}})}}),
               [=](const Value& r) {
                 std::vector<Value> actions;
                 for (auto& a : r.arr())
                   if (a["edit"].isObj()) actions.push_back(a);
                 if (actions.empty()) {
                   status(L"Nucleus: no fixes on this line");
                   return;
                 }
                 std::vector<std::wstring> titles;
                 for (auto& a : actions) titles.push_back(wide(a["title"].str()));
                 int i = pickAtCaret(h, titles);
                 if (i >= 0) applyWorkspaceEdit(actions[i]["edit"]);
               });
}
static void cmdFixAll() {
  HWND h = curSci();
  Doc* d = active();
  if (!d) return needHandler();
  Value range(Object{{"start", lspPos(h, 0)}, {"end", lspPos(h, sci(h, SCI_GETLENGTH))}});
  lsp::request("textDocument/codeAction", Value(Object{{"textDocument", docId(d)}, {"range", range}, {"context", Value(Object{{"diagnostics", Value(Array{})}, {"only", Value(Array{Value("source.fixAll")})}})}}),
               [](const Value& r) {
                 if (!r.size() || !r[(size_t)0]["edit"].isObj()) {
                   status(L"Nucleus: nothing to fix automatically");
                   return;
                 }
                 applyWorkspaceEdit(r[(size_t)0]["edit"]);
                 status(L"Nucleus: " + wide(r[(size_t)0]["title"].str()));
               });
}
static void cmdFormat() {
  HWND h = curSci();
  Doc* d = active();
  if (!d) return needHandler();
  lsp::request("textDocument/formatting", Value(Object{{"textDocument", docId(d)}, {"options", Value(Object{{"tabSize", (int)sci(h, SCI_GETTABWIDTH)}, {"insertSpaces", !sci(h, SCI_GETUSETABS)}})}}), [=](const Value& r) {
    if (r.size()) applyEdits(h, r);
    else status(L"Nucleus: already formatted");
  });
}
static void newTab(const std::string& text) {
  SendMessage(npp._nppHandle, NPPM_MENUCOMMAND, 0, IDM_FILE_NEW);
  HWND h = curSci();
  sci(h, SCI_SETTEXT, 0, (sptr_t)toDoc(h, text).c_str());  // a new tab is ANSI when Notepad++ is set so
  sci(h, SCI_SETSAVEPOINT);
  sci(h, SCI_GOTOPOS, 0);
}
static void cmdTryIt() {
  HWND h = curSci();
  Doc* d = active();
  if (!d) return needHandler();
  int i = pickAtCaret(h, {L"Try it with 1 player", L"Try it with 2 players", L"Try it with 3 players", L"Try it with 4 players", L"", L"4 players, each with their own keyboard and mouse"});
  if (i < 0) return;
  Object args{{"uri", d->uri}, {"players", i == 5 ? 4 : i + 1}};
  if (i == 5) args["keyboardPlayer"] = Value("all");
  std::wstring name = baseName(d->path);
  lsp::request("workspace/executeCommand", Value(Object{{"command", "nucleus.tryIt"}, {"arguments", Value(Array{Value(args)})}}), [=](const Value& r) {
    newTab("Try it: " + utf8(name) + " (simulated: what Nucleus would set up for each player; nothing on this PC is touched)\n\n" + (r.isStr() ? r.str() : json::stringify(r)));
  });
}
static void jumpTo(HWND h, const Value& range) {
  sptr_t s = sciPos(h, range["start"]), e = sciPos(h, range["end"]);
  sci(h, SCI_GOTOPOS, s);
  sci(h, SCI_SETSEL, s, e);
  sci(h, SCI_SCROLLCARET);
}
/** The handler's own function or variable, `Game.X` where it's set, `Context.Options["key"]` its AddOption. */
static void cmdDefinition() {
  HWND h = curSci();
  Doc* d = active();
  if (!d) return needHandler();
  std::string uri = d->uri;
  lsp::request("textDocument/definition", Value(Object{{"textDocument", docId(d)}, {"position", lspPos(h, sci(h, SCI_GETCURRENTPOS))}}), [=](const Value& r) {
    const Value& loc = r.isArr() ? r[(size_t)0] : r;
    if (!loc.isObj() || loc["uri"].str() != uri) {
      status(L"Nucleus: no definition in this handler (for Nucleus' own names: Show docs here)");
      return;
    }
    jumpTo(h, loc["range"]);
  });
}
/** Every use of the variable or function at the caret, in a list to jump from. */
static void cmdReferences() {
  HWND h = curSci();
  Doc* d = active();
  if (!d) return needHandler();
  lsp::request("textDocument/references", Value(Object{{"textDocument", docId(d)}, {"position", lspPos(h, sci(h, SCI_GETCURRENTPOS))}, {"context", Value(Object{{"includeDeclaration", true}})}}), [=](const Value& r) {
    if (!r.size()) {
      status(L"Nucleus: no uses of a handler variable or function here");
      return;
    }
    std::vector<std::wstring> items;
    for (auto& loc : r.arr()) {
      sptr_t line = loc["range"]["start"]["line"].num();
      sptr_t len = sci(h, SCI_LINELENGTH, line);
      std::string text(len + 1, '\0');
      sci(h, SCI_GETLINE, line, (sptr_t)&text[0]);
      text.resize(strnlen(text.c_str(), len));
      while (!text.empty() && (text.back() == '\n' || text.back() == '\r')) text.pop_back();
      size_t first = text.find_first_not_of(" \t");
      text = first == std::string::npos ? "" : text.substr(first, 80);
      items.push_back(L"Line " + std::to_wstring(line + 1) + L":\t" + wide(text));
    }
    int i = pickAtCaret(h, items);
    if (i >= 0) jumpTo(h, r[(size_t)i]["range"]);
  });
}
/** The handler in the browser workbench (visual editor, Lines, Test all…), through a share link from the tool. */
static void cmdWorkbench() {
  Doc* d = active();
  if (!d) {
    ShellExecuteW(npp._nppHandle, L"open", L"https://snailedlt.github.io/nucleuscoop-handler-testbench/?ref=notepadpp", nullptr, nullptr, SW_SHOWNORMAL);
    return;
  }
  lsp::request("workspace/executeCommand", Value(Object{{"command", "nucleus.workbenchLink"}, {"arguments", Value(Array{Value(Object{{"uri", d->uri}, {"ref", "notepadpp"}})})}}), [](const Value& r) {
    std::string url = r["url"].str();
    if (url.rfind("https://", 0) != 0) return;
    ShellExecuteW(npp._nppHandle, L"open", wide(url).c_str(), nullptr, nullptr, SW_SHOWNORMAL);
    if (!r["withHandler"].boolean()) status(L"Nucleus: this handler is too large for a link: in the workbench, use Open file… to open it");
  });
}

static void cmdOutline() {
  if (!outRegistered) createOutline();
  outShown = !outShown;
  SendMessage(npp._nppHandle, outShown ? NPPM_DMMSHOW : NPPM_DMMHIDE, 0, (LPARAM)outPanel);
  SendMessage(npp._nppHandle, NPPM_SETMENUITEMCHECK, outCmd, outShown);
  if (outShown) {
    if (currentDoc() && !lsp::running) lsp::start();
    refreshOutline();
  }
}

/** One argument on a Windows command line, quoted the way programs read it back (CommandLineToArgvW rules). */
static std::wstring quoteArg(const std::wstring& a) {
  std::wstring out = L"\"";
  size_t slashes = 0;
  for (wchar_t c : a) {
    if (c == L'\\') {
      slashes++;
      continue;
    }
    out.append(c == L'"' ? slashes * 2 + 1 : slashes, L'\\');
    slashes = 0;
    out += c;
  }
  out.append(slashes * 2, L'\\');
  return out + L"\"";
}

/** A folder picker; empty when cancelled. */
static std::wstring pickFolder(const std::wstring& title) {
  IFileOpenDialog* dlg = nullptr;
  if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dlg)))) return L"";
  DWORD opts;
  dlg->GetOptions(&opts);
  dlg->SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
  dlg->SetTitle(title.c_str());
  std::wstring folder;
  if (SUCCEEDED(dlg->Show(npp._nppHandle))) {
    IShellItem* item;
    if (SUCCEEDED(dlg->GetResult(&item))) {
      PWSTR p;
      if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &p))) {
        folder = p;
        CoTaskMemFree(p);
      }
      item->Release();
    }
  }
  dlg->Release();
  return folder;
}

// New handler: a small dialog (built in memory, no resource file), then where to save it; ncdev writes it.
struct DlgBuilder {
  std::vector<WORD> v;
  WORD count = 0;
  void dw(DWORD d) {
    v.push_back(LOWORD(d));
    v.push_back(HIWORD(d));
  }
  void str(const std::wstring& t) {
    for (wchar_t c : t) v.push_back(c);
    v.push_back(0);
  }
  DlgBuilder(const std::wstring& title, short cx, short cy) {
    dw(DS_SETFONT | DS_MODALFRAME | DS_CENTER | WS_POPUP | WS_CAPTION | WS_SYSMENU);
    dw(0);
    v.push_back(0);  // the number of controls, set by done()
    for (short x : {(short)0, (short)0, cx, cy}) v.push_back(x);
    v.push_back(0);  // no menu
    v.push_back(0);  // the standard class
    str(title);
    v.push_back(9);
    str(L"Segoe UI");
  }
  void item(WORD cls, DWORD style, short x, short y, short cx, short cy, WORD id, const std::wstring& text) {
    if (v.size() % 2) v.push_back(0);  // controls start on a DWORD boundary
    dw(style | WS_CHILD | WS_VISIBLE);
    dw(0);
    for (short n : {x, y, cx, cy}) v.push_back(n);
    v.push_back(id);
    v.push_back(0xFFFF);
    v.push_back(cls);  // 0x80 button, 0x81 edit, 0x82 static
    str(text);
    v.push_back(0);
    count++;
  }
  /** A control of a registered window class by name (SysListView32, …). */
  void itemClass(const wchar_t* cls, DWORD style, short x, short y, short cx, short cy, WORD id) {
    if (v.size() % 2) v.push_back(0);
    dw(style | WS_CHILD | WS_VISIBLE);
    dw(0);
    for (short n : {x, y, cx, cy}) v.push_back(n);
    v.push_back(id);
    str(cls);
    str(L"");
    v.push_back(0);
    count++;
  }
  DLGTEMPLATE* done() {
    v[4] = count;
    return (DLGTEMPLATE*)v.data();
  }
};
struct NewHandler {
  std::wstring name, exe, steamId, maxPlayers = L"4";
  std::vector<std::pair<std::string, std::wstring>> features;  // id, label (from ncdev new --list-features)
  std::vector<bool> chosen;
};
enum { ID_NAME = 101, ID_EXE, ID_STEAM, ID_MAX, ID_FEATURE = 200 };
static std::wstring itemText(HWND d, int id) {
  wchar_t buf[512] = L"";
  GetDlgItemTextW(d, id, buf, 512);
  std::wstring t = buf;
  size_t a = t.find_first_not_of(L" \t"), b = t.find_last_not_of(L" \t");
  return a == std::wstring::npos ? L"" : t.substr(a, b - a + 1);
}
static INT_PTR CALLBACK newProc(HWND d, UINT m, WPARAM w, LPARAM l) {
  auto* nh = (NewHandler*)GetWindowLongPtrW(d, DWLP_USER);
  switch (m) {
    case WM_INITDIALOG:
      SetWindowLongPtrW(d, DWLP_USER, l);
      SetDlgItemTextW(d, ID_MAX, ((NewHandler*)l)->maxPlayers.c_str());
      SetFocus(GetDlgItem(d, ID_NAME));
      return FALSE;
    case WM_COMMAND:
      if (LOWORD(w) == IDOK) {
        nh->name = itemText(d, ID_NAME);
        nh->exe = itemText(d, ID_EXE);
        nh->steamId = itemText(d, ID_STEAM);
        nh->maxPlayers = itemText(d, ID_MAX);
        if (nh->name.empty() || nh->exe.empty()) {
          MessageBoxW(d, L"The game's name and its .exe file name are needed (the exe Nucleus starts, e.g. Game.exe or Game-Win64-Shipping.exe).", PLUGIN_NAME, MB_OK | MB_ICONINFORMATION);
          SetFocus(GetDlgItem(d, nh->name.empty() ? ID_NAME : ID_EXE));
          return TRUE;
        }
        for (size_t i = 0; i < nh->features.size(); i++) nh->chosen[i] = IsDlgButtonChecked(d, ID_FEATURE + (int)i) == BST_CHECKED;
        EndDialog(d, IDOK);
        return TRUE;
      }
      if (LOWORD(w) == IDCANCEL) {
        EndDialog(d, IDCANCEL);
        return TRUE;
      }
      return FALSE;
  }
  return FALSE;
}
static void cmdNewHandler() {
  if (findTool().empty()) return lsp::start();  // offers to download the tools
  NewHandler nh;
  Value list;
  if (json::parse(runTool(L"new --list-features --json", nullptr, 30000), list) && list.isArr())
    for (auto& f : list.arr()) {
      std::wstring label;
      for (wchar_t c : wide(f["label"].str())) label += c == L'&' ? std::wstring(L"&&") : std::wstring(1, c);  // a single & would underline the next letter
      nh.features.push_back({f["id"].str(), label});
    }
  nh.chosen.assign(nh.features.size(), false);
  short y = 8, W = 260;
  DlgBuilder b(L"New Nucleus Co-op handler", W, 0);
  auto field = [&](const wchar_t* label, WORD id, DWORD extra = 0) {
    b.item(0x82, SS_LEFT, 8, y, W - 16, 9, (WORD)-1, label);
    b.item(0x81, WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL | extra, 8, y + 10, W - 16, 13, id, L"");
    y += 28;
  };
  field(L"&Game's name (as players know it, e.g. Halo: Reach)", ID_NAME);
  field(L"The game's .&exe file name (e.g. Game.exe)", ID_EXE);
  field(L"&Steam app ID (optional, the number in its store link)", ID_STEAM, ES_NUMBER);
  field(L"&Most players at once", ID_MAX, ES_NUMBER);
  if (!nh.features.empty()) {
    b.item(0x82, SS_LEFT, 8, y, W - 16, 9, (WORD)-1, L"Start with (you can add these later too):");
    y += 12;
    for (size_t i = 0; i < nh.features.size(); i++, y += 13) b.item(0x80, BS_AUTOCHECKBOX | WS_TABSTOP, 12, y, W - 20, 11, (WORD)(ID_FEATURE + i), nh.features[i].second);
    y += 4;
  }
  b.item(0x80, BS_DEFPUSHBUTTON | WS_TABSTOP, W - 112, y, 50, 14, IDOK, L"Create…");
  b.item(0x80, BS_PUSHBUTTON | WS_TABSTOP, W - 58, y, 50, 14, IDCANCEL, L"Cancel");
  b.v[8] = y + 22;  // the dialog's height, now known
  if (DialogBoxIndirectParamW(hModule, b.done(), npp._nppHandle, newProc, (LPARAM)&nh) != IDOK) return;

  // Where to save it: named after the game, as a Hub install names it.
  std::wstring file;
  for (wchar_t c : nh.name)
    if (!wcschr(L"\\/:*?\"<>|", c)) file += c;
  IFileSaveDialog* dlg = nullptr;
  if (FAILED(CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dlg)))) return;
  COMDLG_FILTERSPEC types[] = {{L"Nucleus Co-op handler (*.js)", L"*.js"}};
  dlg->SetFileTypes(1, types);
  dlg->SetDefaultExtension(L"js");
  dlg->SetFileName((file.empty() ? L"handler" : file).c_str());
  dlg->SetTitle(L"Save the new handler");
  std::wstring last = iniGet(L"ncdev", L"newFolder");
  IShellItem* start = nullptr;
  if (!last.empty() && SUCCEEDED(SHCreateItemFromParsingName(last.c_str(), nullptr, IID_PPV_ARGS(&start)))) {
    dlg->SetFolder(start);
    start->Release();
  }
  std::wstring out;
  if (SUCCEEDED(dlg->Show(npp._nppHandle))) {
    IShellItem* item;
    if (SUCCEEDED(dlg->GetResult(&item))) {
      PWSTR p;
      if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &p))) {
        out = p;
        CoTaskMemFree(p);
      }
      item->Release();
    }
  }
  dlg->Release();
  if (out.empty()) return;
  iniSet(L"ncdev", L"newFolder", out.substr(0, out.find_last_of(L"\\/")).c_str());

  std::wstring args = L"new --name " + quoteArg(nh.name) + L" --exe " + quoteArg(nh.exe) + L" --out " + quoteArg(out) + L" --force";
  if (!nh.steamId.empty()) args += L" --steam-id " + quoteArg(nh.steamId);
  if (!nh.maxPlayers.empty()) args += L" --max-players " + quoteArg(nh.maxPlayers);
  std::string features;
  for (size_t i = 0; i < nh.features.size(); i++)
    if (nh.chosen[i]) features += (features.empty() ? "" : ",") + nh.features[i].first;
  if (!features.empty()) args += L" --features " + quoteArg(wide(features));
  DWORD code = 1;
  std::string said = runTool(args, &code, 30000);
  if (code != 0 || !exists(out)) {
    MessageBoxW(npp._nppHandle, (L"Couldn't create the handler:\n\n" + wide(said)).c_str(), PLUGIN_NAME, MB_OK | MB_ICONWARNING);
    return;
  }
  SendMessage(npp._nppHandle, NPPM_DOOPEN, 0, (LPARAM)out.c_str());
  status(L"Nucleus: created " + baseName(out));
}

// Install to Nucleus Co-op: the handler and its <Name>/ folder into Nucleus' handlers folder (ncdev install).
static std::wstring nucleusFolder(bool ask) {
  std::wstring dir = iniGet(L"nucleus", L"path");
  if (!ask && !dir.empty() && exists(dir + L"\\handlers")) return dir;
  for (;;) {
    dir = pickFolder(L"Your Nucleus Co-op folder (the one with NucleusCoop.exe and \"handlers\")");
    if (dir.empty()) return L"";
    if (exists(dir + L"\\handlers")) break;
    if (MessageBoxW(npp._nppHandle, (L"\"" + dir + L"\" has no \"handlers\" folder. Pick the Nucleus Co-op folder (the one with NucleusCoop.exe).").c_str(), PLUGIN_NAME, MB_OKCANCEL | MB_ICONINFORMATION) != IDOK) return L"";
  }
  iniSet(L"nucleus", L"path", dir.c_str());
  return dir;
}
static void cmdSetNucleus() {
  std::wstring dir = nucleusFolder(true);
  if (!dir.empty()) status(L"Nucleus: handlers install to " + dir + L"\\handlers");
}
static void cmdInstall() {
  Doc* d = currentDoc();
  if (!d) return needHandler();
  if (findTool().empty()) return lsp::start();
  SendMessage(npp._nppHandle, NPPM_SAVECURRENTFILE, 0, 0);  // what is installed or packaged is what is on screen
  std::wstring nucleus = nucleusFolder(false);
  if (nucleus.empty()) return;
  bool force = false;
  int errors = 0;
  for (auto& x : diagnostics[d->uri].arr())
    if (x["severity"].num(1) == 1) errors++;
  if (errors) {
    std::wstring q = baseName(d->path) + L" has " + std::to_wstring(errors) + (errors == 1 ? L" error" : L" errors") + L", so Nucleus may not load it (see the Problems panel). Install it anyway?";
    if (MessageBoxW(npp._nppHandle, q.c_str(), PLUGIN_NAME, MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2) != IDYES) return;
    force = true;
  }
  std::wstring dest = nucleus + L"\\handlers\\" + baseName(d->path);
  if (_wcsicmp(dest.c_str(), d->path.c_str()) == 0) {
    MessageBoxW(npp._nppHandle, L"This handler is already in Nucleus' handlers folder: Nucleus uses it as it is.", PLUGIN_NAME, MB_OK | MB_ICONINFORMATION);
    return;
  }
  if (exists(dest)) {
    std::wstring q = baseName(d->path) + L" is already installed in\n" + nucleus + L"\\handlers\n\nReplace it with this one?";
    if (MessageBoxW(npp._nppHandle, q.c_str(), PLUGIN_NAME, MB_YESNO | MB_ICONQUESTION) != IDYES) return;
    force = true;
  }
  runToolAsync(L"installing " + baseName(d->path), L"install " + quoteArg(d->path) + L" --nucleus " + quoteArg(nucleus) + (force ? L" --force" : L""), 60000, [](const ToolResult& r) {
    std::string said = r.out;
    while (!said.empty() && (said.back() == '\n' || said.back() == '\r')) said.pop_back();
    std::wstring why = toolFailure(r, L"to install it");
    status(r.code == 0 ? L"Nucleus: installed" : L"Nucleus: couldn't install");
    MessageBoxW(npp._nppHandle, (!why.empty() ? why : wide(said.empty() ? "Couldn't run ncdev install." : said)).c_str(), PLUGIN_NAME, MB_OK | (r.code == 0 ? MB_ICONINFORMATION : MB_ICONWARNING));
  });
}

// Rename: the handler's own variable or function, every use (textDocument/prepareRename, then rename).
struct RenameState {
  std::wstring name;
};
static INT_PTR CALLBACK renameProc(HWND d, UINT m, WPARAM w, LPARAM l) {
  auto* st = (RenameState*)GetWindowLongPtrW(d, DWLP_USER);
  switch (m) {
    case WM_INITDIALOG:
      SetWindowLongPtrW(d, DWLP_USER, l);
      SetDlgItemTextW(d, ID_NAME, ((RenameState*)l)->name.c_str());
      SetFocus(GetDlgItem(d, ID_NAME));
      SendDlgItemMessageW(d, ID_NAME, EM_SETSEL, 0, -1);
      return FALSE;
    case WM_COMMAND:
      if (LOWORD(w) == IDOK) {
        st->name = itemText(d, ID_NAME);
        EndDialog(d, IDOK);
        return TRUE;
      }
      if (LOWORD(w) == IDCANCEL) {
        EndDialog(d, IDCANCEL);
        return TRUE;
      }
  }
  return FALSE;
}
static void cmdRename() {
  HWND h = curSci();
  Doc* d = active();
  if (!d) return needHandler();
  Value pos = lspPos(h, sci(h, SCI_GETCURRENTPOS));
  lsp::request("textDocument/prepareRename", Value(Object{{"textDocument", docId(d)}, {"position", pos}}), [=](const Value& r) {
    if (!r.isObj()) {
      status(L"Nucleus: put the cursor on one of the handler's own variables or functions to rename it");
      return;
    }
    RenameState st{wide(r["placeholder"].str())};
    std::wstring old = st.name;
    DlgBuilder b(L"Rename " + old, 220, 52);
    b.item(0x82, SS_LEFT, 8, 8, 204, 9, (WORD)-1, L"New name (every use in this handler changes):");
    b.item(0x81, WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL, 8, 18, 204, 13, ID_NAME, L"");
    b.item(0x80, BS_DEFPUSHBUTTON | WS_TABSTOP, 108, 36, 50, 14, IDOK, L"Rename");
    b.item(0x80, BS_PUSHBUTTON | WS_TABSTOP, 162, 36, 50, 14, IDCANCEL, L"Cancel");
    if (DialogBoxIndirectParamW(hModule, b.done(), npp._nppHandle, renameProc, (LPARAM)&st) != IDOK || st.name.empty() || st.name == old) return;
    flushChange();
    lsp::request("textDocument/rename", Value(Object{{"textDocument", docId(d)}, {"position", pos}, {"newName", utf8(st.name)}}), [=](const Value& e) {
      if (e.isObj() && applyWorkspaceEdit(e)) status(L"Nucleus: renamed " + old + L" to " + st.name);
    });
  });
}

// Settings…: how strict each check is (the rule severities) and the format style, kept in NcDev.ini.
struct RuleRow {
  std::string id, def, desc;
  std::string cur;  // "" = the default
};
struct SettingsState {
  std::vector<RuleRow> rules;
  int quotes = 0, semis = 0;  // 0 double/add, 1 single/keep, 2 keep (quotes)
};
enum { ID_RULES = 300, ID_SEV, ID_QUOTES, ID_SEMIS, ID_RESET, ID_DESC };
static const char* SEVS[] = {"", "error", "warning", "info", "hint", "off"};
static std::wstring sevLabel(const RuleRow& r) { return r.cur.empty() ? wide(r.def) + L" (default)" : wide(r.cur); }
static INT_PTR CALLBACK settingsProc(HWND d, UINT m, WPARAM w, LPARAM l) {
  auto* st = (SettingsState*)GetWindowLongPtrW(d, DWLP_USER);
  HWND lv = GetDlgItem(d, ID_RULES), sev = GetDlgItem(d, ID_SEV);
  auto selected = [&]() { return ListView_GetNextItem(lv, -1, LVNI_SELECTED); };
  auto showSev = [&]() {
    int i = selected();
    EnableWindow(sev, i >= 0);
    if (i < 0) return;
    const RuleRow& r = st->rules[i];
    SetDlgItemTextW(d, ID_DESC, wide(r.desc).c_str());
    SendMessageW(sev, CB_DELETESTRING, 0, 0);
    SendMessageW(sev, CB_INSERTSTRING, 0, (LPARAM)(L"Default (" + wide(r.def) + L")").c_str());
    int k = 0;
    for (int j = 1; j < 6; j++)
      if (r.cur == SEVS[j]) k = j;
    SendMessageW(sev, CB_SETCURSEL, k, 0);
  };
  switch (m) {
    case WM_INITDIALOG: {
      SetWindowLongPtrW(d, DWLP_USER, l);
      st = (SettingsState*)l;
      ListView_SetExtendedListViewStyle(lv, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER);
      const wchar_t* cols[] = {L"Check", L"Severity", L"What it finds"};
      int widths[] = {150, 110, 420};
      for (int i = 0; i < 3; i++) {
        LVCOLUMNW c{};
        c.mask = LVCF_TEXT | LVCF_WIDTH;
        c.pszText = (LPWSTR)cols[i];
        c.cx = widths[i];
        ListView_InsertColumn(lv, i, &c);
      }
      for (size_t i = 0; i < st->rules.size(); i++) {
        LVITEMW it{};
        it.mask = LVIF_TEXT;
        it.iItem = (int)i;
        std::wstring id = wide(st->rules[i].id), sv = sevLabel(st->rules[i]), ds = wide(st->rules[i].desc);
        it.pszText = &id[0];
        ListView_InsertItem(lv, &it);
        ListView_SetItemText(lv, (int)i, 1, &sv[0]);
        ListView_SetItemText(lv, (int)i, 2, &ds[0]);
      }
      SendMessageW(sev, CB_ADDSTRING, 0, (LPARAM)L"Default");
      for (const wchar_t* x : {L"Error: underlined red", L"Warning: underlined orange", L"Info: dotted underline", L"Hint: only in the Problems panel", L"Off: not checked"}) SendMessageW(sev, CB_ADDSTRING, 0, (LPARAM)x);
      HWND q = GetDlgItem(d, ID_QUOTES), sm = GetDlgItem(d, ID_SEMIS);
      for (const wchar_t* x : {L"\"Double\" (default; what the Hub install reads)", L"'Single'", L"Keep as written"}) SendMessageW(q, CB_ADDSTRING, 0, (LPARAM)x);
      for (const wchar_t* x : {L"Add where a statement ends without one (default)", L"Keep as written"}) SendMessageW(sm, CB_ADDSTRING, 0, (LPARAM)x);
      SendMessageW(q, CB_SETCURSEL, st->quotes, 0);
      SendMessageW(sm, CB_SETCURSEL, st->semis, 0);
      if (!st->rules.empty()) ListView_SetItemState(lv, 0, LVIS_SELECTED | LVIS_FOCUSED, LVIS_SELECTED | LVIS_FOCUSED);
      showSev();
      return TRUE;
    }
    case WM_NOTIFY: {
      auto* nm = (NMHDR*)l;
      if (nm->idFrom == ID_RULES && nm->code == LVN_ITEMCHANGED && (((NMLISTVIEW*)l)->uNewState & LVIS_SELECTED)) showSev();
      return FALSE;
    }
    case WM_COMMAND:
      if (LOWORD(w) == ID_SEV && HIWORD(w) == CBN_SELCHANGE) {
        int i = selected(), k = (int)SendMessageW(sev, CB_GETCURSEL, 0, 0);
        if (i >= 0 && k >= 0) {
          st->rules[i].cur = SEVS[k];
          std::wstring sv = sevLabel(st->rules[i]);
          ListView_SetItemText(lv, i, 1, &sv[0]);
        }
        return TRUE;
      }
      if (LOWORD(w) == ID_RESET) {
        for (size_t i = 0; i < st->rules.size(); i++) {
          st->rules[i].cur.clear();
          std::wstring sv = sevLabel(st->rules[i]);
          ListView_SetItemText(lv, (int)i, 1, &sv[0]);
        }
        showSev();
        return TRUE;
      }
      if (LOWORD(w) == IDOK) {
        st->quotes = (int)SendDlgItemMessageW(d, ID_QUOTES, CB_GETCURSEL, 0, 0);
        st->semis = (int)SendDlgItemMessageW(d, ID_SEMIS, CB_GETCURSEL, 0, 0);
        EndDialog(d, IDOK);
        return TRUE;
      }
      if (LOWORD(w) == IDCANCEL) {
        EndDialog(d, IDCANCEL);
        return TRUE;
      }
  }
  return FALSE;
}
static void cmdSettings() {
  if (findTool().empty()) return lsp::start();
  SettingsState st;
  Value rules;
  if (!json::parse(runTool(L"rules --json", nullptr, 30000), rules) || !rules.isObj()) {
    MessageBoxW(npp._nppHandle, L"Couldn't read the list of checks from ncdev.", PLUGIN_NAME, MB_OK | MB_ICONWARNING);
    return;
  }
  Value saved = lsp::iniSection(L"rules");
  for (auto& [id, r] : *rules.o) st.rules.push_back(RuleRow{id, r["severity"].str(), r["description"].str(), saved[id].str()});
  std::wstring q = iniGet(L"format", L"quotes"), sm = iniGet(L"format", L"semicolons");
  st.quotes = q == L"single" ? 1 : q == L"keep" ? 2 : 0;
  st.semis = sm == L"keep" ? 1 : 0;
  DlgBuilder b(L"Nucleus Co-op handlers: settings", 400, 276);
  b.item(0x82, SS_LEFT, 8, 6, 384, 9, (WORD)-1, L"Checks: pick one, then how it's shown (or Off).");
  b.itemClass(L"SysListView32", LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS | WS_BORDER | WS_TABSTOP, 8, 17, 384, 130, ID_RULES);
  b.item(0x82, SS_LEFT | SS_NOPREFIX, 8, 151, 384, 26, ID_DESC, L"");
  b.item(0x82, SS_LEFT, 8, 182, 90, 9, (WORD)-1, L"Selected &check:");
  b.item(0x85, CBS_DROPDOWNLIST | WS_VSCROLL | WS_TABSTOP, 100, 180, 200, 120, ID_SEV, L"");
  b.item(0x80, BS_PUSHBUTTON | WS_TABSTOP, 308, 179, 84, 14, ID_RESET, L"Reset all checks");
  b.item(0x82, SS_LEFT, 8, 202, 384, 9, (WORD)-1, L"Format handler:");
  b.item(0x82, SS_LEFT, 8, 216, 90, 9, (WORD)-1, L"&Quotes:");
  b.item(0x85, CBS_DROPDOWNLIST | WS_TABSTOP, 100, 214, 200, 80, ID_QUOTES, L"");
  b.item(0x82, SS_LEFT, 8, 234, 90, 9, (WORD)-1, L"&Semicolons:");
  b.item(0x85, CBS_DROPDOWNLIST | WS_TABSTOP, 100, 232, 200, 80, ID_SEMIS, L"");
  b.item(0x80, BS_DEFPUSHBUTTON | WS_TABSTOP, 288, 256, 50, 14, IDOK, L"OK");
  b.item(0x80, BS_PUSHBUTTON | WS_TABSTOP, 342, 256, 50, 14, IDCANCEL, L"Cancel");
  if (DialogBoxIndirectParamW(hModule, b.done(), npp._nppHandle, settingsProc, (LPARAM)&st) != IDOK) return;
  for (auto& r : st.rules) iniSet(L"rules", wide(r.id), r.cur.empty() ? nullptr : wide(r.cur).c_str());
  iniSet(L"format", L"quotes", st.quotes == 1 ? L"single" : st.quotes == 2 ? L"keep" : nullptr);
  iniSet(L"format", L"semicolons", st.semis == 1 ? L"keep" : nullptr);
  if (lsp::running) lsp::notify("workspace/didChangeConfiguration", Value(Object{{"settings", lsp::settings()}}));
  status(L"Nucleus: settings saved");
}

// Browse the Hub…: search hub.splitscreen.me (most downloaded first), download a handler with its files and open it.
struct HubState {
  Value list;
  std::string picked;  // id
  std::wstring title;
};
enum { ID_HUBQ = 310, ID_HUBSEARCH, ID_HUBLIST, ID_HUBGET, ID_HUBWEB, ID_HUBNOTE };
static HWND hubDlg = nullptr;  // the open Browse the Hub dialog, for searches that answer after it closed
static void hubShow(HWND d, HubState* st, const ToolResult& res) {
  HWND lv = GetDlgItem(d, ID_HUBLIST);
  Value r;
  st->list = json::parse(res.out, r) && r.isArr() ? r : Value(Array{});
  ListView_DeleteAllItems(lv);
  int i = 0;
  for (auto& h : st->list.arr()) {
    LVITEMW it{};
    it.mask = LVIF_TEXT;
    it.iItem = i;
    std::wstring t = wide(h["title"].str()), g = wide(h["gameName"].str()), o = wide(h["owner"].str()), n = std::to_wstring((long long)h["downloads"].num()), v = h["verified"].boolean() ? L"Verified" : L"";
    it.pszText = &t[0];
    ListView_InsertItem(lv, &it);
    ListView_SetItemText(lv, i, 1, &g[0]);
    ListView_SetItemText(lv, i, 2, &o[0]);
    ListView_SetItemText(lv, i, 3, &n[0]);
    ListView_SetItemText(lv, i, 4, &v[0]);
    i++;
  }
  if (i) {
    ListView_SetItemState(lv, 0, LVIS_SELECTED | LVIS_FOCUSED, LVIS_SELECTED | LVIS_FOCUSED);
    status(L"Nucleus: " + std::to_wstring(i) + L" handlers");
  } else if (!r.isArr()) {
    std::wstring why = toolFailure(res, L"to reach the Hub");
    status(L"Nucleus: couldn't reach the Hub");
    SetDlgItemTextW(d, ID_HUBNOTE, (why.empty() ? L"Couldn't reach the Hub. Is this PC online?" : why).c_str());
  } else
    status(L"Nucleus: no handlers found");
  EnableWindow(GetDlgItem(d, ID_HUBGET), i > 0);
  EnableWindow(GetDlgItem(d, ID_HUBWEB), i > 0);
}
/** Searches in the background: the dialog (and Notepad++) stay usable; a new search replaces one still running. */
static void hubFill(HWND d, HubState* st, const std::wstring& words) {
  ListView_DeleteAllItems(GetDlgItem(d, ID_HUBLIST));
  EnableWindow(GetDlgItem(d, ID_HUBGET), FALSE);
  EnableWindow(GetDlgItem(d, ID_HUBWEB), FALSE);
  SetDlgItemTextW(d, ID_HUBNOTE, words.empty() ? L"Loading the most downloaded…" : L"Searching…");
  runToolAsync(L"searching the Hub", words.empty() ? L"hub search --popular --json" : L"hub search " + quoteArg(words) + L" --json", 60000,
               [d, st, words](const ToolResult& res) {
                 if (hubDlg != d) return;  // closed meanwhile
                 SetDlgItemTextW(d, ID_HUBNOTE, words.empty() ? L"Most downloaded first." : L"Best matches first.");
                 hubShow(d, st, res);
               },
               true);
}
static INT_PTR CALLBACK hubProc(HWND d, UINT m, WPARAM w, LPARAM l) {
  auto* st = (HubState*)GetWindowLongPtrW(d, DWLP_USER);
  HWND lv = GetDlgItem(d, ID_HUBLIST);
  auto pick = [&]() -> const Value* {
    int i = ListView_GetNextItem(lv, -1, LVNI_SELECTED);
    return i >= 0 && i < (int)st->list.size() ? &st->list[(size_t)i] : nullptr;
  };
  switch (m) {
    case WM_INITDIALOG: {
      SetWindowLongPtrW(d, DWLP_USER, l);
      st = (HubState*)l;
      hubDlg = d;
      ListView_SetExtendedListViewStyle(lv, LVS_EX_FULLROWSELECT | LVS_EX_DOUBLEBUFFER);
      const wchar_t* cols[] = {L"Handler", L"Game", L"By", L"Downloads", L""};
      int widths[] = {220, 180, 100, 80, 70};
      for (int i = 0; i < 5; i++) {
        LVCOLUMNW c{};
        c.mask = LVCF_TEXT | LVCF_WIDTH | (i == 3 ? LVCF_FMT : 0);
        c.fmt = LVCFMT_RIGHT;
        c.pszText = (LPWSTR)cols[i];
        c.cx = widths[i];
        ListView_InsertColumn(lv, i, &c);
      }
      hubFill(d, st, L"");
      SetFocus(GetDlgItem(d, ID_HUBQ));
      return FALSE;
    }
    case WM_NOTIFY: {
      auto* nm = (NMHDR*)l;
      if (nm->idFrom == ID_HUBLIST && nm->code == NM_DBLCLK) SendMessageW(d, WM_COMMAND, ID_HUBGET, 0);
      return FALSE;
    }
    case WM_COMMAND:
      // Enter in the search box searches (it would otherwise press the default button).
      if (LOWORD(w) == ID_HUBSEARCH || ((LOWORD(w) == IDOK || LOWORD(w) == ID_HUBGET) && HIWORD(w) == BN_CLICKED && GetFocus() == GetDlgItem(d, ID_HUBQ))) {
        hubFill(d, st, itemText(d, ID_HUBQ));
        return TRUE;
      }
      if (LOWORD(w) == ID_HUBWEB) {
        if (const Value* h = pick()) ShellExecuteW(d, L"open", wide(h->operator[]("url").str() + "?ref=notepadpp").c_str(), nullptr, nullptr, SW_SHOWNORMAL);
        return TRUE;
      }
      if (LOWORD(w) == ID_HUBGET || LOWORD(w) == IDOK) {
        if (const Value* h = pick()) {
          st->picked = (*h)["id"].str();
          st->title = wide((*h)["title"].str());
          hubDlg = nullptr;
          EndDialog(d, IDOK);
        }
        return TRUE;
      }
      if (LOWORD(w) == IDCANCEL) {
        hubDlg = nullptr;
        auto it = toolJobs.find(L"searching the Hub");
        if (it != toolJobs.end()) it->second->cancel = true;  // nobody waits for it now
        EndDialog(d, IDCANCEL);
        return TRUE;
      }
      return FALSE;
    case WM_DESTROY:
      if (hubDlg == d) hubDlg = nullptr;
      return FALSE;
  }
  return FALSE;
}
static void cmdHub() {
  if (findTool().empty()) return lsp::start();
  HubState st;
  DlgBuilder b(L"Handlers on hub.splitscreen.me", 420, 236);
  b.item(0x82, SS_LEFT, 8, 8, 120, 9, (WORD)-1, L"&Search by game or handler:");
  b.item(0x81, WS_BORDER | WS_TABSTOP | ES_AUTOHSCROLL, 130, 6, 226, 13, ID_HUBQ, L"");
  b.item(0x80, BS_PUSHBUTTON | WS_TABSTOP, 362, 5, 50, 14, ID_HUBSEARCH, L"Search");
  b.itemClass(L"SysListView32", LVS_REPORT | LVS_SINGLESEL | LVS_SHOWSELALWAYS | WS_BORDER | WS_TABSTOP, 8, 24, 404, 184, ID_HUBLIST);
  b.item(0x82, SS_LEFT, 8, 216, 180, 9, ID_HUBNOTE, L"Most downloaded first.");
  b.item(0x80, BS_PUSHBUTTON | WS_TABSTOP, 194, 214, 70, 14, ID_HUBWEB, L"Open on the Hub");
  b.item(0x80, BS_DEFPUSHBUTTON | WS_TABSTOP, 268, 214, 90, 14, ID_HUBGET, L"Download and open…");
  b.item(0x80, BS_PUSHBUTTON | WS_TABSTOP, 362, 214, 50, 14, IDCANCEL, L"Close");
  if (DialogBoxIndirectParamW(hModule, b.done(), npp._nppHandle, hubProc, (LPARAM)&st) != IDOK || st.picked.empty()) return;
  std::wstring folder = pickFolder(L"Where to put \"" + st.title + L"\" (a folder is made for it)");
  if (folder.empty()) return;
  std::wstring name;
  for (wchar_t c : st.title)
    if (c >= 32 && !wcschr(L"\\/:*?\"<>|", c)) name += c;
  // Never "." or ".." (the chosen folder itself or its parent) and no trailing dots or spaces (as core's safeFileName).
  while (!name.empty() && (name.back() == L'.' || name.back() == L' ')) name.pop_back();
  while (!name.empty() && name.front() == L' ') name.erase(0, 1);
  std::wstring out = folder + L"\\" + (name.empty() ? L"handler" : name);
  std::wstring title = st.title;
  // In the background: Notepad++ stays usable while it downloads (the status bar counts the seconds).
  runToolAsync(L"downloading " + title, L"hub fetch " + quoteArg(wide(st.picked)) + L" --out " + quoteArg(out) + L" --json", 180000, [title, out](const ToolResult& res) {
    Value r;
    if (!json::parse(res.out, r) || !r.isObj()) {
      std::wstring why = toolFailure(res, L"to download it");
      status(L"Nucleus: couldn't download " + title);
      MessageBoxW(npp._nppHandle, (why.empty() ? L"Couldn't download it. Is this PC online, and can it reach hub.splitscreen.me?\n\n(" + wide(res.out.substr(0, 300)) + L")" : why).c_str(), PLUGIN_NAME, MB_OK | MB_ICONWARNING);
      return;
    }
    // The handler is the .js at the top of its folder.
    std::string dir = r["dir"].str();
    for (auto& f : r["files"].arr()) {
      std::string p = f.str();
      std::string rest = p.size() > dir.size() ? p.substr(dir.size() + 1) : p;
      if (rest.size() > 3 && rest.compare(rest.size() - 3, 3, ".js") == 0 && rest.find_first_of("\\/") == std::string::npos) {
        SendMessage(npp._nppHandle, NPPM_DOOPEN, 0, (LPARAM)wide(p).c_str());
        status(L"Nucleus: downloaded " + title + L" to " + out);
        return;
      }
    }
    status(L"Nucleus: downloaded " + title);
    ShellExecuteW(npp._nppHandle, L"open", out.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  });
}

// Package as .nc…: handler.js and its <Name>/ folder, ready to upload to the Hub (ncdev package).
static void cmdPackage() {
  Doc* d = currentDoc();
  if (!d) return needHandler();
  if (findTool().empty()) return lsp::start();
  SendMessage(npp._nppHandle, NPPM_SAVECURRENTFILE, 0, 0);  // what is installed or packaged is what is on screen
  int errors = 0;
  for (auto& x : diagnostics[d->uri].arr())
    if (x["severity"].num(1) == 1) errors++;
  if (errors) {
    std::wstring q = baseName(d->path) + L" has " + std::to_wstring(errors) + (errors == 1 ? L" error" : L" errors") + L", so Nucleus may not load it (see the Problems panel). Package it anyway?";
    if (MessageBoxW(npp._nppHandle, q.c_str(), PLUGIN_NAME, MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2) != IDYES) return;
  }
  std::wstring dir = d->path.substr(0, d->path.find_last_of(L"\\/"));
  runToolAsync(L"packaging " + baseName(d->path), L"package " + quoteArg(d->path) + (errors ? L" --force" : L""), 60000, [dir](const ToolResult& r) {
    std::string said = r.out;
    while (!said.empty() && (said.back() == '\n' || said.back() == '\r')) said.pop_back();
    std::wstring why = toolFailure(r, L"to package it");
    bool ok = r.code == 0 && why.empty();
    status(ok ? L"Nucleus: packaged" : L"Nucleus: couldn't package");
    if (MessageBoxW(npp._nppHandle, (!why.empty() ? why : wide(said.empty() ? "Couldn't run ncdev package." : said) + (ok ? L"\n\nOpen the folder?" : L"")).c_str(), PLUGIN_NAME, (ok ? MB_YESNO | MB_ICONINFORMATION : MB_OK | MB_ICONWARNING)) == IDYES)
      ShellExecuteW(npp._nppHandle, L"open", dir.c_str(), nullptr, nullptr, SW_SHOWNORMAL);
  });
}

// Test in Nucleus Co-op: install, then (re)start Nucleus with the handler's game selected (ncdev test).
static void cmdTestInNucleus() {
  Doc* d = currentDoc();
  if (!d) return needHandler();
  if (findTool().empty()) return lsp::start();
  SendMessage(npp._nppHandle, NPPM_SAVECURRENTFILE, 0, 0);  // what's tested is what's on screen
  std::wstring nucleus = nucleusFolder(false);
  if (nucleus.empty()) return;
  Value st;
  if (!json::parse(runTool(L"test --status --nucleus " + quoteArg(nucleus) + L" --json", nullptr, 30000), st) || !st.isObj()) {
    MessageBoxW(npp._nppHandle, L"Couldn't ask ncdev about Nucleus Co-op.", PLUGIN_NAME, MB_OK | MB_ICONWARNING);
    return;
  }
  if (!st["canStart"].boolean()) {
    MessageBoxW(npp._nppHandle, wide(st["why"].str()).c_str(), PLUGIN_NAME, MB_OK | MB_ICONINFORMATION);
    return;
  }
  std::wstring flags;
  int errors = 0;
  for (auto& x : diagnostics[d->uri].arr())
    if (x["severity"].num(1) == 1) errors++;
  if (errors) {
    std::wstring q = baseName(d->path) + L" has " + std::to_wstring(errors) + (errors == 1 ? L" error" : L" errors") + L", so Nucleus may not load it (see the Problems panel). Test it anyway?";
    if (MessageBoxW(npp._nppHandle, q.c_str(), PLUGIN_NAME, MB_YESNO | MB_ICONWARNING | MB_DEFBUTTON2) != IDYES) return;
    flags += L" --force";
  }
  if (st["running"].boolean()) {
    if (MessageBoxW(npp._nppHandle, L"Nucleus Co-op is open. It reads handlers when it starts: close it and start it again with this handler?", PLUGIN_NAME, MB_YESNO | MB_ICONQUESTION) != IDYES) return;
    flags += L" --restart";
  }
  // The debug log tells you why a test went wrong: offered once.
  if (st["debugLog"].type == json::Value::Bool && !st["debugLog"].boolean() && iniGet(L"ncdev", L"debugLogAsked").empty()) {
    iniSet(L"ncdev", L"debugLogAsked", L"1");
    if (MessageBoxW(npp._nppHandle, L"Turn on Nucleus' debug log? debug-log.txt then says what Nucleus did, step by step: the first thing to read when a test goes wrong.", PLUGIN_NAME, MB_YESNO | MB_ICONQUESTION) == IDYES) flags += L" --debug-log on";
  }
  runToolAsync(L"starting Nucleus Co-op", L"test " + quoteArg(d->path) + L" --nucleus " + quoteArg(nucleus) + flags, 60000, [](const ToolResult& r) {
    std::string said = r.out;
    while (!said.empty() && (said.back() == '\n' || said.back() == '\r')) said.pop_back();
    std::wstring why = toolFailure(r, L"to start Nucleus Co-op");
    bool ok = r.code == 0 && why.empty();
    status(ok ? L"Nucleus: Nucleus Co-op started" : L"Nucleus: couldn't start Nucleus Co-op");
    MessageBoxW(npp._nppHandle, (!why.empty() ? why : wide(said.empty() ? "Couldn't run ncdev test." : said) + (ok ? L"\n\nAfterwards: Plugins › Nucleus Co-op handlers › Open Nucleus' debug log." : L"")).c_str(), PLUGIN_NAME, MB_OK | (ok ? MB_ICONINFORMATION : MB_ICONWARNING));
  });
}
static void cmdOpenNucleusLog() {
  std::wstring nucleus = nucleusFolder(false);
  if (nucleus.empty()) return;
  std::wstring log = nucleus + L"\\debug-log.txt";
  if (!exists(log)) {
    MessageBoxW(npp._nppHandle, (L"There's no debug-log.txt in " + nucleus + L" yet. Turn on the debug log in Nucleus' settings (or say yes when testing), then run a test.").c_str(), PLUGIN_NAME, MB_OK | MB_ICONINFORMATION);
    return;
  }
  SendMessage(npp._nppHandle, NPPM_DOOPEN, 0, (LPARAM)log.c_str());
}
static void cmdDocs() {
  HWND h = curSci();
  if (!currentDoc()) return needHandler();
  hoverAt(h, sci(h, SCI_GETCURRENTPOS), false);
}
static void cmdSuggest() {
  if (!currentDoc()) return needHandler();
  complete(curSci(), true);
}
static void cmdPanel() {
  if (!panelRegistered) createPanel();
  panelShown = !panelShown;
  SendMessage(npp._nppHandle, panelShown ? NPPM_DMMSHOW : NPPM_DMMHIDE, 0, (LPARAM)panel);
  SendMessage(npp._nppHandle, NPPM_SETMENUITEMCHECK, panelCmd, panelShown);
  if (panelShown) {
    if (currentDoc() && !lsp::running) lsp::start();
    refreshPanel();
  }
}
static void cmdLinkFolder() {
  Doc* d = currentDoc();
  if (!d) return needHandler();
  std::wstring folder = pickFolder(L"The folder " + baseName(d->path) + L"'s game is installed in (where its .exe is, or above)");
  if (folder.empty()) return;
  iniSet(L"gameFolders", baseName(d->path), folder.c_str());
  if (lsp::running) lsp::notify("workspace/didChangeConfiguration", Value(Object{{"settings", lsp::settings()}}));
  status(L"Nucleus: " + baseName(d->path) + L" is checked against " + folder);
}
static void cmdUnlinkFolder() {
  Doc* d = currentDoc();
  if (!d) return needHandler();
  iniSet(L"gameFolders", baseName(d->path), nullptr);
  if (lsp::running) lsp::notify("workspace/didChangeConfiguration", Value(Object{{"settings", lsp::settings()}}));
}
static void cmdReference() {
  if (findTool().empty()) return lsp::start();
  runToolAsync(L"loading the API reference", L"api --markdown", 60000, [](const ToolResult& r) {
    if (!r.out.empty() && r.code == 0) newTab(r.out);
    else status(L"Nucleus: couldn't load the API reference");
  });
}
static void cmdUpdate() {
  if (findTool().empty()) return lsp::start();
  runToolAsync(L"updating the handler tools", L"update --from-notepad++", 300000, [](const ToolResult& r) {
    lsp::stop();  // the tool may have been replaced: start the new one
    lsp::restarts = 0;
    for (auto& [b, d] : docs) d.open = false;
    std::wstring why = toolFailure(r, L"to update");
    status(L"Nucleus: update done");
    MessageBoxW(npp._nppHandle, (!why.empty() ? why : wide(r.out.empty() ? "Couldn't run ncdev update." : r.out)).c_str(), PLUGIN_NAME, MB_OK | MB_ICONINFORMATION);
    if (currentDoc()) lsp::start();
  });
}
static void cmdAbout() {
  std::wstring tool = findTool();
  std::string v = tool.empty() ? "not installed" : runTool(L"--version");
  while (!v.empty() && (v.back() == '\n' || v.back() == '\r')) v.pop_back();
  std::wstring text = std::wstring(L"Nucleus Co-op handlers for Notepad++, plugin ") + wide(PLUGIN_VERSION) + L"\nTools: " + wide(v) + (tool.empty() ? L"" : L"\n(" + tool + L")") +
                      L"\n\nIn a handler (.js):\n• Problems are underlined; hover one, or a name, for help.\n• Suggestions appear as you type (after a dot, =, a quote…).\n• Alt+Enter: fixes for the line. Plugins › Nucleus Co-op handlers has the rest.\n\nhttps://github.com/Snailedlt/splitscreenme-vscode";
  MessageBoxW(npp._nppHandle, text.c_str(), PLUGIN_NAME, MB_OK | MB_ICONINFORMATION);
}

static ShortcutKey altEnter{false, true, false, VK_RETURN};
static ShortcutKey altF12{false, true, false, VK_F12};
static FuncItem funcs[] = {
    {L"Quick fix on this line", cmdQuickFix, 0, false, &altEnter},
    {L"Go to definition", cmdDefinition, 0, false, &altF12},
    {L"Find references", cmdReferences, 0, false, nullptr},
    {L"Rename…", cmdRename, 0, false, nullptr},
    {L"Fix all", cmdFixAll, 0, false, nullptr},
    {L"Show docs here", cmdDocs, 0, false, nullptr},
    {L"Suggest here", cmdSuggest, 0, false, nullptr},
    {L"Format handler", cmdFormat, 0, false, nullptr},
    {L"Try it (simulate)…", cmdTryIt, 0, false, nullptr},
    {L"Problems panel", cmdPanel, 0, false, nullptr},
    {L"Outline panel", cmdOutline, 0, false, nullptr},
    {L"Open in the browser workbench", cmdWorkbench, 0, false, nullptr},
    {L"", nullptr, 0, false, nullptr},
    {L"New handler…", cmdNewHandler, 0, false, nullptr},
    {L"Browse the Hub…", cmdHub, 0, false, nullptr},
    {L"Test in Nucleus Co-op", cmdTestInNucleus, 0, false, nullptr},
    {L"Open Nucleus' debug log", cmdOpenNucleusLog, 0, false, nullptr},
    {L"Install to Nucleus Co-op", cmdInstall, 0, false, nullptr},
    {L"Package as .nc (for the Hub)…", cmdPackage, 0, false, nullptr},
    {L"Set the Nucleus Co-op folder…", cmdSetNucleus, 0, false, nullptr},
    {L"", nullptr, 0, false, nullptr},
    {L"Link the game's folder…", cmdLinkFolder, 0, false, nullptr},
    {L"Unlink the game's folder", cmdUnlinkFolder, 0, false, nullptr},
    {L"", nullptr, 0, false, nullptr},
    {L"API reference", cmdReference, 0, false, nullptr},
    {L"Settings…", cmdSettings, 0, false, nullptr},
    {L"Check for updates", cmdUpdate, 0, false, nullptr},
    {L"About", cmdAbout, 0, false, nullptr},
};
static const int PANEL_INDEX = 9, OUTLINE_INDEX = 10, UPDATE_INDEX = 26;

// ---------------------------------------------------------------------------------------------------------------
// Messages from the server (on Notepad++'s thread)

static void handle(const std::string& body) {
  logLine("< " + body);
  Value m;
  if (!json::parse(body, m)) return;
  std::string method = m["method"].str();
  if (method.empty()) {
    auto it = lsp::pending.find(m["id"].num(-1));
    if (it == lsp::pending.end()) return;
    auto cb = it->second;
    lsp::pending.erase(it);
    if (m["error"].isObj()) {
      status(L"Nucleus: " + wide(m["error"]["message"].str()));
      return;
    }
    cb(m["result"]);
    return;
  }
  if (method == "textDocument/publishDiagnostics") {
    diagnostics[m["params"]["uri"].str()] = m["params"]["diagnostics"];
    Doc* d = currentDoc();
    if (d && d->uri == m["params"]["uri"].str()) applyDiagnostics();
  } else if (method == "window/showMessage") {
    status(wide(m["params"]["message"].str()));
  }
  if (!m["id"].isNull()) {  // a request from the server: answer it
    Value result;
    if (method == "workspace/applyEdit") result = Value(Object{{"applied", applyWorkspaceEdit(m["params"]["edit"])}});
    lsp::send(Value(Object{{"jsonrpc", "2.0"}, {"id", m["id"]}, {"result", result}}), true);
  }
}

static LRESULT CALLBACK msgProc(HWND hw, UINT m, WPARAM w, LPARAM l) {
  switch (m) {
    case WM_LSP: {
      std::deque<std::string> batch;
      {
        std::lock_guard<std::mutex> g(lsp::mx);
        batch.swap(lsp::inbox);
      }
      for (auto& b : batch) handle(b);
      return 0;
    }
    case WM_LSP_DIED:
      logLine("! the tool exited");
      // The old server's read end goes first: start() below makes a new one, and closing that instead would kill
      // the new server's reader at once (and every restart after it).
      if (lsp::outRead) CloseHandle(lsp::outRead), lsp::outRead = nullptr;
      if (lsp::running) {
        CloseHandle(lsp::proc);
        CloseHandle(lsp::inWrite);
        lsp::running = lsp::ready = false;
        lsp::pending.clear();
        lsp::queued.clear();
        for (auto& [b, d] : docs) d.open = false;
        if (lsp::restarts++ < 3 && currentDoc()) lsp::start();  // crashed: start again, a few times at most
        else status(L"Nucleus: the handler tools stopped");
      }
      return 0;
    case WM_DOWNLOADED: {
      auto* err = (std::wstring*)l;
      downloading = false;
      if (err->empty()) {
        status(L"Nucleus: handler tools installed");
        if (currentDoc()) lsp::start();
      } else
        MessageBoxW(npp._nppHandle, (L"Couldn't download the handler tools: " + *err + L"\n\nDownload ncdev.exe from https://github.com/Snailedlt/splitscreenme-vscode/releases and run: ncdev setup notepad++").c_str(), PLUGIN_NAME, MB_OK | MB_ICONWARNING);
      delete err;
      return 0;
    }
    case WM_UPDATE_INFO: {
      auto* text = (std::wstring*)l;
      HMENU menu = (HMENU)SendMessage(npp._nppHandle, NPPM_GETMENUHANDLE, NPPPLUGINMENU, 0);
      ModifyMenuW(menu, funcs[UPDATE_INDEX]._cmdID, MF_BYCOMMAND | MF_STRING, funcs[UPDATE_INDEX]._cmdID, text->c_str());
      delete text;
      return 0;
    }
    case WM_TOOL_DONE: {
      auto* p = (std::shared_ptr<ToolJob>*)l;
      std::shared_ptr<ToolJob> job = *p;
      delete p;
      auto it = toolJobs.find(job->what);
      if (it != toolJobs.end() && it->second == job) toolJobs.erase(it);
      if (toolJobs.empty()) KillTimer(hw, TOOL_TIMER);
      if (!job->res.cancelled && job->done) job->done(job->res);
      else if (toolJobs.empty()) status(L"");  // stopped: nothing is running any more
      // Whatever the command says about it, the status bar says plainly that it hung and was stopped.
      if (job->res.timedOut) status(L"Nucleus: stopped after " + std::to_wstring(job->timeoutMs / 1000) + L" s (" + job->what + L" hung). Try again in a moment.");
      return 0;
    }
    case WM_TIMER:
      KillTimer(hw, w);
      if (w == TOOL_TIMER) {
        // What is still running, with the seconds, so a slow download doesn't look like nothing happens.
        if (toolJobs.empty()) return 0;
        auto& job = toolJobs.begin()->second;
        status(L"Nucleus: " + job->what + L"… " + std::to_wstring((GetTickCount64() - job->startedAt) / 1000) + L" s");
        SetTimer(hw, TOOL_TIMER, 1000, nullptr);
        return 0;
      }
      flushChange();
      return 0;
  }
  return DefWindowProcW(hw, m, w, l);
}

/** Once a day at most (the tool remembers): is there a newer version? Shown in the menu, nowhere else. */
static void checkForUpdate() {
  if (findTool().empty()) return;
  std::thread([] {
    DWORD code = 0;
    std::string out = runTool(L"update --check --quiet", &code, 30000);
    while (!out.empty() && (out.back() == '\n' || out.back() == '\r')) out.pop_back();
    if (code == 10 && !out.empty()) PostMessage(msgWnd, WM_UPDATE_INFO, 0, (LPARAM) new std::wstring(L"Update available: " + wide(out)));
  }).detach();
}

// ---------------------------------------------------------------------------------------------------------------
// The plugin's exports

extern "C" __declspec(dllexport) void setInfo(NppData data) {
  npp = data;
  WNDCLASSW wc{};
  wc.lpfnWndProc = msgProc;
  wc.hInstance = hModule;
  wc.lpszClassName = L"NcDevMessages";
  RegisterClassW(&wc);
  msgWnd = CreateWindowExW(0, L"NcDevMessages", L"", 0, 0, 0, 0, 0, HWND_MESSAGE, nullptr, hModule, nullptr);
}
extern "C" __declspec(dllexport) const wchar_t* getName() { return PLUGIN_NAME; }
extern "C" __declspec(dllexport) FuncItem* getFuncsArray(int* n) {
  *n = sizeof funcs / sizeof funcs[0];
  return funcs;
}
extern "C" __declspec(dllexport) BOOL isUnicode() { return TRUE; }
extern "C" __declspec(dllexport) LRESULT messageProc(UINT, WPARAM, LPARAM) { return TRUE; }

extern "C" __declspec(dllexport) void beNotified(SCNotification* n) {
  HWND from = (HWND)n->nmhdr.hwndFrom;
  switch (n->nmhdr.code) {
    case NPPN_READY:
      panelCmd = funcs[PANEL_INDEX]._cmdID;
      outCmd = funcs[OUTLINE_INDEX]._cmdID;
      setupIndicators();
      if (currentDoc()) lsp::start();
      checkForUpdate();
      return;
    case NPPN_SHUTDOWN:
      lsp::stop();
      // Stop running tools, and let their threads finish before the plugin is unloaded.
      for (auto& [what, job] : toolJobs) job->cancel = true;
      for (int i = 0; i < 60 && toolThreads > 0; i++) Sleep(50);
      return;
    case NPPN_BUFFERACTIVATED:
      if (currentDoc()) {
        if (!lsp::running) lsp::start();
        else lsp::openCurrent();
      } else applyDiagnostics();
      refreshOutline();
      return;
    case NPPN_FILEBEFORECLOSE:
      closeBuffer(n->nmhdr.idFrom);
      return;
    case NPPN_FILERENAMED:
    case NPPN_FILESAVED: {
      // Saved under a new name (Save As): the old document goes, the new one comes.
      auto it = docs.find(n->nmhdr.idFrom);
      if (it != docs.end() && it->second.path != pathOfBuffer(n->nmhdr.idFrom)) closeBuffer(n->nmhdr.idFrom);
      if (n->nmhdr.idFrom == curBuffer() && currentDoc()) {
        if (!lsp::running) lsp::start();
        else lsp::openCurrent();
      }
      return;
    }
    case NPPN_DARKMODECHANGED:
      themePanel();
      return;
  }
  if (from != curSci()) return;
  switch (n->nmhdr.code) {
    case SCN_MODIFIED:
      if ((n->modificationType & (SC_MOD_INSERTTEXT | SC_MOD_DELETETEXT))) {
        Doc* d = currentDoc();
        if (d && d->open) {
          d->dirty = true;
          SetTimer(msgWnd, 1, 300, nullptr);
        }
        // A hover describes the text as it was (a quick fix just changed it).
        if (tip == TIP_HOVER) sci(from, SCI_CALLTIPCANCEL), tip = TIP_NONE;
      }
      return;
    case SCN_UPDATEUI: {
      // A reload from disk (the file changed in another program) fills the document through another Scintilla, so no
      // SCN_MODIFIED reaches this one. Compare the text with what the server has (cheap: handlers are small).
      Doc* d = currentDoc();
      if ((n->updated & SC_UPDATE_CONTENT) && d && d->open && !d->dirty && textHash(from) != d->sent) {
        d->dirty = true;
        SetTimer(msgWnd, 1, 300, nullptr);
      }
      return;
    }
    case SCN_CHARADDED: {
      if (!currentDoc() || !lsp::ready) return;
      int c = n->ch;
      if (c == '(' || c == ',') signatureHelp(from);
      if (c == ')' && tip == TIP_SIGNATURE) sci(from, SCI_CALLTIPCANCEL), tip = TIP_NONE;
      if (c == '.' || c == '=' || c == '"' || c == '\'' || c == '[' || c == ',' || isWord(c)) complete(from, false);
      else if (c == ' ') {
        sptr_t p = sci(from, SCI_GETCURRENTPOS) - 2;
        while (p > 0 && sci(from, SCI_GETCHARAT, p) == ' ') p--;
        int prev = (int)sci(from, SCI_GETCHARAT, p);
        if (prev == '=' || prev == ',') complete(from, false);
      }
      return;
    }
    case SCN_AUTOCSELECTION:
      if (currentDoc()) onSelected(from, n->text);
      return;
    case SCN_AUTOCSELECTIONCHANGE:
      if (currentDoc()) onItemHighlighted(from, n->text);
      return;
    case SCN_AUTOCCANCELLED:
      ourList = false;
      return;
    case SCN_DWELLSTART:
      if (n->position >= 0 && currentDoc() && !sci(from, SCI_AUTOCACTIVE) && !(tip == TIP_SIGNATURE && sci(from, SCI_CALLTIPACTIVE))) hoverAt(from, n->position, true);
      return;
    case SCN_DWELLEND:
      if (tip == TIP_HOVER) sci(from, SCI_CALLTIPCANCEL), tip = TIP_NONE;
      return;
  }
}

BOOL APIENTRY DllMain(HINSTANCE h, DWORD reason, LPVOID) {
  if (reason == DLL_PROCESS_ATTACH) {
    hModule = h;
    INITCOMMONCONTROLSEX icc{sizeof icc, ICC_LISTVIEW_CLASSES};
    InitCommonControlsEx(&icc);
  }
  return TRUE;
}
