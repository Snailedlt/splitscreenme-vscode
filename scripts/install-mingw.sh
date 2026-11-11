#!/bin/sh
# MinGW for the Notepad++ plugin (npp-plugin/build.sh) on a GitHub Ubuntu runner, plus any extra packages named.
# The runners sometimes can't resolve security.ubuntu.com (the -security pocket): the same packages are on the
# runner's regular mirror, so apt uses that, with short timeouts and retries instead of hanging for ten minutes.
set -e
for f in /etc/apt/sources.list /etc/apt/sources.list.d/*.sources /etc/apt/sources.list.d/*.list; do
  [ -f "$f" ] && sudo sed -i -E 's#https?://security\.ubuntu\.com/ubuntu#http://azure.archive.ubuntu.com/ubuntu#g' "$f"
done
opts="-o Acquire::Retries=3 -o Acquire::http::Timeout=30 -o Acquire::https::Timeout=30"
pkgs="g++-mingw-w64-x86-64-posix g++-mingw-w64-i686-posix $*"
try() { sudo apt-get $opts update -qq && sudo apt-get $opts install -y -qq $pkgs >/dev/null; }
try || { echo "apt failed; trying once more in 20 s"; sleep 20; try; }
