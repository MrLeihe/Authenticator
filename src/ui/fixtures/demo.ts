import { base32Encode } from '@/core/base32';
import type { Account } from '@/core/types';

/**
 * P2 界面用的内存假数据。
 *
 * 密钥全部由下面这个函数**合成**：一段确定性的字节序列再编码成 base32。
 * 不含任何真实账户、真实密钥或真实身份 —— 提交前请保持这一点。
 */
const synthSecret = (seed: number): string =>
  base32Encode(Uint8Array.from({ length: 20 }, (_, i) => (seed * 37 + i * 11) & 0xff));

const SERVICES = [
  ['GitHub', 'stone'],
  ['阿里云', 'stone@example.com'],
  ['腾讯云', 'stone@example.com'],
  ['Cloudflare', 'stone@example.com'],
  ['Amazon Web Services', 'stone@example.com'],
  ['Google', 'stone@example.com'],
  ['Dropbox', 'stone@example.com'],
  ['Notion', 'stone@example.com'],
  ['Figma', 'stone@example.com'],
  ['npm', 'stone'],
  ['Docker Hub', 'stone'],
  ['DigitalOcean', 'stone@example.com'],
  ['Vercel', 'stone'],
  ['GitLab', 'stone'],
  ['Bitwarden', 'stone@example.com'],
  ['PyPI', 'stone'],
  ['V2EX', 'stone'],
  ['Linode', 'stone@example.com'],
  ['Stripe', 'stone@example.com'],
  ['微信开放平台', 'stone@example.com'],
] as const;

export const DEMO_ACCOUNTS: Account[] = SERVICES.map(([issuer, account], i) => ({
  id: `demo-${i + 1}`,
  issuer,
  account,
  secret: synthSecret(i + 1),
  algorithm: i % 7 === 3 ? 'SHA256' : 'SHA1',
  digits: 6,
  period: i % 11 === 5 ? 60 : 30,
  order: (i + 1) * 1024,
  pinned: i === 0,
  groupId: null,
  createdAt: 0,
}));
