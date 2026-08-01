"""
Bulk import: turns an uploaded CSV or Excel file into rows of Subjects,
Rooms, Teachers, or Class Groups, so a school with 40+ teachers doesn't
have to be typed in one at a time through the Data Entry forms.

Design choices:
  - CSV and .xlsx are both accepted, detected by file extension. openpyxl
    (already a dependency, used by app/services/export.py) reads the
    Excel case; the standard library's csv module handles CSV. Both paths
    converge on the same shape — a list of dicts keyed by the header
    row's column names, lowercased and stripped — so every import_*
    function below only has to deal with one input shape regardless of
    which file type was uploaded.
  - Best-effort, not all-or-nothing: a bad row (missing a required
    column, an unresolvable subject name, whatever) is recorded as an
    error and skipped, but every other row in the file still gets
    imported. A single typo shouldn't force a 40-row admin to fix and
    re-upload the whole spreadsheet from scratch. This mirrors the same
    philosophy as the solver's room assignment (best-effort, not
    infeasible-or-nothing) and constraint parsing (fall back, don't
    block) elsewhere in this codebase.
  - Upsert by name (or grade+name for class groups), not blind insert:
    re-uploading the same file (e.g. after fixing a typo in one row) is
    idempotent rather than creating duplicates, which matters because the
    realistic workflow is "export current roster, edit it, re-upload."
"""
import csv
import io
from dataclasses import dataclass, field

import openpyxl
from sqlalchemy.orm import Session

from app.models.school import ClassGroup, Room, Subject, Teacher


@dataclass
class BulkImportResult:
    created: int = 0
    updated: int = 0
    # human-readable, e.g. "Row 4: missing required 'name' column"
    errors: list[str] = field(default_factory=list)


def parse_rows(filename: str, content: bytes) -> list[dict]:
    """
    Parses an uploaded file into a list of row dicts keyed by lowercased,
    stripped header names. Raises ValueError (caught by the router and
    turned into a 400) if the file type isn't recognized or has no header
    row — everything past that point is per-row, not per-file, error
    handling.
    """
    lower_name = filename.lower()
    if lower_name.endswith(".csv"):
        text = content.decode("utf-8-sig")  # -sig strips a BOM, common from Excel's "Save as CSV"
        reader = csv.reader(io.StringIO(text))
        rows = list(reader)
    elif lower_name.endswith(".xlsx"):
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        rows = [[("" if c is None else str(c)) for c in row] for row in ws.iter_rows(values_only=True)]
    else:
        raise ValueError("Unsupported file type — upload a .csv or .xlsx file.")

    rows = [r for r in rows if any(str(c).strip() for c in r)]  # drop fully blank rows
    if not rows:
        raise ValueError("The file has no data in it.")

    header = [str(c).strip().lower() for c in rows[0]]
    data_rows = []
    for row in rows[1:]:
        padded = list(row) + [""] * (len(header) - len(row))  # short rows just get blank trailing cells
        data_rows.append({header[i]: str(padded[i]).strip() for i in range(len(header))})
    return data_rows


def _int_or_none(value: str) -> int | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return int(float(value))  # float() first so "40.0" from Excel doesn't raise
    except ValueError:
        return None


def import_subjects(db: Session, school_id: int, rows: list[dict]) -> BulkImportResult:
    """Expected columns: name (required), required_room_type (optional)."""
    result = BulkImportResult()
    existing = {s.name.lower(): s for s in db.query(Subject).filter(Subject.school_id == school_id).all()}

    for i, row in enumerate(rows, start=2):  # row 1 is the header
        name = row.get("name", "").strip()
        if not name:
            result.errors.append(f"Row {i}: missing required 'name' column")
            continue
        required_room_type = row.get("required_room_type", "").strip() or None

        match = existing.get(name.lower())
        if match:
            match.required_room_type = required_room_type
            result.updated += 1
        else:
            subject = Subject(school_id=school_id, name=name, required_room_type=required_room_type)
            db.add(subject)
            existing[name.lower()] = subject
            result.created += 1

    db.commit()
    return result


def import_rooms(db: Session, school_id: int, rows: list[dict]) -> BulkImportResult:
    """Expected columns: name (required), capacity (optional int), room_type (optional)."""
    result = BulkImportResult()
    existing = {r.name.lower(): r for r in db.query(Room).filter(Room.school_id == school_id).all()}

    for i, row in enumerate(rows, start=2):
        name = row.get("name", "").strip()
        if not name:
            result.errors.append(f"Row {i}: missing required 'name' column")
            continue
        capacity = _int_or_none(row.get("capacity", ""))
        room_type = row.get("room_type", "").strip() or None

        match = existing.get(name.lower())
        if match:
            match.capacity = capacity
            match.room_type = room_type
            result.updated += 1
        else:
            room = Room(school_id=school_id, name=name, capacity=capacity, room_type=room_type)
            db.add(room)
            existing[name.lower()] = room
            result.created += 1

    db.commit()
    return result


def import_teachers(db: Session, school_id: int, rows: list[dict]) -> BulkImportResult:
    """
    Expected columns: name (required), email (optional),
    max_periods_per_week (optional int), qualified_subjects (optional —
    subject names separated by ';' or ',', matched case-insensitively
    against this school's existing subjects; add the subjects first if
    they don't exist yet, or they're silently skipped with a warning).
    """
    result = BulkImportResult()
    existing = {t.name.lower(): t for t in db.query(Teacher).filter(Teacher.school_id == school_id).all()}
    subjects_by_name = {s.name.lower(): s for s in db.query(Subject).filter(Subject.school_id == school_id).all()}

    for i, row in enumerate(rows, start=2):
        name = row.get("name", "").strip()
        if not name:
            result.errors.append(f"Row {i}: missing required 'name' column")
            continue
        email = row.get("email", "").strip() or None
        max_periods = _int_or_none(row.get("max_periods_per_week", ""))

        qualified_ids = []
        raw_subjects = row.get("qualified_subjects", "")
        if raw_subjects:
            names = [n.strip() for n in raw_subjects.replace(";", ",").split(",") if n.strip()]
            unresolved = []
            for sname in names:
                subj = subjects_by_name.get(sname.lower())
                if subj:
                    qualified_ids.append(subj.id)
                else:
                    unresolved.append(sname)
            if unresolved:
                result.errors.append(
                    f"Row {i} ({name}): couldn't match subject(s) {', '.join(unresolved)} — "
                    f"add them as subjects first, then re-import to pick them up."
                )

        match = existing.get(name.lower())
        if match:
            match.email = email
            match.max_periods_per_week = max_periods
            if qualified_ids:
                match.qualified_subject_ids = qualified_ids
            result.updated += 1
        else:
            teacher = Teacher(
                school_id=school_id,
                name=name,
                email=email,
                max_periods_per_week=max_periods,
                qualified_subject_ids=qualified_ids,
            )
            db.add(teacher)
            existing[name.lower()] = teacher
            result.created += 1

    db.commit()
    return result


def import_class_groups(db: Session, school_id: int, rows: list[dict]) -> BulkImportResult:
    """Expected columns: name (required), grade (optional), student_count (optional int)."""
    result = BulkImportResult()
    groups = db.query(ClassGroup).filter(ClassGroup.school_id == school_id).all()
    existing = {(g.grade or "").lower(): {} for g in groups}
    for g in groups:
        existing.setdefault((g.grade or "").lower(), {})[g.name.lower()] = g

    for i, row in enumerate(rows, start=2):
        name = row.get("name", "").strip()
        if not name:
            result.errors.append(f"Row {i}: missing required 'name' column")
            continue
        grade = row.get("grade", "").strip() or None
        student_count = _int_or_none(row.get("student_count", ""))

        match = existing.get((grade or "").lower(), {}).get(name.lower())
        if match:
            match.student_count = student_count
            result.updated += 1
        else:
            cg = ClassGroup(school_id=school_id, grade=grade, name=name, student_count=student_count)
            db.add(cg)
            existing.setdefault((grade or "").lower(), {})[name.lower()] = cg
            result.created += 1

    db.commit()
    return result


# Downloadable starter templates — header row + one example row, so an
# admin doesn't have to guess column names or formatting from scratch.
TEMPLATES: dict[str, str] = {
    "subjects": "name,required_room_type\nChemistry,lab\nMath,\n",
    "rooms": "name,capacity,room_type\nRoom 101,35,\nChem Lab,30,lab\n",
    "teachers": "name,email,max_periods_per_week,qualified_subjects\n"
                "Priya Sharma,priya@example.com,24,Math;Science\n",
    "class_groups": "name,grade,student_count\nA,Grade 8,32\nB,Grade 8,30\n",
}
