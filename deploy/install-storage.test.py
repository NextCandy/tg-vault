#!/usr/bin/env python3
"""Storage regressions use only temporary directories and injected Docker reads."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('storage', ROOT/'deploy/install-storage.py')
assert spec is not None and spec.loader is not None
storage = importlib.util.module_from_spec(spec)
spec.loader.exec_module(storage)

class Storage(unittest.TestCase):
    def test_reject_injection_and_dangerous_paths(self):
        for value in ['/', '/mnt', '/var/lib', '/usr/local', '/tmp/a:b', '/tmp/$HOME', '/tmp/${EVIL}', '/tmp/a\nb', '/tmp/a#b', '/tmp/a"b', '/tmp/../etc', 'relative']:
            with self.subTest(value=value), self.assertRaises(ValueError): storage.validate_path(value)

    def test_new_space_path_ownership_and_existing_directory_unchanged(self):
        with tempfile.TemporaryDirectory() as d:
            p = storage.create_directory(d+'/my files')
            self.assertEqual(p.stat().st_mode & 0o777, 0o700)
            self.assertEqual(p.stat().st_uid, 1000)
            before = p.stat()
            with self.assertRaises(ValueError): storage.create_directory(str(p))
            self.assertEqual(before, p.stat())
            link = Path(d)/'link'; link.symlink_to(p)
            with self.assertRaises(ValueError): storage.create_directory(str(link/'data'))
            meta = storage.metadata(p, 'bind')
            self.assertEqual(meta['LOCAL_STORAGE_INODE'], str(p.stat().st_ino))

    def test_env_only_is_upgrade_without_docker(self):
        with tempfile.TemporaryDirectory() as d:
            old = os.getcwd()
            try:
                os.chdir(d); Path('.env').write_text('# copied example or legacy\n')
                with patch.object(storage, 'docker', side_effect=AssertionError('must not inspect')):
                    self.assertTrue(storage.existing())
            finally: os.chdir(old)

    def test_daemon_failure_never_becomes_new_install(self):
        with tempfile.TemporaryDirectory() as d:
            old = os.getcwd()
            try:
                os.chdir(d)
                with patch.object(storage, 'docker', side_effect=RuntimeError('daemon failed')):
                    with self.assertRaises(RuntimeError): storage.existing()
                for outputs in [('backend',), ('', 'old-volume'), ('', '')]:
                    with patch.object(storage, 'docker', side_effect=outputs):
                        self.assertEqual(storage.existing(), any(outputs))
            finally: os.chdir(old)

    def test_preserve_bind_and_named_volume_and_reject_changed_mount(self):
        for kind, source in [('bind', '/mnt/my files'), ('volume', 'legacy_files')]:
            config = {'name':'sandbox', 'services':{'backend':{'volumes':[{'type':kind,'source':source,'target':'/data'}]}}, 'volumes':{source:{'name':source}}}
            actual = {'Type':kind,'Source':source,'Name':source,'Destination':'/data','RW':True}
            with patch.object(storage, 'docker', side_effect=['cid', json.dumps([{'Mounts':[actual]}])]): storage.verify(config)
            for change in [{'Source':'/other','Name':'other'}, {'RW':False}, {'Type':'tmpfs'}]:
                with patch.object(storage, 'docker', side_effect=['cid', json.dumps([{'Mounts':[{**actual, **change}]}])]):
                    with self.assertRaises(ValueError): storage.verify(config)

    def test_env_only_missing_volume_fails_closed(self):
        config = {'name':'fixture','services':{'backend':{'volumes':[{'type':'volume','source':'files','target':'/data'}]}},'volumes':{'files':{'name':'original'}}}
        def docker(*args):
            if args[0] == 'ps': return ''
            raise ValueError('original volume missing')
        with patch.dict(os.environ, {'STORAGE_EXISTING':'true'}), patch.object(storage,'docker',side_effect=docker):
            with self.assertRaises(ValueError): storage.verify(config)

    def test_actual_nonroot_refuses_privileged_directory_creation(self):
        if os.getuid() != 0: self.skipTest('requires root to drop uid')
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        os.chmod(directory.name, 0o777)
        target = str(Path(directory.name)/'nonroot-data')
        def drop():
            os.setgroups([]); os.setgid(65534); os.setuid(65534)
        result = subprocess.run(['python3',str(ROOT/'deploy/install-storage.py'),'create',target], preexec_fn=drop, text=True, capture_output=True)
        self.assertNotEqual(result.returncode,0)
        self.assertFalse(Path(target).exists())

    def test_real_compose_long_syntax_space_path(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)
            (p/'compose.json').write_text(json.dumps({'services':{'backend':{'image':'alpine','volumes':[{'type':'${KIND:-volume}','source':'${SOURCE:-files}','target':'/data'}]}},'volumes':{'files':{}}}))
            (p/'.env').write_text("KIND=bind\nSOURCE='"+d+"/my files'\n")
            result = subprocess.run(['docker','compose','-f',str(p/'compose.json'),'--env-file',str(p/'.env'),'config','--format','json'], capture_output=True, text=True, check=True)
            mount = json.loads(result.stdout)['services']['backend']['volumes'][0]
            self.assertEqual((mount['type'], mount['source']), ('bind', d+'/my files'))

if __name__ == '__main__': unittest.main(verbosity=2)
