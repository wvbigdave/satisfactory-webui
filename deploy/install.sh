#!/bin/sh
# Portable installer; run --help or --dry-run before installing.
set -eu
exec python3 "$(dirname "$0")/install.py" "$@"
