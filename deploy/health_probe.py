"""Independent DNS/TCP/TLS/HTTP probe. Logs only a fixed whitelist of technical fields."""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import urlsplit

TIMINGS = ('time_namelookup', 'time_connect', 'time_appconnect', 'time_starttransfer', 'time_total')


def probe(url):
    parts = urlsplit(url)
    if parts.scheme != 'https' or not parts.hostname or parts.username or parts.password or parts.query or parts.fragment:
        raise ValueError('Probe needs an HTTPS URL without credentials, query or fragment')
    with tempfile.TemporaryDirectory(prefix='health-probe-') as directory:
        header_file = Path(directory) / 'headers'
        result = subprocess.run(['curl', '-q', '--silent', '--show-error', '--proto', '=https',
            '--max-time', '25', '--dump-header', str(header_file), '--output', '/dev/null',
            '--write-out', '%{json}', url], capture_output=True, text=True, timeout=30)
        try:
            stats = json.loads(result.stdout)
        except ValueError:
            stats = {}
        record = {'event': 'delivery_health_probe', 'at': datetime.now(timezone.utc).isoformat(),
            'curl_exit': result.returncode, 'http_status': stats.get('http_code', 0)}
        for key in TIMINGS:
            value = stats.get(key)
            if isinstance(value, (int, float)):
                record[key + '_ms'] = round(value * 1000, 2)
        if header_file.exists():
            headers = header_file.read_text(errors='replace')
            match = re.search(r'^x-request-id:\s*([0-9a-f-]{36})\s*$', headers, re.I | re.M)
            if match:
                record['request_id'] = match[1].lower()
            for name in ('db_pool', 'db_query', 'backend', 'proxy_headers'):
                match = re.search(r'(?:^|[,\s])' + name + r';dur=(\d+(?:\.\d+)?)', headers)
                if match:
                    record[name + '_ms'] = float(match[1])
        if result.returncode:
            record['last_completed_stage'] = 'response' if stats.get('time_starttransfer') else (
                'tls' if stats.get('time_appconnect') else 'tcp' if stats.get('time_connect') else
                'dns' if stats.get('time_namelookup') else 'none')
        return record


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--url', default='https://delivery.bantr.ru/api/health')
    args = parser.parse_args()
    try:
        print(json.dumps(probe(args.url)), flush=True)
    except Exception as error:
        print(json.dumps({'event': 'delivery_health_probe_error', 'error_kind': type(error).__name__}), flush=True)
        raise SystemExit(1)
