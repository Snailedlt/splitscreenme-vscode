#!/bin/sh
# Builds the Notepad++ plugin with MinGW: dist-sea/NcDev.dll (64-bit Notepad++) and dist-sea/NcDev-x86.dll (32-bit).
#   apt-get install g++-mingw-w64-x86-64-posix g++-mingw-w64-i686-posix
set -e
cd "$(dirname "$0")"
mkdir -p ../dist-sea
build() {
  "$1" -std=c++17 -O2 -s -shared -static -municode -Wall -Wno-unused-function \
    -o "../dist-sea/$2" src/NcDev.cpp -lcomctl32 -lole32 -luuid -lurlmon -lbcrypt -lshell32
  echo "dist-sea/$2 ($(wc -c < "../dist-sea/$2") bytes)"
}
build x86_64-w64-mingw32-g++-posix NcDev.dll
if command -v i686-w64-mingw32-g++-posix >/dev/null; then build i686-w64-mingw32-g++-posix NcDev-x86.dll
else echo "No 32-bit MinGW (g++-mingw-w64-i686-posix): skipping NcDev-x86.dll"; fi
