"""Technical probe records must not contain cookies, headers, URLs or error bodies."""
import importlib.util
import json
from pathlib import Path
import subprocess
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('health_probe', Path(__file__).resolve().parents[1]/'deploy/health_probe.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class HealthProbeTests(unittest.TestCase):
    def curl(self, args, **kwargs):
        Path(args[args.index('--dump-header')+1]).write_text(
            'HTTP/2 200\nx-request-id: 8ce3ff7f-36d3-4599-8553-e21c3c457a98\n'
            'set-cookie: private-cookie\nserver-timing: db_pool;dur=1.1, db_query;dur=0.2, backend;dur=2, proxy_headers;dur=3\n')
        return subprocess.CompletedProcess(args, 0, json.dumps({'http_code':200, 'time_namelookup':.001,
            'time_connect':.003, 'time_appconnect':.01, 'time_starttransfer':.02, 'time_total':.021,
            'url_effective':'private-url', 'secret':'private-data'}), 'private-error')

    def test_success_is_a_whitelist_of_timings_and_correlation_id(self):
        with patch.object(module.subprocess, 'run', side_effect=self.curl):
            record=module.probe('https://delivery.example.com/api/health')
        self.assertEqual(record['http_status'],200)
        self.assertEqual(record['time_appconnect_ms'],10)
        self.assertEqual(record['db_query_ms'],.2)
        self.assertEqual(record['request_id'],'8ce3ff7f-36d3-4599-8553-e21c3c457a98')
        self.assertNotIn('private-',json.dumps(record))

    def test_timeout_records_last_completed_stage(self):
        data={'http_code':0, 'time_namelookup':.001,'time_connect':.01,'time_appconnect':.02,'time_starttransfer':0,'time_total':25}
        with patch.object(module.subprocess,'run',return_value=subprocess.CompletedProcess([],28,json.dumps(data),'private-error')):
            record=module.probe('https://delivery.example.com/api/health')
        self.assertEqual(record['curl_exit'],28)
        self.assertEqual(record['last_completed_stage'],'tls')
        self.assertNotIn('private-',json.dumps(record))

    def test_credentials_and_query_are_rejected(self):
        for url in ('https://user:password@example.com/health','https://example.com/health?token=secret','http://example.com/health'):
            with self.assertRaises(ValueError): module.probe(url)
