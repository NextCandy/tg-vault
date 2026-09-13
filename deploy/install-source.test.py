#!/usr/bin/env python3
"""Run real Git update cases on disposable local repositories, never GitHub."""
import os
from pathlib import Path
import re
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
SOURCE=(ROOT/'deploy/install.sh').read_text()
START=SOURCE.index('update_source() {')
END=SOURCE.index('\n}\n',START)+3
FUNCTION=SOURCE[START:END]

class SourceUpdate(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix='tg-vault-git-');self.base=Path(self.tmp.name)
  self.origin=self.base/'origin.git';self.author=self.base/'author';self.work=self.base/'work'
  self.env=dict(os.environ,GIT_AUTHOR_NAME='Installer test',GIT_AUTHOR_EMAIL='installer-test@example.invalid',GIT_COMMITTER_NAME='Installer test',GIT_COMMITTER_EMAIL='installer-test@example.invalid')
  self.env.pop('INSTALL_TEST_SKIP_GIT_UPDATE',None)
  self.git('init','--bare',str(self.origin));self.git('clone',str(self.origin),str(self.author))
  (self.author/'deploy').mkdir();(self.author/'deploy/install.sh').write_text('#!/bin/bash\nprintf "reload args: %s\\n" "$*"\n')
  (self.author/'.gitignore').write_text('.env\n');self.git('add','.',cwd=self.author);self.git('commit','-m','initial',cwd=self.author)
  self.git('push','-u','origin','HEAD',cwd=self.author);self.git('clone',str(self.origin),str(self.work))
 def tearDown(self):self.tmp.cleanup()
 def git(self,*args,cwd=None):
  return subprocess.run(['git',*args],cwd=cwd or self.base,env=self.env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.strip()
 def check(self,noninteractive='true',skip='false',after='false'):
  code=f'NON_INTERACTIVE={noninteractive}; SKIP_SOURCE_UPDATE={skip}; AFTER_SOURCE_UPDATE={after}; INSTALL_REQUIRE_ATTESTATIONS=true;\n'+FUNCTION+'\nupdate_source\nprintf "continued\\n"\n'
  return subprocess.run(['bash','-euc',code],cwd=self.work,env=self.env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=15)
 def test_fast_forward_reexec_preserves_noninteractive(self):
  (self.author/'new').write_text('new');self.git('add','.',cwd=self.author);self.git('commit','-m','update',cwd=self.author);self.git('push',cwd=self.author)
  r=self.check();self.assertEqual(r.returncode,0,r.stdout);self.assertIn('--non-interactive --after-source-update',r.stdout);self.assertNotIn('continued',r.stdout)
 def test_dirty_local_stops_without_overwrite(self):
  (self.work/'deploy/install.sh').write_text('local change')
  r=self.check();self.assertNotEqual(r.returncode,0);self.assertEqual((self.work/'deploy/install.sh').read_text(),'local change')
 def test_detached_stops_unless_explicit_skip(self):
  self.git('checkout','--detach',cwd=self.work);r=self.check();self.assertNotEqual(r.returncode,0)
  r=self.check(skip='true');self.assertEqual(r.returncode,0,r.stdout);self.assertIn('continued',r.stdout)
 def test_offline_remote_does_not_hang_and_skip_is_explicit(self):
  self.git('remote','set-url','origin',str(self.base/'missing'),cwd=self.work)
  r=self.check();self.assertNotEqual(r.returncode,0);self.assertIn('--skip-source-update',r.stdout)
  self.assertEqual(self.check(skip='true').returncode,0)
 def test_after_source_update_does_not_fetch_again(self):
  self.git('remote','set-url','origin',str(self.base/'missing'),cwd=self.work)
  self.assertEqual(self.check(after='true').returncode,0)

if __name__=='__main__':unittest.main(verbosity=2)
