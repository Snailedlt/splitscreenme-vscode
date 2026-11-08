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
#include <shlobj.h>
#include <shobjidl.h>
#include <urlmon.h>
#include <bcrypt.h>

#include <algorithm>
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
#define NPPM_DMMREGASDCKDLG (NPPMSG + 33)
#define NPPM_SETMENUITEMCHECK (NPPMSG + 40)
#define NPPM_GETPLUGINSCONFIGDIR (NPPMSG + 46)
#define NPPM_MENUCOMMAND (NPPMSG + 48)
#define NPPM_GETFULLPATHFROMBUFFERID (NPPMSG + 58)
#define NPPM_GETCURRENTBUFFERID (NPPMSG + 60)
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
};
static std::map<UINT_PTR, Doc> docs;
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

/** Runs the tool with arguments and returns what it prints (stdout and stderr). */
static std::string runTool(const std::wstring& args, DWORD* exitCode = nullptr, DWORD timeoutMs = 120000) {
  std::wstring tool = findTool();
  if (tool.empty()) return "";
  SECURITY_ATTRIBUTES sa{sizeof sa, nullptr, TRUE};
  HANDLE rd, wr;
  if (!CreatePipe(&rd, &wr, &sa, 0)) return "";
  SetHandleInformation(rd, HANDLE_FLAG_INHERIT, 0);
  STARTUPINFOW si{sizeof si};
  si.dwFlags = STARTF_USESTDHANDLES;
  si.hStdOutput = wr;
  si.hStdError = wr;
  si.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
  PROCESS_INFORMATION pi{};
  std::wstring cmd = tool + L" " + args + (tool.rfind(L"cmd.exe", 0) == 0 ? L"\"" : L"");
  std::string out;
  if (CreateProcessW(nullptr, &cmd[0], nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi)) {
    CloseHandle(wr);
    wr = nullptr;
    char buf[4096];
    DWORD n;
    while (ReadFile(rd, buf, sizeof buf, &n, nullptr) && n) out.append(buf, n);
    WaitForSingleObject(pi.hProcess, timeoutMs);
    if (exitCode) GetExitCodeProcess(pi.hProcess, exitCode);
    CloseHandle(pi.hProcess);
    CloseHandle(pi.hThread);
  }
  if (wr) CloseHandle(wr);
  CloseHandle(rd);
  return out;
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
static HWND msgWnd;
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
static Value settings() { return Value(Object{{"nucleus", Value(Object{{"gameFolders", gameFolders()}, {"lint", Value(Object{{"workspace", false}})}})}}); }

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
  BOOL ok = CreateProcessW(nullptr, &cmd[0], nullptr, nullptr, TRUE, CREATE_NO_WINDOW, nullptr, nullptr, &si, &pi);
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
}

// The Problems panel (dockable, bottom): every problem in the current handler; double-click or Enter jumps to it.
static HWND panel, list;
static bool panelShown = false, panelRegistered = false;
static int panelCmd = 0;
static std::vector<Value> panelItems;

static void gotoProblem(int i) {
  if (i < 0 || i >= (int)panelItems.size()) return;
  HWND h = curSci();
  Range r = diagRange(h, panelItems[i]);
  sci(h, SCI_GOTOPOS, r.start);
  sci(h, SCI_SETSEL, r.start, r.end);
  SetFocus(h);
}
static void themePanel() {
  if (!list) return;
  DarkColors c{};
  if (SendMessage(npp._nppHandle, NPPM_ISDARKMODEENABLED, 0, 0) && SendMessage(npp._nppHandle, NPPM_GETDARKMODECOLORS, sizeof c, (LPARAM)&c)) {
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
  data.uMask = DWS_DF_CONT_BOTTOM;
  data.pszModuleName = L"NcDev.dll";
  SendMessage(npp._nppHandle, NPPM_DMMREGASDCKDLG, 0, (LPARAM)&data);
  panelRegistered = true;
  themePanel();
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
    lsp::notify("textDocument/didOpen", Value(Object{{"textDocument", Value(Object{{"uri", d->uri}, {"languageId", "javascript"}, {"version", d->version}, {"text", docText(curSci())}})}}));
  }
  applyDiagnostics();
}
static void flushChange() {
  Doc* d = currentDoc();
  if (!d || !d->open || !d->dirty) return;
  d->dirty = false;
  d->version++;
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
  for (auto& e : edits.arr()) list.push_back({{sciPos(h, e["range"]["start"]), sciPos(h, e["range"]["end"])}, e["newText"].str()});
  std::sort(list.begin(), list.end(), [](auto& a, auto& b) { return a.first.start > b.first.start; });
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
    for (size_t k = 0; k < l.size(); k++) {
      if (l[k] == '`' || (l[k] == '*' && k + 1 < l.size() && l[k + 1] == '*')) {
        if (l[k] == '*') k++;
        continue;
      }
      if (l[k] == '[') {  // [text](url) -> text
        size_t close = l.find("](", k);
        size_t end = close == std::string::npos ? close : l.find(')', close);
        if (end != std::string::npos) {
          t += l.substr(k + 1, close - k - 1);
          k = end;
          continue;
        }
      }
      if (l[k] == '\\' && k + 1 < l.size()) continue;
      t += l[k];
    }
    while (!t.empty() && t[0] == '#') t.erase(0, 1);
    // _italic_ and the ⓘ mark (not in every editor font)
    for (size_t k; (k = t.find("\xE2\x93\x98")) != std::string::npos;) t.erase(k, 3 + (k + 3 < t.size() && t[k + 3] == ' '));
    if (t.size() > 1 && t.find_first_not_of(' ') != std::string::npos && t[t.find_first_not_of(' ')] == '_' && t.back() == '_') {
      t.erase(t.find_first_not_of(' '), 1);
      t.pop_back();
    }
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
static int completionId = 0;
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
  int id = lsp::request("textDocument/completion", Value(Object{{"textDocument", docId(d)}, {"position", lspPos(h, pos)}}), [=](const Value& r) {
    if (completionId != lsp::nextId - 1 && false) return;
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
  completionId = id;
}

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
  sci(h, SCI_SETTARGETRANGE, start, end);
  sci(h, SCI_REPLACETARGET, item.text.size(), (sptr_t)item.text.c_str());
  sci(h, SCI_GOTOPOS, start + item.text.size());
}
/** The highlighted suggestion's type and first line of docs, in the status bar (a call tip would close the list). */
static void onItemHighlighted(HWND, const char* label) {
  auto it = std::find_if(items.begin(), items.end(), [&](const Item& i) { return i.label == label; });
  if (!ourList || it == items.end()) return;
  std::string doc = plain(it->doc, 1);
  size_t nl = doc.find('\n');
  if (nl != std::string::npos) doc = doc.substr(0, nl);
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
    const Value& doc = sig["documentation"];
    std::string ds = plain(doc.isStr() ? doc.str() : doc["value"].str(), 4);
    if (!ds.empty()) text += "\n" + ds;
    sptr_t caret = sci(h, SCI_GETCURRENTPOS);
    showTip(h, caret, text, TIP_SIGNATURE);
    int ap = r["activeParameter"].num(sig["activeParameter"].num(0));
    const Value& p = sig["parameters"][(size_t)ap];
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
  for (size_t i = 0; i < choices.size(); i++) AppendMenuW(m, choices[i].empty() ? MF_SEPARATOR : MF_STRING, i + 1, choices[i].c_str());
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
  sci(h, SCI_SETTEXT, 0, (sptr_t)text.c_str());
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
  IFileOpenDialog* dlg = nullptr;
  if (FAILED(CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dlg)))) return;
  DWORD opts;
  dlg->GetOptions(&opts);
  dlg->SetOptions(opts | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM);
  std::wstring title = L"The folder " + baseName(d->path) + L"'s game is installed in (where its .exe is, or above)";
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
  std::string md = runTool(L"api --markdown");
  if (!md.empty()) newTab(md);
}
static void cmdUpdate() {
  if (findTool().empty()) return lsp::start();
  status(L"Nucleus: checking for updates…");
  std::string out = runTool(L"update --from-notepad++");
  lsp::stop();  // the tool may have been replaced: start the new one
  lsp::restarts = 0;
  for (auto& [b, d] : docs) d.open = false;
  MessageBoxW(npp._nppHandle, wide(out.empty() ? "Couldn't run ncdev update." : out).c_str(), PLUGIN_NAME, MB_OK | MB_ICONINFORMATION);
  if (currentDoc()) lsp::start();
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
static FuncItem funcs[] = {
    {L"Quick fix on this line", cmdQuickFix, 0, false, &altEnter},
    {L"Fix all", cmdFixAll, 0, false, nullptr},
    {L"Show docs here", cmdDocs, 0, false, nullptr},
    {L"Suggest here", cmdSuggest, 0, false, nullptr},
    {L"Format handler", cmdFormat, 0, false, nullptr},
    {L"Try it (simulate)…", cmdTryIt, 0, false, nullptr},
    {L"Problems panel", cmdPanel, 0, false, nullptr},
    {L"", nullptr, 0, false, nullptr},
    {L"Link the game's folder…", cmdLinkFolder, 0, false, nullptr},
    {L"Unlink the game's folder", cmdUnlinkFolder, 0, false, nullptr},
    {L"", nullptr, 0, false, nullptr},
    {L"API reference", cmdReference, 0, false, nullptr},
    {L"Check for updates", cmdUpdate, 0, false, nullptr},
    {L"About", cmdAbout, 0, false, nullptr},
};
static const int PANEL_INDEX = 6, UPDATE_INDEX = 12;

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
      CloseHandle(lsp::outRead);
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
    case WM_TIMER:
      KillTimer(hw, w);
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
      setupIndicators();
      if (currentDoc()) lsp::start();
      checkForUpdate();
      return;
    case NPPN_SHUTDOWN:
      lsp::stop();
      return;
    case NPPN_BUFFERACTIVATED:
      if (currentDoc()) {
        if (!lsp::running) lsp::start();
        else lsp::openCurrent();
      } else applyDiagnostics();
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
      }
      return;
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
