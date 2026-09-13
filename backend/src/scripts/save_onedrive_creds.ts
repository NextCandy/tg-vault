
import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import { encryptSettingValue } from '../utils/credentialCrypto.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '../../.env') });

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
});

// ============================================
// 从环境变量读取 OneDrive 国际版凭证，禁止硬编码真实 token
// ============================================
const CREDENTIALS = {
    onedrive_client_id: process.env.ONEDRIVE_CLIENT_ID || '',
    onedrive_client_secret: process.env.ONEDRIVE_CLIENT_SECRET || '',
    onedrive_refresh_token: process.env.ONEDRIVE_REFRESH_TOKEN || '',
    onedrive_tenant_id: process.env.ONEDRIVE_TENANT_ID || 'common',
    storage_provider: 'onedrive'
};

if (!CREDENTIALS.onedrive_client_id || !CREDENTIALS.onedrive_refresh_token) {
    throw new Error('Missing ONEDRIVE_CLIENT_ID or ONEDRIVE_REFRESH_TOKEN');
}
// ============================================

const updateSetting = async (key: string, value: string) => {
    await pool.query(
        `INSERT INTO system_settings (key, value, updated_at) 
         VALUES ($1, $2, NOW()) 
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [key, encryptSettingValue(key, value)]
    );
    console.log(`✓ Updated setting: ${key}`);
};

async function main() {
    try {
        console.log('==========================================');
        console.log('OneDrive 国际版凭证保存工具');
        console.log('==========================================\n');

        console.log('1. 连接数据库...');

        // 确保表存在
        await pool.query(`
            CREATE TABLE IF NOT EXISTS system_settings (
                key VARCHAR(255) PRIMARY KEY,
                value TEXT NOT NULL,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('✓ 确认 system_settings 表存在\n');

        console.log('2. 保存 OneDrive 凭证...');
        await updateSetting('onedrive_client_id', CREDENTIALS.onedrive_client_id);
        await updateSetting('onedrive_client_secret', CREDENTIALS.onedrive_client_secret);
        await updateSetting('onedrive_refresh_token', CREDENTIALS.onedrive_refresh_token);
        await updateSetting('onedrive_tenant_id', CREDENTIALS.onedrive_tenant_id);
        await updateSetting('storage_provider', CREDENTIALS.storage_provider);

        console.log('\n==========================================');
        console.log('✓ OneDrive 凭证保存成功！');
        console.log('✓ 存储提供商已切换为 OneDrive');
        console.log('==========================================\n');

        console.log('重启后端服务后生效。Docker 部署可运行：docker compose restart backend\n');

    } catch (err: any) {
        console.error('\n✗ OneDrive 凭证保存失败');
        console.error('  错误信息:', err.message);

        console.log('\n检查数据库连接后重试，或在 Web 设置中添加 OneDrive。\n');

        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
