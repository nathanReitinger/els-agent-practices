# Best Practices for Working with AI Agents in Empirical Legal Research

*Version 0.2.0-draft · Working draft: anyone can edit it, and every edit is logged · Latest published version: <https://nathanreitinger.github.io/els-agent-practices/>*

*A living document, started by Nathan Reitinger (Northwestern Law) with contributions from the people listed at the end. The first draft was written with Claude Code (Claude Opus 5.5). Anyone can edit it; see "How to contribute" at the end.*

**Who this is for.** Empirical legal scholars, and the students and RAs who work with them, who use AI agents in research they plan to publish. By "agent" we mean tools like Claude Code, Codex, Cursor, or Gemini CLI that read your files, write and run code, and carry out multi-step tasks, not just a chat window. Most of this applies to chat assistants too; agents raise the stakes because they act on your files directly. You don't need to be able to code to follow most of it. You do need to check.

**Why a separate guide.** Agents can now do much of the mechanical work of an empirical project: collecting and cleaning data, coding documents, running models, building dashboards, drafting and checking prose. They are fast and capable, and they fail differently than human research assistants do. They also inherit every old problem in empirical legal research, from unrepresentative case samples to unreliable coding, and can make those problems faster and harder to see. These practices aim to keep the speed while making sure the work survives a referee, a replication attempt, and a skeptical reader.

**How it's organized.** Part 1 is the short version: eight principles. Part 2 turns them into practices by research stage, numbered so you can cite them ("see D6"). Part 3 is a pre-submission checklist. The appendices have a starter instruction file for your agent and prompts worth reusing. Sources are cited by author and year and listed under Further reading.

*Nothing here replaces your institution's policies, your IRB, or a venue's rules.*

---

## Part 1: Eight principles

**1. You are the author; the agent is a research assistant.** Responsibility doesn't delegate. Before anything goes out under your name, you should be able to defend every number, quote, citation, and line of code as if you had produced it yourself.

**2. Verification is the bottleneck.** Agents make producing code, data, and prose nearly free; checking them is not. Design each task so its output is cheap to check: small steps, logged counts, quoted sources, and viewers that put the agent's output next to the original. If you can't evaluate the output, don't delegate the task.

**3. Fluency is not accuracy.** Agent output is just as polished and confident when it's wrong as when it's right. The cues you'd use to judge a human RA (sloppiness, hesitation, "I wasn't sure about this one") are missing unless you ask for them. Judge by evidence, not tone.

**4. The dangerous errors are silent decisions, not crashes.** Code that fails is easy to catch. The real risk is a plausible choice made without telling you: dropping missing values, deduplicating, choosing how to join two datasets, collapsing categories, resolving an ambiguous coding rule. Software defaults are decisions too; many statistical commands quietly drop every row with a missing value. In empirical work, these choices can be the finding.

**5. Agents optimize for "done."** When something fails, an agent may loosen the test, drop the troublesome rows, plug in a placeholder value, or quietly switch methods, and then report success. Make "never change the data, the tests, or the specification to make something work" a standing rule, and check that it's followed.

**6. Speed multiplies researcher degrees of freedom.** An agent can run fifty specifications, or fifty wordings of a coding prompt, before lunch. Without a plan written in advance, you'll drift, without meaning to, toward the version that works. Fix the scope, the codebook, and the main analysis before you look at results, and keep a record of everything you ran.

**7. Agents tend to agree with you.** They're built to be helpful, which can shade into confirming your hypothesis or praising your draft. Don't tell the agent what you hope to find when it's measuring or critiquing, ask it for the strongest counterargument, and use fresh sessions (new conversations with no memory of this one) as skeptical reviewers.

**8. Spend the time you save on rigor.** The same tools that create these risks make rigor cheap: tests, logs, double coding, independent replication, documentation, replication packages. These are the things that used to get skipped because they were tedious. The goal isn't the same quality faster; it's higher quality in the same time.

---

## Part 2: Practices by stage

### A. Before you start

*An agent can set up most of this in a few minutes. Ask it to.*

**A1. Assume the AI provider sees everything the agent reads, and check your data's terms first.** Whatever the agent opens, or its commands print, goes to the model provider. Data use agreements and licenses may forbid that. ICPSR, for example, treats uploading even its public-use files to an AI tool that retains inputs as prohibited redistribution (ICPSR 2024), and commercial legal databases (Westlaw, Lexis, Bloomberg) often restrict bulk downloading and use with AI tools. Know which account you're on, too: personal plans run under consumer terms, which may allow training on your sessions and long retention (Anthropic 2025), while institutional and API accounts usually have stricter terms. Use your institution's approved tools, and ask your library or counsel before, not after.

**A2. Tell your IRB, and your participants, when their data will pass through an AI service.** IRBs increasingly ask which tools you'll use, whether the data are identifiable, and how you'll check the outputs (see, e.g., Lehigh University n.d.), and consent forms written before you used AI may not cover it. For client material, such as clinic files or a practitioner coauthor's documents, ABA Formal Opinion 512 requires the client's informed consent before confidential information goes into a self-learning AI tool (ABA 2024).

**A3. Keep restricted data out of the agent's reach.** "Don't look in that folder" is not a safeguard; keeping the data somewhere the agent can't reach is. Two patterns work. The agent writes code against the codebook and a synthetic or redacted sample, and you run it on the real data yourself and share back only aggregate results. Or, for model-based coding of restricted documents, you use an open-weight model (one you can download and run yourself) on your own machine or your institution's research computing cluster. Running locally isn't automatically compliant, though: some restricted data may be used only in an approved environment cut off from the internet (ICPSR 2024).

**A4. Put the project under version control (git) from day one.** Git records every change to every file. Commit before and after each agent task and you get an exact record of what changed and a one-step undo. You don't need to know git; the agent can run it for you. Keep restricted data out of anything you push online.

**A5. Use a standard folder layout, and make raw data read-only.** Original data is never edited; every transformation is a script that writes somewhere else. Enforce read-only with file permissions (on Mac or Linux: `chmod -R a-w data/raw`), not just an instruction. A layout that works:

```
my-project/
  CLAUDE.md          standing instructions for the agent (or AGENTS.md)
  README.md          how to reproduce everything, start to finish
  ANALYSIS_PLAN.md   written before you look at results
  DECISIONS.md       every judgment call: date, decision, alternatives, reason
  LOG.md             what was done each session, including every model run
  data/raw/          original data; read-only
  data/derived/      written only by scripts
  code/              numbered scripts: 01_collect, 02_clean, 03_code, 04_analyze
  output/            tables, figures, model-coded data, raw model responses
  docs/              codebook, search log, data sources and their terms, AI-use log
```

**A6. Work in a language you can read, or verify outputs instead.** If you read Stata or R, have the agent use it; agents tend to default to Python. If you don't read code, you can still do rigorous work, but your checks have to be on outputs: known answers (C6), side-by-side viewers (C7), and counts (C4). Either way, ask for a plain-English account of each step and of what each model estimates.

**A7. Give the agent a standing instruction file.** This is a short file in the project folder that the agent reads at the start of every session: what the project is, the rules for data, analysis, and citations, and the quirks of your data. Claude Code reads `CLAUDE.md` (recent versions also read `AGENTS.md`); many other agents read `AGENTS.md`. Keep it with your replication materials, since it shaped the agent's work (H2). Appendix A has a starter.

**A8. Record where every dataset came from.** Source, URL, date accessed, version or release, license or terms, and the query or steps used to get it. Agents keep this log well if asked, and not at all if not.

**A9. Write down each dataset's known traps, and test for them.** Standard legal datasets have documented quirks that an agent won't know unless you tell it. In the Administrative Office's federal court data, award amounts were recorded in thousands and capped at 9999, a value also used for missing amounts, which inflated mean awards in studies that missed it (Eisenberg & Schlanger 2003). The FJC's Integrated Database overwrites records every quarter, so the same pull can differ later, and some fields, such as pro se and in forma pauperis status, get no quality checks (FJC n.d.). The Songer appeals database samples only published opinions and needs weights (Songer Project n.d.). List the traps for your data in the instruction file, and turn each into a check (C5).

### B. Directing the work

**B1. Plan first, then execute.** For anything multi-step, ask for a plan, the assumptions behind it, and the judgment calls it expects to make, and invite questions. Edit the plan, then approve it. (In Claude Code, use plan mode: in the terminal, press Shift+Tab until it shows plan mode; in the desktop app, type `/plan`.)

**B2. Work in small, checkable steps, and define "done."** "Write a script that downloads the 2010–2020 dockets, reports how many it got, and stops" beats "build the dataset." Say what done looks like: which files exist, what runs, what gets printed.

**B3. Make the agent surface its decisions.** Every analytic choice (exclusions, deduplication, merges, recodes, ambiguous cases) goes in `DECISIONS.md` with the alternatives and the reason. Anything that could change results needs your sign-off first.

**B4. Demand evidence, not assurances.** "Done," "verified," and "all tests pass" are claims. Ask for the command and its output, the row counts, the test results, and a clear line between what it checked and what it assumed. Before accepting changes, look at the diff (the list of exact changes); agents sometimes change more than they were asked to.

**B5. Keep state in files, not in the conversation.** Chats end, get summarized, and lose detail. The plan, decisions, codebook, and running log live in the project folder. Start each session by pointing the agent to them.

**B6. Start fresh sessions for new tasks.** Long sessions accumulate stale assumptions, and quality drops. When the agent starts going in circles, stop, clear, and restate the task better instead of arguing with it. (Claude Code: `/clear`.)

**B7. Turn every correction into a written rule.** When you correct the agent about your data or your field ("in this dataset, 'dismissed' includes voluntary dismissals"), add the rule to the instruction file. Otherwise you'll make the same correction next week.

### C. Collecting and cleaning data

**C1. Define the case universe before you search, and make the search rerunnable.** Write down which cases belong in the study before running any searches. Then save each query, the database, the date run, and the full list of hits, and report the screening in a flow diagram (hits, exclusions by reason, final sample), with a second person screening a random subset. The same query can return quite different cases on different research platforms (Mart 2017), so the record of the search is part of the data (Hall & Wright 2008; Chin et al. 2021).

**C2. Know which slice of the courts your source covers, and claim no more.** Most federal appellate decisions are unpublished: 85.6 percent of merits decisions in the regional circuits in fiscal 2024, from 60.7 percent in the D.C. Circuit to 92.3 percent in the Ninth (Administrative Office 2024). Publication isn't random; it has tracked reversal and the panel's characteristics (Merritt & Brudney 2001). Databases have gaps too. The Caselaw Access Project covers opinions published in books, through 2020 (Caselaw Access Project n.d.), and court websites and PACER have left many district court opinions effectively hidden (Martin 2018). Check completeness against dockets where you can, and describe findings as being about the population your source actually covers.

**C3. Verify before every point of no return.** Before a large download, an expensive coding run, a merge, or the move to analysis, stop and check. Errors get more expensive the further downstream they're found, and some steps, like rate-limited scrapes and paid model runs, can't be cheaply redone. Ask the agent "How could this be wrong? What might you have missed?" Then check its answer yourself.

**C4. Log counts at every step, and reconcile them against an independent source.** Every script that filters, merges, or reshapes prints the number of rows before and after. That gives you the attrition table (raw N, exclusions by reason, analysis sample) for free, and it catches merges that silently duplicate or drop cases. Where you can, check counts against something the agent didn't produce: the source's own totals, a count you made yourself, a published figure.

**C5. Write your expectations into the code.** These are checks that fail loudly: case IDs are unique, dates fall in range, categories match the codebook, nothing is unexpectedly missing, and none of the dataset traps in A9 slipped through. You decide what should be true; the agent encodes it. A check the agent derived from the very data it's checking proves nothing.

**C6. Test against known answers first.** Before running a pipeline on 50,000 opinions, run it on 25 you've coded by hand, or reproduce a published number from the same data. If it can't get the answers you know, don't trust the ones you don't.

**C7. Look at the data yourself, with tools built for the job.** Pull a random sample (not the first rows, which are often atypical) and check it against the source documents at every major stage. Agents are good at building tools that make this fast: a side-by-side viewer with the PDF on the left and the extracted or coded values on the right; a dashboard where clicking a bar shows the documents behind it; a plain-text list of every record you can keyword-search. Building one takes minutes and makes checking hundreds of records realistic.

**C8. Review fuzzy matches by hand.** Matching the names of parties, judges, firms, and counsel is where legal-data pipelines quietly go wrong. Have the agent show you the matches near its cutoff, and record the cutoff as a decision.

**C9. Scrape responsibly, and watch the meter.** Check the terms of service and robots.txt (the site's rules for automated access), space out your requests, and identify yourself. Some sources charge per page (PACER), and an agent's retry loop can run up a real bill. Run a small sample first, and set spending caps on paid services.

**C10. Treat downloaded documents as untrusted input.** Web pages and PDFs can contain hidden text written to give the agent instructions ("prompt injection"). An agent reading scraped material shouldn't also have access to credentials or sensitive files, and you should read what it proposes to do before approving it.

### D. Using language models to code legal texts

Pulling the docket number, date, court, and parties from a document is *extraction*: there's a right answer on the page, and you can spot-check it. Deciding what argument a plaintiff made, or whether a court applied a particular test, is *classification*. That's measurement, and it should be held to the standards of content analysis with human coders, plus a few new ones. Most of this section applies to human coders too.

**D1. Name the unit of analysis.** An opinion, a case, a docket, an issue, a judge's vote, and a defendant each produce a different N, and agents switch between them without noticing. The FJC's criminal data, for example, count defendants, not cases (FJC n.d.). Say up front how you'll count consolidated cases, multiple opinions in one case, and mixed dispositions such as "affirmed in part, reversed in part" (Hall & Wright 2008).

**D2. Write the codebook first.** Definitions, decision rules, edge cases, and examples, written so a human coder could follow them. Code more finely than you plan to analyze, and collapse categories by a rule written in advance; you can always combine categories later, but you can't split them (Hall & Wright 2008). Keep an "other" category and read what lands in it; that's where the codebook needs work.

**D3. Check that the model follows your codebook, not its own idea of the label.** Models often apply their own sense of what a legal term means instead of your definition. Test for it: shuffle the order of the categories, swap the label names for neutral ones, run the codebook's own examples through, and add an exclusion rule to see whether the model honors it (Halterman & Keith 2026).

**D4. Validate against blind, double human coding.** Draw a random sample and have two people code it independently, without seeing the model's answers, at the pilot stage and again with the final codebook. Report chance-corrected agreement (Cohen's κ or Krippendorff's α) for each variable, and the model's accuracy, precision, and recall for each category (precision: how often a label is right when the model assigns it; recall: what share of the true cases it finds). For rare codes, report agreement on the cases where either coder marked the code present. This has been the exception in legal research: only 14 percent of the 134 content-analysis projects Hall & Wright reviewed reported any quantitative measure of reliability (Hall & Wright 2008). A second model makes a cheap extra coder for flagging hard cases, but two models agreeing isn't validation; they can share the same blind spots.

**D5. Keep the coder blind.** Knowing the outcome changes how coders code everything else. In the Supreme Court Database, the issue codes assigned to cases were conditional on the disposition and on the known preferences of the deciding Court, which skews the database's "direction" variables (Harvey & Woodruff 2013). When coding inputs, hide the disposition unless the codebook needs it, and never show the model your hypothesis. In practice, have the agent write a script that sends each document to the model with only the codebook, rather than asking the agent to code documents itself in a session that knows what you hope to find.

**D6. Develop prompts on one sample, then freeze the model, prompt, and settings before you look at results.** Coding choices are researcher degrees of freedom too. Replicating 37 annotation tasks from 21 published studies, one team found that model-based coding led to incorrect conclusions for about 31 percent of hypotheses even with state-of-the-art models, and that a handful of prompt paraphrases could make virtually anything statistically significant (Baumann et al. 2025). Formatting changes alone have moved accuracy by up to 76 points (Sclar et al. 2024). Tune prompts on a development sample (never on your validation set, which overstates accuracy), freeze them, and report how the main result holds up under reasonable alternative prompts or models.

**D7. Look at where it fails.** Errors that cluster by court, era, document length, or outcome can bias your results even when overall accuracy looks high. Check error rates across the groups your analysis compares.

**D8. Carry measurement error into the analysis.** Treating model labels as ground truth can bias downstream estimates. Use methods built for imperfect labels, such as design-based supervised learning (Egami et al. 2023), or at minimum show how the main result compares in the human-coded sample.

**D9. Run the coding more than once, and record everything.** Even settings meant to be deterministic can vary: one study found accuracy differences of up to 15 percent across runs (Atil et al. 2024). Run the coding at least twice and report how often the runs agree. Record the exact model identifier (not just "Claude" or "GPT"), how you accessed it, the prompt, the settings, and the dates, and save every raw response. Hosted models get updated and retired, so your replication package should include the outputs, not just the code that produced them (Barrie, Palmer & Spirling 2024). Open-weight models can be archived and rerun later, a real advantage for replication, but save their outputs too.

**D10. Treat a prompted commercial model as a baseline, not the default.** Across 260 legal annotation tasks, small open models fine-tuned on a few hundred to a thousand labeled examples usually beat prompted commercial models (Dominguez-Olmedo et al. 2025; see also Thalken et al. 2023), and performance varies a great deal from one legal task to another (Guha et al. 2023). If you already have human-coded examples from validation (D4), try a fine-tuned model and compare.

**D11. Pilot before you scale.** Run about 1 percent of the corpus, check the outputs and the cost, then run the rest.

### E. Analysis

**E1. Write the analysis plan before you look at results.** The plan covers the unit of analysis (D1), outcome, sample, key variables, model, standard errors (including clustering), and main hypotheses, dated and committed to the repository, or formally preregistered. When the outcomes are in the documents you're coding, "before you look at results" means before you read the sample: freeze the scope and the codebook first, and disclose any cases you read in advance (Chin et al. 2021). An agent can help draft the plan by interviewing you, and it's good at spotting what you left unspecified, but the decisions are yours. Deviations are fine; undisclosed deviations are not.

**E2. Log every specification, and label exploration as exploration.** Have the agent record every model it runs and the key estimate in `LOG.md`, not just the ones you'll report. If you ask the agent to explore ("you tell me which variables make sense"), treat what it finds as a hypothesis to test under a fresh plan, ideally on new data. When robustness matters, use the agent's speed to run every reasonable specification and show the whole distribution of estimates (a "specification curve"; Simonsohn, Simmons & Nelson 2020), in the open rather than as a private search.

**E3. Don't let the agent change the question to get an answer.** No changes to the sample, specification, tests, or data to make code run or results appear; it should stop and report instead. Watch for quiet switches: from logit to OLS after a convergence warning, a dropped fixed effect, an outlier excluded "temporarily."

**E4. Independently re-implement your key results.** Give a fresh session, or a different model, only the analysis plan and the raw data, and have it reproduce the main estimates without seeing your code. Discrepancies reveal bugs and decisions the plan left unstated. This kind of double-entry check was expensive with human RAs; now it's cheap enough to do routinely.

**E5. Commission a hostile referee.** In a fresh session, ask the agent to attack your findings: selection (which disputes get litigated, which get settled, which opinions get published; Priest & Klein 1984; C2), confounding, measurement, alternative explanations, coding errors. Don't say which result you're hoping for. Student-edited law reviews rarely give empirical work a methods review, so for a law review article this may be the only methods review the paper gets before publication; ask a colleague, too (Chin & Zeiler 2021).

### F. Legal sources and citations

**F1. Retrieve, don't recall.** Never accept a citation the agent produced from memory. It should find the source (CourtListener, the Caselaw Access Project, govinfo, the journal's site, or documents you provide) and give you the exact passage and pin cite supporting each proposition, with a link or file path. Free sources have coverage gaps (C2), so a missing case may be missing from the database, not from the law.

**F2. Check the proposition, not just the existence.** Invented cases are the famous failure. A more common failure, and a harder one to catch, is a real case with the wrong holding, a misquoted passage, a wrong pin cite, or a case since reversed. A human checks quote, pin cite, proposition, and subsequent history, preferably with two citators, since citators also miss and mislabel negative treatment (Hellyer 2018). That includes output from commercial legal AI tools, which also make these errors (Magesh et al. 2025).

**F3. The agent finds; you read.** Agents are good at searching and triaging literature and unreliable at characterizing what a study found. Read anything you cite, and treat summaries as leads. If the agent couldn't open the document, its summary is a guess.

**F4. Read every source yourself before you sign anything.** Expert declarations, amicus briefs, and testimony carry the highest stakes. A federal court excluded an academic expert's declaration because it cited sources that GPT-4o had invented (Kohls v. Ellison 2025), and courts now answer fabricated citations with sanctions up to disqualification and referral to the bar (Johnson v. Dunn 2025; Noland v. Land of the Free 2025). Journals are acting too: Stanford Law Review's policy lets it rescind acceptance over hallucinated sources (Stanford Law Review 2026).

### G. Writing and reviewing

**G1. Use the agent as an editor and critic, not as the author.** It's very good at finding unclear passages, gaps in an argument, missing counterarguments, and inconsistencies. The arguments, the characterizations of the literature, and the claims about the law should be yours. Some venues expect even feedback on your argument to be disclosed (G4).

**G2. Generate the numbers in the text from the code.** Dynamic documents (Quarto, R Markdown, Stata's `dyndoc`) or values exported by the analysis script keep text and results from drifting apart. At minimum, have the agent check every number in the draft against the output.

**G3. Match the language to the design.** "Caused," "led to," and "the effect of" need a causal design. Even "correlation" has a specific meaning that a regression coefficient may not match. Agents readily upgrade associations into confident causal prose.

**G4. Disclose AI help with the research, not just the writing, and keep the log that makes disclosure accurate.** Publishers broadly agree on a core: an AI tool can't be an author, you're responsible for everything it produced, and research uses (code, data collection, document coding, analysis) are disclosed, usually in the methods section, with the tool, version, dates, task, and how you checked the output (COPE 2023; Wiley n.d.; Oxford University Press 2026; Elsevier 2026). Some add steps: Oxford journals, including the Journal of Legal Analysis, also want it in the cover letter, and Elsevier wants a separate declaration. Basic grammar and spelling help is often exempt. Law reviews vary: Stanford Law Review asks for a footnote disclosing significant use, including in empirical analysis, and California Law Review has authors sign an AI use and disclosure agreement (Stanford Law Review 2026; California Law Review 2026). Undisclosed use can lead to rejection or retraction. Log as you go: tool, model and version, date, task, files, prompts, outputs, and how you checked them.

**G5. When you review, keep other people's work out of AI tools.** Wiley bars uploading manuscripts under review to AI tools, Springer Nature bars uploading them to unsecured ones, and NIH and NSF bar it in grant review (Wiley n.d.; Springer Nature 2026; NIH 2023; NSF 2023). Assume confidentiality rules apply unless the venue says otherwise.

### H. Sharing data and replication

**H1. Check the venue's data policy before you collect, not after.** Some journals require data and code before publication (for example, the Journal of Law and Economics), and the Journal of Legal Analysis requires a deposit it can use to reproduce the results before acceptance. Others only encourage sharing, and most top student-edited law reviews had no transparency guidelines when surveyed (Chin & Zeiler 2021). Only about 15 percent of empirical legal studies have a readily available dataset (Matthews & Rantanen 2025; see also Chin et al. 2023). Policies change, so check the current one, and plan to meet the strictest you might face.

**H2. Build the replication package as you go.** It needs a master script that runs everything from raw data to every table and figure; a README (the Social Science Data Editors' template is a good default); recorded software and package versions (for example, `renv` for R, a lock file for Python, or the Stata version plus any user-written packages); random seeds; and datasets cited by version or release (the Supreme Court Database, for one, asks to be cited by release; Spaeth et al. 2026). For model-coded variables, include the codebook, prompts, model identifiers, settings, raw outputs, and the agent's instruction file, and consider completing a reporting checklist for language-model use such as GUIDE-LLM (Feuerriegel et al. 2026). If licenses bar sharing the documents themselves, share everything else: coded data keyed to citations or docket numbers, the search log and hit lists, the code, and instructions for getting access.

**H3. Don't assume a public record is safe to republish.** Federal filings must redact only a few items: Social Security and taxpayer numbers, birth dates, minors' names, and financial-account numbers (Fed. R. Civ. P. 5.2). Witness and victim names, medical details, and other sensitive facts run through court records (Ardia & Klinefelter 2015), and a de-anonymization experiment on German court decisions found initials, the form Rule 5.2 prescribes for minors, the weakest anonymization technique (Deuber, Keuchen & Christin 2023). The FJC strips criminal defendants' names from its database (FJC n.d.). Publish only the identifiers your analysis needs.

**H4. Test the package from scratch.** Before submission, have a fresh agent session (or a colleague) copy the package into an empty folder and run it using only the README. Agents are good at this test, and at noticing what's missing.

---

## Part 3: Pre-submission checklist

- [ ] Case universe defined before searching; queries, databases, dates, and hit lists saved; screening shown in a flow diagram (C1).
- [ ] Coverage of the sources stated, and claims limited to it (C2).
- [ ] Raw data untouched; every transformation scripted (A5).
- [ ] Path from raw data to analysis sample documented, with counts at each step (C4).
- [ ] Unit of analysis stated; judgment calls logged; deviations from the analysis plan disclosed (D1, B3, E1).
- [ ] Model-coded variables validated against blind double human coding, with agreement reported for each variable (D4).
- [ ] Prompts frozen before results; main result shown under alternative prompts or models; coding run at least twice (D6, D9).
- [ ] Every specification run is logged, and the reported results are representative of them (E2).
- [ ] Key results independently re-implemented (E4).
- [ ] Hostile-referee review done, and its points addressed (E5).
- [ ] Every citation checked by a person against the source: quote, pin cite, proposition, and subsequent history, with two citators (F2).
- [ ] Every number in the text generated by the code or checked against its output (G2).
- [ ] AI use disclosed according to the venue's policy, including use in the research, not just the writing (G4).
- [ ] Replication package meets the venue's data policy and runs from scratch using only the README (H1, H4).
- [ ] Published data checked for personal information (H3).
- [ ] No restricted data in the agent's workspace, the repository, or the replication package (A3).

---

## Appendix A: Starter instruction file

Save this as `CLAUDE.md` (Claude Code) or `AGENTS.md` (many other agents) in the project folder, and adapt it. Keep it short: agents follow a page of specific rules better than ten pages of general ones. Describe the research question, not the result you expect. The agent can create the files it mentions.

```
# Project: [title]

## About this project
[Two or three sentences: research question, data, methods, intended venue.]
Unit of analysis: [opinion / case / docket / issue / vote / defendant]. Count consolidated cases, multiple opinions, and mixed dispositions as the codebook says.
I am the author and am accountable for every number, quote, and citation. You are a research assistant. Make your work easy for me to check.

## Data
- data/raw/ is read-only. Never modify, move, or overwrite anything in it. Scripts write to data/derived/.
- Never edit data by hand or fix individual values in place. If something looks wrong, tell me.
- Never drop, deduplicate, impute, recode, or filter observations without printing row counts before and after and logging the step in DECISIONS.md.
- Record every search (query, database, date, number of hits) in docs/search-log.md, and save the hit list.
- [If applicable: Never open data/restricted/. Develop against data/synthetic/.]

## Analysis
- Follow ANALYSIS_PLAN.md. Do not change the outcome, sample, variables, model, or standard errors without asking me.
- Log every model you run in LOG.md, including ones that fail or that I won't report: date, specification, key estimate.
- Never change a test, a check, a coding rule, or the data to make code run or a result appear. Stop and tell me.
- Write code in [Stata / R / Python]. Set and record random seeds.

## Coding documents with a model
- Code documents through a script that sends each one to the model with only the codebook. Don't code documents yourself in this conversation.
- Don't show the model the case outcome unless the codebook calls for it, and never show it the hypotheses.
- Once I approve the prompts, don't change them. Record the exact model identifier, prompt, settings, and date for every run, and save every raw response in output/.

## Sources and citations
- Never cite a case, statute, article, or quotation from memory. Find the source and give me the exact supporting passage, the pin cite, and where you found it.
- If you cannot find or open a source, say so. "I couldn't verify this" is always an acceptable answer.

## Working with me
- Before any multi-step task, give me a short plan, your assumptions, and the judgment calls you expect to make. Ask about anything that could affect results.
- Stop and ask before decisions about sample definitions, exclusions, variable construction, ambiguous cases, or model choice, and before anything hard to undo (large downloads, paid model runs, deleting files).
- When you extract or code information from documents, give me a way to check it against the source, such as a side-by-side viewer.
- When you say something is done, show evidence: the command, its output, row counts, test results. Separate what you verified from what you assumed.
- Tell me when you are uncertain. Report null, weak, or surprising results as clearly as strong ones.
- Log judgment calls in DECISIONS.md: date, decision, alternatives considered, reason.

## Notes on our data (add to this as you go)
- [Example: In the AO/FJC data, award amounts are in thousands and 9999 can mean missing; treat 9999 as missing (DECISIONS.md, entry 4).]
- [Example: In this dataset, "dismissed" includes voluntary dismissals; code them per codebook §3.2.]
```

## Appendix B: Prompts worth reusing

**Plan before acting**

> Before writing any code: restate the task in your own words, list the steps you'll take, list every assumption you're making about the data, and list the judgment calls you'll have to make. Ask me about anything that could affect results. Don't start until I approve.

**Show your work**

> How do you know that worked? Show me the commands you ran, their output, and the row counts at each step. Then list separately what you verified and what you assumed.

**Find your own mistakes** (before a point of no return)

> Before we go on: how could this be wrong? What might you have missed? Check your work for errors. The next step is [downloading all the files / coding the full corpus / running the analysis], which is hard to undo.

**Build a checking tool**

> Build me a simple local web page for checking your work: the original document on the left and the values you extracted or coded on the right, with a way for me to mark each one correct or incorrect and save my notes to a file.

**Prompt robustness**

> Rerun the coding script on the validation sample with these two alternative wordings of the prompt: [A] and [B]. Report how many labels change, the agreement with the human coding under each wording, and whether the main estimate changes.

**Hostile referee** (fresh session)

> You are a skeptical referee for [journal]. Read ANALYSIS_PLAN.md, the code in code/, and the results in output/. Identify the most serious threats to the main conclusion (selection, confounding, measurement, coding errors, bugs, questionable choices), ranked by severity. Be specific. Don't soften your assessment.

**Independent replication** (fresh session, in a new folder containing only the plan and the raw data)

> Using only ANALYSIS_PLAN.md and the files in data/raw/, write new code that produces the estimates in Table 2. Report your estimates, and list every decision the plan left unspecified and how you resolved it.

**Citation check**

> For each citation in [section], open the source and give me the exact passage that supports the proposition, the pin cite, where you found it, and whether the source supports the proposition as written (yes / partly / no). If you can't open a source, say so; don't guess.

**Number check**

> List every number in [the draft] and the table, figure, or log line it comes from. Flag any number that doesn't match or that you can't trace.

---

## Open questions

These issues are unsettled. Add your view under any of them, with your name, or add a question.

1. **Disclosure in law reviews.** Journal publishers now broadly agree on what to disclose (G4), but law reviews vary. Should law reviews adopt a common standard, and what should it require for AI use in empirical work?
2. **Validation thresholds.** When is model coding good enough to be the only coding? Should it match human-human agreement, beat it, or be judged by how much it moves the downstream estimate?
3. **Hosted, open-weight, or fine-tuned models.** If a hosted model is retired, is a study replicable from saved outputs alone? Should measurement tasks favor open-weight or fine-tuned models that can be archived (D9, D10)?
4. **Preregistration.** Now that specification searching and prompt searching are nearly free, is a dated plan in the repository enough, or should agent-assisted empirical work be formally preregistered?
5. **What the agent knows.** Should the agent writing analysis code know the hypothesis? Does knowing it bias its choices the way it can bias a human coder's (D5)?
6. **Students and RAs.** What should RAs be allowed to delegate? How do we preserve the training value of doing the work by hand at least once?
7. **Licensed databases.** Which uses of Westlaw, Lexis, and Bloomberg content with agents do subscriber agreements allow, and what should institutions negotiate for?
8. **Review.** Publishers and funders bar uploading manuscripts and proposals under review to AI tools (G5). Should editors use agents, with authors' consent, to check replication packages and citations? What would that change about submission norms?
9. **Reporting standards.** Should empirical legal research adopt a reporting checklist for model-coded data, such as GUIDE-LLM, or develop its own?

---

## Field notes: what went wrong (or almost did)

Concrete stories teach more than principles. Add yours; three lines is plenty.

- **What happened:** In the workshop's data-breach exercise (scraping the Maryland Attorney General's breach notices), the index table had 5,261 rows but only 4,711 unique document links, so "download all the PDFs" could never produce 5,261 files.
- **How it was caught:** Counting the table rows independently in the browser, counting the downloaded files by year, and asking the agent to account for the gap before linking documents to the table.
- **The rule it suggests:** Reconcile counts against an independent source before a point of no return (C3, C4). *(N.R.)*

---

## Further reading

*Each reference below was checked against the publisher's page, an archive, or the primary source on October 1, 2026, by AI research agents. Per F2, confirm before you rely on one.*

**Empirical legal research: methods and data**

- Epstein & King (2002), [*The Rules of Inference*](https://chicagounbound.uchicago.edu/uclrev/vol69/iss1/1/), 69 U. Chi. L. Rev. 1. The standards agent-assisted work still has to meet.
- Hall & Wright (2008), [*Systematic Content Analysis of Judicial Opinions*](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=913336), 96 Calif. L. Rev. 63. Case selection, coding, and reliability (C1, D1, D2, D4).
- Priest & Klein (1984), [*The Selection of Disputes for Litigation*](https://doi.org/10.1086/467732), 13 J. Legal Stud. 1. Why litigated cases aren't a random sample of disputes (E5).
- Merritt & Brudney (2001), [*Stalking Secret Law: What Predicts Publication in the United States Courts of Appeals*](https://scholarship.law.vanderbilt.edu/vlr/vol54/iss1/2/), 54 Vand. L. Rev. 69 (C2).
- Administrative Office of the U.S. Courts (2024), [*Table B-12: U.S. Courts of Appeals, Type of Opinion or Order Filed in Cases Terminated on the Merits, 12-Month Period Ending September 30, 2024*](https://www.uscourts.gov/data-news/data-tables/2024/09/30/judicial-business/b-12) (C2).
- Martin (2018), [*District Court Opinions That Remain Hidden Despite a Long-standing Congressional Mandate of Transparency: The Result of Judicial Autonomy and Systemic Indifference*](https://papers.ssrn.com/sol3/papers.cfm?abstract_id=3034399), 110 Law Libr. J. 305 (C2).
- Mart (2017), [*The Algorithm as a Human Artifact: Implications for Legal [Re]Search*](https://scholar.law.colorado.edu/faculty-articles/755/), 109 Law Libr. J. 387. Different platforms return different cases for the same query (C1).
- Hellyer (2018), [*Evaluating Shepard's, KeyCite, and BCite for Case Validation Accuracy*](https://scholarship.law.wm.edu/libpubs/131/), 110 Law Libr. J. 449 (F2).
- Caselaw Access Project (n.d.), [*About*](https://case.law/about/) (C2).
- Eisenberg & Schlanger (2003), [*The Reliability of the Administrative Office of the U.S. Courts Database: An Initial Empirical Analysis*](https://scholarship.law.nd.edu/ndlr/vol78/iss5/2/), 78 Notre Dame L. Rev. 1455 (A9).
- Federal Judicial Center (n.d.), [*The Integrated Database: A Research Guide*](https://www.fjc.gov/sites/default/files/IDB-Research-Guide.pdf) (A9, D1, H3).
- Songer Project (n.d.), [*U.S. Courts of Appeals Databases*](https://www.songerproject.org/us-courts-of-appeals-databases.html), documentation (A9).
- Spaeth et al. (2026), [*The Supreme Court Database: How to Cite*](https://scdb.la.psu.edu/how-to-cite-us) (H2).
- Harvey & Woodruff (2013), [*Confirmation Bias in the United States Supreme Court Judicial Database*](https://doi.org/10.1093/jleo/ewr003), 29 J.L. Econ. & Org. 414 (D5).

**Transparency, replication, and research hygiene**

- Chin & Zeiler (2021), [*Replicability in Empirical Legal Research*](https://doi.org/10.1146/annurev-lawsocsci-121620-085055), 17 Ann. Rev. L. & Soc. Sci. 239 (E5, H1).
- Chin et al. (2021), [*Improving the Credibility of Empirical Legal Research*](https://doi.org/10.5204/lthj.1875), 3(2) Law, Tech. & Humans 1 (C1, E1).
- Chin et al. (2023), [*The Transparency of Quantitative Empirical Legal Research Published in Highly Ranked Law Journals (2018–2020)*](https://doi.org/10.12688/f1000research.127563.2), 12 F1000Research 144 (H1).
- Matthews & Rantanen (2025), [*Legal Research as a Collective Enterprise: An Examination of Data Availability in Empirical Legal Scholarship*](https://doi.org/10.1093/jleo/ewae001), 41 J.L. Econ. & Org. 570 (H1).
- Journal of Law and Economics, [*Data Policy*](https://www.journals.uchicago.edu/journals/jle/data-policy); Journal of Legal Analysis, [*General Instructions*](https://academic.oup.com/jla/pages/General_Instructions) (H1, G4).
- Gentzkow & Shapiro (2014), [*Code and Data for the Social Sciences: A Practitioner's Guide*](https://web.stanford.edu/~gentzkow/research/CodeAndData.pdf). Many of the data-hygiene practices here predate AI.
- Wilson et al. (2017), [*Good Enough Practices in Scientific Computing*](https://doi.org/10.1371/journal.pcbi.1005510), 13(6) PLOS Comput. Biol. e1005510.
- Simmons, Nelson & Simonsohn (2011), [*False-Positive Psychology: Undisclosed Flexibility in Data Collection and Analysis Allows Presenting Anything as Significant*](https://doi.org/10.1177/0956797611417632), 22 Psychol. Sci. 1359 (Principle 6).
- Gelman & Loken (2014), [*The Statistical Crisis in Science*](https://doi.org/10.1511/2014.111.460), 102 Am. Scientist 460. The "garden of forking paths" (Principle 6).
- Simonsohn, Simmons & Nelson (2020), [*Specification Curve Analysis*](https://doi.org/10.1038/s41562-020-0912-z), 4 Nature Hum. Behav. 1208 (E2).
- Social Science Data Editors (2022), [*Template README for Social Science Replication Packages*](https://social-science-data-editors.github.io/template_README/), v1.1 (H2).
- Fed. R. Civ. P. 5.2, [*Privacy Protection for Filings Made with the Court*](https://www.law.cornell.edu/rules/frcp/rule_5.2) (H3).
- Ardia & Klinefelter (2015), [*Privacy and Court Records: An Empirical Study*](https://doi.org/10.15779/Z38TR9C), 30 Berkeley Tech. L.J. 1807 (H3).
- Deuber, Keuchen & Christin (2023), [*Assessing Anonymity Techniques Employed in German Court Decisions*](https://www.usenix.org/conference/usenixsecurity23/presentation/deuber), USENIX Security '23, 5199 (H3).

**Language models as measurement instruments**

- Egami et al. (2023), [*Using Imperfect Surrogates for Downstream Inference: Design-based Supervised Learning for Social Science Applications of Large Language Models*](https://proceedings.neurips.cc/paper_files/paper/2023/hash/d862f7f5445255090de13b825b880d59-Abstract-Conference.html), NeurIPS 36 (D8).
- Törnberg (2024), [*Best Practices for Text Annotation with Large Language Models*](https://doi.org/10.6092/issn.1971-8853/19461), 18(2) Sociologica 67.
- Halterman & Keith (2026), [*Codebook LLMs: Evaluating LLMs as Measurement Tools for Political Science Concepts*](https://doi.org/10.1017/pan.2025.10017), 34 Political Analysis 188 (D3).
- Baumann et al. (2025), [*Large Language Model Hacking: Quantifying the Hidden Risks of Using LLMs for Text Annotation*](https://arxiv.org/abs/2509.08825), arXiv:2509.08825 (D6).
- Sclar et al. (2024), [*Quantifying Language Models' Sensitivity to Spurious Features in Prompt Design or: How I Learned to Start Worrying about Prompt Formatting*](https://arxiv.org/abs/2310.11324), ICLR 2024 (D6).
- Atil et al. (2024), [*Non-Determinism of "Deterministic" LLM Settings*](https://arxiv.org/abs/2408.04667), arXiv:2408.04667 (D9).
- Barrie, Palmer & Spirling (2024), [*Replication for Language Models: Problems, Principles, and Best Practice for Political Science*](https://arthurspirling.org/documents/BarriePalmerSpirling_TrustMeBro.pdf), working paper, draft of Dec. 17, 2024 (D9).
- Ziems et al. (2024), [*Can Large Language Models Transform Computational Social Science?*](https://doi.org/10.1162/coli_a_00502), 50(1) Computational Linguistics 237.
- Feuerriegel et al. (2026), [*A Reporting Checklist for Large Language Models in Behavioural Science*](https://doi.org/10.1038/s41562-026-02492-7), 10 Nature Hum. Behav. 1182. The GUIDE-LLM checklist (H2).

**Language models and legal tasks**

- Choi (2024), [*How to Use Large Language Models for Empirical Legal Research*](https://doi.org/10.1628/jite-2024-0006), 180 J. Institutional & Theoretical Econ. 214.
- Dominguez-Olmedo et al. (2025), [*Lawma: The Power of Specialization for Legal Annotation*](https://arxiv.org/abs/2407.16615), ICLR 2025 (D10).
- Thalken et al. (2023), [*Modeling Legal Reasoning: LM Annotation at the Edge of Human Agreement*](https://doi.org/10.18653/v1/2023.emnlp-main.575), EMNLP 2023, 9252 (D10).
- Guha et al. (2023), [*LegalBench: A Collaboratively Built Benchmark for Measuring Legal Reasoning in Large Language Models*](https://proceedings.neurips.cc/paper_files/paper/2023/file/89e44582fd28ddfea1ea4dcb0ebbf4b0-Paper-Datasets_and_Benchmarks.pdf), NeurIPS Datasets & Benchmarks (D10).
- Savelka & Ashley (2023), [*The Unreasonable Effectiveness of Large Language Models in Zero-Shot Semantic Annotation of Legal Texts*](https://doi.org/10.3389/frai.2023.1279794), 6 Frontiers in AI 1279794.
- Dahl et al. (2024), [*Large Legal Fictions: Profiling Legal Hallucinations in Large Language Models*](https://doi.org/10.1093/jla/laae003), 16 J. Legal Analysis 64.
- Magesh et al. (2025), [*Hallucination-Free? Assessing the Reliability of Leading AI Legal Research Tools*](https://doi.org/10.1111/jels.12413), 22 J. Empirical Legal Stud. 216 (F2).

**Fabricated citations in court**

- Mata v. Avianca, Inc., [678 F. Supp. 3d 443 (S.D.N.Y. 2023)](https://www.courtlistener.com/opinion/9885417/mata-v-avianca-inc/).
- Kohls v. Ellison, [No. 24-cv-3754 (D. Minn. Jan. 10, 2025)](https://hlli.org/wp-content/uploads/2024/09/KohlsMN.46.Order-granting-motion-to-exclude-Hancock-decl.pdf) (order excluding an expert declaration) (F4).
- Johnson v. Dunn, [No. 2:21-cv-1701 (N.D. Ala. July 23, 2025)](https://www.courthousenews.com/wp-content/uploads/2025/07/johnson-vs-dunn-attorney-sanctions-order.pdf) (sanctions order) (F4).
- Noland v. Land of the Free, L.P., [114 Cal. App. 5th 426 (2025)](https://www.law.berkeley.edu/wp-content/uploads/archive/2025/12/Noland-v-Land-of-the-Free-LP.pdf) (F4).
- Charlotin, [*AI Hallucination Cases*](https://www.damiencharlotin.com/hallucinations/), a running database of court decisions involving AI-fabricated content.

**Disclosure, ethics, and data governance**

- COPE Council (2023), [*Authorship and AI Tools*](https://doi.org/10.24318/cCVRZBms) (G4).
- Wiley (n.d.), [*Using AI Tools in Your Research*](https://www.wiley.com/en-us/publish/article/ai-guidelines/) (G4, G5).
- Oxford University Press (2026), [*Policy on AI Use and Disclosure for Oxford Journals Authors*](https://academic.oup.com/pages/for-authors/journals/preparing-and-submitting-your-manuscript/ai-principles-for-oxford-journals/policy-on-ai-use-and-disclosure-for-oxford-journals-authors) (G4).
- Elsevier (2026), [*Generative AI Policies for Journals*](https://www.elsevier.com/about/policies-and-standards/generative-ai-policies-for-journals) (G4).
- Springer Nature (2026), [*AI Use in Research Practice*](https://www.springernature.com/gp/policies/editorial-policies/using-ai-in-research) (G5).
- Cambridge University Press (n.d.), [*Authorship and Contributorship*](https://www.cambridge.org/core/services/authors/publishing-ethics/research-publishing-ethics-guidelines-for-journals/authorship-and-contributorship).
- Stanford Law Review (2026), [*AI Policy (Vol. 79)*](https://www.stanfordlawreview.org/wp-content/uploads/sites/3/2026/01/Vol.-79-SLR-AI-Policy.pdf) (F4, G4).
- California Law Review (2026), [*Artificial Intelligence Author Use and Disclosure Agreement*](https://www.californialawreview.org/s/CLR-Author-AI-Policy.pdf) (G4).
- American Bar Association (2024), [*Formal Opinion 512: Generative Artificial Intelligence Tools*](https://www.americanbar.org/news/abanews/aba-news-archives/2024/07/aba-issues-first-ethics-guidance-ai-tools/) (press release) (A2).
- ICPSR (2024), [*Policy on the Use of Large Language Models*](https://www.icpsr.umich.edu/sites/icpsr/about/policies/large-language-models-and-ai) (A1, A3).
- Lehigh University (n.d.), [*Guidance: Generative AI and Human Subjects Research*](https://research.lehigh.edu/policies-guidance-forms/guidance-generative-ai-and-human-subjects-research) (A2).
- NIH (2023), [*NOT-OD-23-149*](https://grants.nih.gov/grants/guide/notice-files/NOT-OD-23-149.html), on generative AI in peer review (G5).
- NSF (2023), [*Notice to Research Community: Use of Generative Artificial Intelligence Technology in the NSF Merit Review Process*](https://www.nsf.gov/news/notice-to-the-research-community-on-ai) (G5).
- Anthropic (2025), [*Updates to Consumer Terms and Privacy Policy*](https://www.anthropic.com/news/updates-to-our-consumer-terms) (A1).

**Working with agents**

- Anthropic, [*Best Practices for Claude Code*](https://code.claude.com/docs/en/best-practices).

---

## How to contribute

Anyone can edit this guide, and every edit is logged, so nothing is ever lost.

- **Edit the draft:** go to <https://nathanreitinger.github.io/els-agent-practices/draft/> and click "Edit this draft." Edits that change only the draft are merged automatically. You'll need a free GitHub account.
- **Comment:** highlight any passage on the draft page.
- **See or undo edits:** the draft's edit history shows every change, and any earlier revision can be viewed and restored.
- **Keep the format:** a bold one-sentence rule, then a sentence or two on why or how. Specific beats general: name the dataset, the tool, the failure. Cite only sources you've read, by author and year, and add them to Further reading.
- **Practice numbers are permanent** once published. Add a new practice at the end of its section with the next free number.
- **Add a field note** when something goes wrong, and add yourself to the contributors list.

Published versions are numbered and never change, so cite the version you used and its permanent link (both at the top of the published file). Version numbers work like software releases: patch versions (0.1.1) fix wording and references, minor versions (0.2.0) add practices, and major versions (1.0.0, 2.0.0) remove or reverse advice. Versions below 1.0 are community drafts.

**Contributors:** Nathan Reitinger (Northwestern Law)
