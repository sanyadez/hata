#!/bin/sh
# Hata installer.
#
#   curl -fsSL https://raw.githubusercontent.com/sanyadez/hata/main/install.sh | sudo sh
#
# Moving in from CasaOS (takes its apps over where they are, then stops CasaOS):
#
#   curl -fsSL https://raw.githubusercontent.com/sanyadez/hata/main/install.sh | sudo sh -s -- --migrate-casaos
#
# What it does: downloads the `hata` binary for this machine from the GitHub release and checks it
# against the release's SHA256SUMS, installs Docker when it is missing (with Docker's own script from
# get.docker.com) and Samba for sharing folders over the network (the system's own package), and runs `hata install`, which copies the binary to /usr/local/bin and starts the
# `hata` systemd service. Running it again updates Hata to the latest release.
#
# Options:
#   --migrate-casaos   take over the apps of a CasaOS install on this machine
#   --port <number>    port of the web UI (default: 80, or the next free one if 80 is taken)
#   --no-docker        do not install Docker
#   --no-samba         do not install Samba (folders can then not be shared over the network)
#   --version <tag>    install this release instead of the latest (also: HATA_VERSION)
#
# HATA_DOWNLOAD_URL overrides where the files are taken from (a directory URL holding
# hata-linux-<arch> and SHA256SUMS) — for mirrors and for testing.

set -eu

REPO="sanyadez/hata"
VERSION="${HATA_VERSION:-latest}"
MIGRATE_CASAOS=0
INSTALL_DOCKER=1
INSTALL_SAMBA=1
PORT=""

say() { printf '%s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }
die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --migrate-casaos) MIGRATE_CASAOS=1 ;;
    --no-docker) INSTALL_DOCKER=0 ;;
    --no-samba) INSTALL_SAMBA=0 ;;
    --port)
      [ $# -ge 2 ] || die "--port needs a number"
      PORT="$2"
      shift
      ;;
    --version)
      [ $# -ge 2 ] || die "--version needs a release tag"
      VERSION="$2"
      shift
      ;;
    -h | --help)
      sed -n '2,25p' "$0" 2>/dev/null | sed 's/^# \{0,1\}//' || true
      exit 0
      ;;
    *) die "unknown option: $1" ;;
  esac
  shift
done

# --- What machine is this -------------------------------------------------------------------------

[ "$(uname -s)" = "Linux" ] || die "Hata runs on Linux; this is $(uname -s)."
[ "$(id -u)" -eq 0 ] || die "this needs root: put sudo before sh."
command -v systemctl >/dev/null 2>&1 || die "systemd was not found; Hata is installed as a systemd service."

case "$(uname -m)" in
  x86_64 | amd64) ARCH="x64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  armv7l | armv6l | armhf) die "32-bit ARM is not supported: Hata needs a 64-bit system (x86_64 or arm64). On a Raspberry Pi 3 or newer, install the 64-bit Raspberry Pi OS." ;;
  *) die "unsupported processor: $(uname -m). Hata is built for x86_64 and arm64." ;;
esac

# the binary is linked against glibc
if ldd --version 2>&1 | grep -qi musl; then
  die "this system uses musl (Alpine); there is no Hata build for it yet."
fi

if command -v curl >/dev/null 2>&1; then
  fetch() { curl -fsSL --retry 3 -o "$2" "$1"; }
elif command -v wget >/dev/null 2>&1; then
  fetch() { wget -q -O "$2" "$1"; }
else
  die "curl or wget is needed to download Hata."
fi
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is needed to check the download."

# --- Download and verify --------------------------------------------------------------------------

if [ -n "${HATA_DOWNLOAD_URL:-}" ]; then
  BASE="${HATA_DOWNLOAD_URL%/}"
elif [ "$VERSION" = "latest" ]; then
  BASE="https://github.com/$REPO/releases/latest/download"
else
  BASE="https://github.com/$REPO/releases/download/$VERSION"
fi

FILE="hata-linux-$ARCH"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT INT TERM

step "Downloading Hata ($FILE)"
fetch "$BASE/$FILE" "$TMP/$FILE" || die "could not download $BASE/$FILE"
fetch "$BASE/SHA256SUMS" "$TMP/SHA256SUMS" || die "could not download $BASE/SHA256SUMS"

EXPECTED="$(awk -v f="$FILE" '$2 == f || $2 == "*" f { print $1 }' "$TMP/SHA256SUMS")"
[ -n "$EXPECTED" ] || die "SHA256SUMS has no entry for $FILE."
ACTUAL="$(sha256sum "$TMP/$FILE" | awk '{ print $1 }')"
[ "$EXPECTED" = "$ACTUAL" ] || die "the download is damaged or was tampered with: checksum of $FILE does not match."

chmod +x "$TMP/$FILE"
say "Hata $("$TMP/$FILE" version), checksum OK."

# --- Docker ---------------------------------------------------------------------------------------

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  say "Docker $(docker version --format '{{.Server.Version}}' 2>/dev/null || echo '?') with compose is already installed."
elif [ "$INSTALL_DOCKER" -eq 1 ]; then
  step "Installing Docker (get.docker.com)"
  fetch "https://get.docker.com" "$TMP/get-docker.sh" || die "could not download the Docker installer."
  sh "$TMP/get-docker.sh" || die "the Docker installer failed. Install Docker Engine with the compose plugin yourself and run this again with --no-docker."
  systemctl enable --now docker >/dev/null 2>&1 || true
else
  say "Docker is missing and --no-docker was given: Hata will start, but apps need Docker Engine with the compose plugin."
fi

# --- Samba ----------------------------------------------------------------------------------------
# Folders shared over the network are served by Samba, which Hata then sets up itself. Hata works
# without it, so a failure here is not the end of the installation.

if command -v smbd >/dev/null 2>&1 || [ -x /usr/sbin/smbd ]; then
  say "Samba is already installed."
elif [ "$INSTALL_SAMBA" -eq 1 ]; then
  step "Installing Samba"
  if command -v apt-get >/dev/null 2>&1; then
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends samba >/dev/null 2>&1 ||
      { apt-get update >/dev/null 2>&1 && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends samba >/dev/null 2>&1; } || SAMBA_FAILED=1
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y samba >/dev/null 2>&1 || SAMBA_FAILED=1
  elif command -v yum >/dev/null 2>&1; then
    yum install -y samba >/dev/null 2>&1 || SAMBA_FAILED=1
  elif command -v zypper >/dev/null 2>&1; then
    zypper --non-interactive install samba >/dev/null 2>&1 || SAMBA_FAILED=1
  elif command -v pacman >/dev/null 2>&1; then
    pacman -S --noconfirm --needed samba >/dev/null 2>&1 || SAMBA_FAILED=1
  else
    SAMBA_FAILED=1
  fi
  if [ "${SAMBA_FAILED:-0}" -eq 1 ]; then
    say "Samba could not be installed. Hata works without it; sharing folders over the network can be set up later in Settings → Network folders."
  else
    say "Samba is installed."
  fi
fi

# --- Move in from CasaOS --------------------------------------------------------------------------

if [ "$MIGRATE_CASAOS" -eq 1 ]; then
  step "Moving in from CasaOS"
  HATA_INSTALLER=1 "$TMP/$FILE" migrate casaos --yes || die "the move from CasaOS failed; nothing of CasaOS was removed. See the messages above."
elif [ -d /var/lib/casaos/apps ] && [ ! -f "$(cat /etc/hata/state-dir 2>/dev/null || echo /var/lib/hata)/migrations/casaos.json" ]; then
  say ""
  say "CasaOS is installed on this machine. To take its apps over, run:  sudo hata migrate casaos"
fi

# --- Install the service --------------------------------------------------------------------------

step "Installing the service"
if [ -n "$PORT" ]; then
  "$TMP/$FILE" install --port "$PORT"
else
  "$TMP/$FILE" install
fi
