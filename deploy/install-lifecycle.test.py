#!/usr/bin/env python3
"""Installer lifecycle contract tests using failure-aware Docker subprocesses."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]

DOCKER = r'''#!/usr/bin/env python3
import sys,os,json
args=sys.argv[1:]
with open(os.environ['DOCKER_LOG'],'a') as f:
 f.write(json.dumps({'args':args,'web':os.environ.get('CORS_ORIGIN'),'api':os.environ.get('VITE_API_URL'),'db':os.environ.get('DB_PASSWORD'),'session':os.environ.get('SESSION_SECRET'),'storage':os.environ.get('STORAGE_CREDENTIALS_SECRET')})+'\n')
if args[:2]==['compose','version']: print('2.39.0');sys.exit(0)
if args[:2]==['buildx','version']: print('github.com/docker/buildx v0.28.0');sys.exit(0)
if args==['compose','up','--help']: print('--wait --wait-timeout --no-recreate');sys.exit(0)
if args==['buildx','build','--help']: print('--sbom --provenance');sys.exit(0)
if args==['buildx','inspect']: print('Driver: docker\nStatus: running\nBuildKit version: v0.20.0');sys.exit(0)
if args[:1]==['info']: print('io.containerd.snapshotter.v1');sys.exit(0)
if args[:1]==['ps']:
 if os.environ.get('CASE')=='old-container': print('existing-pg')
 sys.exit(0)
if args[:2]==['volume','inspect']: sys.exit(0 if args[-1].endswith('_file-storage') or os.environ.get('CASE')=='old-volume' else 1)
if args[:2]==['volume','ls']: sys.exit(0)
if args==['compose','config','--format','json']: print(json.dumps({'name':'tg-vault','services':{'backend':{'volumes':[{'type':os.environ.get('LOCAL_STORAGE_MOUNT_TYPE') or 'volume','source':os.environ.get('LOCAL_STORAGE_SOURCE') or 'file-storage','target':'/data'}]}},'volumes':{'file-storage':{'name':'tg-vault_file-storage'}}}));sys.exit(0)
if args[:2]==['compose','ps']: sys.exit(0)
if args[:2]==['compose','logs']: print('fixture diagnostic log');sys.exit(0)
case=os.environ.get('CASE','')
if args[:3]==['compose','config','--quiet'] and case=='config': sys.exit(14)
if args[:2]==['compose','build'] and case=='build': sys.exit(15)
if args[:2]==['compose','up']:
 if args[-1]=='postgres' and case=='postgres': sys.exit(16)
 if args[-1]=='frontend' and case=='backend': sys.exit(17)
sys.exit(0)
'''

class Lifecycle(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix='tg-vault-lifecycle-')
  self.root=Path(self.temp.name)
  (self.root/'deploy').mkdir(); (self.root/'backend').mkdir(); (self.root/'fake-bin').mkdir()
  for name in ('install.sh','install-runtime.sh','install-environment.sh','install-config.py','install-storage.py'):
   if (ROOT/'deploy'/name).exists(): shutil.copy(ROOT/'deploy'/name,self.root/'deploy'/name)
  (self.root/'docker-compose.yml').write_text('services: {}\n')
  (self.root/'backend/package.json').write_text('{"version":"2.4.3"}')
  (self.root/'fake-bin/docker').write_text(DOCKER); (self.root/'fake-bin/docker').chmod(0o755)
  self.env=dict(os.environ, PATH=str(self.root/'fake-bin')+':'+os.environ['PATH'],DOCKER_LOG=str(self.root/'docker.jsonl'),INSTALL_TEST_SKIP_GIT_UPDATE='true',CORS_ORIGIN='https://cloud.example.xyz',VITE_API_URL='https://api.example.xyz')
  for key in list(self.env):
   if key.startswith(('COMPOSE_','DOCKER_')) and key != 'DOCKER_LOG' or key in ('DB_PASSWORD','SESSION_SECRET','STORAGE_CREDENTIALS_SECRET'): self.env.pop(key,None)
 def tearDown(self): self.temp.cleanup()
 def run_case(self,case='',*flags):
  self.env['CASE']=case
  r=subprocess.run(['bash',str(self.root/'deploy/install.sh'),'--non-interactive',*flags],cwd='/tmp',env=self.env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=15)
  log=self.root/'docker.jsonl'
  self.calls=[json.loads(x) for x in log.read_text().splitlines()] if log.exists() else []
  return r
 def ups(self): return [x['args'] for x in self.calls if x['args'][:2]==['compose','up'] and '--help' not in x['args']]
 def test_fresh_starts_pg_before_app_and_waits(self):
  r=self.run_case();self.assertEqual(r.returncode,0,r.stdout)
  self.assertEqual([x[-1] for x in self.ups()],['postgres','frontend'])
  self.assertTrue(all('--wait' in x for x in self.ups()))
  self.assertIn('--no-recreate',self.ups()[0])
  self.assertEqual((self.root/'.env').stat().st_mode & 0o777,0o600)
  self.assertIn('首次部署完成',r.stdout)
 def test_failed_compose_validation_starts_nothing(self):
  r=self.run_case('config');self.assertNotEqual(r.returncode,0);self.assertFalse(self.ups());self.assertNotIn('部署完成',r.stdout)
 def test_failed_build_starts_nothing(self):
  r=self.run_case('build');self.assertNotEqual(r.returncode,0);self.assertFalse(self.ups());self.assertNotIn('部署完成',r.stdout)
 def test_unhealthy_pg_never_starts_apps(self):
  r=self.run_case('postgres');self.assertNotEqual(r.returncode,0);self.assertEqual(len(self.ups()),1);self.assertIn('未自动删除数据卷',r.stdout);self.assertNotIn('部署完成',r.stdout)
 def test_unhealthy_backend_never_reports_success(self):
  r=self.run_case('backend');self.assertNotEqual(r.returncode,0);self.assertIn('排障',r.stdout);self.assertNotIn('部署完成',r.stdout)
 def test_lost_env_old_db_refuses_password_rotation(self):
  for case in ('old-container','old-volume'):
   with self.subTest(case=case):
    r=self.run_case(case);self.assertNotEqual(r.returncode,0);self.assertFalse((self.root/'.env').exists());self.assertFalse(self.ups());self.assertIn('DB_PASSWORD',r.stdout)
 def test_existing_env_secrets_and_pg_are_preserved(self):
  initial="CORS_ORIGIN='https://cloud.example.xyz'\nVITE_API_URL='https://api.example.xyz'\nDB_PASSWORD=existing-db-password\n"
  (self.root/'.env').write_text(initial)
  r=self.run_case();self.assertEqual(r.returncode,0,r.stdout)
  env=(self.root/'.env').read_text();self.assertIn('DB_PASSWORD=existing-db-password',env);self.assertNotIn('SESSION_SECRET=',env);self.assertNotIn('STORAGE_CREDENTIALS_SECRET=',env)
  self.assertIn('--no-recreate',self.ups()[0])
 def test_unknown_second_flag_rejected_before_side_effects(self):
  r=self.run_case('','--invalid');self.assertEqual(r.returncode,2);self.assertFalse(self.calls);self.assertFalse((self.root/'.env').exists())
 def test_wait_timeout_invalid_is_early_error(self):
  self.env['INSTALL_HEALTH_TIMEOUT']='wat'
  r=self.run_case();self.assertNotEqual(r.returncode,0);self.assertFalse(self.ups());self.assertIn('INSTALL_HEALTH_TIMEOUT',r.stdout)
  self.assertFalse((self.root/'.env').exists())
 def test_ambient_secrets_cannot_override_existing_env(self):
  (self.root/'.env').write_text('CORS_ORIGIN=https://cloud.example.cc\nVITE_API_URL=https://api.example.cn\nDB_PASSWORD="persisted-db"\nSESSION_SECRET=persisted-session\nSTORAGE_CREDENTIALS_SECRET=persisted-storage\n')
  self.env.update(DB_PASSWORD='wrong-db',SESSION_SECRET='wrong-session',STORAGE_CREDENTIALS_SECRET='wrong-storage')
  r=self.run_case();self.assertEqual(r.returncode,0,r.stdout)
  for call in self.calls:
   if call['args'][:2]==['compose','build']:
    self.assertEqual((call['db'],call['session'],call['storage']),('persisted-db','persisted-session','persisted-storage'))
 def test_invalid_config_aborts_without_write(self):
  original='CORS_ORIGIN=https://cloud.example.cc\nVITE_API_URL=https://api.example.cn\nDB_PASSWORD=${DONT_EXPAND}\n'
  (self.root/'.env').write_text(original)
  r=self.run_case();self.assertNotEqual(r.returncode,0);self.assertFalse(self.ups());self.assertEqual((self.root/'.env').read_text(),original)
 def test_compat_removes_only_build_attestations(self):
  shutil.copy2(ROOT/'docker-compose.yml',self.root/'docker-compose.yml')
  (self.root/'.env').write_text('DB_PASSWORD=fake-only\n')
  code='source deploy/install-runtime.sh; INSTALL_REQUIRE_ATTESTATIONS=false; prepare_install_compose; python3 -c \'import sys;print(open(sys.argv[1]).read())\' "$INSTALL_COMPAT_FILE"'
  result=subprocess.run(['bash','-euc',code],cwd=self.root,env=self.env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=15)
  self.assertEqual(result.returncode,0,result.stdout)
  self.assertNotIn('sbom: true',result.stdout);self.assertNotIn('provenance: mode=max',result.stdout)
  original=(ROOT/'docker-compose.yml').read_text()
  expected=''.join(line for line in original.splitlines(keepends=True) if not line.startswith(('      sbom:','      provenance:')))
  self.assertTrue(result.stdout.rstrip().endswith(expected.rstrip()))

if __name__=='__main__': unittest.main(verbosity=2)
