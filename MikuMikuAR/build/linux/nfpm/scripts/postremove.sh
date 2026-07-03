#!/bin/sh
set -e

# Rebuild desktop database after removal
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications/ 2>/dev/null || true
fi

# Rebuild icon cache
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor/ 2>/dev/null || true
fi

# Rebuild MIME database
if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime/ 2>/dev/null || true
fi
