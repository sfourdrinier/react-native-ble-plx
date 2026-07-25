// Project workflow: fix ROADMAP 4.0 E2E review findings (docs/review/findings-4.0.json).
// Designed for agent_budget=64. Groups non-overlapping path areas for parallel fixers.
// Verify is fail-closed. Updates tracker markdown in-repo when possible.

let meta = #{
    name: "roadmap-4-fix-findings",
    description: "Fix all open ROADMAP 4.0 E2E findings: plan → parallel area fixers → verify → tracker update",
    when_to_use: "After roadmap-4-e2e-review (or when docs/review/findings-4.0.json has open items). Prefer agent_budget 64.",
    phases: [
        #{ title: "Ingest", detail: "Load findings; filter open; cluster by area" },
        #{ title: "Plan", detail: "Pick this-run work set; dedupe; assign areas" },
        #{ title: "Fix", detail: "Parallel read-write fixers per area (non-overlapping paths)" },
        #{ title: "Verify", detail: "Fail-closed tests + code review per area" },
        #{ title: "Track", detail: "Update tracker + write run report" },
    ],
};

// --- schemas ---
let plan_schema = #{
    "type": "object",
    "required": ["batches", "deferred_ids", "notes"],
    "properties": #{
        "notes": #{ "type": "string" },
        "deferred_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 120 },
        "batches": #{
            "type": "array",
            "maxItems": 12,
            "items": #{
                "type": "object",
                "required": ["area", "finding_ids", "primary_paths", "summary"],
                "properties": #{
                    "area": #{ "type": "string", "description": "Non-overlapping bucket id e.g. android, ios, src-core" },
                    "finding_ids": #{ "type": "array", "items": #{ "type": "string" }, "minItems": 1, "maxItems": 40 },
                    "primary_paths": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
                    "summary": #{ "type": "string" },
                },
            },
        },
    },
};

let fix_schema = #{
    "type": "object",
    "required": ["area", "fixed_ids", "skipped_ids", "files_changed", "notes", "test_commands"],
    "properties": #{
        "area": #{ "type": "string" },
        "fixed_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "skipped_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "files_changed": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 40 },
        "notes": #{ "type": "string" },
        "test_commands": #{
            "type": "array",
            "items": #{ "type": "string" },
            "maxItems": 8,
            "description": "Narrow pnpm/jest/script commands that validate this batch",
        },
    },
};

let verify_schema = #{
    "type": "object",
    "required": ["area", "ok", "verified_ids", "failed_ids", "evidence", "notes"],
    "properties": #{
        "area": #{ "type": "string" },
        "ok": #{ "type": "boolean" },
        "verified_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "failed_ids": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 25 },
        "evidence": #{ "type": "string" },
        "notes": #{ "type": "string" },
    },
};

let track_schema = #{
    "type": "object",
    "required": ["tracker_markdown", "summary", "remaining_open_estimate"],
    "properties": #{
        "tracker_markdown": #{ "type": "string" },
        "summary": #{ "type": "string" },
        "remaining_open_estimate": #{ "type": "integer" },
        "next_run_hint": #{ "type": "string" },
    },
};

// --- args ---
// findings_path: default docs/review/findings-4.0.json
// severities: optional comma list e.g. "critical,high" (default all)
// max_batches: max parallel fix areas this run (default 12, hard cap 12)
// max_findings: max findings to attempt this run (default 120 = full backlog, hard cap 120)
// only_ids: optional comma list F001,F002
// Prefer round-2 full-severity backlog when present
let findings_path = "docs/review/findings-4.0-round2.json";
let severities = "all";
let max_batches = 12;
let max_findings = 120;
let only_ids = "";
if args != () {
    if args.findings_path != () { findings_path = args.findings_path; }
    if args.severities != () { severities = args.severities; }
    if args.max_batches != () { max_batches = args.max_batches; }
    if args.max_findings != () { max_findings = args.max_findings; }
    if args.only_ids != () { only_ids = args.only_ids; }
}
if max_batches < 1 { max_batches = 1; }
if max_batches > 12 { max_batches = 12; }
if max_findings < 1 { max_findings = 1; }
if max_findings > 120 { max_findings = 120; }

log("roadmap-4-fix-findings path=" + findings_path
    + " severities=" + severities
    + " max_batches=" + max_batches.to_string()
    + " max_findings=" + max_findings.to_string());

// Budget design (prefer 64):
// 1 ingest/plan + ≤12 fix + ≤12 verify + 1 track = ≤26 per full-backlog run
// Leave headroom for verify retries / larger prompts under agent_budget 64
let b0 = budget();
log("budget remaining at start: " + b0.remaining.to_string() + " / " + b0.total.to_string());

// =============================================================================
phase("Ingest");
// =============================================================================

let ingest_prompt = "";
ingest_prompt += "You are the INGEST step for fixing ROADMAP 4.0 E2E findings.\n";
ingest_prompt += "MANDATORY: read_file the findings JSON at: " + findings_path + "\n";
ingest_prompt += "Also read docs/FIX_TRACKER.4.0.md if it exists (status column).\n";
ingest_prompt += "Filter to status=open (or missing status). Severities filter: " + severities + " (all = no filter).\n";
if only_ids != "" {
    ingest_prompt += "ONLY these IDs (comma list): " + only_ids + "\n";
}
ingest_prompt += "Return a plan object: batches grouped by NON-OVERLAPPING path areas so parallel fixers never edit the same files.\n";
ingest_prompt += "Area rules (prefer these buckets):\n";
ingest_prompt += "  android | ios | electron-native | web-host | src-core | discovery-profiles | examples | tests | ci-release | docs | plugin-shim\n";
ingest_prompt += "Dedupe duplicate findings (same root cause) into one id list per batch; put pure dupes in deferred_ids with note.\n";
ingest_prompt += "Prioritize critical > high > medium > low > nit.\n";
ingest_prompt += "Cap: at most " + max_batches.to_string() + " batches and " + max_findings.to_string() + " total finding_ids across batches.\n";
ingest_prompt += "Each batch: area, finding_ids, primary_paths, summary of the work.\n";
ingest_prompt += "Do not fix code in this step.\n";

let plan1 = agent(ingest_prompt, #{
    label: "ingest:plan",
    capability_mode: "read-only",
    output_schema: plan_schema,
});

// Fail soft so validate_only / empty filters complete; real runs re-invoke with a valid findings_path.
if plan1 == () || !plan1.success || plan1.output == () {
    complete(#{
        summary: "Ingest/plan failed — check findings_path (default docs/review/findings-4.0.json).",
        error: true,
        verified: [],
        failed: [],
        skipped: [],
    });
}

let batches = plan1.output.batches;
if batches == () || batches.len() == 0 {
    complete(#{
        summary: "No open findings to fix for this filter (or planner returned empty batches).",
        fixed: [],
        verified: [],
        failed: [],
        skipped: [],
    });
}

let plan_notes = "";
if plan1.output.notes != () { plan_notes = plan1.output.notes; }
log("Plan batches=" + batches.len().to_string() + " notes=" + plan_notes);

// =============================================================================
phase("Fix");
// =============================================================================

let fix_jobs = [];
for batch in batches {
    let fp = "";
    fp += "You are a FIXER for ROADMAP 4.0 finding batch area=`" + batch.area + "`.\n";
    fp += "Charter: source-compatible 3.x Base64 API; dual bytes path additive; owned native; honest supports(); Expo 57 / RN 0.86; TDD.\n";
    fp += "Finding IDs to fix: " + json_encode(batch.finding_ids) + "\n";
    fp += "Batch summary: " + batch.summary + "\n";
    fp += "Primary paths: " + json_encode(batch.primary_paths) + "\n";
    fp += "MANDATORY: read_file findings JSON " + findings_path + " and pull full issue/proposed_fix/evidence for each ID.\n";
    fp += "MANDATORY: read the real source, implement the fix, add/update focused tests when behavior changes.\n";
    fp += "Stay inside this area's paths — do NOT edit unrelated trees (parallel fixers own other areas).\n";
    fp += "Prefer package helpers over demo-only hacks. No deprecated APIs when a current alternative exists.\n";
    fp += "After edits: list files_changed, fixed_ids, skipped_ids (with why in notes), and narrow test_commands (e.g. pnpm test:package -- __tests__/X.js).\n";
    fp += "Do not run the full suite unless necessary; leave broad verify to the verify agent.\n";
    fix_jobs.push(#{
        prompt: fp,
        label: "fix:" + batch.area,
        capability_mode: "read-write",
        output_schema: fix_schema,
    });
}

log("Launching " + fix_jobs.len().to_string() + " fix agents");
let fix_results = parallel(fix_jobs);

let fix_by_area = #{};
let all_fixed = [];
let all_skipped = [];
let all_test_cmds = [];
let fi = 0;
for fr in fix_results {
    let batch = batches[fi];
    let area = batch.area;
    if fr == () || !fr.success || fr.output == () {
        log("Fix agent failed for area " + area);
        fix_by_area[area] = #{ ok: false, fixed_ids: [], skipped_ids: batch.finding_ids, notes: "fixer failed", test_commands: [] };
    } else {
        fix_by_area[area] = fr.output;
        if fr.output.fixed_ids != () {
            for id in fr.output.fixed_ids { all_fixed.push(id); }
        }
        if fr.output.skipped_ids != () {
            for id in fr.output.skipped_ids { all_skipped.push(id); }
        }
        if fr.output.test_commands != () {
            for c in fr.output.test_commands { all_test_cmds.push(c); }
        }
    }
    fi += 1;
}

log("Fix phase claimed fixed=" + all_fixed.len().to_string() + " skipped=" + all_skipped.len().to_string());

// =============================================================================
phase("Verify");
// =============================================================================

let vjobs = [];
let vi = 0;
for batch in batches {
    let area = batch.area;
    let fix_out = ();
    // recover fix output from parallel results by index
    let fr = fix_results[vi];
    if fr != () && fr.success && fr.output != () {
        fix_out = fr.output;
    }
    let vp = "";
    vp += "You are a VERIFY agent (fail-closed) for area=`" + area + "`.\n";
    vp += "Batch finding IDs: " + json_encode(batch.finding_ids) + "\n";
    vp += "Fixer report JSON: " + json_encode(fix_out) + "\n";
    vp += "MANDATORY: inspect the claimed files_changed with read_file/grep — confirm the root cause is actually fixed.\n";
    vp += "MANDATORY: run the narrowest tests (prefer fixer test_commands; else pnpm test:package with a focused path; pnpm typecheck if TS touched).\n";
    vp += "capability: you may execute shell for pnpm/jest only. Do not expand scope.\n";
    vp += "Set ok=true only if tests pass AND code evidence supports each verified_id.\n";
    vp += "failed_ids = claimed fixed but not proven. verified_ids only with evidence.\n";
    vp += "Empty evidence ⇒ ok=false for those ids.\n";
    vjobs.push(#{
        prompt: vp,
        label: "verify:" + area,
        capability_mode: "execute",
        output_schema: verify_schema,
    });
    vi += 1;
}

let verify_results = parallel(vjobs);
let verified = [];
let failed = [];
let vj = 0;
for vr in verify_results {
    let batch = batches[vj];
    if vr == () || !vr.success || vr.output == () {
        // fail closed: entire batch unverified
        for id in batch.finding_ids { failed.push(id); }
        log("Verify agent failed for " + batch.area + " — all batch ids marked failed");
    } else {
        if vr.output.verified_ids != () {
            for id in vr.output.verified_ids { verified.push(id); }
        }
        if vr.output.failed_ids != () {
            for id in vr.output.failed_ids { failed.push(id); }
        }
        // any batch finding neither verified nor failed → failed (fail closed)
        for id in batch.finding_ids {
            let seen = false;
            if vr.output.verified_ids != () {
                for x in vr.output.verified_ids { if x == id { seen = true; } }
            }
            if vr.output.failed_ids != () {
                for x in vr.output.failed_ids { if x == id { seen = true; } }
            }
            if !seen { failed.push(id); }
        }
        let ok_s = "false";
        if vr.output.ok == true { ok_s = "true"; }
        log("Verify " + batch.area + " ok=" + ok_s);
    }
    vj += 1;
}

log("Verified=" + verified.len().to_string() + " failed=" + failed.len().to_string());

// =============================================================================
phase("Track");
// =============================================================================

let track_prompt = "";
track_prompt += "Update the ROADMAP 4.0 fix tracker after this fix run.\n";
track_prompt += "Read docs/FIX_TRACKER.4.0.md and docs/review/findings-4.0.json if present.\n";
track_prompt += "Verified IDs (mark verified): " + json_encode(verified) + "\n";
track_prompt += "Failed IDs (remain open): " + json_encode(failed) + "\n";
track_prompt += "Skipped IDs: " + json_encode(all_skipped) + "\n";
track_prompt += "Fixer notes: " + json_encode(fix_by_area) + "\n";
track_prompt += "Write full tracker_markdown table (all known IDs if possible) with Status column: open|verified|failed|skipped.\n";
track_prompt += "summary: short paragraph of what landed. remaining_open_estimate: integer.\n";
track_prompt += "next_run_hint: suggested severities/only_ids for the next /workflow roadmap-4-fix-findings run.\n";
track_prompt += "If you can write files: update docs/FIX_TRACKER.4.0.md in the repo (read-write).\n";

let track = agent(track_prompt, #{
    label: "track:update",
    capability_mode: "read-write",
    output_schema: track_schema,
});

let report = "# ROADMAP 4.0 Fix Findings Run\n\n";
report += "_Workflow: `roadmap-4-fix-findings` · budget-oriented (prefer **64** agents)_\n\n";
if track != () && track.success && track.output != () {
    report += "## Summary\n\n" + track.output.summary + "\n\n";
    report += "## Tracker\n\n" + track.output.tracker_markdown + "\n\n";
    if track.output.next_run_hint != () {
        report += "## Next run\n\n" + track.output.next_run_hint + "\n\n";
    }
    report += "Remaining open (estimate): " + track.output.remaining_open_estimate.to_string() + "\n\n";
} else {
    report += "Tracker agent failed; raw counts only.\n\n";
}
report += "## Counts\n\n";
report += "- Verified: " + verified.len().to_string() + "\n";
report += "- Failed: " + failed.len().to_string() + "\n";
report += "- Skipped: " + all_skipped.len().to_string() + "\n";
report += "- Batches: " + batches.len().to_string() + "\n\n";
report += "## Verified IDs\n\n" + json_encode(verified) + "\n\n";
report += "## Failed IDs\n\n" + json_encode(failed) + "\n\n";
report += "---\nPrefer: `/workflow roadmap-4-fix-findings` with `agent_budget: 64`.\n";

let path = write_scratch_file("roadmap-4-fix-findings.md", report);
log("Wrote " + path);

// Optional second pass if budget remains and failures exist
let b1 = budget();
if failed.len() > 0 && b1.remaining >= 14 {
    log("Budget remaining " + b1.remaining.to_string() + " — not auto-looping failed fixes this version; re-run with only_ids");
}

complete(#{
    path: path,
    verified: verified,
    failed: failed,
    skipped: all_skipped,
    batches: batches.len(),
    report: report,
});
