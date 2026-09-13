#!/usr/bin/env python3
"""Validate real full Compose config with optional downloaded Compose binaries.
No daemon operations; uses disposable dotenv, never the project's live .env.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--compose-bin', action='append', default=[])
    args = parser.parse_args()
    results = []
    with tempfile.TemporaryDirectory(prefix='tg-vault-compose-schema-') as directory:
        fixture = Path(directory)
        shutil.copy2(ROOT/'docker-compose.yml', fixture/'docker-compose.yml')
        (fixture/'.env').write_text('DB_PASSWORD=sandbox-only-password\nCORS_ORIGIN=https://cloud.example.xyz\nVITE_API_URL=https://api.example.xyz\n')
        env = {k:v for k,v in os.environ.items() if not k.startswith(('COMPOSE_','DOCKER_')) and k not in ('DB_PASSWORD','CORS_ORIGIN','VITE_API_URL','SESSION_SECRET','STORAGE_CREDENTIALS_SECRET','PORT')}
        # Execute the production compat generator, copy its output before EXIT cleanup.
        code = 'source "$1"; INSTALL_REQUIRE_ATTESTATIONS=false; prepare_install_compose; cp "$INSTALL_COMPAT_FILE" compat.yml'
        result = subprocess.run(['bash','-euc',code,'test',str(ROOT/'deploy/install-runtime.sh')],cwd=fixture,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        assert result.returncode == 0, result.stderr
        for binary in [['docker','compose']]+[[b] for b in args.compose_bin]:
            version = subprocess.check_output(binary+['version'],text=True).strip()
            base_result = subprocess.run(binary+['--project-directory',str(fixture),'--env-file',str(fixture/'.env'),'-f',str(fixture/'docker-compose.yml'),'config','--format','json'],cwd=fixture,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            compat_result = subprocess.run(binary+['--project-directory',str(fixture),'--env-file',str(fixture/'.env'),'-f',str(fixture/'compat.yml'),'config','--format','json'],cwd=fixture,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            assert compat_result.returncode == 0, (version, compat_result.stderr)
            config = json.loads(compat_result.stdout)
            assert set(config['services']) == {'postgres','backend','frontend'}
            assert config['services']['backend']['environment']['DATABASE_URL']=='postgresql://tgvault:sandbox-only-password@postgres:5432/tgvault'
            assert config['services']['postgres']['environment']['POSTGRES_PASSWORD']=='sandbox-only-password'
            assert config['services']['frontend']['build']['args']['VITE_API_URL']=='https://api.example.xyz'
            for service in ['frontend','backend']:
                build = config['services'][service]['build']
                assert 'sbom' not in build and 'provenance' not in build
                assert (fixture/Path(build['context'])).resolve()==(fixture/service).resolve(), (version, build['context'],str(fixture/service))
            results.append({'version':version,'standard_schema':base_result.returncode==0,'compat_schema':True,'runtime_env_and_paths':True})
    print(json.dumps(results,ensure_ascii=False,indent=2))

if __name__=='__main__': main()
