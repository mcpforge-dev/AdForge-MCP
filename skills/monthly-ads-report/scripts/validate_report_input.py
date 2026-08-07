#!/usr/bin/env python3
"""Validate provenance and anti-hallucination gates for a report dataset."""

from __future__ import annotations

import json
import sys
from pathlib import Path


VALID_PROVENANCE = {"SOURCE_FACT", "USER_CONFIRMED", "CALCULATED", "UNKNOWN"}


def validate(data: dict) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    mode = data.get("mode")
    if mode not in {"draft_with_gaps", "final"}:
        errors.append("mode must be draft_with_gaps or final")

    facts = data.get("facts", [])
    changes = data.get("changes", [])
    questions = data.get("questions", [])
    assertions = data.get("assertions", [])
    if not all(isinstance(x, list) for x in (facts, changes, questions, assertions)):
        return ["facts, changes, questions and assertions must be arrays"], warnings

    evidence: dict[str, tuple[str, str]] = {}
    for index, fact in enumerate(facts):
        fact_id = fact.get("fact_id")
        status = fact.get("provenance", {}).get("status")
        if not fact_id:
            errors.append(f"facts[{index}] has no fact_id")
            continue
        if fact_id in evidence:
            errors.append(f"duplicate evidence id: {fact_id}")
        if status not in VALID_PROVENANCE:
            errors.append(f"fact {fact_id} has invalid provenance status")
        provenance = fact.get("provenance", {})
        if status == "SOURCE_FACT" and not provenance.get("source_ref"):
            errors.append(f"source fact {fact_id} has no source_ref")
        if status == "USER_CONFIRMED" and not provenance.get("source_ref"):
            errors.append(f"user-confirmed fact {fact_id} has no answer source_ref")
        if status == "CALCULATED" and (not provenance.get("formula") or not provenance.get("evidence_ids")):
            errors.append(f"calculated fact {fact_id} lacks formula or evidence_ids")
        if status == "UNKNOWN":
            warnings.append(f"unknown fact: {fact_id}")
        evidence[fact_id] = ("fact", status or "")

    for index, change in enumerate(changes):
        change_id = change.get("change_id")
        reason_status = change.get("reason_status")
        if not change_id:
            errors.append(f"changes[{index}] has no change_id")
            continue
        if change_id in evidence:
            errors.append(f"duplicate evidence id: {change_id}")
        if reason_status == "CONFIRMED" and not change.get("reason"):
            errors.append(f"change {change_id} is confirmed but has no reason")
        if reason_status == "MISSING":
            matching = [q for q in questions if q.get("entity_id") == change.get("entity_id") and q.get("category") == "change_reason"]
            if not matching:
                errors.append(f"change {change_id} has no reason and no mandatory question")
            if mode == "final":
                errors.append(f"final report contains change with missing reason: {change_id}")
        if reason_status == "UNKNOWN":
            warnings.append(f"unknown change reason: {change_id}")
        evidence[change_id] = ("change", reason_status or "")

    open_questions = [q.get("question_id", "<missing-id>") for q in questions if q.get("status") == "OPEN"]
    if mode == "final" and open_questions:
        errors.append("final report has open questions: " + ", ".join(open_questions))

    for assertion in assertions:
        assertion_id = assertion.get("assertion_id", "<missing-id>")
        refs = assertion.get("evidence_ids", [])
        if not refs:
            errors.append(f"assertion {assertion_id} has no evidence_ids")
            continue
        missing = [ref for ref in refs if ref not in evidence]
        if missing:
            errors.append(f"assertion {assertion_id} references missing evidence: {', '.join(missing)}")
        unknown_refs = [ref for ref in refs if evidence.get(ref, (None, None))[1] in {"UNKNOWN", "MISSING"}]
        if unknown_refs and assertion.get("type") != "hypothesis":
            errors.append(f"assertion {assertion_id} relies on unknown evidence: {', '.join(unknown_refs)}")
        if assertion.get("type") == "causal":
            confirmed_reason = any(evidence.get(ref) == ("change", "CONFIRMED") for ref in refs)
            if not confirmed_reason:
                errors.append(f"causal assertion {assertion_id} lacks a confirmed change reason")

    return errors, warnings


def main() -> int:
    if len(sys.argv) != 2:
        print("Usage: validate_report_input.py <validated-report-data.json>", file=sys.stderr)
        return 2
    path = Path(sys.argv[1])
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    errors, warnings = validate(data)
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    print(f"Validation complete: {len(errors)} error(s), {len(warnings)} warning(s)")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
