#!/usr/bin/env python3
"""Opt-in real Docker installer test; isolated names, volumes and internal network.
Uses already-built app images. Never mounts project data or publishes host ports.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent

def run(cmd, cwd=None, env=None, check=True, timeout=600):
    result = subprocess.run(cmd, cwd=cwd, env=env, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=timeout)
    if check and result.returncode:
        raise AssertionError(f'{cmd}: exit {result.returncode}\n{result.stdout[-8000:]}')
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--expect-legacy-failure', action='store_true')
    parser.add_argument('--compat', action='store_true')
    parser.add_argument('--compose-bin', help='Optional independently installed Compose v2 binary')
    parser.add_argument('--bash-bin', default='bash')
    parser.add_argument('--special-password', action='store_true')
    parser.add_argument('--build-from-source', action='store_true')
    parser.add_argument('--backend-image', default='tg-vault-backend:local-bot-audit-fix')
    parser.add_argument('--frontend-image', default='tg-vault-frontend:local-static-nav')
    parser.add_argument('--report', default='/tmp/tg-vault-installer-runtime.json')
    args = parser.parse_args()
    for image in (args.backend_image, args.frontend_image):
        run(['docker', 'image', 'inspect', image])
    pg_image = 'postgres@sha256:cf78e76683b9ca8c5733cbbdce6c9262b45b6767934dd0a95e671f9a0fc20685'
    run(['docker', 'image', 'inspect', pg_image])
    project = 'tg-vault-installer-test-' + secrets.token_hex(4)
    compose = {
        'name': project,
        'services': {
            'postgres': {
                'image': pg_image, 'mem_limit': '256m',
                'environment': {'POSTGRES_DB': 'tgvault', 'POSTGRES_USER': 'tgvault', 'POSTGRES_PASSWORD': '${DB_PASSWORD:?required}'},
                'volumes': ['postgres-data:/var/lib/postgresql/data'],
                'healthcheck': {'test': ['CMD-SHELL', 'pg_isready -U tgvault -d tgvault'], 'interval': '1s', 'timeout': '3s', 'retries': 30},
            },
            'backend': {
                'image': args.backend_image, 'mem_limit': '384m',
                'environment': {'DATABASE_URL': 'postgresql://tgvault:${DB_PASSWORD_URI:-${DB_PASSWORD}}@postgres:5432/tgvault', 'NODE_ENV': 'production', 'PORT': '51947', 'SESSION_SECRET': '${SESSION_SECRET:-}', 'STORAGE_CREDENTIALS_SECRET': '${STORAGE_CREDENTIALS_SECRET:-}', 'CORS_ORIGIN': '${CORS_ORIGIN}', 'TELEGRAM_BOT_TOKEN': '', 'TELEGRAM_API_ID': '', 'TELEGRAM_API_HASH': '', 'UPLOAD_DIR': '/data/uploads'},
                'volumes': [{'type':'${LOCAL_STORAGE_MOUNT_TYPE:-volume}', 'source':'${LOCAL_STORAGE_SOURCE:-file-storage}', 'target':'/data'}],
                'depends_on': {'postgres': {'condition': 'service_healthy'}},
                'healthcheck': {'test': ['CMD-SHELL', 'node -e "fetch(\'http://127.0.0.1:51947/readyz\').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"'], 'interval': '2s', 'timeout': '4s', 'retries': 15},
            },
            'frontend': {
                'image': args.frontend_image, 'mem_limit': '64m',
                'depends_on': {'backend': {'condition': 'service_healthy'}},
                'healthcheck': {'test': ['CMD-SHELL', 'wget -q -O - http://127.0.0.1/ >/dev/null'], 'interval': '2s', 'timeout': '3s', 'retries': 15},
            },
        },
        'volumes': {'postgres-data': {}, 'file-storage': {}},
        'networks': {'default': {'internal': True}},
    }
    report = {'project': project, 'legacy': args.expect_legacy_failure, 'checks': []}
    built_images = []
    if args.build_from_source:
        for service in ('backend', 'frontend'):
            image = project+'-'+service+':test'
            built_images.append(image)
            compose['services'][service]['image'] = image
            compose['services'][service]['build'] = {'context': str(ROOT/service), 'args': {'SOURCE_VERSION': 'installer-isolated-test', 'SOURCE_REVISION': 'worktree'}}
            if not args.compat:
                compose['services'][service]['build'].update(sbom=True, provenance='mode=max')
            if service == 'frontend':
                compose['services'][service]['build']['args']['VITE_API_URL'] = '${VITE_API_URL}'
    with tempfile.TemporaryDirectory(prefix=project+'-') as folder:
        fixture = Path(folder)
        (fixture/'deploy').mkdir()
        (fixture/'backend').mkdir()
        for source in (ROOT/'deploy').glob('install*'):
            if source.is_file() and source.suffix in ('.sh', '.py'):
                shutil.copy2(source, fixture/'deploy'/source.name)
        if args.expect_legacy_failure:
            original = run(['git','show','ab8d90e:deploy/install.sh'], ROOT).stdout
            (fixture/'deploy/install.sh').write_text(original)
        (fixture/'backend/package.json').write_text('{"version":"2.4.3"}\n')
        (fixture/'docker-compose.yml').write_text(json.dumps(compose))
        if args.special_password:
            run(['docker', 'volume', 'create', project+'_file-storage'])
            (fixture/'.env').write_text("DB_PASSWORD='sandbox/@:#%$literal-password'\nCORS_ORIGIN=https://cloud.example.xyz\nVITE_API_URL=https://api.example.xyz\n")
        env = {k:v for k,v in os.environ.items() if not k.startswith(('COMPOSE_', 'DOCKER_')) and k not in ('DB_PASSWORD','SESSION_SECRET','STORAGE_CREDENTIALS_SECRET','PORT')}
        env.update(CORS_ORIGIN='https://cloud.example.xyz', VITE_API_URL='https://api.example.xyz', COMPOSE_PROJECT_NAME=project)
        if args.compose_bin:
            import shlex
            binary = str(Path(args.compose_bin).resolve())
            real_docker = shutil.which('docker')
            assert real_docker, 'Docker CLI required'
            fake = fixture/'bin'; fake.mkdir()
            wrapper = fake/'docker'
            wrapper.write_text('#!/usr/bin/env bash\nif [[ "${1:-}" == compose ]]; then shift; exec '+shlex.quote(binary)+' "$@"; fi\nexec '+shlex.quote(real_docker)+' "$@"\n')
            wrapper.chmod(0o755)
            env['PATH'] = str(fake)+os.pathsep+env['PATH']
        cmd = ['docker', 'compose', '-p', project]
        installer = [args.bash_bin,'deploy/install.sh','--non-interactive'] + (['--compat'] if args.compat else [])
        try:
            install = run(installer, fixture, env, check=False)
            report['install_exit'] = install.returncode
            report['install_output'] = install.stdout[-7000:]
            logs = run(cmd+['logs','--no-color','backend'], fixture, env, check=False).stdout
            report['backend_logs'] = logs[-10000:]
            if args.expect_legacy_failure:
                assert 'ENOTFOUND postgres' in logs or 'EAI_AGAIN postgres' in logs, logs
                ids = run(cmd+['ps','--all','--quiet','postgres'], fixture, env).stdout.strip()
                assert not ids, ids
                report['checks'].append('Original installer skips postgres and actual backend fails getaddrinfo for postgres (ENOTFOUND or EAI_AGAIN)')
            else:
                assert install.returncode == 0, install.stdout

                ids = run(cmd+['ps','--all','--quiet'], fixture, env).stdout.split()
                state = json.loads(run(['docker','inspect',*ids]).stdout)
                assert len(state)==3 and all(x['State']['Health']['Status']=='healthy' for x in state)
                report['checks'].append('Fresh install brings up healthy postgres, backend, frontend')
                pg_id = run(cmd+['ps','--quiet','postgres'], fixture, env).stdout.strip()
                pg_start = run(['docker','inspect','--format','{{.State.StartedAt}}',pg_id]).stdout.strip()
                secrets_before = (fixture/'.env').read_bytes()
                run(cmd+['exec','-T','postgres','psql','-U','tgvault','-c','CREATE TABLE installer_sentinel (value text); INSERT INTO installer_sentinel VALUES (\'keep\');'], fixture, env)
                second = run(installer, fixture, env)
                assert pg_id == run(cmd+['ps','--quiet','postgres'],fixture,env).stdout.strip()
                assert pg_start == run(['docker','inspect','--format','{{.State.StartedAt}}',pg_id]).stdout.strip()
                assert secrets_before == (fixture/'.env').read_bytes()
                report['checks'].append('Repeat install preserves postgres process, credentials and data')
                run(cmd+['stop','postgres'], fixture, env)
                run(installer, fixture, env)
                sentinel = run(cmd+['exec','-T','postgres','psql','-U','tgvault','-Atc','SELECT value FROM installer_sentinel'],fixture,env).stdout.strip()
                assert sentinel=='keep'
                report['checks'].append('Existing stopped postgres restarts without losing data')
        finally:
            cleanup = run(cmd+['down','--volumes','--remove-orphans'],fixture,env,check=False)
            report['cleanup_exit'] = cleanup.returncode
            report['remaining_containers'] = run(['docker','ps','-aq','--filter',f'label=com.docker.compose.project={project}']).stdout.strip()
            report['remaining_volumes'] = run(['docker','volume','ls','-q','--filter',f'label=com.docker.compose.project={project}']).stdout.strip()
            if built_images:
                run(['docker','image','rm',*built_images],check=False)
            Path(args.report).write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
            assert cleanup.returncode==0 and not report['remaining_containers'] and not report['remaining_volumes']
    print(json.dumps({k:v for k,v in report.items() if k not in ('install_output','backend_logs')},ensure_ascii=False,indent=2))

if __name__=='__main__':
    main()
