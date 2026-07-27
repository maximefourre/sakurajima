#!/usr/bin/env python3
"""
Minimal dev server for the scene.

Exists for one reason: python -m http.server caches aggressively, and ES module
imports are static, so a page-level cache-buster does not reach them. Editing a
shader and reloading would silently keep running the old module — which is a
genuinely awful way to lose half an hour.

Everything here is served with Cache-Control: no-store.
"""
import sys
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 5173


class NoCacheHandler(SimpleHTTPRequestHandler):
    # SimpleHTTPRequestHandler serves .html/.js without a charset, which lets the
    # browser fall back to a legacy encoding and choke on any non-ASCII byte in
    # an inline module script. Be explicit.
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".json": "application/json; charset=utf-8",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, fmt, *args):
        # Only log failures; a render loop fetching modules is not interesting.
        if args and str(args[1]).startswith(("4", "5")):
            sys.stderr.write("%s - %s\n" % (self.address_string(), fmt % args))


if __name__ == "__main__":
    print(f"serving on http://127.0.0.1:{PORT}  (no-store)")
    ThreadingHTTPServer(("127.0.0.1", PORT), NoCacheHandler).serve_forever()
