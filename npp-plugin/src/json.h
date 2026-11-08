// A small JSON value, parser and writer for the plugin's LSP messages (UTF-8 strings). No dependencies.
#pragma once
#include <map>
#include <memory>
#include <string>
#include <vector>
#include <cstdlib>
#include <cstdio>
#include <cstring>

namespace json {

struct Value;
using Object = std::map<std::string, Value>;
using Array = std::vector<Value>;

struct Value {
  enum Type { Null, Bool, Number, String, Arr, Obj } type = Null;
  bool b = false;
  double n = 0;
  std::string s;
  std::shared_ptr<Array> a;
  std::shared_ptr<Object> o;

  Value() {}
  Value(std::nullptr_t) {}
  Value(bool v) : type(Bool), b(v) {}
  Value(int v) : type(Number), n(v) {}
  Value(long long v) : type(Number), n((double)v) {}
  Value(double v) : type(Number), n(v) {}
  Value(const char* v) : type(String), s(v) {}
  Value(const std::string& v) : type(String), s(v) {}
  Value(const Array& v) : type(Arr), a(std::make_shared<Array>(v)) {}
  Value(const Object& v) : type(Obj), o(std::make_shared<Object>(v)) {}

  bool isNull() const { return type == Null; }
  bool isObj() const { return type == Obj; }
  bool isArr() const { return type == Arr; }
  bool isStr() const { return type == String; }
  bool isNum() const { return type == Number; }

  /** Member of an object, or a null value. */
  const Value& operator[](const std::string& k) const {
    static const Value none;
    if (type != Obj) return none;
    auto it = o->find(k);
    return it == o->end() ? none : it->second;
  }
  const Value& operator[](size_t i) const {
    static const Value none;
    return type == Arr && i < a->size() ? (*a)[i] : none;
  }
  size_t size() const { return type == Arr ? a->size() : type == Obj ? o->size() : 0; }
  const Array& arr() const {
    static const Array none;
    return type == Arr ? *a : none;
  }
  std::string str(const std::string& d = "") const { return type == String ? s : d; }
  int num(int d = 0) const { return type == Number ? (int)n : d; }
  bool boolean(bool d = false) const { return type == Bool ? b : d; }
};

inline void writeString(std::string& out, const std::string& s) {
  out += '"';
  for (unsigned char c : s) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          snprintf(buf, sizeof buf, "\\u%04x", c);
          out += buf;
        } else out += (char)c;
    }
  }
  out += '"';
}

inline void write(std::string& out, const Value& v) {
  switch (v.type) {
    case Value::Null: out += "null"; break;
    case Value::Bool: out += v.b ? "true" : "false"; break;
    case Value::Number: {
      char buf[32];
      if (v.n == (long long)v.n) snprintf(buf, sizeof buf, "%lld", (long long)v.n);
      else snprintf(buf, sizeof buf, "%.17g", v.n);
      out += buf;
      break;
    }
    case Value::String: writeString(out, v.s); break;
    case Value::Arr: {
      out += '[';
      bool first = true;
      for (auto& x : *v.a) {
        if (!first) out += ',';
        first = false;
        write(out, x);
      }
      out += ']';
      break;
    }
    case Value::Obj: {
      out += '{';
      bool first = true;
      for (auto& kv : *v.o) {
        if (!first) out += ',';
        first = false;
        writeString(out, kv.first);
        out += ':';
        write(out, kv.second);
      }
      out += '}';
      break;
    }
  }
}
inline std::string stringify(const Value& v) {
  std::string out;
  write(out, v);
  return out;
}

class Parser {
 public:
  explicit Parser(const std::string& t) : s(t) {}
  bool parse(Value& out) {
    ws();
    if (!value(out)) return false;
    ws();
    return i == s.size();
  }

 private:
  const std::string& s;
  size_t i = 0;
  void ws() {
    while (i < s.size() && (s[i] == ' ' || s[i] == '\n' || s[i] == '\r' || s[i] == '\t')) i++;
  }
  bool lit(const char* w) {
    size_t n = strlen(w);
    if (s.compare(i, n, w) != 0) return false;
    i += n;
    return true;
  }
  static void utf8(std::string& o, unsigned cp) {
    if (cp < 0x80) o += (char)cp;
    else if (cp < 0x800) { o += (char)(0xC0 | (cp >> 6)); o += (char)(0x80 | (cp & 0x3F)); }
    else if (cp < 0x10000) { o += (char)(0xE0 | (cp >> 12)); o += (char)(0x80 | ((cp >> 6) & 0x3F)); o += (char)(0x80 | (cp & 0x3F)); }
    else { o += (char)(0xF0 | (cp >> 18)); o += (char)(0x80 | ((cp >> 12) & 0x3F)); o += (char)(0x80 | ((cp >> 6) & 0x3F)); o += (char)(0x80 | (cp & 0x3F)); }
  }
  bool hex4(unsigned& v) {
    if (i + 4 > s.size()) return false;
    v = (unsigned)strtoul(s.substr(i, 4).c_str(), nullptr, 16);
    i += 4;
    return true;
  }
  bool string(std::string& o) {
    if (s[i] != '"') return false;
    i++;
    while (i < s.size()) {
      char c = s[i++];
      if (c == '"') return true;
      if (c != '\\') { o += c; continue; }
      if (i >= s.size()) return false;
      char e = s[i++];
      switch (e) {
        case 'n': o += '\n'; break;
        case 'r': o += '\r'; break;
        case 't': o += '\t'; break;
        case 'b': o += '\b'; break;
        case 'f': o += '\f'; break;
        case 'u': {
          unsigned cp;
          if (!hex4(cp)) return false;
          if (cp >= 0xD800 && cp < 0xDC00 && i + 6 <= s.size() && s[i] == '\\' && s[i + 1] == 'u') {
            i += 2;
            unsigned lo;
            if (!hex4(lo)) return false;
            cp = 0x10000 + ((cp - 0xD800) << 10) + (lo - 0xDC00);
          }
          utf8(o, cp);
          break;
        }
        default: o += e;
      }
    }
    return false;
  }
  bool value(Value& v) {
    if (i >= s.size()) return false;
    char c = s[i];
    if (c == '{') {
      i++;
      Object obj;
      ws();
      if (i < s.size() && s[i] == '}') { i++; v = Value(obj); return true; }
      for (;;) {
        ws();
        std::string k;
        if (!string(k)) return false;
        ws();
        if (i >= s.size() || s[i++] != ':') return false;
        ws();
        Value x;
        if (!value(x)) return false;
        obj[k] = x;
        ws();
        if (i < s.size() && s[i] == ',') { i++; continue; }
        if (i < s.size() && s[i] == '}') { i++; break; }
        return false;
      }
      v = Value(obj);
      return true;
    }
    if (c == '[') {
      i++;
      Array arr;
      ws();
      if (i < s.size() && s[i] == ']') { i++; v = Value(arr); return true; }
      for (;;) {
        ws();
        Value x;
        if (!value(x)) return false;
        arr.push_back(x);
        ws();
        if (i < s.size() && s[i] == ',') { i++; continue; }
        if (i < s.size() && s[i] == ']') { i++; break; }
        return false;
      }
      v = Value(arr);
      return true;
    }
    if (c == '"') {
      std::string str;
      if (!string(str)) return false;
      v = Value(str);
      return true;
    }
    if (lit("true")) { v = Value(true); return true; }
    if (lit("false")) { v = Value(false); return true; }
    if (lit("null")) { v = Value(); return true; }
    char* end = nullptr;
    double d = strtod(s.c_str() + i, &end);
    if (end == s.c_str() + i) return false;
    i = end - s.c_str();
    v = Value(d);
    return true;
  }
};

inline bool parse(const std::string& text, Value& out) { return Parser(text).parse(out); }

}  // namespace json
