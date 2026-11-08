import functools
import http.server
import socketserver
import sys
import threading
from pathlib import Path

from playwright.sync_api import sync_playwright

APP = Path(__file__).resolve().parent.parent
OUT = APP / "tests" / "out"

# shift the clock so the meadow renders at 11:00 local time (daytime phase)
SHIFT_TO_DAY = """
(() => {
  const RealDate = Date;
  const now = new RealDate();
  const target = new RealDate(now);
  target.setHours(11, 0, 0, 0);
  const offset = target.getTime() - now.getTime();
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) {
        super(RealDate.now() + offset);
      } else {
        super(...args);
      }
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  window.Date = ShiftedDate;
})();
"""


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass


def serve():
    handler = functools.partial(QuietHandler, directory=str(APP))
    server = socketserver.ThreadingTCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def main():
    server = serve()
    base = f"http://127.0.0.1:{server.server_address[1]}/index.html"
    errors = []
    with sync_playwright() as p:
        browser = p.chromium.launch(
            args=["--no-proxy-server", "--use-angle=d3d11", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"],
        )
        for width, height in ((1440, 900), (390, 844)):
            context = browser.new_context(viewport={"width": width, "height": height})
            context.add_init_script(SHIFT_TO_DAY)
            page = context.new_page()
            page.on("pageerror", lambda exc: errors.append(str(exc)))
            page.on("console", lambda msg: errors.append(msg.text) if msg.type == "error" else None)
            page.goto(base + "#/today")
            page.wait_for_timeout(4000)
            hour = page.evaluate("new Date().getHours()")
            page.screenshot(path=str(OUT / f"day_{width}.png"))
            page.goto(base + "#/meadow")
            page.wait_for_timeout(3500)
            page.screenshot(path=str(OUT / f"day_meadow_{width}.png"))
            print(f"width {width}: page hour {hour}")
            context.close()
        browser.close()
    server.shutdown()
    print(f"errors: {len(errors)}")
    for error in errors:
        print("  ", error)
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
