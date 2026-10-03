"""Tests for the proposals robot: vote counting, and whole runs in a scratch copy of the repository.

    python3 -m unittest discover -s scripts/tests -t scripts/tests
"""

import datetime as dt
import os
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from commands import parse_command  # noqa: E402
from fingerprint import fingerprint  # noqa: E402
from proposals import Governance, count_votes, decide, fetch_site, parse_time  # noqa: E402

DRAFTER = "https://nathanreitinger.github.io/els-agent-practices/draft/"
# Like GitHub's machines: no git settings from this computer, and no guessing a name or email from it.
NO_GIT_SETTINGS = {**os.environ, "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
                   "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "user.useConfigOnly", "GIT_CONFIG_VALUE_0": "true"}
MAINTAINERS = json.loads((ROOT / "governance" / "maintainers.json").read_text())


def note(id, user, text, exact=None, prefix="", suffix="", created="2026-10-03T10:00:00+00:00", updated=None,
         refs=None, name=None):
    """An annotation as the Hypothesis search API returns it."""
    row = {"id": id, "user": f"acct:{user}@hypothes.is", "user_info": {"display_name": name or user},
           "created": created, "updated": updated or created, "text": text,
           "links": {"incontext": f"https://hyp.is/{id}/nathanreitinger.github.io/els-agent-practices/draft/"},
           "target": [{"source": DRAFTER}]}
    if exact:
        row["target"][0]["selector"] = [{"type": "TextQuoteSelector", "exact": exact, "prefix": prefix, "suffix": suffix}]
    if refs:
        row["references"] = refs
    return row


def reply(id, user, text, to, when="2026-10-03T11:00:00+00:00"):
    return note(id, user, text, created=when, refs=[to])


LEAD_EMAIL = MAINTAINERS["maintainers"][0]["email"]


def site_vote(suggestion, email, vote, at="2026-10-03T11:00:00.123456+00:00"):
    """A row of the Suggest Edits database's votes table, as its API returns it."""
    return {"suggestion": suggestion, "voter_id": f"id-{email}", "voter_email": email, "vote": vote, "at": at}


def site_suggestions(email="reader@example.org", start=0):
    """The editor's four captured suggestions as rows of the Suggest Edits database's suggestions table."""
    posted = json.loads((ROOT / "scripts" / "tests" / "suggestions.json").read_text())["posted"]
    rows = []
    for i, body in enumerate(posted):
        selector = body["target"][0]["selector"][0]
        command = parse_command(body["text"], selector["exact"])
        when = f"2026-10-03T10:0{start + i}:00.000001+00:00"
        rows.append({"id": f"0000000{i}-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "author_id": f"id-{email}", "author_email": email,
                     "kind": command["kind"], "exact": selector["exact"], "prefix": selector["prefix"],
                     "suffix": selector["suffix"], "new_text": command["new"], "reason": "", "base": "0.0.2",
                     "created": when, "updated": when})
    return rows


class VotesTest(unittest.TestCase):
    def setUp(self):
        self.gov = Governance(MAINTAINERS)
        self.record = {"updated": "2026-10-03T10:00:00+00:00", "created": "2026-10-03T10:00:00+00:00",
                       "proposer": {"name": "Jane", "hypothesis": "jdoe"}}

    def test_maintainer_votes_count_and_readers_show_support(self):
        votes, support, stale = count_votes(self.record, [
            reply("r1", "nathanReitinger", "Approve", "p"),
            reply("r2", "jdoe", "Approve", "p"),
            reply("r3", "reader", "approved!", "p"),
            reply("r4", "reader2", "Nice idea", "p"),
        ], [], self.gov)
        self.assertEqual([(v.maintainer.name, v.vote) for v in votes], [("Nathan Reitinger", "approve")])
        self.assertEqual((support, stale), (2, 0))

    def test_votes_before_the_last_edit_are_stale(self):
        votes, _, stale = count_votes(self.record, [reply("r1", "NATHANREITINGER", "Approve", "p", "2026-10-03T09:00:00+00:00")],
                                      [], self.gov)
        self.assertEqual((votes, stale), ([], 1))

    def test_latest_vote_wins_across_hypothesis_and_github(self):
        comments = [
            {"user": {"login": "nathanreitinger", "type": "User"}, "body": "/reject not yet",
             "created_at": "2026-10-03T12:00:00Z", "updated_at": "2026-10-03T12:00:00Z", "html_url": "u"},
            {"user": {"login": "github-actions[bot]", "type": "Bot"}, "body": "/approve",
             "created_at": "2026-10-03T13:00:00Z", "updated_at": "2026-10-03T13:00:00Z", "html_url": "u"},
        ]
        votes, _, _ = count_votes(self.record, [reply("r1", "nathanReitinger", "Approve", "p")], comments, self.gov)
        self.assertEqual([(v.vote, v.via) for v in votes], [("reject", "GitHub")])

    def test_votes_on_suggest_edits_count_by_email(self):
        votes, support, stale = count_votes(self.record, [], [], self.gov, [
            site_vote("p", LEAD_EMAIL.upper(), "approve"),
            site_vote("p", "reader@example.org", "approve"),
            site_vote("p", LEAD_EMAIL, "reject", at="2026-10-03T09:00:00+00:00"),  # older, and before the last edit
        ])
        self.assertEqual([(v.maintainer.name, v.vote, v.via) for v in votes], [("Nathan Reitinger", "approve", "Suggest Edits")])
        self.assertEqual((support, stale), (1, 0))
        votes, _, stale = count_votes(self.record, [], [], self.gov, [site_vote("p", LEAD_EMAIL, "approve", at="2026-10-03T09:00:00Z")])
        self.assertEqual((votes, stale), ([], 1))

    def test_self_approval_can_be_turned_off(self):
        data = json.loads(json.dumps(MAINTAINERS))
        data["rules"]["maintainers_may_approve_their_own_proposals"] = False
        gov = Governance(data)
        record = {**self.record, "proposer": {"name": "N", "hypothesis": "nathanReitinger"}}
        votes, _, _ = count_votes(record, [reply("r1", "nathanReitinger", "Approve", "p")], [], gov)
        self.assertEqual(votes, [])
        on_site = {**self.record, "proposer": {"name": LEAD_EMAIL, "email": LEAD_EMAIL}}
        votes, _, _ = count_votes(on_site, [], [], gov, [site_vote("p", LEAD_EMAIL, "approve")])
        self.assertEqual(votes, [])

    def test_decisions(self):
        gov = self.gov
        now = parse_time("2026-10-03T12:00:00Z")
        member = gov.maintainers[0]
        from proposals import Maintainer, Vote
        other = Maintainer("Other", "maintainer", "other", "")
        approve = Vote(member, "approve", now, "Hypothesis", "")
        reject = Vote(other, "reject", now, "Hypothesis", "")
        self.assertEqual(decide(self.record, [approve], gov, now), "adopt")
        self.assertEqual(decide(self.record, [approve, reject], gov, now), "wait")
        self.assertEqual(decide(self.record, [reject], gov, now), "decline")
        self.assertEqual(decide(self.record, [], gov, now), "wait")
        gov.hours_open = 48
        self.assertEqual(decide(self.record, [approve], gov, now), "wait")


class RunTest(unittest.TestCase):
    """Whole runs of the robot in a scratch copy of the repository, reading comments from a file."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="els-robot-"))
        self.repo = self.dir / "repo"
        shutil.copytree(ROOT, self.repo, ignore=shutil.ignore_patterns(".git", "__pycache__", ".claude", ".DS_Store"))
        self.baseline()
        self.git("init", "--quiet", "-b", "main")
        self.git("add", "-A")
        self.git("commit", "--quiet", "-m", "Start")
        self.git("tag", "-a", "v0.0.2", "-m", "Version 0.0.2")
        self.fixture = self.dir / "annotations.json"

    def tearDown(self):
        shutil.rmtree(self.dir, ignore_errors=True)

    def baseline(self):
        """Put the copy back to version 0.0.2 with no proposals, so the tests don't depend on later versions."""
        manifest = json.loads((self.repo / "versions.json").read_text())
        keep = {"0.0.0", "0.0.1", "0.0.2"}
        for folder in (self.repo / "versions").iterdir():
            if folder.is_dir() and folder.name.removeprefix("v") not in keep:
                shutil.rmtree(folder)
        manifest["versions"] = [r for r in manifest["versions"] if r["version"] in keep]
        manifest["latest"] = "0.0.2"
        (self.repo / "versions.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        frozen = (self.repo / "versions" / "v0.0.2" / "AGENTS.md").read_bytes()
        (self.repo / "latest" / "AGENTS.md").write_bytes(frozen)
        (self.repo / "draft" / "AGENTS.md").write_bytes(frozen)
        (self.repo / "governance" / "proposals.json").unlink(missing_ok=True)

    def git(self, *args):
        """git in the scratch copy, as a maintainer named Maintainer (the robot must name itself)."""
        return subprocess.run(["git", "-c", "user.name=Maintainer", "-c", "user.email=maintainer@example.org", *args],
                              cwd=self.repo, capture_output=True, text=True, check=True, env=NO_GIT_SETTINGS).stdout.strip()

    def robot(self, rows, *extra, now="2026-10-03T12:00:00Z", site=None):
        self.fixture.write_text(json.dumps(rows))
        if site is not None:
            (self.dir / "site.json").write_text(json.dumps(site))
            extra = (*extra, "--site-data", str(self.dir / "site.json"))
        result = subprocess.run([sys.executable, "scripts/proposals.py", "--annotations", str(self.fixture), "--offline",
                                 "--now", now, *extra], cwd=self.repo, capture_output=True, text=True, env=NO_GIT_SETTINGS)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        return result.stdout

    def ledger(self):
        return {r["id"]: r for r in json.loads((self.repo / "governance" / "proposals.json").read_text())["proposals"]}

    def manifest(self):
        return json.loads((self.repo / "versions.json").read_text())

    def rows(self):
        return [
            note("p1", "jdoe", "Replace with: estimated cost and how it's billed\nWhy: subscriptions differ",
                 "estimated cost", "would cost money. Give me the ", " first.", name="Jane Doe"),
            reply("r1", "nathanReitinger", "Approve", "p1"),
            note("p2", "nathanReitinger", "Delete", "(git)", "isn't under version control ", ", offer to set",
                 created="2026-10-03T10:05:00+00:00"),
            reply("r2", "jdoe", "Approve", "p2"),
            note("p3", "reader", "Replace with:", "random seed", "Set and record a ", " in every script",
                 created="2026-10-03T10:10:00+00:00"),
            note("p4", "reader", "Delete", "words that aren't anywhere in the file", created="2026-10-03T10:15:00+00:00"),
            note("p5", "reader", "Add rule: Always work in a cloud notebook.",
                 "Set and record a random seed in every script that samples or simulates.",
                 created="2026-10-03T10:20:00+00:00"),
            reply("r5", "nathanReitinger", "Reject. That isn't general.", "p5"),
            note("p6", "reader", "Delete this rule", "Change only what the task requires, and report other problems "
                 "instead of fixing them.", created="2026-10-03T10:25:00+00:00", updated="2026-10-03T11:30:00+00:00"),
            reply("r6", "nathanReitinger", "Approve", "p6", "2026-10-03T11:00:00+00:00"),
            note("p7", "reader", "Replace with: Report every result",
                 "Report null, weak, and surprising results", "", " as plainly as strong ones",
                 created="2026-10-03T10:30:00+00:00"),
            note("p8", "reader", "Replace with: Report null and surprising findings",
                 "Report null, weak, and surprising results", "", " as plainly as strong ones",
                 created="2026-10-03T10:35:00+00:00"),
            reply("r8", "nathanReitinger", "approve", "p8"),
            note("c1", "reader", "what is a trigger?", "When a trigger fires"),
            note("old", "nathanReitinger", "delete", "Anyone, including me, proposes changing the analysis plan",
                 created="2026-10-02T20:59:00+00:00"),
        ]

    def test_a_full_cycle(self):
        out = self.robot(self.rows())
        ledger, manifest = self.ledger(), self.manifest()

        # Two approved proposals became two versions, in order, each with its own fingerprint and tag.
        self.assertEqual(manifest["latest"], "0.0.4")
        self.assertEqual([ledger["p1"]["version"], ledger["p8"]["version"]], ["0.0.3", "0.0.4"])
        self.assertEqual(self.git("tag", "--list", "v*").split(), ["v0.0.2", "v0.0.3", "v0.0.4"])
        for entry in manifest["versions"][:2]:
            frozen = (self.repo / "versions" / f"v{entry['version']}" / "AGENTS.md").read_text()
            self.assertEqual(fingerprint(frozen), entry["fingerprint"])
            self.assertIn(f"Argon2id fingerprint of this file without this line: {entry['fingerprint']}", frozen.split("\n")[2])
        draft = (self.repo / "draft" / "AGENTS.md").read_text()
        self.assertEqual(draft, (self.repo / "latest" / "AGENTS.md").read_text())
        self.assertIn("Give me the estimated cost and how it's billed first.", draft)
        self.assertIn("- Report null and surprising findings as plainly as strong ones", draft)

        # The record says who proposed and approved each change.
        changelog = (self.repo / "CHANGELOG.md").read_text()
        self.assertIn("## [0.0.3] - 2026-10-03", changelog)
        self.assertIn("Proposed by Jane Doe (Hypothesis: jdoe) on 2026-10-03: “subscriptions differ”", changelog)
        self.assertIn("Approved by Nathan Reitinger (Hypothesis, 2026-10-03)", changelog)
        log = self.git("log", "--format=%an|%s", "-3")
        self.assertIn("Jane Doe|Version 0.0.3: Replaced “estimated cost” with “estimated cost and how it's billed” (Stop and ask).", log)
        self.assertIn("Approved-by: Nathan Reitinger (Hypothesis)", self.git("log", "-1", "--format=%B", "v0.0.3"))

        # Everything else is recorded with the right status.
        self.assertEqual(ledger["p2"]["status"], "open")
        self.assertEqual(ledger["p2"]["support"], 1)
        self.assertEqual(ledger["p3"]["status"], "needs-fix")
        self.assertEqual(ledger["p4"]["status"], "cannot-apply")
        self.assertEqual(ledger["p5"]["status"], "declined")
        self.assertEqual((ledger["p6"]["status"], ledger["p6"]["stale_votes"]), ("open", 1))
        self.assertEqual(ledger["p7"]["status"], "cannot-apply")  # p8 changed its words first
        self.assertNotIn("c1", ledger)
        self.assertNotIn("old", ledger)
        self.assertEqual(ledger["p2"]["preview"]["after"],
                         ["If the project isn't under version control, offer to set it up and run it for me. Commit "
                          "before and after each task, with a plain-English message saying what changed and why."])
        self.assertIn("Adopted proposal p1 as version 0.0.3", out)

        # A second run with the same comments changes nothing.
        head = self.git("rev-parse", "HEAD")
        self.robot(self.rows())
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.assertEqual(self.git("status", "--porcelain"), "")

        # Deleting a proposal withdraws it; a new approval adopts another.
        rows = [r for r in self.rows() if r["id"] != "p6"]
        rows.append(reply("r9", "nathanReitinger", "/approve", "p2", "2026-10-03T12:30:00+00:00"))
        self.robot(rows, now="2026-10-03T13:00:00Z")
        ledger = self.ledger()
        self.assertEqual(ledger["p6"]["status"], "withdrawn")
        self.assertEqual((ledger["p2"]["status"], ledger["p2"]["version"]), ("adopted", "0.0.5"))
        self.assertIn("version control, offer to set it up", (self.repo / "draft" / "AGENTS.md").read_text())
        verify = subprocess.run([sys.executable, "scripts/fingerprint.py", "--verify"], cwd=self.repo,
                                capture_output=True, text=True)
        self.assertEqual(verify.returncode, 0, verify.stderr)

    def test_dry_run_changes_nothing(self):
        out = self.robot(self.rows(), "--dry-run")
        self.assertIn("Would adopt proposal p1 as version 0.0.3", out)
        self.assertIn("Would adopt proposal p8 as version 0.0.4", out)
        self.assertEqual(self.git("status", "--porcelain"), "")
        self.assertEqual(self.git("tag", "--list"), "v0.0.2")

    def test_a_direct_edit_is_published(self):
        path = self.repo / "draft" / "AGENTS.md"
        path.write_text(path.read_text().replace("Never invent values", "Never make up values"))
        self.git("commit", "--quiet", "-am", "Reword rule 3")
        self.robot([])
        manifest = self.manifest()
        self.assertEqual(manifest["latest"], "0.0.3")
        self.assertEqual(manifest["versions"][0]["summary"], "Edited directly by Maintainer: Reword rule 3")
        self.assertIn("Never make up values", (self.repo / "latest" / "AGENTS.md").read_text())
        self.assertTrue((self.repo / "governance" / "proposals.json").exists())

    def test_direct_edits_list_only_text_changes_and_take_a_summary(self):
        path = self.repo / "draft" / "AGENTS.md"
        lines = path.read_text().split("\n")
        lines[2] = lines[2].replace("Permanent link", "Permanent address")  # only the version line
        path.write_text("\n".join(lines))
        self.git("commit", "--quiet", "-am", "Touch only the version line")
        path.write_text(path.read_text().replace("Never invent values", "Never make up values"))
        self.git("commit", "--quiet", "-am", "Reword rule 3")
        path.write_text(path.read_text().replace("Set and record a random seed", "Always set and record a random seed"))
        self.git("commit", "--quiet", "-am", "Reword the seed rule", "-m", "Version-summary: Two rewordings from the comments.")
        self.robot([])
        entry = self.manifest()["versions"][0]
        self.assertEqual((entry["version"], entry["summary"]), ("0.0.3", "Two rewordings from the comments."))
        changelog = (self.repo / "CHANGELOG.md").read_text()
        self.assertIn("Changes to the text, by Maintainer:\n\n- Reword rule 3\n- Reword the seed rule\n", changelog)
        self.assertNotIn("Touch only the version line", changelog)

    def suggestion_rows(self, approved):
        """The editor's four suggestions as Hypothesis returns them, with a maintainer's approval of some."""
        posted = json.loads((ROOT / "scripts" / "tests" / "suggestions.json").read_text())["posted"]
        rows = []
        for i, body in enumerate(posted):
            created = f"2026-10-03T10:0{i}:00+00:00"
            rows.append({"id": f"s{i}", "user": "acct:testreader@hypothes.is", "user_info": {"display_name": "Test Reader"},
                         "created": created, "updated": created, "text": body["text"], "target": body["target"],
                         "links": {"incontext": f"https://hyp.is/s{i}/draft"}})
            if i in approved:
                rows.append(reply(f"a{i}", "nathanReitinger", "Approve", f"s{i}"))
        return rows

    def test_suggestions_from_the_editor_apply_in_any_order(self):
        for first in ([3], [2]):  # the new rule first, or the word change in the rule it follows first
            with self.subTest(first=first):
                self.tearDown()
                self.setUp()
                self.robot(self.suggestion_rows(first))
                self.robot(self.suggestion_rows([0, 1, 2, 3]), now="2026-10-03T13:00:00Z")
                self.assertEqual({r["id"]: r["status"] for r in self.ledger().values()},
                                 {"s0": "adopted", "s1": "adopted", "s2": "adopted", "s3": "adopted"})
                draft = (self.repo / "draft" / "AGENTS.md").read_text()
                self.assertIn("- If the project isn't under version control, offer to set it up", draft)
                self.assertIn("- Keep plans and drafts, decisions, and the codebook in files", draft)
                self.assertIn("- Set and record a random seed in each script that samples or simulates.\n"
                              "- Name the model and its version in every log.\n", draft)

    def test_suggestions_and_votes_from_suggest_edits(self):
        rows = site_suggestions()
        ids = [f"sb-{row['id']}" for row in rows]
        votes = [site_vote(ids[0], LEAD_EMAIL, "approve"), site_vote(ids[1], "someone@example.org", "approve"),
                 site_vote(ids[2], LEAD_EMAIL, "reject")]
        self.robot([], site={"suggestions": rows, "votes": votes})
        ledger = self.ledger()
        self.assertEqual([ledger[i]["status"] for i in ids], ["adopted", "open", "declined", "open"])
        self.assertEqual((ledger[ids[1]]["support"], ledger[ids[0]]["proposer"]), (1, {"name": "reader@example.org", "email": "reader@example.org"}))
        self.assertEqual(ledger[ids[0]]["votes"][0]["via"], "Suggest Edits")
        draft = (self.repo / "draft" / "AGENTS.md").read_text()
        self.assertIn("- If the project isn't under version control, offer to set it up", draft)

        # The record credits the proposer by email address, and the commit is theirs.
        changelog = (self.repo / "CHANGELOG.md").read_text()
        self.assertIn("Proposed by reader@\u2060example.org (Suggest Edits) on 2026-10-03", changelog)
        self.assertIn("Approved by Nathan Reitinger (Suggest Edits, 2026-10-03)", changelog)
        self.assertEqual(self.git("log", "-1", "--format=%an <%ae>", "v0.0.3"), "reader@example.org <reader@example.org>")
        message = self.git("log", "-1", "--format=%B", "v0.0.3")
        self.assertIn("Suggested-by: reader@example.org (Suggest Edits)", message)
        self.assertIn("Approved-by: Nathan Reitinger (Suggest Edits)", message)

        # Editing a suggestion makes earlier votes stale; withdrawing one (deleting its row) closes it.
        rows[3] = {**rows[3], "new_text": "Name the model and its exact version in every log.",
                   "updated": "2026-10-03T12:10:00.5+00:00"}
        votes.append(site_vote(ids[3], LEAD_EMAIL, "approve", at="2026-10-03T12:05:00+00:00"))
        self.robot([], site={"suggestions": [rows[3]], "votes": votes}, now="2026-10-03T12:30:00Z")
        ledger = self.ledger()
        self.assertEqual((ledger[ids[1]]["status"], ledger[ids[1]]["note"]), ("withdrawn", "The proposer withdrew it."))
        self.assertEqual((ledger[ids[3]]["status"], ledger[ids[3]]["stale_votes"]), ("open", 1))
        votes.append(site_vote(ids[3], LEAD_EMAIL, "approve", at="2026-10-03T12:40:00+00:00"))
        self.robot([], site={"suggestions": [rows[3]], "votes": votes}, now="2026-10-03T13:00:00Z")
        self.assertEqual(self.ledger()[ids[3]]["status"], "adopted")
        self.assertIn("- Name the model and its exact version in every log.\n", (self.repo / "draft" / "AGENTS.md").read_text())

    def test_suggest_edits_accounts_can_be_ignored(self):
        governance = self.repo / "governance" / "maintainers.json"
        data = json.loads(governance.read_text())
        data["ignored_accounts"]["site"] = ["Spam@Example.org"]
        governance.write_text(json.dumps(data))
        self.git("commit", "--quiet", "-am", "Ignore a spammer")
        self.robot([], site={"suggestions": site_suggestions("spam@example.org"), "votes": []})
        self.assertEqual(self.ledger(), {})

    def test_a_changed_frozen_version_stops_the_robot(self):
        frozen = self.repo / "versions" / "v0.0.1" / "AGENTS.md"
        frozen.write_text(frozen.read_text().replace("Never", "Always", 1))
        self.fixture.write_text("[]")
        result = subprocess.run([sys.executable, "scripts/proposals.py", "--annotations", str(self.fixture), "--offline"],
                                cwd=self.repo, capture_output=True, text=True, env=NO_GIT_SETTINGS)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("no longer matches its recorded fingerprint", result.stderr)


class FetchSiteTest(unittest.TestCase):
    """Reading Suggest Edits' database, from a stand-in for Supabase's API on a local port."""

    def setUp(self):
        import http.server
        import threading
        self.requests = []
        rows = [{"id": str(i), "created": f"{i:06d}"} for i in range(1500)]
        test = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                from urllib.parse import parse_qs, urlparse
                url = urlparse(self.path)
                query = {k: v[0] for k, v in parse_qs(url.query).items()}
                test.requests.append((url.path, query, {k.lower(): v for k, v in self.headers.items()}))
                table = rows if url.path == "/rest/v1/suggestions" else [{"suggestion": "sb-1", "vote": "approve"}]
                offset, limit = int(query.get("offset", 0)), int(query.get("limit", 1000))
                body = json.dumps(table[offset:offset + limit]).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def test_every_row_with_the_public_key(self):
        data = fetch_site(self.url + "/", "sb_publishable_test")
        self.assertEqual(len(data["suggestions"]), 1500)
        self.assertEqual(data["votes"], [{"suggestion": "sb-1", "vote": "approve"}])
        paths = [(path, query.get("offset")) for path, query, _ in self.requests]
        self.assertEqual(paths, [("/rest/v1/suggestions", "0"), ("/rest/v1/suggestions", "1000"), ("/rest/v1/votes", "0")])
        headers = self.requests[0][2]
        self.assertEqual(headers.get("apikey"), "sb_publishable_test")
        self.assertNotIn("authorization", headers)  # a publishable key isn't a JWT
        fetch_site(self.url, "eyJhbGciOiJIUzI1NiJ9.e30.x")
        self.assertEqual(self.requests[-1][2].get("authorization"), "Bearer eyJhbGciOiJIUzI1NiJ9.e30.x")


class FakeGitHub:
    """Just enough of GitHub's issues API for the robot, in memory, on a local port."""

    def __init__(self):
        import http.server
        import threading
        self.issues, self.comments, self.labels = {}, {}, set()
        fake = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, code, data=None):
                body = json.dumps(data).encode() if data is not None else b""
                self.send_response(code)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def body(self):
                length = int(self.headers.get("Content-Length") or 0)
                return json.loads(self.rfile.read(length) or b"{}")

            def route(self):
                from urllib.parse import parse_qs, urlparse
                url = urlparse(self.path)
                parts = url.path.split("/")[4:]  # after /repos/owner/name
                return parts, {k: v[0] for k, v in parse_qs(url.query).items()}

            def do_GET(self):
                parts, query = self.route()
                if parts == ["issues"]:
                    page = int(query.get("page", 1))
                    items = list(fake.issues.values())
                    return self.reply(200, items[(page - 1) * 100:page * 100])
                if len(parts) == 3 and parts[2] == "comments":
                    page = int(query.get("page", 1))
                    return self.reply(200, fake.comments.get(int(parts[1]), [])[(page - 1) * 100:page * 100])
                if parts == ["labels", "proposal"]:
                    return self.reply(200, {"name": "proposal"}) if "proposal" in fake.labels else self.reply(404, {})
                self.reply(404, {})

            def do_POST(self):
                parts, _ = self.route()
                data = self.body()
                if parts == ["labels"]:
                    fake.labels.add(data["name"])
                    return self.reply(201, data)
                if parts == ["issues"]:
                    number = len(fake.issues) + 1
                    fake.issues[number] = {"number": number, "title": data["title"], "body": data["body"],
                                           "state": "open", "labels": [{"name": n} for n in data.get("labels", [])]}
                    return self.reply(201, fake.issues[number])
                if len(parts) == 3 and parts[2] == "comments":
                    fake.add_comment(int(parts[1]), "github-actions[bot]", data["body"], bot=True)
                    return self.reply(201, {})
                self.reply(404, {})

            def do_PATCH(self):
                parts, _ = self.route()
                data = self.body()
                if "labels" in data:
                    data["labels"] = [{"name": n} for n in data["labels"]]
                fake.issues[int(parts[1])].update(data)
                self.reply(200, fake.issues[int(parts[1])])

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def add_comment(self, number, login, body, when="2026-10-03T12:30:00Z", bot=False):
        self.comments.setdefault(number, []).append({
            "user": {"login": login, "type": "Bot" if bot else "User"}, "body": body,
            "created_at": when, "updated_at": when, "html_url": f"https://github.com/x/y/issues/{number}#c"})

    def close(self):
        self.server.shutdown()
        self.server.server_close()


class GitHubRunTest(RunTest):
    """Runs that push to a stand-in for the GitHub repository and use a stand-in for GitHub's issues."""

    def setUp(self):
        super().setUp()
        self.origin = self.dir / "origin.git"
        subprocess.run(["git", "init", "--quiet", "--bare", "-b", "main", str(self.origin)], check=True)
        self.git("remote", "add", "origin", str(self.origin))
        self.git("push", "--quiet", "-u", "origin", "main", "--tags")
        self.github = FakeGitHub()

    def tearDown(self):
        self.github.close()
        super().tearDown()

    def robot_online(self, rows, now="2026-10-03T12:00:00Z"):
        import os
        self.fixture.write_text(json.dumps(rows))
        env = {**NO_GIT_SETTINGS, "GH_TOKEN": "test-token", "REPO": "owner/name", "GITHUB_API_URL": self.github.url}
        result = subprocess.run([sys.executable, "scripts/proposals.py", "--annotations", str(self.fixture), "--push",
                                 "--now", now], cwd=self.repo, capture_output=True, text=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        return result.stdout

    def origin_git(self, *args):
        return subprocess.run(["git", "--git-dir", str(self.origin), *args], capture_output=True, text=True,
                              check=True).stdout.strip()

    def test_issues_votes_on_github_and_pushing(self):
        rows = [r for r in self.rows() if r["id"] in ("p1", "r1", "p2", "r2", "p3")]
        self.robot_online(rows)
        # The approved proposal was published and pushed with its tag; the open one got an issue.
        self.assertEqual(self.origin_git("tag", "--list", "v*").split(), ["v0.0.2", "v0.0.3"])
        self.assertEqual(self.origin_git("rev-parse", "main"), self.git("rev-parse", "HEAD"))
        ledger = self.ledger()
        self.assertIsNone(ledger["p1"]["issue"])  # approved before it ever got an issue
        self.assertIsNone(ledger["p3"]["issue"])  # needs a fix: no issue until it can be voted on
        number = ledger["p2"]["issue"]
        issue = self.github.issues[number]
        self.assertIn("<!-- proposal:p2 -->", issue["body"])
        self.assertIn("control <del>(git)</del>, offer", issue["body"])
        self.assertTrue(issue["title"].startswith("Proposal: Delete “(git)”"))
        self.assertIn("proposal", self.github.labels)

        # A maintainer votes on the issue; the next run adopts it, pushes, and closes the issue.
        self.github.add_comment(number, "NathanReitinger", "/approve looks right")
        self.github.add_comment(number, "someone-else", "/reject")
        self.robot_online(rows, now="2026-10-03T13:00:00Z")
        ledger = self.ledger()
        self.assertEqual((ledger["p2"]["status"], ledger["p2"]["version"]), ("adopted", "0.0.4"))
        self.assertEqual(ledger["p2"]["votes"][0]["via"], "GitHub")
        self.assertEqual(self.github.issues[number]["state"], "closed")
        self.assertEqual(self.github.issues[number]["state_reason"], "completed")
        outcome = [c["body"] for c in self.github.comments[number] if c["user"]["type"] == "Bot"]
        self.assertEqual(len(outcome), 1)
        self.assertIn("**Adopted.** It's in [version 0.0.4]", outcome[0])
        self.assertEqual(self.origin_git("tag", "--list", "v*").split(), ["v0.0.2", "v0.0.3", "v0.0.4"])
        self.assertIn("Discussion: <https://github.com/owner/name/issues/1>", (self.repo / "CHANGELOG.md").read_text())

        # Running again doesn't post twice or push anything new.
        head = self.origin_git("rev-parse", "main")
        self.robot_online(rows, now="2026-10-03T13:15:00Z")
        self.assertEqual(self.origin_git("rev-parse", "main"), head)
        self.assertEqual(len([c for c in self.github.comments[number] if c["user"]["type"] == "Bot"]), 1)

    def test_an_issue_opened_by_hand_counts(self):
        rows = [r for r in self.rows() if r["id"] in ("p2",)]
        self.github.issues[1] = {"number": 1, "title": "Proposal", "state": "open", "labels": [],
                                 "body": "Filed on the Maintainers page.\n\n<!-- proposal:p2 -->"}
        self.github.add_comment(1, "nathanreitinger", "/approve\n\nApproved on the Maintainers page.")
        self.robot_online(rows)
        ledger = self.ledger()
        self.assertEqual((ledger["p2"]["issue"], ledger["p2"]["status"], ledger["p2"]["version"]), (1, "adopted", "0.0.3"))
        self.assertEqual(len(self.github.issues), 1)  # no second issue for the same proposal
        self.assertEqual(self.github.issues[1]["state"], "closed")

    def test_the_robot_labels_issues_it_finds_unlabeled(self):
        rows = [r for r in self.rows() if r["id"] in ("p2",)]
        self.github.issues[1] = {"number": 1, "title": "Proposal", "state": "open", "labels": [],
                                 "body": "Filed on the Maintainers page.\n\n<!-- proposal:p2 -->"}
        self.robot_online(rows)
        self.assertEqual(self.github.issues[1]["labels"], [{"name": "proposal"}])
        self.assertIn("**Maintainers:** approve or disapprove it on [Suggest Edits]", self.github.issues[1]["body"])

    def test_a_suggestion_gets_an_issue_once_it_has_settled(self):
        row = {**site_suggestions()[0], "created": "2026-10-03T11:55:00+00:00", "updated": "2026-10-03T11:55:00+00:00"}
        (self.dir / "site.json").write_text(json.dumps({"suggestions": [row], "votes": []}))
        env = {**NO_GIT_SETTINGS, "GH_TOKEN": "test-token", "REPO": "owner/name", "GITHUB_API_URL": self.github.url}
        for now, issues in (("2026-10-03T12:00:00Z", 0), ("2026-10-03T12:06:00Z", 1)):
            self.fixture.write_text("[]")
            result = subprocess.run([sys.executable, "scripts/proposals.py", "--annotations", str(self.fixture), "--site-data",
                                     str(self.dir / "site.json"), "--push", "--now", now], cwd=self.repo, capture_output=True,
                                    text=True, env=env)
            self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
            self.assertEqual(len(self.github.issues), issues)
        body = self.github.issues[1]["body"]
        self.assertIn("**reader@\u2060example.org** (Suggest Edits) proposes a change", body)
        self.assertNotIn("the comment that proposes it", body)

    def test_a_rejected_push_starts_again(self):
        # Someone else pushes first; the robot's push is rejected, so it starts over from GitHub's copy.
        other = self.dir / "other"
        subprocess.run(["git", "clone", "--quiet", str(self.origin), str(other)], check=True)
        readme = other / "README.md"
        readme.write_text(readme.read_text() + "\nA line added elsewhere.\n")
        subprocess.run(["git", "-C", str(other), "-c", "user.name=X", "-c", "user.email=x@example.org", "commit",
                        "--quiet", "-am", "Elsewhere"], check=True)
        subprocess.run(["git", "-C", str(other), "push", "--quiet"], check=True)
        out = self.robot_online([r for r in self.rows() if r["id"] in ("p1", "r1")])
        self.assertIn("Adopted proposal p1 as version 0.0.3", out)
        log = self.origin_git("log", "--format=%s", "main")
        self.assertIn("Elsewhere", log)
        self.assertIn("Version 0.0.3: Replaced", log)
        self.assertEqual(self.origin_git("tag", "--list", "v0.0.3"), "v0.0.3")


if __name__ == "__main__":
    unittest.main()
