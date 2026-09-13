import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { localeRegistry } from '../i18n/registry';

const flatten = (value: unknown, prefix = '', result: Record<string, string> = {}): Record<string, string> => {
  if (typeof value === 'string') result[prefix] = value;
  else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, result);
  }
  return result;
};

// These are public semantics, not snapshots of every sentence. Catalog tests
// separately cover keys and interpolation, including service-side tr() calls.
const retainedCopy = [
  ['settings.cards.security.unsafeWebdav.confirmation', /SSRF/, /HTTP/, /WebDAV/],
  ['settings.cards.security.changePassword.description', /所有设备|all devices|Все устройства/i],
  ['settings.cards.maintenance.history.description', /失败|failures|ошибки/, /成功|successful|успешные/, /跳过|skipped|пропущенные/],
  ['management.telegramAccounts.description', /加密|encrypted|зашифрованные/, /停用|Disabling|отключении/],
  ['management.telegramAccounts.unlink.message', /永久|permanently|навсегда/, /其他|Other|Другие/],
  ['appCopy.cancelResumeDescription', /无法撤销|cannot be undone|невозможно отменить/],
  ['files.ui.share.providerHint', /Google Drive/, /OneDrive/],
  ['files.ui.preview.quotaExceeded', /额度|quota|квота/],
  ['subscriptionCenter.mode.description', /不会删除|do not delete|не удаляют/],
  ['subscriptionCenter.rules.description', /优先级最高|highest priority|наивысший приоритет/],
] as const;

test('public copy stays neutral while security, quotas and operation consequences remain explicit', async () => {
  for (const locale of localeRegistry) {
    const catalog = flatten(await locale.load());
    for (const [key, ...patterns] of retainedCopy) {
      assert.equal(typeof catalog[key], 'string', `${locale.code}:${key}`);
      for (const pattern of patterns) assert.match(catalog[key], pattern, `${locale.code}:${key}`);
    }
    for (const [key, value] of Object.entries(catalog)) {
      assert.doesNotMatch(value, /智能调度|Smart scheduling|Умное планирование|explainable risk scoring|可解释的风险评分|最短可用路径|счастливый путь|терминальн(?:ые|ых) записи|клеммные записи|旧确认令牌|consumed confirmation token|local QR renderer|本地二维码组件/i, `${locale.code}:${key}`);
    }
    assert.match(catalog['management.upload.reliable.concurrencyDetail'], /3/);
    assert.match(catalog['settings.cards.maintenance.chunkConcurrency.description'], /12/);
    assert.match(catalog['settings.cards.maintenance.chunkConcurrency.description'], /16/);
    assert.match(catalog['settings.cards.maintenance.chunkConcurrency.description'], /\/download_workers/);
    assert.match(catalog['settings.cards.maintenance.fileConcurrency.description'], /\/file_concurrency/);
    assert.match(catalog['settings.cards.maintenance.fileConcurrency.description'], /4/);
    assert.match(catalog['settings.remaining.shared.allowlistDescription'], /空列表|empty list|пустой список/i);
    assert.match(catalog['settings.remaining.shared.allowlistDescription'], /首个|first user|первый пользователь/i);
    assert.match(catalog['tasks.dialogs.dismissDescription'], /文件|files|файлы/i);
    assert.match(catalog['files.ui.deleteDialog.partialRetryHint'], /重新|again|снова/);
  }
});

test('Russian controls name actions and do not confuse download thresholds or ad confidence', async () => {
  const ru = flatten(await localeRegistry.find(locale => locale.code === 'ru')!.load());
  assert.equal(ru['common.actions.close'], 'Закрыть');
  assert.equal(ru['settings.nav.storage'], 'Хранилище');
  assert.equal(ru['tasks.actions.cleanTerminal'], 'Очистить записи завершённых задач');
  assert.equal(ru['management.upload.chunkThreshold'], 'Файлы больше {{size}} MiB загружаются по частям');
  assert.match(ru['subscriptionCenter.filterModes.conservative.detail'], /подозрительный контент сохраняется/);
  assert.match(ru['subscriptionCenter.filterModes.aggressive.detail'], /предполагаемая реклама/);
});

const sourceRoot = path.resolve(import.meta.dirname, '..');
const sourceFiles = (directory: string): string[] => fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = path.join(directory, entry.name);
  if (entry.isDirectory()) return sourceFiles(file);
  return entry.name.endsWith('.tsx') && !/\.test\.tsx$/.test(entry.name) ? [file] : [];
});
const literalExceptions = new Set([
  // Brands, provider/config identifiers, example inputs and units are deliberate.
  'TG Vault', 'Google Drive', 'OneDrive', 'Microsoft Entra', 'RAM', 'Bucket',
  'Bot Token', 'API ID', 'API Hash', 'Azure Portal', 'OneDrive (Microsoft Graph)',
  'S3 (AWS / R2 / MinIO)', 'Microsoft 365', 'Web', 'Bot', 'HTTP', 'HTTPS',
  'MB', 'MB/s', 'WebDAV (Beta)', 'Connection string', 'chat id', 'Prefix',
  'https://dav.example.com/dav', 'http://127.0.0.1:5244/dav', 'prefix/path/',
  'oss-cn-hangzhou.aliyuncs.com', 'https://s3.amazonaws.com', 'us-east-1',
  '0000', '000000', '••••', '0', '1', '4', '8', '12', '16', '2', '3',
  'Bot：@', '@userinfobot', 'Google Cloud Console', 'Google Cloud Client ID',
  'Google Cloud Client Secret', 'folders/', 'AADSTS7000215 Invalid client secret',
  'Azure App Client ID', 'oss-cn-hangzhou', 'my-oss-bucket', 'AccessKey ID',
  'AccessKey Secret', 'my-s3-bucket', 'https://dav.jianguoyun.com/dav/',
  'https://openlist.example.com', 'ID', 'ID:',
]);

test('hardcoded JSX copy is limited to reviewed brands, units and configuration examples', () => {
  const offenders: string[] = [];
  const visibleAttributes = new Set(['alt', 'title', 'aria-label', 'placeholder', 'label', 'description']);
  for (const file of sourceFiles(sourceRoot)) {
    const source = fs.readFileSync(file, 'utf8');
    const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const check = (node: ts.Node, text: string) => {
      const normalized = text.replace(/\s+/g, ' ').trim();
      if (!/[\p{L}\p{N}]/u.test(normalized) || literalExceptions.has(normalized)) return;
      offenders.push(`${path.relative(sourceRoot, file)}:${tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1}: ${normalized}`);
    };
    const visit = (node: ts.Node) => {
      if (ts.isJsxText(node)) check(node, node.text);
      if (ts.isJsxAttribute(node) && visibleAttributes.has(node.name.getText(tree)) && node.initializer && ts.isStringLiteral(node.initializer)) check(node, node.initializer.text);
      if (ts.isJsxExpression(node) && node.expression && (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression))) check(node, node.expression.text);
      ts.forEachChild(node, visit);
    };
    visit(tree);
  }
  assert.deepEqual(offenders, [], `Unreviewed hardcoded copy:\n${offenders.join('\n')}`);
});

test('provider labels and account scheduling explanations use the selected locale', () => {
  const accountPanel = fs.readFileSync(path.join(sourceRoot, 'components/pages/TelegramUserAccountsPanel.tsx'), 'utf8');
  assert.doesNotMatch(accountPanel, /overview\.scheduling\.description\s*\|\|/);
  assert.match(accountPanel, /\{t\('management\.telegramAccounts\.scheduling\.description'\)\}/);
  const card = fs.readFileSync(path.join(sourceRoot, 'components/ui/FileCard.tsx'), 'utf8');
  assert.match(card, /label: t\('appCopy\.localStorage'\)/);
  const app = fs.readFileSync(path.join(sourceRoot, 'App.tsx'), 'utf8');
  assert.match(app, /provider\.id === 'local' \? t\('appCopy\.localStorage'\) : provider\.label/);
});
