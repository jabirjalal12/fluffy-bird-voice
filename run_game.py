import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8080
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

def run():
    os.chdir(DIRECTORY)
    port = PORT
    server = None
    for attempt in range(10):
        try:
            server = socketserver.TCPServer(("", port), Handler)
            break
        except OSError:
            port += 1

    if not server:
        print("Could not bind to any port from 8080-8090.")
        sys.exit(1)

    url = f"http://localhost:{port}/index.html"
    print("==================================================")
    print(" Fluffy Bird Voice Game Server Running!")
    print(f" URL: {url}")
    print(" Press Ctrl+C to stop the server.")
    print("==================================================")

    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"Please open {url} in your browser.")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
        server.server_close()

if __name__ == "__main__":
    run()
