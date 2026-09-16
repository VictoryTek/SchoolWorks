"""
Synergy SIS -- OneRoster v1.1 API connection test.
Spec: https://www.imsglobal.org/oneroster-v11-final-specification

Auth (Section 3.6.2):  POST /oauth/token
  Authorization: Basic base64(client_id:client_secret)
  Body: grant_type=client_credentials&scope=<scope>

API root (Section 3.3): /ims/oneroster/v1p1/
"""

import os, json, base64, csv, urllib.request, urllib.parse, urllib.error
from pathlib import Path
from fix_usernames import derive_username

# --- Load .env ---------------------------------------------------------------
_env = Path(__file__).parent / ".env"
if _env.exists():
    for _l in _env.read_text().splitlines():
        _l = _l.strip()
        if _l and not _l.startswith("#") and "=" in _l:
            _k, _v = _l.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

BASE_URL      = "https://tn-obi.edupoint.com"
CLIENT_ID     = os.environ.get("SYNERGY_CLIENT_ID")
CLIENT_SECRET = os.environ.get("SYNERGY_CLIENT_SECRET")
TOKEN_URL     = f"{BASE_URL}/oauth/access_token"
API_ROOT      = f"{BASE_URL}/ims/oneroster/v1p1"
EXPORT_DIR    = Path(os.environ.get("SYNERGY_EXPORT_DIR", Path(__file__).parent))

if not CLIENT_ID or not CLIENT_SECRET:
    raise SystemExit("Missing SYNERGY_CLIENT_ID or SYNERGY_CLIENT_SECRET in .env.")

SCOPES_TO_TRY = [
    "",   # this server rejects scoped requests; no-scope works
    "https://purl.imsglobal.org/spec/or/v1p1/scope/roster.readonly",
    "https://purl.imsglobal.org/spec/or/v1p1/scope/roster-core.readonly",
]

ENDPOINTS_TO_TRY = [
    "/schools",
    "/orgs",
    "/students",
    "/teachers",
    "/users",
    "/academicSessions",
]

PAGE_SIZE = 100   # records per page

# --- Data-pull menu ---------------------------------------------------------
PULL_OPTIONS = {
    "1": ("students",         "/students",         "users"),
    "2": ("teachers",         "/teachers",         "users"),
    "3": ("enrollments",      "/enrollments",      "enrollments"),
    "4": ("classes",          "/classes",          "classes"),
    "5": ("schools",          "/schools",          "orgs"),
    "6": ("academicSessions", "/academicSessions", "academicSessions"),
    "7": ("All of the above", None,                None),
}

print("\nWhat would you like to pull?")
for key, (label, _, _) in PULL_OPTIONS.items():
    print(f"  {key}) {label}")
choice = input("Enter number(s) separated by commas (e.g. 1,3): ").strip()

selected = []
keys = [k.strip() for k in choice.split(",")]
if "7" in keys:
    selected = [(label, ep, rk) for k, (label, ep, rk) in PULL_OPTIONS.items() if k != "7"]
else:
    for k in keys:
        if k in PULL_OPTIONS and PULL_OPTIONS[k][1] is not None:
            selected.append(PULL_OPTIONS[k])
        elif k:
            print(f"  Warning: unknown option '{k}' ignored.")

if not selected:
    raise SystemExit("No valid options selected. Exiting.")

# ---------------------------------------------------------------------------
def fetch_token(scope):
    creds = base64.b64encode(f"{CLIENT_ID}:{CLIENT_SECRET}".encode()).decode()
    body = {"grant_type": "client_credentials"}
    if scope:
        body["scope"] = scope
    req = urllib.request.Request(TOKEN_URL,
        data=urllib.parse.urlencode(body).encode(),
        headers={
            "Authorization": f"Basic {creds}",
            "Content-Type":  "application/x-www-form-urlencoded",
            "Accept":        "application/json",
        })
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            data = json.loads(r.read().decode())
            return data.get("access_token")
    except urllib.error.HTTPError as e:
        print(f"    [{e.code}] {e.read().decode(errors='replace')[:200]}")
        return None
    except urllib.error.URLError as e:
        raise SystemExit(f"Connection error: {e.reason}")

def api_get(url, headers):
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            total = r.headers.get("X-Total-Count", "")
            return r.status, r.read().decode(errors="replace"), total
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode(errors="replace"), ""
    except urllib.error.URLError as e:
        return 0, str(e.reason), ""

def fetch_all(endpoint, record_key):
    """Fetch every page from a OneRoster endpoint and return all records."""
    all_records = []
    offset = 0
    server_total = None
    while True:
        url = f"{API_ROOT}{endpoint}?limit={PAGE_SIZE}&offset={offset}"
        status, body, x_total = api_get(url, HEADERS)
        if status != 200:
            print(f"  Error {status}: {body[:200]}")
            break
        if server_total is None and x_total:
            server_total = x_total
            print(f"  Server reports X-Total-Count: {server_total}")
        data = json.loads(body)
        page = data.get(record_key, [])
        all_records.extend(page)
        print(f"  Fetched {len(all_records)} so far (page offset {offset})...")
        if len(page) < PAGE_SIZE:
            break          # last page
        offset += PAGE_SIZE
    if server_total and str(len(all_records)) != server_total:
        print(f"  WARNING: received {len(all_records)} records but server reported {server_total} -- possible filter mismatch")
    return all_records

def pretty(body):
    try:
        return json.dumps(json.loads(body), indent=2)[:800]
    except Exception:
        return body[:800]

# ---------------------------------------------------------------------------
print(f"\n{'='*60}")
print(f"Base   : {BASE_URL}")
print(f"Token  : {TOKEN_URL}")
print(f"API    : {API_ROOT}")
print(f"{'='*60}\n")

print("Step 1 -- Getting Bearer Token (OAuth2 Client Credentials) ...")
TOKEN = None
for scope in SCOPES_TO_TRY:
    label = scope or "(no scope)"
    print(f"  scope: {label}")
    TOKEN = fetch_token(scope)
    if TOKEN:
        print(f"  Token : {TOKEN[:25]}...  OK\n")
        break

if not TOKEN:
    raise SystemExit("Could not obtain a token. Check App ID / Secret.")

HEADERS = {"Authorization": f"Bearer {TOKEN}", "Accept": "application/json"}

def export_csv(label, records, csv_path):
    """Flatten and export any list of OneRoster records to CSV."""
    if not records:
        print(f"  No records returned for {label}.")
        return

    # Flatten nested dicts one level deep (e.g. {"user": {"sourcedId": ...}} →
    # "user_sourcedId") so every value ends up as a plain string column.
    def flatten(rec):
        flat = {}
        for k, v in rec.items():
            if isinstance(v, dict):
                for sub_k, sub_v in v.items():
                    flat[f"{k}_{sub_k}"] = sub_v
            elif isinstance(v, list):
                flat[k] = "; ".join(str(i) for i in v)
            else:
                flat[k] = v
        return flat

    rows = [flatten(r) for r in records]
    fields = list(dict.fromkeys(k for row in rows for k in row))  # preserve order, dedupe

    try:
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
            writer.writeheader()
            writer.writerows(rows)
    except PermissionError:
        print(f"  ERROR: Cannot write '{csv_path.name}' -- close it in Excel (or another app) and re-run.")
        return

    print(f"  {len(records)} {label} exported to: {csv_path}")


print(f"\nDiagnostic -- checking for hidden students (enabledUser=false / tobedeleted) ...")
_diag_url = f"{API_ROOT}/students?limit=1&filter=enabledUser%3D%27false%27"
_d_status, _d_body, _d_total = api_get(_diag_url, HEADERS)
print(f"  enabledUser=false  -> X-Total-Count: {_d_total or '(not returned)'} | HTTP {_d_status}")
_diag_url2 = f"{API_ROOT}/students?limit=1&filter=status%3D%27tobedeleted%27"
_d2_status, _d2_body, _d2_total = api_get(_diag_url2, HEADERS)
print(f"  status=tobedeleted -> X-Total-Count: {_d2_total or '(not returned)'} | HTTP {_d2_status}")

# Pre-K grade codes used by Synergy (see classes/students 'grades' field).
PREK_GRADE_CODES = {"P3", "P4"}

def is_prek_grades(grades_value):
    if not grades_value:
        return False
    if isinstance(grades_value, (list, tuple, set)):
        codes = grades_value
    else:
        codes = str(grades_value).replace(";", "|").split("|")
    return any(str(code).strip() in PREK_GRADE_CODES for code in codes)

print(f"\nStep 2 -- Fetching selected data ...")
try:
    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
except OSError as e:
    raise SystemExit(f"Cannot create or access export directory '{EXPORT_DIR}': {e}")

print(f"Export directory: {EXPORT_DIR}")
prek_class_ids = None
for label, endpoint, record_key in selected:
    print(f"\n  [{label}]")
    records = fetch_all(endpoint, record_key)
    if label == "schools":
        total_records = len(records)
        records = [record for record in records if record.get("type", "").lower() == "school"]
        print(f"  Kept {len(records)} school records; excluded {total_records - len(records)} non-school organizations.")
    if label in ("students", "teachers"):
        fixed = 0
        for record in records:
            new_username = derive_username(record.get("email"))
            if new_username and record.get("username", "").strip().lower() != new_username:
                record["username"] = new_username
                fixed += 1
        print(f"  Corrected {fixed} username(s) from email.")
    if label == "students":
        total_records = len(records)
        records = [r for r in records if not is_prek_grades(r.get("grades"))]
        print(f"  Kept {len(records)} students; excluded {total_records - len(records)} Pre-K students.")
    if label == "classes":
        total_records = len(records)
        prek_class_ids = {r.get("sourcedId") for r in records if is_prek_grades(r.get("grades"))}
        records = [r for r in records if r.get("sourcedId") not in prek_class_ids]
        print(f"  Kept {len(records)} classes; excluded {total_records - len(records)} Pre-K classes.")
    if label == "enrollments":
        if prek_class_ids is None:
            print("  Fetching classes to identify Pre-K enrollments ...")
            all_classes = fetch_all("/classes", "classes")
            prek_class_ids = {c.get("sourcedId") for c in all_classes if is_prek_grades(c.get("grades"))}
        total_records = len(records)
        records = [r for r in records if (r.get("class") or {}).get("sourcedId") not in prek_class_ids]
        print(f"  Kept {len(records)} enrollments; excluded {total_records - len(records)} Pre-K enrollments.")
    csv_path = EXPORT_DIR / f"{label.replace(' / ', '_')}.csv"
    export_csv(label, records, csv_path)

print("\nDone.")
