#!/bin/sh
set -e

# Update desktop application database
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database /usr/share/applications/ 2>/dev/null || true
fi

# Update icon cache
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t /usr/share/icons/hicolor/ 2>/dev/null || true
fi

# Register MIME types for .pmx / .vmd / .mmascene
if command -v update-mime-database >/dev/null 2>&1; then
    update-mime-database /usr/share/mime/ 2>/dev/null || true
fi

# Set as default handler for PMX files if no other handler is registered
if command -v xdg-mime >/dev/null 2>&1; then
    xdg-mime default mikumikuar.desktop application/x-pmx 2>/dev/null || true
    xdg-mime default mikumikuar.desktop application/x-vmd 2>/dev/null || true
fi
