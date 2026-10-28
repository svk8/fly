"""Consistent online backup of the shared SQLite database."""
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from sqlalchemy.engine import make_url
from config import settings

url = make_url(settings.DATABASE_URL)
if not url.drivername.startswith('sqlite') or not url.database or url.database == ':memory:':
    raise SystemExit('This command backs up SQLite only. Use pg_dump for PostgreSQL.')
source = Path(url.database).resolve()
if not source.is_file():
    raise SystemExit('Database not found')
Path('backups').mkdir(exist_ok=True)
target = Path('backups') / f"crowdship-{datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')}.db"
with sqlite3.connect(source.as_uri() + '?mode=ro', uri=True) as db, sqlite3.connect(target) as dest:
    db.backup(dest)
print(target)
