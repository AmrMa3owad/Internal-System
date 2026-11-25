"""Independent verification for Mohamy_Plus_Database_Template.xlsx."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from openpyxl import load_workbook

from generate_database_template import ROOT, WORKBOOK_FILE, load_configuration


REQUIRED_SHEETS = ["Users", "Leads", "Clients", "Companies", "Cases", "Consultations", "Transactions", "FollowUps", "Activities", "Documents", "Settings", "Assignments", "AccessLog", "ExternalPartners", "Referrals", "ReferralWork", "ReferralPayments", "Conversations", "Messages", "WebhookEvents"]
EXPECTED_VALIDATIONS = {
    "Users": {"Role": "ROLES", "Status": "USER_STATUSES", "Language": "LANGUAGES"},
    "Leads": {"ClientType": "CLIENT_TYPES", "Source": "LEAD_SOURCES", "Priority": "PRIORITIES", "Status": "LEAD_STATUSES"},
    "Clients": {"ClientType": "CLIENT_TYPES", "Status": "CLIENT_STATUSES"},
    "Cases": {"Priority": "PRIORITIES", "Status": "CASE_STATUSES"},
    "Consultations": {"PaymentStatus": "PAYMENT_STATUSES", "Status": "CONSULTATION_STATUSES", "IsPaid": "BOOLEAN_VALUES"},
    "Transactions": {"Type": "TRANSACTION_TYPES", "PaymentMethod": "PAYMENT_METHODS"},
    "FollowUps": {"Priority": "PRIORITIES", "Status": "FOLLOW_UP_STATUSES"},
    "Documents": {"ConfidentialityLevel": "CONFIDENTIALITY_LEVELS"},
        "ExternalPartners": {"PartnerType": "PARTNER_TYPES", "Status": "PARTNER_STATUSES"},
        "Referrals": {"Scope": "REFERRAL_SCOPES", "ExternalWork": "REFERRAL_WORK_TYPES", "Status": "REFERRAL_STATUSES"},
        "ReferralPayments": {"PaymentMethod": "PAYMENT_METHODS"},
}


def verify() -> dict[str, object]:
    schemas, _dropdowns, defaults = load_configuration()
    errors: list[str] = []
    checks: list[str] = []
    if not WORKBOOK_FILE.exists():
        return {"passed": False, "errors": [f"Workbook not found: {WORKBOOK_FILE}"], "checks": checks}

    try:
        workbook = load_workbook(WORKBOOK_FILE, data_only=False)
        checks.append("Workbook opens successfully with openpyxl.")
    except Exception as error:  # pragma: no cover - reports a useful CLI failure
        return {"passed": False, "errors": [f"Workbook cannot be opened: {error}"], "checks": checks}

    missing_sheets = [name for name in REQUIRED_SHEETS if name not in workbook.sheetnames]
    if missing_sheets:
        errors.append("Missing worksheets: " + ", ".join(missing_sheets))
    else:
        checks.append("All seventeen required entity worksheets exist.")

    for sheet_name in REQUIRED_SHEETS:
        if sheet_name not in workbook.sheetnames:
            continue
        sheet = workbook[sheet_name]
        headers = list(next(sheet.iter_rows(min_row=1, max_row=1, values_only=True)))
        expected_headers = schemas[sheet_name]
        if headers != expected_headers:
            errors.append(f"{sheet_name}: headers do not exactly match MP_SCHEMAS.")
        if len(headers) != len(set(headers)):
            errors.append(f"{sheet_name}: duplicate headers found.")
        if [header for header in expected_headers if header not in headers]:
            errors.append(f"{sheet_name}: required header is missing.")
        if headers == expected_headers and len(headers) == len(set(headers)):
            checks.append(f"{sheet_name}: exact, unique schema headers verified.")

        if sheet_name in EXPECTED_VALIDATIONS:
            expected_formulas = {f"=MP_{name}" for name in EXPECTED_VALIDATIONS[sheet_name].values()}
            actual_formulas = {validation.formula1 for validation in sheet.data_validations.dataValidation}
            missing_validations = expected_formulas - actual_formulas
            if missing_validations:
                errors.append(f"{sheet_name}: missing expected dropdown validation(s): {', '.join(sorted(missing_validations))}.")
            else:
                checks.append(f"{sheet_name}: required dropdown validations verified.")

        if sheet_name != "Settings":
            records = [row for row in sheet.iter_rows(min_row=2, values_only=True) if any(value is not None for value in row)]
            if records:
                errors.append(f"{sheet_name}: contains {len(records)} non-header record(s); template must be empty.")

    settings_sheet = workbook["Settings"] if "Settings" in workbook.sheetnames else None
    if settings_sheet:
        setting_values = {
            row[0]: row[1]
            for row in settings_sheet.iter_rows(min_row=2, values_only=True)
            if row[0] is not None
        }
        expected_values = {key: json.dumps(value, ensure_ascii=False, separators=(",", ":")) for key, value in defaults.items()}
        if setting_values != expected_values:
            errors.append("Settings rows do not exactly match MP_DEFAULT_SETTINGS JSON values.")
        else:
            checks.append("Settings keys and JSON values match MP_DEFAULT_SETTINGS.")

    if "ValidationLists" not in workbook.sheetnames or workbook["ValidationLists"].sheet_state != "hidden":
        errors.append("ValidationLists helper worksheet is missing or visible.")
    else:
        checks.append("Hidden validation-list worksheet is present.")

    return {"passed": not errors, "errors": errors, "checks": checks, "workbook": str(WORKBOOK_FILE)}


if __name__ == "__main__":
    report = verify()
    print(json.dumps(report, indent=2, ensure_ascii=False))
    sys.exit(0 if report["passed"] else 1)
