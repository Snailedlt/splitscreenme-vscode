---
type: llm
---

PASS if the answer says Nucleus and Proto Input support at most four controllers per instance (only ProtoController1 to ProtoController4 exist), so ProtoController5 and higher do nothing.
FAIL if it tells the user to set ProtoController5 or higher, or presents them as working options.
