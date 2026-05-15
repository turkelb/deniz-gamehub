#!/usr/bin/env python3
"""Game Hub HTTP server — serves landing page + snake frontend."""
import http.server, socketserver, os, sys

PORT = int(os.environ.get("PORT", 8080))
DIR = os.path.dirname(os.path.abspath(__file__))

class GameHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIR, **kwargs)

    def do_GET(self):
        # Route /snake/* to snake-frontend/
        if self.path.startswith("/snake"):
            path = self.path[6:] or "/"
            if path == "/": path = "/index.html"
            # Remove leading slash for file lookup
            fpath = os.path.join(DIR, "snake-frontend", path.lstrip("/"))
            if os.path.isfile(fpath):
                self.send_response(200)
                ct = "text/html" if fpath.endswith(".html") else \
                     "text/css" if fpath.endswith(".css") else \
                     "application/javascript" if fpath.endswith(".js") else \
                     "application/octet-stream"
                self.send_header("Content-Type", ct)
                self.end_headers()
                with open(fpath, "rb") as f:
                    self.wfile.write(f.read())
                return
            self.send_error(404)
            return
        # Route / to www/ (landing page)
        elif self.path == "/" or self.path.startswith("/?"):
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            with open(os.path.join(DIR, "www", "index.html"), "rb") as f:
                self.wfile.write(f.read())
            return
        else:
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
