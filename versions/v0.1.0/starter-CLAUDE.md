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
