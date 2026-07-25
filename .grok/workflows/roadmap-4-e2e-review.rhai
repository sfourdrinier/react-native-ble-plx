// Project workflow: end-to-end ROADMAP 4.0 review for unified-ble-manager.
// Saved in-repo so teammates can run: /workflow roadmap-4-e2e-review
// Agent budget: design for ≤32 (default fan-out ~22; pass agent_budget 32).

let meta = #{
    name: "roadmap-4-e2e-review",
    description: "ROADMAP 4.0 end-to-end review: bugs, edge cases, tests, DRY; examples + native; propose fixes",
    when_to_use: "Before a 4.0 milestone, after large multi-host/native/profile changes, or when hunting bugs/DRY/tests across the full tree",
    phases: [
        #{ title: "Ground", detail: "Charter + GAPS + latest practices" },
        #{ title: "Surfaces", detail: "Parallel review of TS, native, examples, tests, CI" },
        #{ title: "Verify", detail: "Adversarial skeptics on top findings (fail closed)" },
        #{ title: "Report", detail: "Severity-ranked report with proposed fixes" },
    ],
};

// --- schemas ---
let finding_item = #{
    "type": "object",
    "required": ["file", "issue", "severity", "kind", "proposed_fix"],
    "properties": #{
        "file": #{ "type": "string", "description": "Repo-relative path or symbol path" },
        "issue": #{ "type": "string", "description": "Concrete problem observed in code" },
        "severity": #{ "type": "string", "enum": ["critical", "high", "medium", "low", "nit"] },
        "kind": #{
            "type": "string",
            "enum": ["bug", "edge_case", "test_gap", "dry", "compat", "docs", "perf", "security", "modernization"],
        },
        "proposed_fix": #{ "type": "string", "description": "Actionable fix proposal" },
        "evidence": #{ "type": "string", "description": "Quote, line range, or behavior observed" },
    },
};

let findings_schema = #{
    "type": "object",
    "required": ["findings", "lane", "notes"],
    "properties": #{
        "lane": #{ "type": "string" },
        "notes": #{ "type": "string" },
        "findings": #{
            "type": "array",
            "maxItems": 10,
            "items": finding_item,
        },
    },
};

let ground_schema = #{
    "type": "object",
    "required": ["charter_summary", "non_negotiables", "review_emphasis", "latest_practice_notes"],
    "properties": #{
        "charter_summary": #{ "type": "string" },
        "non_negotiables": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 12 },
        "review_emphasis": #{ "type": "string" },
        "latest_practice_notes": #{ "type": "string" },
    },
};

let verdict_schema = #{
    "type": "object",
    "required": ["real", "reason", "evidence", "severity_adjust"],
    "properties": #{
        "real": #{ "type": "boolean" },
        "reason": #{ "type": "string" },
        "evidence": #{ "type": "string" },
        "severity_adjust": #{
            "type": "string",
            "enum": ["keep", "raise", "lower", "drop"],
            "description": "keep severity, raise, lower, or drop if false positive",
        },
    },
};

let report_schema = #{
    "type": "object",
    "required": ["title", "executive_summary", "confirmed_markdown", "deferred_markdown", "next_actions"],
    "properties": #{
        "title": #{ "type": "string" },
        "executive_summary": #{ "type": "string" },
        "confirmed_markdown": #{ "type": "string" },
        "deferred_markdown": #{ "type": "string" },
        "next_actions": #{ "type": "array", "items": #{ "type": "string" }, "maxItems": 15 },
    },
};

// --- args (optional focus / since / caps) ---
// focus: "all" | path prefix | surface name (e.g. "profiles", "android", "electron")
// since: git commit for optional diff context
// max_verify: max findings to adversarial-verify.
// Default 120 = verify ALL severities (critical→nit), not only top highs.
// Full verify needs agent_budget ≈ 1 + 12 lanes + max_verify + 1 report (e.g. 160 for 120).
// Pass a lower max_verify only for a quick smoke; never treat that as the full bar.
let focus = "all";
let since_commit = ();
let max_verify = 120;
if args != () {
    if args.focus != () { focus = args.focus; }
    if args.since != () { since_commit = args.since; }
    if args.max_verify != () {
        max_verify = args.max_verify;
    }
}
if max_verify < 1 { max_verify = 1; }
if max_verify > 120 { max_verify = 120; }

log("roadmap-4-e2e-review focus=" + focus + " max_verify=" + max_verify.to_string());

// Optional diff context (empty if no since)
let diff_ctx = "";
if since_commit != () {
    let d = git_diff_since(since_commit);
    if d != () {
        // keep prompt size sane
        let ds = d;
        if type_of(ds) == "string" {
            if ds.len() > 12000 {
                ds = ds.sub_string(0, 12000) + "\n…[diff truncated]…\n";
            }
            diff_ctx = ds;
        }
    }
}

// Shared charter bullets for every lane (static — agents also re-read ROADMAP)
let charter_blurb = "";
charter_blurb += "ROADMAP 4.0 non-negotiables: source-compatible 3.x Base64 API; additive dual bytes path; ";
charter_blurb += "owned Kotlin/Swift radio; TurboModule not MBA; Electron BLE only in main (never WebBT-only for supported); ";
charter_blurb += "honest supports(); multi-host preview after foundation; TDD; Expo 57 / RN 0.86 floor; ";
charter_blurb += "no Classic/LE Audio. Prefer current APIs over deprecated. Nothing too small to report. ";
charter_blurb += "Propose concrete fixes. Empty findings only after real tool use.\n";

// =============================================================================
phase("Ground");
// =============================================================================

let ground_prompt = "";
ground_prompt += "You are grounding a ROADMAP 4.0 end-to-end review of this repo (unified-ble-manager / react-native-ble-plx fork).\n";
ground_prompt += "MANDATORY tools: read_file on ROADMAP.4.0.md and docs/GAPS.4.0.md (at least first 200 lines + search for open gaps). ";
ground_prompt += "Optionally web_search for latest BLE central practices (CoreBluetooth, Android GATT, Web Bluetooth privacy, Electron security) if useful.\n";
ground_prompt += "Focus arg from operator: " + focus + "\n";
ground_prompt += "Produce: charter_summary (short), non_negotiables (bullets), review_emphasis (what matters most for this focus), ";
ground_prompt += "latest_practice_notes (1 short paragraph; say 'n/a' if no web needed).\n";
ground_prompt += "Do not invent roadmap text — quote or paraphrase only what you read.\n";

let ground = agent(ground_prompt, #{
    label: "ground:roadmap",
    capability_mode: "read-only",
    output_schema: ground_schema,
});

let ground_text = "";
if ground != () && ground.success && ground.output != () {
    ground_text = json_encode(ground.output);
} else {
    ground_text = "{\"charter_summary\":\"Grounding agent failed — lanes must still read ROADMAP.4.0.md themselves.\"}";
    log("Ground agent failed or empty; lanes will self-ground");
}

// =============================================================================
phase("Surfaces");
// =============================================================================
// Fixed lanes (12). Deterministic scope — no discovery agent deciding worklist.
// Budget: 1 ground + 12 lanes + ≤10 verify + 1 report ≤ 24 (under 32).

let lanes = [
    #{
        id: "ts-core",
        paths: "src/BleManager.ts src/port/ src/encoding.ts src/supports.ts src/ConnectionManager.ts src/longWrite.ts src/DeviceOperationQueue.ts",
        ask: "Host-agnostic TS core: dual Base64/bytes path, queues, long write, supports() honesty, PortBleManager/FakeBlePort contracts, error paths, race/lifecycle bugs.",
    },
    #{
        id: "discovery-profiles",
        paths: "src/discovery/ src/profiles/ docs/DISCOVERY_AND_PROFILES.md",
        ask: "Generic discovery vs profile layering; UUID match false positives; SIG parse/encode edge cases (HR, Battery, DIS, HT, BP, IEEE-11073); DRY across profiles.",
    },
    #{
        id: "android-native",
        paths: "android/ src/NativeBlePlx.ts (Android-related) owned Android radio under android/",
        ask: "Owned Android GATT (Kotlin/Java): bonding, MTU, notifications, services changed, permissions, FGS, TurboModule boundary, thread safety, deprecations.",
    },
    #{
        id: "ios-native",
        paths: "ios/ Owned CoreBluetooth adapters, restoration, BlePlx.mm, MultiplatformBleAdapter remnants",
        ask: "Owned iOS/CoreBluetooth: restore D5 host-owned reconnect, descriptors, didModifyServices, restoration subspec opt-in, memory/retain, New Architecture.",
    },
    #{
        id: "electron-native",
        paths: "native/electron/ src/hosts/electron.ts src/hosts/native/corebluetooth/ docs/ELECTRON.md example-electron/",
        ask: "Electron main-only BLE, CoreBluetooth N-API, preload/IPC, Fake fallback, live Polar path; security of contextBridge; no radio in renderer.",
    },
    #{
        id: "web-host",
        paths: "src/hosts/web.ts docs/WEB.md example-web/ example-shared/ui/",
        ask: "Web Bluetooth host: chooser filters, optionalServices, capability shrinking, supports() honesty, shared UI bridge, CSP.",
    },
    #{
        id: "examples-shared",
        paths: "example-shared/ example-web/ example-electron/ example-expo/src/services/",
        ask: "Examples: DRY between web/electron/expo, thin wrappers over package profiles, smoke/fake radio coverage, CJS/ESM drift, inspect/common profiles UX.",
    },
    #{
        id: "tests",
        paths: "__tests__/ jest.config.js jest.setup.js",
        ask: "Test gaps, weak mocks, false-green FakeBlePort, missing edge cases for profiles/native contracts, flaky timing, DRY between tests.",
    },
    #{
        id: "compat-migration",
        paths: "packages/ MIGRATION_4.0.md src/index.ts package.json plugin/",
        ask: "3.x source compat, shim package, codemod, plugin floors Expo 57/RN 0.86, export surface bloat, breaking API risks.",
    },
    #{
        id: "ci-tooling",
        paths: ".github/workflows/ scripts/ package.json",
        ask: "CI matrix honesty (what is actually tested), electron smoke, prepack/typecheck, release verify, missing gates for new profiles/hosts.",
    },
    #{
        id: "docs-gaps",
        paths: "docs/ ROADMAP.4.0.md docs/GAPS.4.0.md docs/PLATFORMS.md",
        ask: "Docs vs code drift, GAPS still open that code already claims done, missing multi-host recipes, inaccurate supports tables.",
    },
    #{
        id: "security-perf",
        paths: "src/ android/ ios/ native/electron/ example-electron/preload.js",
        ask: "Security (IPC, permissions, buffer bounds) and performance (copies, Base64 hot paths, notify fanout, main-thread blocking). Small nits OK.",
    },
];

// Filter lanes if focus is a known lane id or path substring (simple contains)
let selected = [];
if focus == "all" || focus == "" {
    selected = lanes;
} else {
    for lane in lanes {
        let id_hit = lane.id == focus;
        let path_hit = false;
        // crude substring: focus appears in paths or id
        if lane.paths.contains(focus) || lane.id.contains(focus) || focus.contains(lane.id) {
            path_hit = true;
        }
        if id_hit || path_hit {
            selected.push(lane);
        }
    }
    if selected.len() == 0 {
        log("Focus matched no lane; falling back to all 12 surfaces");
        selected = lanes;
    }
}

let lane_jobs = [];
for lane in selected {
    let p = "";
    p += "ROADMAP 4.0 surface review — lane `" + lane.id + "`.\n";
    p += charter_blurb;
    p += "Grounding JSON (may be incomplete): " + ground_text + "\n";
    p += "Lane question: " + lane.ask + "\n";
    p += "Primary paths (start here; follow imports as needed): " + lane.paths + "\n";
    p += "Operator focus: " + focus + "\n";
    p += "MANDATORY: use read_file, grep, list_dir (and git if useful). Do NOT answer from memory.\n";
    p += "Hunt: bugs, edge cases, test gaps, DRY, compat breaks, docs lies, security/perf, modernization (deprecated APIs).\n";
    p += "ALL severities matter: file critical, high, medium, low, AND nit. Do not self-censor nits or docs.\n";
    p += "At most 10 findings. Prefer covering the severity range (not 10 criticals only). Each needs file, issue, severity, kind, proposed_fix, evidence.\n";
    p += "Empty findings array is valid ONLY after you inspected the paths and found nothing material.\n";
    p += "Set lane to \"" + lane.id + "\". notes = short coverage statement of what you read.\n";
    if diff_ctx != "" {
        p += "Optional recent diff context (truncated):\n";
        p += diff_ctx;
        p += "\n";
    }
    // Web research only when standards matter for this lane
    if lane.id == "discovery-profiles" || lane.id == "web-host" || lane.id == "ios-native" || lane.id == "android-native" {
        p += "If a SIG/OS API detail is uncertain, use web_search for Bluetooth SIG / Apple / Android / W3C docs — ground claims.\n";
    }
    lane_jobs.push(#{
        prompt: p,
        label: "lane:" + lane.id,
        capability_mode: "read-only",
        output_schema: findings_schema,
    });
}

log("Launching " + lane_jobs.len().to_string() + " surface lanes");
let lane_results = parallel(lane_jobs);

// Collect findings
let all_findings = [];
let lane_fail = 0;
let li = 0;
for r in lane_results {
    if r == () || !r.success || r.output == () || r.output.findings == () {
        lane_fail += 1;
    } else {
        for f in r.output.findings {
            // Attach lane id if missing
            let row = f;
            all_findings.push(row);
        }
    }
    li += 1;
}
log("Collected " + all_findings.len().to_string() + " raw findings; failed/empty lanes=" + lane_fail.to_string());

// Rank for verification: critical > high > medium > low > nit; cap max_verify
fn severity_rank(s) {
    if s == "critical" { return 0; }
    if s == "high" { return 1; }
    if s == "medium" { return 2; }
    if s == "low" { return 3; }
    if s == "nit" { return 4; }
    return 5;
}

// Simple selection: multi-pass by severity without sort API
let to_verify = [];
let ranks = ["critical", "high", "medium", "low", "nit"];
for rank_name in ranks {
    for f in all_findings {
        if to_verify.len() >= max_verify { break; }
        if f.severity == rank_name {
            // skip dupes by file+issue fingerprint
            let key = "";
            if f.file != () { key += f.file; }
            key += "|";
            if f.issue != () { key += f.issue; }
            let dup = false;
            for e in to_verify {
                let ek = "";
                if e.file != () { ek += e.file; }
                ek += "|";
                if e.issue != () { ek += e.issue; }
                if ek == key { dup = true; break; }
            }
            if !dup {
                to_verify.push(f);
            }
        }
    }
}

if all_findings.len() > to_verify.len() {
    log("Truncated verify set: " + to_verify.len().to_string() + " of " + all_findings.len().to_string() + " (max_verify)");
}

// =============================================================================
phase("Verify");
// =============================================================================

let confirmed = [];
let rejected = [];
let unverified = [];

if to_verify.len() == 0 {
    log("No findings to verify");
} else {
    let vjobs = [];
    let vi = 0;
    for f in to_verify {
        let issue_j = json_encode(f);
        let vp = "";
        vp += "Adversarially VERIFY this ROADMAP 4.0 review finding. Your job is to REFUTE weak claims.\n";
        vp += "Finding JSON: " + issue_j + "\n";
        vp += "MANDATORY: read the cited file(s) with read_file/grep. Independently check evidence.\n";
        vp += "Set real=true ONLY if the issue is real with concrete evidence you inspected.\n";
        vp += "Default real=false when unsure, speculative, already fixed, or out of scope.\n";
        vp += "severity_adjust: keep | raise | lower | drop (drop if false positive).\n";
        vp += "evidence must quote path/symbol/behavior — empty evidence means real must be false.\n";
        vjobs.push(#{
            prompt: vp,
            label: "verify:" + vi.to_string(),
            capability_mode: "read-only",
            output_schema: verdict_schema,
        });
        vi += 1;
    }
    let verdicts = parallel(vjobs);
    let vj = 0;
    for v in verdicts {
        let finding = to_verify[vj];
        if v == () || !v.success || v.output == () {
            unverified.push(finding);
        } else if v.output.real == true && v.output.evidence != () && v.output.evidence != "" {
            if v.output.severity_adjust == "drop" {
                rejected.push(finding);
            } else {
                confirmed.push(#{
                    finding: finding,
                    verdict: v.output,
                });
            }
        } else {
            rejected.push(finding);
        }
        vj += 1;
    }
    log("Verify: confirmed=" + confirmed.len().to_string()
        + " rejected=" + rejected.len().to_string()
        + " unverified=" + unverified.len().to_string());
}

// Findings not selected for verify — list as deferred (not silently dropped)
let deferred = [];
for f in all_findings {
    let key = "";
    if f.file != () { key += f.file; }
    key += "|";
    if f.issue != () { key += f.issue; }
    let was_v = false;
    for e in to_verify {
        let ek = "";
        if e.file != () { ek += e.file; }
        ek += "|";
        if e.issue != () { ek += e.issue; }
        if ek == key { was_v = true; break; }
    }
    if !was_v {
        deferred.push(f);
    }
}

// =============================================================================
phase("Report");
// =============================================================================

let report_prompt = "";
report_prompt += "Write the final ROADMAP 4.0 end-to-end review report for unified-ble-manager.\n";
report_prompt += "Charter context: " + ground_text + "\n";
report_prompt += "CONFIRMED findings (survived adversarial verify) JSON:\n";
report_prompt += json_encode(confirmed) + "\n";
report_prompt += "REJECTED / false positives JSON:\n";
report_prompt += json_encode(rejected) + "\n";
report_prompt += "UNVERIFIED (skeptic failed) JSON:\n";
report_prompt += json_encode(unverified) + "\n";
report_prompt += "DEFERRED (not in verify budget) JSON:\n";
report_prompt += json_encode(deferred) + "\n";
report_prompt += "Produce markdown sections in confirmed_markdown and deferred_markdown: severity-ranked lists with file, kind, issue, proposed_fix.\n";
report_prompt += "executive_summary: 1 short paragraph on readiness vs ROADMAP 4.0 intent.\n";
report_prompt += "next_actions: ordered fix list (smallest high-value first is OK).\n";
report_prompt += "title like 'ROADMAP 4.0 E2E Review'. Be specific; no fluff.\n";
// Optional: re-read GAPS if helpful
report_prompt += "If useful, read docs/GAPS.4.0.md to map findings onto open gaps.\n";

let report_agent = agent(report_prompt, #{
    label: "report:synthesize",
    capability_mode: "read-only",
    output_schema: report_schema,
});

let md = "# ROADMAP 4.0 E2E Review\n\n";
md += "_Workflow: `roadmap-4-e2e-review` · focus=`" + focus + "`_\n\n";

if report_agent != () && report_agent.success && report_agent.output != () {
    let o = report_agent.output;
    if o.title != () { md += "# " + o.title + "\n\n"; }
    if o.executive_summary != () {
        md += "## Executive summary\n\n";
        md += o.executive_summary + "\n\n";
    }
    if o.confirmed_markdown != () {
        md += "## Confirmed findings\n\n";
        md += o.confirmed_markdown + "\n\n";
    }
    if o.deferred_markdown != () {
        md += "## Deferred / not verified\n\n";
        md += o.deferred_markdown + "\n\n";
    }
    if o.next_actions != () {
        md += "## Next actions\n\n";
        for a in o.next_actions {
            md += "- " + a + "\n";
        }
        md += "\n";
    }
} else {
    md += "## Executive summary\n\nReport synthesizer failed; raw counts only.\n\n";
    md += "- Confirmed: " + confirmed.len().to_string() + "\n";
    md += "- Rejected: " + rejected.len().to_string() + "\n";
    md += "- Unverified: " + unverified.len().to_string() + "\n";
    md += "- Deferred: " + deferred.len().to_string() + "\n\n";
    md += "## Confirmed (raw JSON)\n\n```json\n" + json_encode(confirmed) + "\n```\n";
}

md += "---\n\n";
md += "Agent budget design: ≤32 (1 ground + ≤12 lanes + ≤10 verify + 1 report).\n";
md += "Fail-closed verify: missing skeptic evidence does not confirm.\n";

let path = write_scratch_file("roadmap-4-e2e-review.md", md);
log("Wrote report " + path);

complete(#{
    path: path,
    focus: focus,
    counts: #{
        raw: all_findings.len(),
        confirmed: confirmed.len(),
        rejected: rejected.len(),
        unverified: unverified.len(),
        deferred: deferred.len(),
        lanes: selected.len(),
        lane_failures: lane_fail,
    },
    report: md,
});
