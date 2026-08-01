# Smart Sweep SWMS — documentation

| Document | For | Covers |
|---|---|---|
| [API reference](API-REFERENCE.md) | Developers, integrators | Every endpoint, request and response shape, error codes, auth, scoping |
| [Workflows](WORKFLOWS.md) | Analysts, supervisors, developers | How work moves through the system, who does each step, and the rules the server enforces |
| [User manual](USER-MANUAL.md) | Everyone using the app | Every screen, by role, in plain language |
| **[User manual (Word)](Smart-Sweep-User-Manual.docx)** | End users, for printing and circulation | The same manual as a formatted 24-page `.docx` — title page, linked contents, tables and callouts |

### The Word manual

[`Smart-Sweep-User-Manual.docx`](Smart-Sweep-User-Manual.docx) is the
hand-out version: A4, 24 pages, with a clickable table of contents whose page
numbers are already populated. Regenerate it after editing
[`build-user-manual.js`](build-user-manual.js):

```bash
node docs/build-user-manual.js docs/Smart-Sweep-User-Manual.docx
```

The generator needs the `docx` npm package. After regenerating, open the file in
Word once and update the contents field (Ctrl-A, F9) so the page numbers match.

## The API collection

| File | What it is |
|---|---|
| [`api/SmartSweep-SWMS.postman_collection.json`](api/SmartSweep-SWMS.postman_collection.json) | 148 requests in 12 folders, with auth capture built in |
| [`api/SmartSweep-SWMS.postman_environment.json`](api/SmartSweep-SWMS.postman_environment.json) | `baseUrl`, demo phone, PIN and token slots |
| [`api/openapi.yml`](api/openapi.yml) | The generated OpenAPI 3.0.3 schema |
| [`api/build_collection.py`](api/build_collection.py) | The generator, so the collection can be rebuilt when the API changes |

### Quick start

Start the backend, then import both JSON files into Postman and select the
**Smart Sweep — Local** environment:

```bash
cd server && .venv/Scripts/python.exe manage.py runserver
```

Run `00 · Auth & session → 1 · Request login code`, then `2 · Verify code`. The
test scripts capture the JWT pair, your role and your collector id into
collection variables, so every other request is authorised automatically.

Demo accounts all use PIN **1470**:

| Phone | Role | Scope |
|---|---|---|
| `01711000042` | Collector | Ward 14 |
| `01700112233` | Supervisor | Zone 03 |
| `01900445566` | Agency Admin | All zones |
| `01800778899` | KCC Viewer | City-wide |

Signing in as each in turn is the fastest way to see ward scoping and the
permission rules in action.

### Rebuilding the collection

The collection is generated, not hand-maintained. Paths and query parameters
come from the drf-spectacular schema; request bodies for `@action` endpoints are
written by hand in the generator, because spectacular defaults those to the
viewset's serializer rather than the action's own.

```bash
cd server && .venv/Scripts/python.exe manage.py spectacular --file ../docs/api/openapi.yml
```

```bash
server/.venv/Scripts/python.exe docs/api/build_collection.py docs/api
```

## Verification

Every endpoint, response shape, permission rule and error code in these
documents was checked against a running server on the `seed_demo` dataset —
including the ward-scoping differences between roles, the complaint permission
model, the `use_billing_run` refusal, the five QR scan outcomes, and the CSV and
XLSX exports.
