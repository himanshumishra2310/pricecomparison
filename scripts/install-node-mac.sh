#!/bin/bash
# Installs Node.js 22 into ~/.local/node without Homebrew and without an admin password.
# Downloads the official build from nodejs.org. Safe to run again.
set -eu
BASE="https://nodejs.org/dist/latest-v22.x"
case "$(uname -m)" in
  arm64) ARCH="arm64" ;;
  x86_64) ARCH="x64" ;;
  *) echo "Unsupported Mac type: $(uname -m)"; exit 1 ;;
esac
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# The file name contains the exact version, so read it from the official checksum list.
curl -fsSL "$BASE/SHASUMS256.txt" -o "$TMP/sums.txt"
LINE="$(grep "node-v[0-9.]*-darwin-$ARCH.tar.gz$" "$TMP/sums.txt" | head -1)"
[ -n "$LINE" ] || { echo "Could not find a Node download for this Mac"; exit 1; }
SUM="${LINE%% *}"
FILE="${LINE##* }"

echo "  Downloading $FILE ..."
curl -fsSL "$BASE/$FILE" -o "$TMP/$FILE"
echo "$SUM  $TMP/$FILE" | shasum -a 256 -c - >/dev/null || { echo "Download is corrupted, try again"; exit 1; }

DEST="$HOME/.local/node"
rm -rf "$DEST"
mkdir -p "$HOME/.local"
tar -xzf "$TMP/$FILE" -C "$TMP"
mv "$TMP/${FILE%.tar.gz}" "$DEST"
echo "  Node installed in $DEST"
