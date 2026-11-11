#!/bin/sh
# The native parts, in Node's Debian container: the Notepad++ plugin (npp-plugin/build.sh, MinGW) and the standalone
# ncdev for the given scripts/sea.mjs targets (default win-x64,linux-x64; the Windows one needs osslsigncode).
# A container with Debian's packages, so a GitHub runner's Ubuntu mirrors (security.ubuntu.com has stopped
# resolving there before) can't hold a build up. Run after npm ci and npm run build; output in dist-sea/.
#   sh scripts/build-native.sh [targets]
set -e
TARGETS="${1:-win-x64,linux-x64}"
docker run --rm -v "$PWD:/w" -w /w -e HOME=/tmp/home node:22-bookworm sh -ec "
  apt-get -o Acquire::Retries=3 update -qq
  apt-get -o Acquire::Retries=3 install -y -qq --no-install-recommends g++-mingw-w64-x86-64-posix g++-mingw-w64-i686-posix osslsigncode >/dev/null
  sh npp-plugin/build.sh
  node scripts/sea.mjs --require-plugin --targets $TARGETS
  chown -R $(id -u):$(id -g) dist-sea .sea-cache 2>/dev/null || true"
