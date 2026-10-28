"""Exercise built images without real Telegram calls or production environment files."""
import argparse
import ipaddress
import subprocess
import uuid


def docker(*args, check=True):
    result = subprocess.run(['docker', *args], text=True, stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT, timeout=120)
    if check and result.returncode:
        raise RuntimeError(f'Docker command failed: {args[0]}\n{result.stdout}')
    return result.stdout.strip()


# Run inside the web container: no host ports, DNS changes or external Telegram requests.
SMOKE = r"""
import { createHmac } from 'node:crypto';
const base = 'http://127.0.0.1:3000';
const headers = { 'Content-Type': 'application/json' };
const params = new URLSearchParams({auth_date: String(Math.floor(Date.now()/1000)),
  user: JSON.stringify({id: 101, first_name: 'CI User'})});
const check = [...params.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
const secret = createHmac('sha256', 'WebAppData').update('123456:TEST_TOKEN').digest();
params.set('hash', createHmac('sha256', secret).update(check).digest('hex'));
headers['X-Telegram-Init-Data'] = params.toString();
let healthy = false;
for (let i = 0; i < 100; i++) {
  try { if ((await fetch(base + '/api/health')).ok) { healthy = true; break; } } catch {}
  await new Promise(resolve => setTimeout(resolve, 300));
}
if (!healthy) throw Error('Shared backend did not become healthy');
if ((await fetch(base + '/api/parcels')).status !== 401) throw Error('Anonymous request was accepted');
const mode = process.argv[1];
if (mode === 'create') {
  const deadline = new Date(Date.now() + 3*86400000).toLocaleDateString('ru-RU');
  const created = await fetch(base + '/api/parcels', { method: 'POST', headers,
    body: JSON.stringify({fromCity:'Москва', toCity:'Дубай', deadlineDate:deadline, category:'Документы',
      weight:'до 0.5 кг', description:'CI container test', budget:1000, safetyAccepted:true}) });
  if (created.status !== 201) throw Error('Create failed: ' + await created.text());
}
const response = await fetch(base + '/api/parcels', {headers});
const data = await response.json();
if (!response.ok || data.parcels.length !== 1 || data.parcels[0].description !== 'CI container test') {
  throw Error('Shared data missing: ' + JSON.stringify(data));
}
const site = await fetch(base + '/');
if (!site.ok || !(await site.text()).includes('id="root"')) throw Error('Frontend HTML unavailable');
console.log(mode === 'create' ? 'Containers: health, authorization, creation and frontend OK' : 'Container restart: data persisted');
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bot-image', default='flyparcel-ci:bot')
    parser.add_argument('--web-image', default='flyparcel-ci:web')
    args = parser.parse_args()
    prefix = 'flyparcel-ci-' + uuid.uuid4().hex[:12]
    bot, web = prefix + '-bot', prefix + '-web'
    try:
        # An isolated documentation subnet avoids consuming Docker's exhausted default pools.
        # No service in this test needs internet access.
        for subnet in ipaddress.ip_network('192.0.2.0/24').subnets(new_prefix=28):
            try:
                docker('network', 'create', '--internal', '--subnet', str(subnet), prefix)
                break
            except RuntimeError as error:
                if 'overlap' not in str(error).lower():
                    raise
        else:
            raise RuntimeError('No free subnet for the isolated CI test network')
        docker('run', '-d', '--name', bot, '--network', prefix, '--network-alias', 'bot',
            '-e', 'BOT_TOKEN=123456:TEST_TOKEN', '-e', 'APP_URL=', '-e', 'BOT_POLLING=false',
            '-e', 'API_HOST=0.0.0.0', args.bot_image)
        docker('run', '-d', '--name', web, '--network', prefix,
            '-e', 'BOT_API_URL=http://bot:8000', args.web_image)
        print(docker('exec', web, 'node', '--input-type=module', '-e', SMOKE, 'create'), flush=True)
        # The Python bot must see exactly the record created through the web proxy.
        query = "import sqlite3; db=sqlite3.connect('/app/data/crowdship.db'); assert db.execute('select count(*) from parcel_requests').fetchone()[0]==1; print('Shared bot database: OK')"
        print(docker('exec', bot, 'python', '-c', query), flush=True)
        print(docker('exec', bot, 'python', 'backup.py'), flush=True)
        docker('restart', bot)
        print(docker('exec', web, 'node', '--input-type=module', '-e', SMOKE, 'check'), flush=True)
    except Exception:
        for name in (bot, web):
            print(docker('logs', '--tail', '80', name, check=False), flush=True)
        raise
    finally:
        for name in (web, bot):
            docker('rm', '-f', name, check=False)
        docker('network', 'rm', prefix, check=False)


if __name__ == '__main__':
    main()
