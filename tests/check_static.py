"""Validate the files shipped to the TV without third-party tools."""

from html.parser import HTMLParser
import json
import os
import re
import subprocess
from tempfile import TemporaryDirectory
import unittest
from pathlib import Path
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[1]
CATEGORIES = {
    "quote": ("Think about it", "#ffc857"),
    "physics": ("Physics", "#5ccfee"),
    "math": ("Math", "#a8e07a"),
    "animals": ("Animals and birds", "#ff93b4"),
    "space": ("Space", "#b9a6ff"),
    "learn": ("Did you know?", "#ffad66"),
    "inspire": ("Inspiring words", "#ff7f6e"),
    "chemistry": ("Chemistry", "#5ee0b8"),
    "astronomy": ("Astronomy", "#8fb4ff"),
}
QUOTE_KEYS = {"quote", "inspire"}  # need an author or origin line
DETAIL_KEYS = {"physics", "math", "chemistry"}  # need an everyday or worked example
T_MAX, D_MAX = 110, 140  # keeps the slide on screen at the 40% and 60% extremes


class PageAssets(HTMLParser):
    def __init__(self, source):
        super().__init__()
        self.assets = []
        self.feed(source)

    def handle_starttag(self, tag, attrs):
        for name, value in attrs:
            if name in ("href", "src") and value is not None:
                self.assets.append((tag, urlsplit(value)))


class StaticChecks(unittest.TestCase):
    def test_001_older_chromium_syntax_and_guarded_wrap(self):
        js = (ROOT / "app.js").read_text()
        rules = {
            "optional chaining or nullish coalescing": r"\?\.|\?\?",
            "logical assignment": r"\|\|=|&&=",
            "numeric separator": r"\b\d[\d.]*_\d",
            "class syntax or private fields": r"\bclass\s+[\w$]|(?m:^\s*#[\w$]+)",
            "post-ES2017 built-in": r"\.\s*(?:replaceAll|at)\s*\(|\bPromise\.any\b|\bstructuredClone\b",
            "top-level await or ES module syntax": r"(?m:^\s*(?:await\b|import\b|export\b))",
        }
        for feature, pattern in rules.items():
            with self.subTest(feature=feature):
                self.assertNotRegex(js, pattern)
        css = (ROOT / "styles.css").read_text()
        css = re.sub(r"/\*.*?\*/", "", css, flags=re.S)
        depth = 0
        support_depth = None
        declarations = 0
        for match in re.finditer(r"@supports\s*\(\s*text-wrap\s*:\s*balance\s*\)\s*\{|[{}]|text-wrap\s*:", css):
            token = match.group()
            if token.startswith("@supports"):
                depth += 1
                support_depth = depth
            elif token == "{":
                depth += 1
            elif token == "}":
                if depth == support_depth:
                    support_depth = None
                depth -= 1
            else:
                declarations += 1
                self.assertIsNotNone(support_depth, "Unguarded text-wrap declaration")
        self.assertGreater(declarations, 0)
        self.assertEqual(depth, 0)
        self.assertNotRegex(css, r":(?:has|is|where)\(|@container\b|\b(?:gap|aspect-ratio|inset|backdrop-filter)\s*:")

    def test_006_content_contract_and_no_em_dash(self):
        data = json.loads((ROOT / "content.json").read_text())
        self.assertEqual(set(data["categories"]), set(CATEGORIES))
        for key, (label, accent) in CATEGORIES.items():
            category = data["categories"][key]
            with self.subTest(category=key):
                self.assertEqual((category["label"], category["accent"]), (label, accent))
                self.assertGreaterEqual(len(category["items"]), 15)
                print(f"{key}: {len(category['items'])}", flush=True)
            for index, item in enumerate(category["items"], 1):
                with self.subTest(category=key, item=index):
                    self.assertIsInstance(item.get("t"), str)
                    self.assertTrue(item["t"].strip())
                    self.assertTrue(set(item) <= {"t", "d", "a"})
                    for field in set(item) - {"t"}:
                        self.assertIsInstance(item[field], str)
                    if key in DETAIL_KEYS:
                        self.assertTrue(item.get("d", "").strip())
                    if key in QUOTE_KEYS:
                        self.assertTrue(item.get("a", "").strip())
                    else:
                        self.assertNotIn("a", item)
                    self.assertLessEqual(len(item["t"]), T_MAX)
                    self.assertLessEqual(len(item.get("d", "")), D_MAX)
                    self.assertNotIn("–", item["t"] + item.get("d", "") + item.get("a", ""))
        texts = [item["t"].strip().lower() for c in data["categories"].values() for item in c["items"]]
        self.assertEqual(len(texts), len(set(texts)), "duplicate main text")
        self.assertEqual(data["categories"]["inspire"].get("style"), "quote")
        for filename in ("app.js", "content.json", "index.html", "README.md", "styles.css"):
            with self.subTest(file=filename):
                self.assertNotIn("\u2014", (ROOT / filename).read_text())
        self.assertNotIn("\u2014", json.dumps(data, ensure_ascii=False))

    def test_014_assets_and_required_style_values(self):
        for manifest in ("package.json", "package-lock.json", "yarn.lock", "pnpm-lock.yaml"):
            self.assertFalse((ROOT / manifest).exists(), manifest)
        assets = PageAssets((ROOT / "index.html").read_text()).assets
        for tag, link in assets:
            with self.subTest(tag=tag, link=link.geturl()):
                if link.scheme == "data":
                    self.assertEqual(tag, "link")
                    self.assertEqual(link.geturl(), "data:,")
                elif link.netloc or link.scheme:
                    self.assertEqual(link.scheme, "https")
                    self.assertIn(link.netloc, {"fonts.googleapis.com", "fonts.gstatic.com"})
                    if link.path:
                        self.assertEqual(link.path, "/css2")
                        self.assertRegex(link.query, r"^family=Fredoka(?::[^&]+)?&family=Newsreader:ital@1&display=swap$")
                else:
                    self.assertIn(link.path, {"app.js", "styles.css"})
        self.assertEqual({link.path for _, link in assets if not (link.netloc or link.scheme)}, {"app.js", "styles.css"})
        css = (ROOT / "styles.css").read_text().lower()
        self.assertRegex(css, r"background:\s*#000000\b")
        self.assertRegex(css, r"color:\s*#ece8df\b")
        self.assertRegex(css, r"cursor:\s*none\b")
        self.assertNotRegex(css, r"(?i)@import\b|url\s*\(")


    def test_018_serve_script_interface_fallback_and_bind_arguments(self):
        script = ROOT / "serve.sh"
        self.assertTrue(os.access(script, os.X_OK))
        with TemporaryDirectory() as sandbox:
            tools = Path(sandbox)
            ipconfig = tools / "ipconfig"
            ipconfig.write_text(
                '#!/bin/sh\n'
                '[ "$1" = getifaddr ] || exit 2\n'
                'printf "lookup %s\\n" "$2" >> "$BRIGHT_MINDS_LOOKUPS"\n'
                'if [ "$BRIGHT_MINDS_INTERFACE" = "$2" ]; then printf "192.0.2.25\\n"; fi\n'
            )
            python = tools / "python3"
            python.write_text('#!/bin/sh\nprintf "server directory: %s\\n" "$PWD"\nprintf "python3 %s\\n" "$*"\n')
            for fake in (ipconfig, python):
                fake.chmod(0o700)
            lookups = tools / "lookups"
            for interface, expected in (("en0", ["lookup en0"]), ("en1", ["lookup en0", "lookup en1"]),
                                        ("", ["lookup en0", "lookup en1"])):
                with self.subTest(interface=interface):
                    lookups.write_text("")
                    result = subprocess.run(
                        [str(script)], cwd=tools, text=True, capture_output=True, check=True, timeout=5,
                        env={"PATH": f"{tools}:/usr/bin:/bin", "BRIGHT_MINDS_INTERFACE": interface,
                             "BRIGHT_MINDS_LOOKUPS": str(lookups)},
                    )
                    self.assertEqual(lookups.read_text().splitlines(), expected)
                    self.assertIn("python3 -m http.server 8080 --bind 0.0.0.0", result.stdout)
                    self.assertIn(f"server directory: {ROOT}", result.stdout)
                    self.assertIn("Click Allow", result.stdout)
                    if interface:
                        self.assertIn("Mac LAN IP: 192.0.2.25", result.stdout)
                        self.assertIn("TV URL: http://192.0.2.25:8080", result.stdout)
                    else:
                        self.assertIn("Could not find the Mac LAN IP", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
