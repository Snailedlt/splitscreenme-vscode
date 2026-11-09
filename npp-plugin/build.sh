#!/bin/sh
# Builds the Notepad++ plugin with MinGW: dist-sea/NcDev.dll (64-bit Notepad++) and dist-sea/NcDev-x86.dll (32-bit).
#   apt-get install g++-mingw-w64-x86-64-posix g++-mingw-w64-i686-posix
# Each DLL carries a version resource (FileVersion = package.json's version as a.b.c.0): Notepad++'s Plugins Admin
# list checks it against the version in its entry (scripts/npp-plugin-list.mjs).
set -e
cd "$(dirname "$0")"
mkdir -p ../dist-sea
VERSION=$(node -p "require('../package.json').version")
# 0.6.0 -> 0,6,0,0 and "0.6.0.0" (a pre-release suffix such as -beta.1 is dropped: Windows versions are numbers)
NUMS=$(echo "$VERSION" | sed 's/[-+].*//' | awk -F. '{printf "%d,%d,%d,0", $1, $2, $3}')
DOTTED=$(echo "$NUMS" | tr , .)
cat > ../dist-sea/NcDev.rc <<RC
1 VERSIONINFO
FILEVERSION $NUMS
PRODUCTVERSION $NUMS
FILEOS 0x40004
FILETYPE 0x2
BEGIN
  BLOCK "StringFileInfo"
  BEGIN
    BLOCK "040904B0"
    BEGIN
      VALUE "CompanyName", "SplitScreen.Me"
      VALUE "FileDescription", "Nucleus Co-op handlers for Notepad++"
      VALUE "FileVersion", "$DOTTED"
      VALUE "InternalName", "NcDev"
      VALUE "LegalCopyright", "MIT License"
      VALUE "OriginalFilename", "NcDev.dll"
      VALUE "ProductName", "Nucleus Co-op handlers"
      VALUE "ProductVersion", "$DOTTED"
    END
  END
  BLOCK "VarFileInfo"
  BEGIN
    VALUE "Translation", 0x409, 1200
  END
END
RC
build() {
  "$3" -i ../dist-sea/NcDev.rc -O coff -o "../dist-sea/$2.res.o"
  "$1" -std=c++17 -O2 -s -shared -static -municode -Wall -Wno-unused-function \
    -o "../dist-sea/$2" src/NcDev.cpp "../dist-sea/$2.res.o" -lcomctl32 -lole32 -luuid -lurlmon -lbcrypt -lshell32
  rm -f "../dist-sea/$2.res.o"
  echo "dist-sea/$2 ($(wc -c < "../dist-sea/$2") bytes, version $DOTTED)"
}
build x86_64-w64-mingw32-g++-posix NcDev.dll x86_64-w64-mingw32-windres
if command -v i686-w64-mingw32-g++-posix >/dev/null; then build i686-w64-mingw32-g++-posix NcDev-x86.dll i686-w64-mingw32-windres
else echo "No 32-bit MinGW (g++-mingw-w64-i686-posix): skipping NcDev-x86.dll"; fi
rm -f ../dist-sea/NcDev.rc
