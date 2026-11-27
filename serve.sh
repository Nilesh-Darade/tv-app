#!/bin/sh

CDPATH='' cd "$(dirname "$0")" || exit 1

IP=$(ipconfig getifaddr en0 2>/dev/null)
if [ -z "$IP" ]; then
    IP=$(ipconfig getifaddr en1 2>/dev/null)
fi

if [ -n "$IP" ]; then
    printf 'Mac LAN IP: %s\n' "$IP"
    printf 'TV URL: http://%s:8080\n' "$IP"
else
    printf '%s\n' "Could not find the Mac LAN IP. In System Settings, open Network and check the active connection's details. On the TV, enter http://<Mac LAN IP>:8080."
fi

printf '%s\n' 'macOS may ask to allow incoming connections for Python. Click Allow.'

exec python3 -m http.server 8080 --bind 0.0.0.0
