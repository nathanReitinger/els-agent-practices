"""The robot (scripts/commands.py) and the page (assets/commands.js) read comments the same way.

    python3 -m unittest discover -s scripts/tests -t scripts/tests
"""

import json
import shutil
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from commands import parse_command, vote_of  # noqa: E402

CASES = json.loads((ROOT / "scripts" / "tests" / "commands.json").read_text())

NODE_CHECK = """
const api = require(process.argv[1]);
const cases = JSON.parse(require("fs").readFileSync(0, "utf8"));
const out = {
  commands: cases.commands.map((c) => api.parseCommand(c.text, c.exact || "")),
  votes: cases.votes.map((c) => api.voteOf(c.text)),
};
process.stdout.write(JSON.stringify(out));
"""


class CommandsTest(unittest.TestCase):
    def test_python(self):
        for case in CASES["commands"]:
            with self.subTest(text=case["text"]):
                self.assertEqual(parse_command(case["text"], case.get("exact", "")), case["expect"])
        for case in CASES["votes"]:
            with self.subTest(vote=case["text"]):
                self.assertEqual(vote_of(case["text"]), case["expect"])

    @unittest.skipUnless(shutil.which("node"), "Node.js isn't installed")
    def test_javascript_agrees(self):
        result = subprocess.run(["node", "-e", NODE_CHECK, str(ROOT / "assets" / "commands.js")],
                                input=json.dumps(CASES), capture_output=True, text=True, check=True)
        out = json.loads(result.stdout)
        for case, got in zip(CASES["commands"], out["commands"]):
            with self.subTest(text=case["text"]):
                self.assertEqual(got, case["expect"])
        for case, got in zip(CASES["votes"], out["votes"]):
            with self.subTest(vote=case["text"]):
                self.assertEqual(got, case["expect"])


if __name__ == "__main__":
    unittest.main()
