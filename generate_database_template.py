"""Generate the Mohamy Plus database-import template from Config.gs.

The source schema and controlled values are parsed from Config.gs so the
workbook stays aligned with the Apps Script database contract.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from openpyxl import Workbook
from openpyxl.formatting.rule import CellIsRule, FormulaRule
from openpyxl.styles import Alignment, Font, PatternFill, Side, Border
from openpyxl.worksheet.datavalidation import DataValidation
from openpyxl.workbook.defined_name import DefinedName


ROOT = Path(__file__).resolve().parent
CONFIG_FILE = ROOT / "Config.gs"
WORKBOOK_FILE = ROOT / "Mohamy_Plus_Database_Template.xlsx"
GUIDE_FILE = ROOT / "DATABASE_SETUP_GUIDE.md"

NAVY = "102A43"
WHITE = "FFFFFF"
LIGHT_GRAY = "F7F9FC"
SYSTEM_GRAY = "EEF2F7"
BORDER_GRAY = "D9E2EC"
DATE_FORMAT = "yyyy-mm-dd hh:mm:ss"
EGP_FORMAT = '"EGP" #,##0.00;[Red]-"EGP" #,##0.00'


def _object_body(source: str, marker: str) -> str:
    """Return the brace-delimited JavaScript object following a const marker."""
    start = source.index(marker)
    opening = source.index("{", start)
    depth = 0
    for index in range(opening, len(source)):
        char = source[index]
        if char == "{":
            depth += 1
        elif char == "}":
            depth -= 1
            if depth == 0:
                return source[opening + 1:index]
    raise ValueError(f"Unclosed object after {marker}")


def _array_values(body: str, key: str) -> list[str]:
    match = re.search(rf"^\s*{re.escape(key)}:\s*\[(.*?)\]", body, re.MULTILINE | re.DOTALL)
    if not match:
        raise ValueError(f"Could not find array configuration for {key}")
    return re.findall(r"'([^']*)'", match.group(1))


def _string_value(body: str, key: str) -> str:
    match = re.search(rf"^\s*{re.escape(key)}:\s*'([^']*)'", body, re.MULTILINE)
    if not match:
        raise ValueError(f"Could not find string configuration for {key}")
    return match.group(1)


def load_configuration(config_file: Path = CONFIG_FILE) -> tuple[dict[str, list[str]], dict[str, list[str]], dict[str, object]]:
    """Read MP_SCHEMAS, dropdown values, and MP_DEFAULT_SETTINGS from Config.gs."""
    source = config_file.read_text(encoding="utf-8")
    config = _object_body(source, "const MP_CONFIG")
    schemas_body = _object_body(source, "const MP_SCHEMAS")
    defaults = _object_body(source, "const MP_DEFAULT_SETTINGS")

    schemas: dict[str, list[str]] = {}
    for match in re.finditer(r"^\s*(\w+):\s*\[(.*?)\]", schemas_body, re.MULTILINE | re.DOTALL):
        schemas[match.group(1)] = re.findall(r"'([^']*)'", match.group(2))

    dropdown_config = {
        "ROLES": _array_values(config, "ROLES"),
        "USER_STATUSES": _array_values(config, "USER_STATUSES"),
        "CLIENT_TYPES": _array_values(config, "CLIENT_TYPES"),
        "CLIENT_STATUSES": _array_values(config, "CLIENT_STATUSES"),
        "LANGUAGES": _array_values(config, "LANGUAGES"),
        "PARTNER_TYPES": _array_values(config, "PARTNER_TYPES"),
        "PARTNER_STATUSES": _array_values(config, "PARTNER_STATUSES"),
        "REFERRAL_SCOPES": _array_values(config, "REFERRAL_SCOPES"),
        "REFERRAL_WORK_TYPES": _array_values(config, "REFERRAL_WORK_TYPES"),
        "REFERRAL_STATUSES": _array_values(config, "REFERRAL_STATUSES"),
        "PRIORITIES": _array_values(config, "PRIORITIES"),
        "LEAD_SOURCES": _array_values(config, "LEAD_SOURCES"),
        "LEAD_STATUSES": _array_values(config, "LEAD_STATUSES"),
        "CASE_STATUSES": _array_values(config, "CASE_STATUSES"),
        "FOLLOW_UP_STATUSES": _array_values(config, "FOLLOW_UP_STATUSES"),
        "CONSULTATION_STATUSES": _array_values(config, "CONSULTATION_STATUSES"),
        "PAYMENT_STATUSES": _array_values(config, "PAYMENT_STATUSES"),
        "TRANSACTION_TYPES": _array_values(config, "TRANSACTION_TYPES"),
        "PAYMENT_METHODS": _array_values(config, "PAYMENT_METHODS"),
        "CONFIDENTIALITY_LEVELS": _array_values(config, "CONFIDENTIALITY_LEVELS"),
        # mpBoolean_ in Validation.gs accepts literal true/false values.
        "BOOLEAN_VALUES": ["TRUE", "FALSE"],
    }

    practice_areas = _array_values(defaults, "PRACTICE_AREAS")
    default_settings = {
        "BUSINESS_NAME": _string_value(defaults, "BUSINESS_NAME"),
        "CURRENCY": _string_value(defaults, "CURRENCY"),
        "TIMEZONE": _string_value(defaults, "TIMEZONE"),
        "LEAD_STATUSES": dropdown_config["LEAD_STATUSES"],
        "CASE_STATUSES": dropdown_config["CASE_STATUSES"],
        "PRACTICE_AREAS": practice_areas,
        "PAYMENT_METHODS": dropdown_config["PAYMENT_METHODS"],
        "NOTIFICATION_PREFERENCES": {"email": True, "overdueFollowUps": True, "upcomingConsultations": True},
        "FUTURE_INTEGRATIONS_ENABLED": False,
    }
    return schemas, dropdown_config, default_settings


def cairo_now_iso() -> str:
    return datetime.now(ZoneInfo("Africa/Cairo")).replace(microsecond=0).isoformat()


def column_width(header: str) -> float:
    wide = {"Description", "Notes", "Outcome", "LostReason", "OpposingParties", "Address", "SettingValue"}
    medium = {"FullName", "CompanyName", "CaseTitle", "FileName", "MeetingLocation", "ContactPerson", "PracticeArea", "InquiryType"}
    if header in wide:
        return 34
    if header in medium:
        return 24
    if header.endswith("ID") or header in {"CaseNumber", "Email", "Phone", "CommercialRegistrationNumber", "TaxNumber"}:
        return 22
    if header in {"CreatedAt", "UpdatedAt", "LastLogin", "LastContactAt", "NextFollowUpAt", "StartDate", "Deadline", "ClosedAt", "ConsultationDate", "PaymentDate", "DueDate", "CompletedAt", "Timestamp", "UploadedAt", "ArchivedAt"}:
        return 22
    return 16


def add_named_lists(workbook: Workbook, dropdowns: dict[str, list[str]]) -> None:
    sheet = workbook.create_sheet("ValidationLists")
    for column, (name, values) in enumerate(dropdowns.items(), start=1):
        sheet.cell(1, column, name)
        for row, value in enumerate(values, start=2):
            sheet.cell(row, column, value)
        column_letter = sheet.cell(1, column).column_letter
        workbook.defined_names.add(DefinedName(f"MP_{name}", attr_text=f"'ValidationLists'!${column_letter}$2:${column_letter}${len(values) + 1}"))
        sheet.column_dimensions[column_letter].width = max(18, len(name) + 2)
    sheet.sheet_state = "hidden"


def apply_validation(sheet, headers: list[str], header: str, named_list: str) -> None:
    if header not in headers:
        return
    col = headers.index(header) + 1
    letter = sheet.cell(1, col).column_letter
    rule = DataValidation(type="list", formula1=f"=MP_{named_list}", allow_blank=True)
    # Dropdowns guide entry. Apps Script remains authoritative and may evolve.
    rule.showErrorMessage = False
    rule.errorTitle = "Use a configured value"
    rule.error = "Choose a listed value or let the Apps Script server validate a future configured value."
    rule.promptTitle = header
    rule.prompt = "Select a configured value where applicable."
    rule.showInputMessage = True
    sheet.add_data_validation(rule)
    rule.add(f"${letter}$2:${letter}$1001")


def style_sheet(sheet, headers: list[str]) -> None:
    last_column = sheet.cell(1, len(headers)).column_letter
    header_fill = PatternFill("solid", fgColor=NAVY)
    alternate_fill = PatternFill("solid", fgColor=LIGHT_GRAY)
    system_fill = PatternFill("solid", fgColor=SYSTEM_GRAY)
    thin_border = Border(bottom=Side(style="thin", color=BORDER_GRAY))
    system_headers = {"IsArchived", "ArchivedAt", "Version", "CreatedAt", "UpdatedAt", "LastLogin", "Timestamp", "UploadedAt", "TotalPaid", "OutstandingBalance"}
    date_headers = {"CreatedAt", "UpdatedAt", "LastLogin", "LastContactAt", "NextFollowUpAt", "StartDate", "Deadline", "ClosedAt", "ConsultationDate", "PaymentDate", "DueDate", "CompletedAt", "Timestamp", "UploadedAt", "ArchivedAt"}
    currency_headers = {"AgreedFee", "TotalPaid", "OutstandingBalance", "Fee", "Amount"}
    numeric_headers = {"Duration", "Version"}
    text_headers = {header for header in headers if header.endswith("ID")} | {"Phone", "Email", "CommercialRegistrationNumber", "TaxNumber", "CaseNumber", "DriveFileID"}

    sheet.freeze_panes = "A2"
    sheet.auto_filter.ref = f"A1:{last_column}1001"
    sheet.sheet_view.showGridLines = False
    sheet.row_dimensions[1].height = 28

    for column, header in enumerate(headers, start=1):
        cell = sheet.cell(1, column)
        cell.fill = header_fill
        cell.font = Font(name="Aptos", size=11, bold=True, color=WHITE)
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = thin_border
        sheet.column_dimensions[cell.column_letter].width = column_width(header)
        for row in range(2, 202):
            value_cell = sheet.cell(row, column)
            value_cell.font = Font(name="Aptos", size=10, color="243B53")
            value_cell.alignment = Alignment(vertical="top", wrap_text=header in {"Description", "Notes", "Outcome", "OpposingParties", "Address", "SettingValue"})
            value_cell.border = thin_border
            if row % 2 == 0:
                value_cell.fill = alternate_fill
            if header in system_headers:
                value_cell.fill = system_fill
            if header in date_headers:
                value_cell.number_format = DATE_FORMAT
            elif header in currency_headers:
                value_cell.number_format = EGP_FORMAT
            elif header in numeric_headers:
                value_cell.number_format = "0"
            elif header in text_headers:
                value_cell.number_format = "@"

    sheet.conditional_formatting.add(
        f"A2:{last_column}1001",
        FormulaRule(formula=["FALSE"], stopIfTrue=False),
    )


def add_status_formatting(sheet, headers: list[str]) -> None:
    if "Status" not in headers:
        return
    status_col = sheet.cell(1, headers.index("Status") + 1).column_letter
    target = f"${status_col}$2:${status_col}$1001"
    green = PatternFill("solid", fgColor="D9EAD3")
    red = PatternFill("solid", fgColor="F4CCCC")
    blue = PatternFill("solid", fgColor="D9EAF7")
    for value in ("CONVERTED", "COMPLETED", "PAID"):
        sheet.conditional_formatting.add(target, CellIsRule(operator="equal", formula=[f'"{value}"'], fill=green))
    for value in ("LOST", "NOT_QUALIFIED", "CANCELLED", "NO_SHOW"):
        sheet.conditional_formatting.add(target, CellIsRule(operator="equal", formula=[f'"{value}"'], fill=red))
    for value in ("NEW", "SCHEDULED", "IN_PROGRESS"):
        sheet.conditional_formatting.add(target, CellIsRule(operator="equal", formula=[f'"{value}"'], fill=blue))


def add_overdue_followup_formatting(sheet, headers: list[str]) -> None:
    if sheet.title != "FollowUps":
        return
    due_col = sheet.cell(1, headers.index("DueDate") + 1).column_letter
    status_col = sheet.cell(1, headers.index("Status") + 1).column_letter
    last_col = sheet.cell(1, len(headers)).column_letter
    fill = PatternFill("solid", fgColor="FCE4D6")
    sheet.conditional_formatting.add(
        f"A2:{last_col}1001",
        FormulaRule(formula=[f'AND(${due_col}2<TODAY(),${status_col}2="OPEN")'], fill=fill),
    )


def populate_settings(sheet, headers: list[str], defaults: dict[str, object]) -> None:
    index = {header: position + 1 for position, header in enumerate(headers)}
    generated_at = cairo_now_iso()
    for row_number, (key, value) in enumerate(defaults.items(), start=2):
        sheet.cell(row_number, index["SettingKey"], key)
        sheet.cell(row_number, index["SettingValue"], json.dumps(value, ensure_ascii=False, separators=(",", ":")))
        sheet.cell(row_number, index["UpdatedAt"], generated_at)
        sheet.cell(row_number, index["UpdatedBy"], "SYSTEM")
        sheet.cell(row_number, index["Version"], 1)


def write_guide(schemas: dict[str, list[str]]) -> None:
    sheet_descriptions = {
        "Users": "Approved internal application accounts and their roles.",
        "Leads": "Potential clients before qualification or conversion.",
        "Clients": "Individuals and company client records; individual contacts can link to a CompanyID.",
        "Companies": "Company identity and commercial contact information.",
        "Cases": "Legal matters linked to a ClientID, including conflict-check and financial fields.",
        "Consultations": "Appointments linked to a lead or client and assigned lawyer.",
        "Transactions": "Cashflow records; INCOME linked to a case updates case payment totals through Apps Script.",
        "FollowUps": "Tasks linked to a lead, client, or case.",
        "Activities": "Append-only server activity history.",
        "Documents": "Google Drive file metadata linked to an entity; it does not store the file itself.",
        "Settings": "Initial application configuration values serialized the same way as MP_DEFAULT_SETTINGS.",
    }
    entity_list = "\n".join(f"- `{name}` — {sheet_descriptions[name]}" for name in schemas)
    guide = f"""# Mohamy Plus database template setup

`Mohamy_Plus_Database_Template.xlsx` is an empty import template generated from `MP_SCHEMAS`, `MP_CONFIG`, and `MP_DEFAULT_SETTINGS` in `Config.gs`. It contains no client, case, user, or other operational records. The only populated rows are the initial Settings values.

## Worksheets and relationships

{entity_list}

Key relationships are `Companies → Clients`, `Leads → Clients` on conversion, `Clients → Cases`, and `Cases → Transactions`. Consultations and follow-ups can link to leads, clients, and/or cases. Users are referenced by assignment fields. Activities and Documents attach to entities by `EntityType` and `EntityID`.

## System-managed columns

Do not manually create or edit permanent IDs (`*ID`, `CaseNumber`, `DriveFileID`), timestamps (`CreatedAt`, `UpdatedAt`, `ArchivedAt`, `Timestamp`, `UploadedAt`, and related event dates), `Version`, archive fields, activity rows, or calculated case values (`TotalPaid`, `OutstandingBalance`). The Apps Script service owns these values, locks concurrent writes, and uses `Version` to prevent silent overwrites. A negative `OutstandingBalance` explicitly means the case has been overpaid. Do not add formulas to financial columns.

`Settings` is intentionally pre-populated with values compatible with `MP_DEFAULT_SETTINGS`. Treat `SettingKey`, `UpdatedAt`, `UpdatedBy`, and `Version` as system-managed. IDs, phone numbers, commercial-registration numbers, tax numbers, and Settings JSON use plain-text formatting to preserve leading zeros and JSON values. Change configuration only through the future authorized Settings UI or a reviewed administrative procedure.

Excel dropdowns are convenience guidance only. They do **not** replace Apps Script server-side validation and deliberately do not block a future value that has been added to the backend configuration.

## Import and bind

1. Upload `Mohamy_Plus_Database_Template.xlsx` to the approved Google Drive account.
2. In Drive, right-click it and choose **Open with → Google Sheets**. This converts it to a Google Sheet.
3. Inspect every imported worksheet before use: all seventeen entity sheets must exist, headers must be in row 1, in the exact order shown, and the Settings values must be present. The hidden `ValidationLists` worksheet supports dropdowns and should remain hidden.
4. Open the converted spreadsheet. Its URL has the form `https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit`; copy only the value between `/d/` and `/edit`.
5. In the Apps Script project, run `bindExistingDatabase('SPREADSHEET_ID')`. It validates every required sheet, exact header order, duplicate columns, and required Settings defaults before it stores the ID. An incompatible spreadsheet is not modified or bound. Do not put the ID into source files, HTML, or documentation.
6. Run `setupDatabase()`. It safely creates missing sheets or headers only in genuinely blank sheets, applies presentation configuration, and provisions an initial owner. It refuses nonblank incompatible schemas and never resets an existing setting value.
7. Run `getStage1DatabaseStatus()` and confirm it reports the expected database.
8. Run `runStage1DatabaseTests()` from the Apps Script editor after setup. It uses a separate temporary spreadsheet through an execution-local context, never changes the configured database ID, and moves test storage to Trash.

## Security and data handling

Do not place real client, case, payment, identity, or confidential legal information in this workbook before authentication, authorization, deployment restrictions, and Drive access controls are implemented. Do not grant general staff direct edit access to the database spreadsheet. A spreadsheet URL is not access control, and workbook validations do not enforce server permissions. Apps Script can fail to disclose the active user's email in consumer or cross-domain deployments; administrative actions fail closed in that case.

No spreadsheet IDs, credentials, secrets, sample users, fabricated clients, or sample legal matters are included in this template.
"""
    GUIDE_FILE.write_text(guide, encoding="utf-8")


def generate(write_guide_file: bool = False) -> tuple[Path, Path | None]:
    """Build the workbook. The guide is hand-maintained; only overwrite it on request."""
    schemas, dropdowns, defaults = load_configuration()
    expected_sheets = ["Users", "Leads", "Clients", "Companies", "Cases", "Consultations", "Transactions", "FollowUps", "Activities", "Documents", "Settings", "Assignments", "AccessLog", "ExternalPartners", "Referrals", "ReferralWork", "ReferralPayments"]
    if list(schemas) != expected_sheets:
        raise ValueError("MP_SCHEMAS does not match the required entity order; generation stopped.")

    workbook = Workbook()
    workbook.remove(workbook.active)
    workbook.properties.title = "Mohamy Plus Database Template"
    workbook.properties.subject = "Google Sheets import template for the Mohamy Plus legal CRM"
    workbook.properties.creator = "Mohamy Plus"
    add_named_lists(workbook, dropdowns)

    validation_map = {
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

    for name, headers in schemas.items():
        sheet = workbook.create_sheet(name)
        sheet.append(headers)
        style_sheet(sheet, headers)
        for header, list_name in validation_map.get(name, {}).items():
            apply_validation(sheet, headers, header, list_name)
        add_status_formatting(sheet, headers)
        add_overdue_followup_formatting(sheet, headers)
        if name == "Settings":
            populate_settings(sheet, headers, defaults)

    workbook.active = workbook.sheetnames.index("Users")
    workbook.save(WORKBOOK_FILE)
    if write_guide_file:
        write_guide(schemas)
        return WORKBOOK_FILE, GUIDE_FILE
    return WORKBOOK_FILE, None


if __name__ == "__main__":
    import sys
    workbook_path, guide_path = generate(write_guide_file="--write-guide" in sys.argv)
    print(f"Generated {workbook_path.name}")
    if guide_path:
        print(f"Generated {guide_path.name}")
