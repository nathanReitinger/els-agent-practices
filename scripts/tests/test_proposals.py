"""Tests for the proposals robot: vote counting, and whole runs in a scratch copy of the repository.

    python3 -m unittest discover -s scripts/tests -t scripts/tests
"""

import datetime as dt
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "scripts"))

from fingerprint import fingerprint  # noqa: E402
from proposals import Governance, count_votes, decide, fetch_site, parse_time, vote_of  # noqa: E402
from release import next_version  # noqa: E402

# Like GitHub's machines: no git settings from this computer, and no guessing a name or email from it. Nothing from
# the GitHub run the tests may be part of, either (such as what started it).
NO_GIT_SETTINGS = {**{k: v for k, v in os.environ.items() if not k.startswith(("GITHUB_", "GH_"))},
                   "GIT_CONFIG_GLOBAL": os.devnull, "GIT_CONFIG_NOSYSTEM": "1",
                   "GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "user.useConfigOnly", "GIT_CONFIG_VALUE_0": "true",
                   "ROBOT_RETRY_SECONDS": "0,0"}
MAINTAINERS = json.loads((ROOT / "governance" / "maintainers.json").read_text())
LEAD_EMAIL = MAINTAINERS["maintainers"][0]["email"]
NO_SITE = {"suggestions": [], "votes": []}


def suggestion(id, kind, exact, prefix="", suffix="", new="", email="jane@example.org", reason="",
               created="2026-10-03T10:00:00+00:00", updated=None):
    """A row of the Suggest Edits database's suggestions table, as its API returns it."""
    return {"id": id, "author_id": f"id-{email}", "author_email": email, "kind": kind, "exact": exact, "prefix": prefix,
            "suffix": suffix, "new_text": new, "reason": reason, "base": "0.0.2", "created": created,
            "updated": updated or created}


def site_vote(suggestion, email, vote, at="2026-10-03T11:00:00.123456+00:00", step="patch"):
    """A row of the Suggest Edits database's votes table, as its API returns it."""
    return {"suggestion": suggestion, "voter_id": f"id-{email}", "voter_email": email, "vote": vote, "at": at,
            "version_step": step}


def site_suggestions(email="reader@example.org", start=0):
    """Four suggestions made with the Suggest Edits editor (scripts/tests/suggestions.json), as database rows."""
    rows = json.loads((ROOT / "scripts" / "tests" / "suggestions.json").read_text())["rows"]
    return [{**row, "id": f"0000000{i}-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "author_id": f"id-{email}", "author_email": email,
             "reason": "", "base": "0.0.2", "created": f"2026-10-03T10:0{start + i}:00.000001+00:00",
             "updated": f"2026-10-03T10:0{start + i}:00.000001+00:00"} for i, row in enumerate(rows)]


class VersionsTest(unittest.TestCase):
    def test_the_last_number_goes_up_unless_a_bigger_step_is_chosen(self):
        self.assertEqual(next_version("0.0.3"), "0.0.4")
        self.assertEqual(next_version("0.0.9"), "0.0.10")
        self.assertEqual(next_version("1.2.3"), "1.2.4")
        self.assertEqual(next_version("1.2.3", "minor"), "1.3.0")
        self.assertEqual(next_version("1.2.3", "major"), "2.0.0")
        self.assertEqual(next_version("0.0.3", "major"), "1.0.0")


class VotesTest(unittest.TestCase):
    def setUp(self):
        self.gov = Governance(MAINTAINERS)
        self.record = {"updated": "2026-10-03T10:00:00+00:00", "created": "2026-10-03T10:00:00+00:00",
                       "proposer": {"name": "jane@example.org", "email": "jane@example.org"}}

    def test_maintainer_votes_count_and_others_show_support(self):
        votes, support, stale = count_votes(self.record, [], self.gov, [
            site_vote("p", LEAD_EMAIL.upper(), "approve"),
            site_vote("p", "jane@example.org", "approve"),
            site_vote("p", "reader@example.org", "approve"),
            site_vote("p", "reader2@example.org", "reject"),
            site_vote("p", LEAD_EMAIL, "reject", at="2026-10-03T09:00:00+00:00"),  # older, and before the last edit
        ])
        self.assertEqual([(v.maintainer.name, v.vote, v.via) for v in votes], [("Nathan Reitinger", "approve", "Suggest Edits")])
        self.assertEqual((support, stale), (2, 0))

    def test_votes_before_the_last_edit_are_stale(self):
        votes, _, stale = count_votes(self.record, [], self.gov, [site_vote("p", LEAD_EMAIL, "approve", at="2026-10-03T09:00:00Z")])
        self.assertEqual((votes, stale), ([], 1))

    def test_latest_vote_wins_across_suggest_edits_and_github(self):
        comments = [
            {"user": {"login": "nathanreitinger", "type": "User"}, "body": "/reject not yet",
             "created_at": "2026-10-03T12:00:00Z", "updated_at": "2026-10-03T12:00:00Z", "html_url": "u"},
            {"user": {"login": "github-actions[bot]", "type": "Bot"}, "body": "/approve",
             "created_at": "2026-10-03T13:00:00Z", "updated_at": "2026-10-03T13:00:00Z", "html_url": "u"},
        ]
        votes, _, _ = count_votes(self.record, comments, self.gov, [site_vote("p", LEAD_EMAIL, "approve")])
        self.assertEqual([(v.vote, v.via) for v in votes], [("reject", "GitHub")])

    def test_votes_in_github_comments(self):
        cases = {"Approve": "approve", "approved!": "approve", "/approve": "approve", "**Approve.** Good catch.": "approve",
                 "Reject — this conflicts with rule 2": "reject", "/reject": "reject", "rejects": "reject",
                 "I approve": None, "Approval pending": None, "+1": None, "": None}
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(vote_of(text), expected)

    def test_self_approval_can_be_turned_off(self):
        data = json.loads(json.dumps(MAINTAINERS))
        data["rules"]["maintainers_may_approve_their_own_proposals"] = False
        gov = Governance(data)
        own = {**self.record, "proposer": {"name": LEAD_EMAIL, "email": LEAD_EMAIL}}
        votes, _, _ = count_votes(own, [], gov, [site_vote("p", LEAD_EMAIL, "approve")])
        self.assertEqual(votes, [])

    def test_decisions(self):
        gov = self.gov
        now = parse_time("2026-10-03T12:00:00Z")
        member = gov.maintainers[0]
        from proposals import Maintainer, Vote
        other = Maintainer("Other", "maintainer", "other@example.org", "")
        approve = Vote(member, "approve", now, "Suggest Edits", "")
        reject = Vote(other, "reject", now, "Suggest Edits", "")
        self.assertEqual(decide(self.record, [approve], gov, now), "adopt")
        self.assertEqual(decide(self.record, [approve, reject], gov, now), "wait")
        self.assertEqual(decide(self.record, [reject], gov, now), "decline")
        self.assertEqual(decide(self.record, [], gov, now), "wait")
        gov.hours_open = 48
        self.assertEqual(decide(self.record, [approve], gov, now), "wait")


class RunTest(unittest.TestCase):
    """Whole runs of the robot in a scratch copy of the repository, reading Suggest Edits' data from a file."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="els-robot-"))
        self.repo = self.dir / "repo"
        shutil.copytree(ROOT, self.repo, ignore=shutil.ignore_patterns(".git", "__pycache__", ".claude", ".DS_Store"))
        self.baseline()
        self.git("init", "--quiet", "-b", "main")
        self.git("add", "-A")
        self.git("commit", "--quiet", "-m", "Start")
        self.git("tag", "-a", "v0.0.2", "-m", "Version 0.0.2")
        self.site_file = self.dir / "site.json"

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
        # No database, and no expecting Supabase to start the robot, whatever the live settings are; a test that
        # needs them sets them (set_supabase).
        manifest["supabase"] = {"url": "", "key": "", "starts_robot": False}
        (self.repo / "versions.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n")
        frozen = (self.repo / "versions" / "v0.0.2" / "AGENTS.md").read_bytes()
        (self.repo / "latest" / "AGENTS.md").write_bytes(frozen)
        (self.repo / "draft" / "AGENTS.md").write_bytes(frozen)
        (self.repo / "governance" / "proposals.json").unlink(missing_ok=True)

    def git(self, *args):
        """git in the scratch copy, as a maintainer named Maintainer (the robot must name itself)."""
        return subprocess.run(["git", "-c", "user.name=Maintainer", "-c", "user.email=maintainer@example.org", *args],
                              cwd=self.repo, capture_output=True, text=True, check=True, env=NO_GIT_SETTINGS).stdout.strip()

    def robot(self, site=None, *extra, now="2026-10-03T12:00:00Z"):
        """A run of the robot, offline, with Suggest Edits' suggestions and votes from a file."""
        self.site_file.write_text(json.dumps(site or NO_SITE))
        result = subprocess.run([sys.executable, "scripts/proposals.py", "--site-data", str(self.site_file), "--offline",
                                 "--now", now, *extra], cwd=self.repo, capture_output=True, text=True, env=NO_GIT_SETTINGS)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        return result.stdout

    def ledger(self):
        return {r["id"]: r for r in json.loads((self.repo / "governance" / "proposals.json").read_text())["proposals"]}

    def manifest(self):
        return json.loads((self.repo / "versions.json").read_text())

    def site(self):
        """Suggestions and votes covering every outcome."""
        return {"suggestions": [
            suggestion("p1", "replace", "estimated cost", "would cost money. Give me the ", " first.",
                       "estimated cost and how it's billed", reason="subscriptions differ"),
            suggestion("p2", "delete", "(git)", "isn't under version control ", ", offer to set", email=LEAD_EMAIL,
                       created="2026-10-03T10:05:00+00:00"),
            suggestion("p3", "replace", "random seed", "Set and record a ", " in every script", "", email="reader@example.org",
                       created="2026-10-03T10:10:00+00:00"),
            suggestion("p4", "delete", "words that aren't anywhere in the file", email="reader@example.org",
                       created="2026-10-03T10:15:00+00:00"),
            suggestion("p5", "rule", "Set and record a random seed in every script that samples or simulates.",
                       new="Always work in a cloud notebook.", email="reader@example.org", created="2026-10-03T10:20:00+00:00"),
            suggestion("p6", "delete", "Change only what the task requires, and report other problems instead of fixing them.",
                       email="reader@example.org", created="2026-10-03T10:25:00+00:00", updated="2026-10-03T11:30:00+00:00"),
            suggestion("p7", "replace", "Report null, weak, and surprising results", "", " as plainly as strong ones",
                       "Report every result", email="reader@example.org", created="2026-10-03T10:30:00+00:00"),
            suggestion("p8", "replace", "Report null, weak, and surprising results", "", " as plainly as strong ones",
                       "Report null and surprising findings", email="reader@example.org", created="2026-10-03T10:35:00+00:00"),
        ], "votes": [
            site_vote("sb-p1", LEAD_EMAIL, "approve"),
            site_vote("sb-p2", "jane@example.org", "approve"),
            site_vote("sb-p5", LEAD_EMAIL, "reject"),
            site_vote("sb-p6", LEAD_EMAIL, "approve", at="2026-10-03T11:00:00+00:00"),  # before p6 was last changed
            site_vote("sb-p8", LEAD_EMAIL, "approve"),
        ]}

    def test_a_full_cycle(self):
        out = self.robot(self.site())
        ledger, manifest = self.ledger(), self.manifest()

        # Two approved suggestions became two versions, in order, each with its own fingerprint and tag.
        self.assertEqual(manifest["latest"], "0.0.4")
        self.assertEqual([ledger["sb-p1"]["version"], ledger["sb-p8"]["version"]], ["0.0.3", "0.0.4"])
        self.assertEqual(self.git("tag", "--list", "v*").split(), ["v0.0.2", "v0.0.3", "v0.0.4"])
        for entry in manifest["versions"][:2]:
            frozen = (self.repo / "versions" / f"v{entry['version']}" / "AGENTS.md").read_text()
            self.assertEqual(fingerprint(frozen), entry["fingerprint"])
            self.assertIn(f"Argon2id fingerprint of this file without this line: {entry['fingerprint']}", frozen.split("\n")[2])
        draft = (self.repo / "draft" / "AGENTS.md").read_text()
        self.assertEqual(draft, (self.repo / "latest" / "AGENTS.md").read_text())
        self.assertIn("Give me the estimated cost and how it's billed first.", draft)
        self.assertIn("- Report null and surprising findings as plainly as strong ones", draft)

        # The record says who suggested and approved each change, and why.
        changelog = (self.repo / "CHANGELOG.md").read_text()
        self.assertIn("## [0.0.3] - 2026-10-03", changelog)
        self.assertIn("Proposed by jane@\u2060example.org (Suggest Edits) on 2026-10-03: “subscriptions differ”", changelog)
        self.assertIn("Approved by Nathan Reitinger (Suggest Edits, 2026-10-03)", changelog)
        log = self.git("log", "--format=%an|%s", "-3")
        self.assertIn("jane@example.org|Version 0.0.3: Replaced “estimated cost” with “estimated cost and how it's billed” (Stop and ask).", log)
        self.assertIn("Approved-by: Nathan Reitinger (Suggest Edits)", self.git("log", "-1", "--format=%B", "v0.0.3"))

        # Everything else is recorded with the right status.
        self.assertEqual(ledger["sb-p2"]["status"], "open")
        self.assertEqual(ledger["sb-p2"]["support"], 1)
        self.assertEqual(ledger["sb-p3"]["status"], "needs-fix")
        self.assertEqual(ledger["sb-p4"]["status"], "cannot-apply")
        self.assertEqual(ledger["sb-p5"]["status"], "declined")
        self.assertEqual((ledger["sb-p6"]["status"], ledger["sb-p6"]["stale_votes"]), ("open", 1))
        self.assertEqual(ledger["sb-p7"]["status"], "cannot-apply")  # p8 changed its words first
        self.assertEqual(ledger["sb-p2"]["preview"]["after"],
                         ["If the project isn't under version control, offer to set it up and run it for me. Commit "
                          "before and after each task, with a plain-English message saying what changed and why."])
        self.assertIn("Adopted proposal sb-p1 as version 0.0.3", out)

        # A second run with the same data changes nothing.
        head = self.git("rev-parse", "HEAD")
        self.robot(self.site())
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.assertEqual(self.git("status", "--porcelain"), "")

        # Withdrawing a suggestion closes it; a new approval adopts another.
        site = self.site()
        site["suggestions"] = [s for s in site["suggestions"] if s["id"] != "p6"]
        site["votes"].append(site_vote("sb-p2", LEAD_EMAIL, "approve", at="2026-10-03T12:30:00+00:00"))
        self.robot(site, now="2026-10-03T13:00:00Z")
        ledger = self.ledger()
        self.assertEqual((ledger["sb-p6"]["status"], ledger["sb-p6"]["note"]), ("withdrawn", "The proposer withdrew it."))
        self.assertEqual((ledger["sb-p2"]["status"], ledger["sb-p2"]["version"]), ("adopted", "0.0.5"))
        self.assertIn("version control, offer to set it up", (self.repo / "draft" / "AGENTS.md").read_text())
        verify = subprocess.run([sys.executable, "scripts/fingerprint.py", "--verify"], cwd=self.repo,
                                capture_output=True, text=True)
        self.assertEqual(verify.returncode, 0, verify.stderr)

    def test_dry_run_changes_nothing(self):
        out = self.robot(self.site(), "--dry-run")
        self.assertIn("Would adopt proposal sb-p1 as version 0.0.3", out)
        self.assertIn("Would adopt proposal sb-p8 as version 0.0.4", out)
        self.assertEqual(self.git("status", "--porcelain"), "")
        self.assertEqual(self.git("tag", "--list"), "v0.0.2")

    def test_a_direct_edit_is_published(self):
        path = self.repo / "draft" / "AGENTS.md"
        path.write_text(path.read_text().replace("Never invent values", "Never make up values"))
        self.git("commit", "--quiet", "-am", "Reword rule 3")
        self.robot()
        manifest = self.manifest()
        self.assertEqual(manifest["latest"], "0.0.3")
        self.assertEqual(manifest["versions"][0]["summary"], "Edited directly by Maintainer: Reword rule 3")
        self.assertIn("Never make up values", (self.repo / "latest" / "AGENTS.md").read_text())
        self.assertTrue((self.repo / "governance" / "proposals.json").exists())

    def test_a_direct_edit_can_choose_a_bigger_version_step(self):
        path = self.repo / "draft" / "AGENTS.md"
        path.write_text(path.read_text().replace("Never invent values", "Never make up values"))
        self.git("commit", "--quiet", "-am", "Reword rule 3", "-m", "Version-step: minor")
        self.robot()
        self.assertEqual(self.manifest()["latest"], "0.1.0")

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
        self.robot()
        entry = self.manifest()["versions"][0]
        self.assertEqual((entry["version"], entry["summary"]), ("0.0.3", "Two rewordings from the comments."))
        changelog = (self.repo / "CHANGELOG.md").read_text()
        self.assertIn("Changes to the text, by Maintainer:\n\n- Reword rule 3\n- Reword the seed rule\n", changelog)
        self.assertNotIn("Touch only the version line", changelog)

    def editor_site(self, approved):
        """The editor's four suggestions, with a maintainer's approval of some."""
        rows = site_suggestions("test.reader@example.org")
        return {"suggestions": rows, "votes": [site_vote(f"sb-{rows[i]['id']}", LEAD_EMAIL, "approve") for i in approved]}

    def test_suggestions_from_the_editor_apply_in_any_order(self):
        for first in ([3], [2]):  # the new rule first, or the word change in the rule it follows first
            with self.subTest(first=first):
                self.tearDown()
                self.setUp()
                self.robot(self.editor_site(first))
                self.robot(self.editor_site([0, 1, 2, 3]), now="2026-10-03T13:00:00Z")
                self.assertEqual({r["status"] for r in self.ledger().values()}, {"adopted"})
                self.assertEqual(len(self.ledger()), 4)
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
        self.robot({"suggestions": rows, "votes": votes})
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
        self.robot({"suggestions": [rows[3]], "votes": votes}, now="2026-10-03T12:30:00Z")
        ledger = self.ledger()
        self.assertEqual((ledger[ids[1]]["status"], ledger[ids[1]]["note"]), ("withdrawn", "The proposer withdrew it."))
        self.assertEqual((ledger[ids[3]]["status"], ledger[ids[3]]["stale_votes"]), ("open", 1))
        votes.append(site_vote(ids[3], LEAD_EMAIL, "approve", at="2026-10-03T12:40:00+00:00"))
        self.robot({"suggestions": [rows[3]], "votes": votes}, now="2026-10-03T13:00:00Z")
        self.assertEqual(self.ledger()[ids[3]]["status"], "adopted")
        self.assertIn("- Name the model and its exact version in every log.\n", (self.repo / "draft" / "AGENTS.md").read_text())

    def test_a_maintainer_can_choose_a_bigger_version_step(self):
        rows = site_suggestions()
        ids = [f"sb-{row['id']}" for row in rows]
        votes = [site_vote(ids[0], LEAD_EMAIL, "approve", step="minor"), site_vote(ids[1], LEAD_EMAIL, "approve"),
                 site_vote(ids[2], LEAD_EMAIL, "approve", step="major")]
        self.robot({"suggestions": rows, "votes": votes})
        ledger = self.ledger()
        self.assertEqual([ledger[i].get("version") for i in ids], ["0.1.0", "0.1.1", "1.0.0", None])
        self.assertEqual(ledger[ids[0]]["votes"][0]["step"], "minor")
        self.assertNotIn("step", ledger[ids[1]]["votes"][0])
        self.assertEqual(self.manifest()["latest"], "1.0.0")
        self.assertEqual(self.git("tag", "--list", "v*").split(), ["v0.0.2", "v0.1.0", "v0.1.1", "v1.0.0"])
        self.assertIn("*Version 1.0.0 · Published", (self.repo / "draft" / "AGENTS.md").read_text())

    def test_a_new_section_keeps_its_lines_and_is_published(self):
        site = {"suggestions": [suggestion("s1", "section", "the strongest counterargument.", "", "",
                                           "Language\n  Write   plainly. \n\nDefine every term.", email="reader@example.org")],
                "votes": [site_vote("sb-s1", LEAD_EMAIL, "approve")]}
        self.robot(site)
        record = self.ledger()["sb-s1"]
        self.assertEqual(record["new"], "Language\nWrite plainly.\nDefine every term.")
        self.assertEqual(record["status"], "adopted")
        self.assertEqual(self.manifest()["versions"][0]["summary"], "Added a section: “Language” (after Pushing back).")
        draft = (self.repo / "draft" / "AGENTS.md").read_text()
        self.assertIn("\n\n## Language\n\n- Write plainly.\n- Define every term.\n\n## Evidence before you say done\n", draft)

    def test_a_suggestion_without_its_new_words_needs_a_fix(self):
        self.robot({"suggestions": [suggestion("q", "insert", "plans", new="  ")], "votes": [site_vote("sb-q", LEAD_EMAIL, "approve")]})
        record = self.ledger()["sb-q"]
        self.assertEqual(record["status"], "needs-fix")
        self.assertIn("Type the new words", record["note"])

    def test_suggest_edits_accounts_can_be_ignored(self):
        governance = self.repo / "governance" / "maintainers.json"
        data = json.loads(governance.read_text())
        data["ignored_accounts"]["site"] = ["Spam@Example.org"]
        governance.write_text(json.dumps(data))
        self.git("commit", "--quiet", "-am", "Ignore a spammer")
        self.robot({"suggestions": site_suggestions("spam@example.org"), "votes": []})
        self.assertEqual(self.ledger(), {})

    def test_an_empty_commit_after_a_month_without_any(self):
        self.robot(now="2026-12-20T12:00:00Z")
        self.assertEqual(self.git("log", "-1", "--format=%s"), "Robot: still running")
        self.assertEqual(self.git("show", "--format=", "--name-only", "HEAD"), "")  # empty: no file changed
        self.assertEqual(self.git("log", "-1", "--format=%an"), "github-actions[bot]")
        head = self.git("rev-parse", "HEAD")
        self.robot(now="2026-12-21T12:00:00Z")  # a day later: nothing to do
        self.assertEqual(self.git("rev-parse", "HEAD"), head)
        self.robot(None, "--dry-run", now="2026-12-20T12:00:00Z")
        self.assertEqual(self.git("rev-parse", "HEAD"), head)

    def test_a_changed_frozen_version_stops_the_robot(self):
        frozen = self.repo / "versions" / "v0.0.1" / "AGENTS.md"
        frozen.write_text(frozen.read_text().replace("Never", "Always", 1))
        self.site_file.write_text(json.dumps(NO_SITE))
        result = subprocess.run([sys.executable, "scripts/proposals.py", "--site-data", str(self.site_file), "--offline"],
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
        self.issues, self.comments, self.labels, self.runs = {}, {}, set(), []
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
                    state = query.get("state", "open")
                    items = [i for i in fake.issues.values() if state == "all" or i["state"] == state]
                    return self.reply(200, items[(page - 1) * 100:page * 100])
                if parts == ["actions", "workflows", "proposals.yml", "runs"]:
                    return self.reply(200, {"total_count": len(fake.runs), "workflow_runs": fake.runs})
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

    def robot_online(self, site=None, now="2026-10-03T12:00:00Z", *extra, database=False):
        """A run that pushes and uses GitHub; with database, it reads the database named in versions.json."""
        self.site_file.write_text(json.dumps(site or NO_SITE))
        data = [] if database else ["--site-data", str(self.site_file)]
        env = {**NO_GIT_SETTINGS, "GH_TOKEN": "test-token", "REPO": "owner/name", "GITHUB_API_URL": self.github.url}
        result = subprocess.run([sys.executable, "scripts/proposals.py", *data, "--push", "--now", now, *extra],
                                cwd=self.repo, capture_output=True, text=True, env=env)
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        return result.stdout

    def origin_git(self, *args):
        return subprocess.run(["git", "--git-dir", str(self.origin), *args], capture_output=True, text=True,
                              check=True).stdout.strip()

    def some(self, *ids):
        """Some of the suggestions in site(), with their votes."""
        site = self.site()
        return {"suggestions": [s for s in site["suggestions"] if s["id"] in ids],
                "votes": [v for v in site["votes"] if v["suggestion"].removeprefix("sb-") in ids]}

    def test_issues_votes_on_github_and_pushing(self):
        site = self.some("p1", "p2", "p3")
        self.robot_online(site)
        # The approved suggestion was published and pushed with its tag; the open one got an issue.
        self.assertEqual(self.origin_git("tag", "--list", "v*").split(), ["v0.0.2", "v0.0.3"])
        self.assertEqual(self.origin_git("rev-parse", "main"), self.git("rev-parse", "HEAD"))
        ledger = self.ledger()
        self.assertIsNone(ledger["sb-p1"]["issue"])  # approved before it ever got an issue
        self.assertIsNone(ledger["sb-p3"]["issue"])  # needs a fix: no issue until it can be voted on
        number = ledger["sb-p2"]["issue"]
        issue = self.github.issues[number]
        self.assertIn("<!-- proposal:sb-p2 -->", issue["body"])
        self.assertIn("control <del>(git)</del>, offer", issue["body"])
        self.assertTrue(issue["title"].startswith("Proposal: Delete “(git)”"))
        self.assertIn("proposal", self.github.labels)

        # A maintainer votes on the issue; the next run adopts it, pushes, and closes the issue.
        self.github.add_comment(number, "NathanReitinger", "/approve looks right")
        self.github.add_comment(number, "someone-else", "/reject")
        self.robot_online(site, now="2026-10-03T13:00:00Z")
        ledger = self.ledger()
        self.assertEqual((ledger["sb-p2"]["status"], ledger["sb-p2"]["version"]), ("adopted", "0.0.4"))
        self.assertEqual(ledger["sb-p2"]["votes"][0]["via"], "GitHub")
        self.assertEqual(self.github.issues[number]["state"], "closed")
        self.assertEqual(self.github.issues[number]["state_reason"], "completed")
        outcome = [c["body"] for c in self.github.comments[number] if c["user"]["type"] == "Bot"]
        self.assertEqual(len(outcome), 1)
        self.assertIn("**Adopted.** It's in [version 0.0.4]", outcome[0])
        self.assertEqual(self.origin_git("tag", "--list", "v*").split(), ["v0.0.2", "v0.0.3", "v0.0.4"])
        self.assertIn("Discussion: <https://github.com/owner/name/issues/1>", (self.repo / "CHANGELOG.md").read_text())

        # Running again doesn't post twice or push anything new.
        head = self.origin_git("rev-parse", "main")
        self.robot_online(site, now="2026-10-03T13:15:00Z")
        self.assertEqual(self.origin_git("rev-parse", "main"), head)
        self.assertEqual(len([c for c in self.github.comments[number] if c["user"]["type"] == "Bot"]), 1)

    def test_an_issue_opened_by_hand_counts(self):
        self.github.issues[1] = {"number": 1, "title": "Proposal", "state": "open", "labels": [],
                                 "body": "Opened by hand.\n\n<!-- proposal:sb-p2 -->"}
        self.github.add_comment(1, "nathanreitinger", "/approve")
        self.robot_online(self.some("p2"))
        ledger = self.ledger()
        self.assertEqual((ledger["sb-p2"]["issue"], ledger["sb-p2"]["status"], ledger["sb-p2"]["version"]), (1, "adopted", "0.0.3"))
        self.assertEqual(len(self.github.issues), 1)  # no second issue for the same suggestion
        self.assertEqual(self.github.issues[1]["state"], "closed")

    def test_the_robot_labels_issues_it_finds_unlabeled(self):
        self.github.issues[1] = {"number": 1, "title": "Proposal", "state": "open", "labels": [],
                                 "body": "Opened by hand.\n\n<!-- proposal:sb-p2 -->"}
        self.robot_online(self.some("p2"))
        self.assertEqual(self.github.issues[1]["labels"], [{"name": "proposal"}])
        self.assertIn("**Maintainers:** approve or disapprove it on [Suggest Edits]", self.github.issues[1]["body"])

    def test_a_suggestion_gets_an_issue_once_it_has_settled(self):
        row = {**site_suggestions()[0], "created": "2026-10-03T11:55:00+00:00", "updated": "2026-10-03T11:55:00+00:00"}
        for now, issues in (("2026-10-03T12:00:00Z", 0), ("2026-10-03T12:06:00Z", 1)):
            self.robot_online({"suggestions": [row], "votes": []}, now)
            self.assertEqual(len(self.github.issues), issues)
        body = self.github.issues[1]["body"]
        self.assertIn("**reader@\u2060example.org** (Suggest Edits) proposes a change", body)

    def set_supabase(self, **settings):
        manifest = json.loads((self.repo / "versions.json").read_text())
        manifest["supabase"].update(settings)
        (self.repo / "versions.json").write_text(json.dumps(manifest, indent=2))
        self.git("commit", "--quiet", "-am", "Supabase settings")
        self.git("push", "--quiet")

    def alerts(self, state="open"):
        return [i for i in self.github.issues.values() if "<!-- alert:" in i["body"] and i["state"] == state]

    def test_an_issue_when_supabase_stops_starting_the_robot(self):
        self.set_supabase(starts_robot=True)
        self.robot_online()
        [issue] = self.alerts()
        self.assertEqual(issue["title"], "Supabase isn't starting the robot")
        self.assertIn("@nathanReitinger", issue["body"])
        self.assertIn("The last start was never.", issue["body"])
        self.assertIn("expires_in=none&actions=write", issue["body"])
        self.assertIn("select robot.set_token(", issue["body"])
        self.robot_online(None, "2026-10-03T12:20:00Z")
        self.assertEqual(len(self.github.issues), 1)  # not opened twice

        self.github.runs = [{"created_at": "2026-10-03T12:30:00Z", "event": "workflow_dispatch"}]
        self.robot_online(None, "2026-10-03T12:35:00Z")
        self.assertEqual(self.alerts(), [])
        self.assertEqual(self.alerts("closed")[0]["state_reason"], "completed")
        self.assertIn("Working again", self.github.comments[issue["number"]][-1]["body"])

        # Six hours without a start: it opens again.
        self.robot_online(None, "2026-10-03T19:00:00Z")
        self.assertIn("The last start was October 03, 2026, at 12:30 UTC.", self.alerts()[0]["body"])

    def test_an_issue_when_the_database_falls_behind(self):
        """Supabase runs supabase/schema.sql and supabase/robot.sql itself when they change; the robot checks it did."""
        self.set_supabase(starts_robot=True)
        changed = int(self.git("log", "-1", "--format=%ct", "--", "supabase/robot.sql"))
        at = lambda hours: dt.datetime.fromtimestamp(changed + hours * 3600, dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        self.github.runs = [{"created_at": at(5), "event": "workflow_dispatch"}]  # Supabase is starting the robot
        files = ("supabase/schema.sql", "supabase/robot.sql")
        md5 = {name: hashlib.md5((self.repo / name).read_bytes()).hexdigest() for name in files}

        def status(**changes):
            rows = [{"file": name, "applied_md5": md5[name], "applied_at": at(0), "error": None, "failed_at": None,
                     **changes.get(name.split("/")[1].split(".")[0], {})} for name in files]
            return {**NO_SITE, "schema_status": rows}

        self.robot_online(status(), at(2))  # up to date
        self.assertEqual(self.alerts(), [])
        # A file that didn't run: an issue at once, with the error and what to do.
        self.robot_online(status(robot={"error": 'syntax error at or near "this"', "failed_at": at(2)}), at(2.1))
        [issue] = self.alerts()
        self.assertEqual(issue["title"], "The database hasn't taken the latest supabase/ files")
        self.assertIn("@nathanReitinger", issue["body"])
        self.assertIn("syntax error at or near", issue["body"])
        self.assertIn("paste the whole of `supabase/robot.sql`", issue["body"])
        self.robot_online(status(), at(2.2))  # fixed
        self.assertEqual(self.alerts(), [])
        # Behind: a changed file is given an hour to reach the database.
        self.robot_online(status(schema={"applied_md5": "an older version"}), at(0.5))
        self.assertEqual(self.alerts(), [])
        self.robot_online(status(schema={"applied_md5": "an older version"}), at(2.3))
        self.assertIn("but the database still has an older version", self.alerts()[0]["body"])
        self.robot_online(status(), at(2.4))
        # A database that doesn't update itself yet: six hours after robot.sql changed, an issue.
        self.robot_online({**NO_SITE, "schema_status": None}, at(3))
        self.assertEqual(self.alerts(), [])
        self.robot_online({**NO_SITE, "schema_status": None}, at(7))
        self.assertIn("doesn't update itself yet", self.alerts()[0]["body"])

    def test_an_issue_when_the_ai_check_fails(self):
        """The AI check of new rules (supabase/robot.sql): an issue if its checks keep failing or it reaches its daily
        limit, and none while it's off or working."""
        self.set_supabase(starts_robot=True)
        self.github.runs = [{"created_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "event": "workflow_dispatch"}]

        def status(**fields):
            return {**NO_SITE, "rule_check_status": {"on": True, "asked_today": 4, "answered_today": 4, "failed_today": 0,
                                                     "daily_limit": 100, "last_error": None, **fields}}

        self.robot_online(status())
        self.assertEqual(self.alerts(), [])
        self.robot_online(status(on=False, failed_today=9, answered_today=0))  # off: nothing to report
        self.assertEqual(self.alerts(), [])
        self.robot_online(status(answered_today=0, failed_today=2, last_error="HTTP 401: invalid x-api-key"))
        self.assertEqual(self.alerts(), [])  # two failures could be a passing outage
        self.robot_online(status(answered_today=0, failed_today=3, last_error="HTTP 401: invalid x-api-key"))
        [issue] = self.alerts()
        self.assertEqual(issue["title"], "The AI check of new rules needs attention")
        self.assertIn("invalid x-api-key", issue["body"])
        self.assertIn("robot.set_anthropic_key", issue["body"])
        self.assertNotIn("sk-ant-", issue["body"].replace("'sk-ant-...'", ""))
        self.robot_online(status())  # working again
        self.assertEqual(self.alerts(), [])
        self.robot_online(status(asked_today=100))
        self.assertIn("limit of 100 checks a day", self.alerts()[0]["body"])

    def test_no_issue_until_supabase_starts_the_robot(self):
        self.robot_online()
        self.assertEqual(self.alerts(), [])

    def test_an_issue_when_the_database_doesnt_answer(self):
        import http.server
        import threading
        answer = {"code": 503}

        class Database(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                body = b"[]" if answer["code"] == 200 else b'{"message": "unavailable"}'
                self.send_response(answer["code"])
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Database)
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            self.set_supabase(url=f"http://127.0.0.1:{server.server_address[1]}", key="sb_publishable_test")
            out = self.robot_online(None, "2026-10-03T12:00:00Z", database=True)
            self.assertIn("Couldn't read the suggestions from Suggest Edits", out)
            [issue] = self.alerts()
            self.assertEqual(issue["title"], "The Suggest Edits database isn't answering")
            self.assertIn("HTTP Error 503", issue["body"])
            self.assertIn("choose **Restore**", issue["body"])
            answer["code"] = 200
            self.robot_online(None, "2026-10-03T12:10:00Z", database=True)
            self.assertEqual(self.alerts(), [])
        finally:
            server.shutdown()
            server.server_close()

    def test_a_rejected_push_starts_again(self):
        # Someone else pushes first; the robot's push is rejected, so it starts over from GitHub's copy.
        other = self.dir / "other"
        subprocess.run(["git", "clone", "--quiet", str(self.origin), str(other)], check=True)
        readme = other / "README.md"
        readme.write_text(readme.read_text() + "\nA line added elsewhere.\n")
        subprocess.run(["git", "-C", str(other), "-c", "user.name=X", "-c", "user.email=x@example.org", "commit",
                        "--quiet", "-am", "Elsewhere"], check=True)
        subprocess.run(["git", "-C", str(other), "push", "--quiet"], check=True)
        out = self.robot_online(self.some("p1"))
        self.assertIn("Adopted proposal sb-p1 as version 0.0.3", out)
        log = self.origin_git("log", "--format=%s", "main")
        self.assertIn("Elsewhere", log)
        self.assertIn("Version 0.0.3: Replaced", log)
        self.assertEqual(self.origin_git("tag", "--list", "v0.0.3"), "v0.0.3")


if __name__ == "__main__":
    unittest.main()
