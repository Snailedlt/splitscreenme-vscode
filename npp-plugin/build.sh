#!/bin/sh
# Builds NcDev.dll (the Notepad++ plugin, x64) with MinGW: apt-get install g++-mingw-w64-x86-64-posix
set -e
cd "$(dirname "$0")"
mkdir -p ../dist-sea
x86_64-w64-mingw32-g++-posix -std=c++17 -O2 -s -shared -static -municode -Wall -Wno-unused-function \
  -o ../dist-sea/NcDev.dll src/NcDev.cpp \
  -lcomctl32 -lole32 -luuid -lurlmon -lbcrypt -lshell32
echo "dist-sea/NcDev.dll ($(wc -c < ../dist-sea/NcDev.dll) bytes)"
