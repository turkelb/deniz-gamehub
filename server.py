#!/usr/bin/env python3
"""Game Hub HTTP server — serves landing page + snake frontend."""
import http.server, socketserver, os, sys

PORT = int(os.environ.get("PORT", 8080))
DIR = os.path.dirname(os.path.abspath(__file__))

class GameHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        try:
            self._do_get()
        except (BrokenPipeError, ConnectionResetError):
            pass

    def _do_get(self):
        # Route /snake/* to snake-frontend/
        if self.path.startswith("/snake"):
            sub = self.path[6:] or "/"
            if sub == "/":
                sub = "/index.html"
            fpath = os.path.join(DIR, "snake-frontend", sub.lstrip("/"))
            if os.path.isfile(fpath):
                self.send_response(200)
                ext = os.path.splitext(fpath)[1]
                ct = {"html": "text/html", "css": "text/css", "js": "application/javascript"}.get(ext[1:], "application/octet-stream")
                self.send_header("Content-Type", ct)
                self.end_headers()
                with open(fpath, "rb") as f:
                    self.wfile.write(f.read())
                return
            self.send_error(404)
            return

        # Route / to www/ (landing page)
        if self.path == "/" or self.path.startswith("/?"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            with open(os.path.join(DIR, "www", "index.html"), "rb") as f:
                self.wfile.write(f.read())
            return

        super().do_GET()

    def log_message(self, format, *args):
        print(f"[hub] {args[0]}")

if __name__ == "__main__":
    print(f" Game Hub: http://0.0.0.0:{PORT}")
    print(f"   Ana sayfa: /")
    print(f"   Yilan:     /snake")
    with socketserver.TCPServer(("0.0.0.0", PORT), GameHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            httpd.shutdown()
