// SSH transport with an explicitly pinned server fingerprint. Never logs key or .env contents.
const { Client } = require('ssh2');
const fs = require('node:fs');
const path = require('node:path');
const e = process.env;
const host = e.DEPLOY_HOST;
const user = e.DEPLOY_USER;
const root = e.DEPLOY_PATH;
const sha = e.DEPLOY_SHA;
const profile = e.DEPLOY_PROFILE || 'shared';
const project = e.DEPLOY_PROJECT || 'delivery';
const fingerprint = e.DEPLOY_HOST_FINGERPRINT || '';
const uploadEnv = process.argv[2] === 'upload-env' ? process.argv[3] : null;
const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
if (!/^[\w.-]+$/.test(host || '') || !/^[a-z_][a-z0-9_-]*$/.test(user || '') ||
    !/^\/[A-Za-z0-9/_-]+$/.test(root || '') || root === '/' ||
    !/^[a-z][a-z0-9_-]+$/.test(project) || !['shared','production','local'].includes(profile) ||
    !/^SHA256:[A-Za-z0-9+/]{43}=?$/.test(fingerprint)) throw Error('Invalid deployment configuration');
if (!uploadEnv && !/^[0-9a-f]{40}$/.test(sha || '')) throw Error('Invalid commit SHA');
const port = Number(e.DEPLOY_PORT || 22);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid SSH port');
const expected = Buffer.from(fingerprint.slice(7), 'base64').toString('hex');
const client = new Client();
const exec = (command, input) => new Promise((resolve, reject) => {
  client.exec(command, (error, stream) => {
    if (error) return reject(error);
    stream.on('data', chunk => process.stdout.write(chunk));
    stream.stderr.on('data', chunk => process.stderr.write(chunk));
    stream.on('error', reject);
    stream.on('close', code => code === 0 ? resolve() : reject(Error(`Remote command exited ${code}`)));
    stream.end(input);
  });
});
const sftp = () => new Promise((resolve,reject) => client.sftp((error,handle) => error ? reject(error) : resolve(handle)));
const call = (handle,method,...args) => new Promise((resolve,reject) => handle[method](...args,error => error ? reject(error) : resolve()));
async function work() {
  await exec(`mkdir -p ${quote(root + '/incoming')} ${quote(root + '/shared')}`);
  const handle = await sftp();
  try {
    const target = uploadEnv ? root + '/shared/.env' : root + '/incoming/' + sha + '.tar.gz';
    const source = uploadEnv || path.resolve('release.tar.gz');
    // Create secret files with restrictive permissions from the first byte, not only after upload.
    await new Promise((resolve,reject) => {
      const sourceStream = fs.createReadStream(source);
      const destStream = handle.createWriteStream(target + '.upload', {mode: 0o600});
      sourceStream.on('error',reject);
      destStream.on('error',reject);
      destStream.on('close',resolve);
      sourceStream.pipe(destStream);
    });
    await call(handle,'rename',target + '.upload',target);
    if (!uploadEnv) {
      await call(handle,'fastPut','deploy/deploy.sh',root + '/incoming/' + sha + '.deploy.sh', {mode:0o600});
    }
  } finally { handle.end(); }
  if (!uploadEnv) {
    // Run a file, not `bash -s`: docker compose exec may otherwise consume the rest of stdin.
    const script = root + '/incoming/' + sha + '.deploy.sh';
    await exec(`bash ${quote(script)} ${[root,sha,profile,project].map(quote).join(' ')} && test "$(cat ${quote(root + '/deployed-sha')})" = ${quote(sha)}`);
    await exec(`rm -f ${quote(script)}`);
  } else console.log('Server configuration uploaded without displaying its contents.');
}
client.on('ready', () => work().then(() => client.end()).catch(error => { console.error(error.message); process.exitCode=1; client.end(); }));
client.on('error', error => { console.error(error.message); process.exitCode=1; });
client.connect({host, port, username:user, privateKey: e.DEPLOY_SSH_KEY || fs.readFileSync(e.DEPLOY_SSH_KEY_FILE),
  hostHash:'sha256', hostVerifier:hash => hash === expected, readyTimeout:30000,
  keepaliveInterval:15000, keepaliveCountMax:4});
