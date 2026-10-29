"""Exercise deployment sequencing without a real Docker daemon or server credentials."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'deploy/deploy.sh'
NEW = 'a' * 40
OLD = 'b' * 40


@unittest.skipUnless(sys.platform.startswith('linux'), 'Linux deployment tests; use Docker on macOS')
class DeploymentTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='flyparcel-deploy-test-')
        self.base = Path(self.temp.name).resolve()
        self.root = self.base / 'delivery'
        for name in ('shared/backups', 'incoming', 'releases'):
            (self.root / name).mkdir(parents=True)
        (self.root/'shared/.env').write_text('BOT_TOKEN=123456:TEST_TOKEN\nAPP_URL=https://delivery.example.com\nDOMAIN=delivery.example.com\n')
        source = self.base / 'source'
        source.mkdir()
        (source/'compose.yaml').write_text('services: {}\n')
        with tarfile.open(self.root/f'incoming/{NEW}.tar.gz','w:gz') as archive:
            archive.add(source/'compose.yaml',arcname='compose.yaml')
        self.bin = self.base / 'bin'
        self.bin.mkdir()
        self.log = self.base/'docker.log'
        docker = self.bin/'docker'
        docker.write_text('''#!/usr/bin/env python3
import json,os,sys
args=sys.argv[1:]
with open(os.environ['TEST_LOG'],'a') as log:
 log.write(json.dumps({'args':args,'release':os.environ.get('FLYPARCEL_RELEASE'),'project':os.environ.get('COMPOSE_PROJECT_NAME')})+'\\n')
if 'ps' in args and '--services' in args: print('bot')
if 'ps' in args and '-q' in args: print('test-container')
if args and args[0]=='inspect': print('{}')
failure=os.environ.get('TEST_FAIL')
if failure and failure in args and os.environ.get('FLYPARCEL_RELEASE')=='a'*40: sys.exit(1)
''')
        docker.chmod(0o755)
        curl = self.bin/'curl'
        curl.write_text('#!/bin/sh\nprintf \'{"status":"ok"}\\n\'\n')
        curl.chmod(0o755)
        self.env = {**os.environ,'PATH':f'{self.bin}:{os.environ["PATH"]}','TEST_LOG':str(self.log)}

    def tearDown(self):
        self.temp.cleanup()

    def deploy(self, profile='local'):
        return subprocess.run(['bash',str(SCRIPT),str(self.root),NEW,profile,'delivery'],env=self.env,capture_output=True,text=True)

    def calls(self):
        return [json.loads(line) for line in self.log.read_text().splitlines()] if self.log.exists() else []

    def previous(self):
        old = self.root/f'releases/{OLD}'
        old.mkdir()
        (old/'compose.yaml').write_text('services: {}\n')
        (self.root/'current').symlink_to(old)
        return old

    def test_success_uses_same_project_and_marks_exact_release(self):
        self.assertEqual(self.deploy().returncode,0)
        self.assertEqual((self.root/'current').resolve(),self.root/f'releases/{NEW}')
        self.assertEqual((self.root/'deployed-sha').read_text().strip(),NEW)
        self.assertTrue(all(call['project']=='delivery' for call in self.calls()))
        self.assertTrue(any('build' in call['args'] for call in self.calls()))

    def test_build_failure_keeps_previous_release_running(self):
        old=self.previous()
        self.env['TEST_FAIL']='build'
        self.assertNotEqual(self.deploy().returncode,0)
        self.assertEqual((self.root/'current').resolve(),old)
        self.assertFalse(any('up' in call['args'] for call in self.calls()))

    def test_failed_start_rolls_back_images_without_restoring_database(self):
        old=self.previous()
        self.env['TEST_FAIL']='up'
        self.assertNotEqual(self.deploy().returncode,0)
        self.assertEqual((self.root/'current').resolve(),old)
        calls=self.calls()
        self.assertTrue(any('backup.py' in call['args'] for call in calls))
        self.assertTrue(any('up' in call['args'] and call['release']==OLD for call in calls))
        self.assertFalse(any('restore' in ' '.join(call['args']) for call in calls))

    def test_shared_proxy_gets_unique_project_alias(self):
        edge=self.base/'edge'
        (edge/'sites').mkdir(parents=True)
        (edge/'compose.yaml').write_text('services: {}\n')
        self.env['DEPLOY_EDGE_PATH']=str(edge)
        result=self.deploy('shared')
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertIn('reverse_proxy delivery-app:3000',(edge/'sites/delivery.caddy').read_text())
        self.assertTrue(any('connect' in call['args'] and 'delivery-app' in call['args'] for call in self.calls()))

    def test_bad_production_url_is_rejected_before_docker(self):
        (self.root/'shared/.env').write_text('BOT_TOKEN=123456:TEST_TOKEN\nAPP_URL=\nDOMAIN=localhost\n')
        self.assertNotEqual(self.deploy('production').returncode,0)
        self.assertEqual(self.calls(),[])
