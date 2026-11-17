#!/usr/bin/env bash
set -euo pipefail
# Official release, pinned version and archive checksum. Ubuntu x64 CI only.
version=8.30.1
checksum=551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb
scanner_tmp=$(mktemp -d)
trap 'rm -rf "$scanner_tmp"' EXIT
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  "https://github.com/gitleaks/gitleaks/releases/download/v${version}/gitleaks_${version}_linux_x64.tar.gz" \
  --output "$scanner_tmp/gitleaks.tar.gz"
printf '%s  %s\n' "$checksum" "$scanner_tmp/gitleaks.tar.gz" | sha256sum --check --status
tar -xzf "$scanner_tmp/gitleaks.tar.gz" -C "$scanner_tmp" gitleaks
mkdir -p "$HOME/.local/bin"
install -m 0755 "$scanner_tmp/gitleaks" "$HOME/.local/bin/gitleaks"
printf '%s\n' "$HOME/.local/bin" >> "$GITHUB_PATH"
