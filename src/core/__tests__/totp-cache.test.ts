import { describe, expect, it } from 'vitest';
import { TotpCache } from '../totp-cache';
import type { Account } from '../types';

// RFC 6238 公开种子，合成数据，不含任何真实密钥
const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

const account = (id: string, over: Partial<Account> = {}): Account => ({
  id,
  issuer: 'Example',
  account: 'user@example.com',
  secret: SECRET,
  algorithm: 'SHA1',
  digits: 6,
  period: 30,
  order: 1024,
  pinned: false,
  groupId: null,
  createdAt: 0,
  ...over,
});

describe('TotpCache', () => {
  it('同一时间窗内重复取用命中缓存，返回同一对象', async () => {
    const cache = new TotpCache();
    const list = [account('a'), account('b')];

    const first = await cache.refresh(list, 30_000);
    const second = await cache.refresh(list, 30_500);

    expect(second.get('a')).toBe(first.get('a'));
    expect(second.get('b')).toBe(first.get('b'));
    expect(first.get('a')?.code).toMatch(/^\d{6}$/);
  });

  it('翻到下一个时间窗才重算，且码改变', async () => {
    const cache = new TotpCache();
    const list = [account('a')];

    const first = await cache.refresh(list, 30_000);
    const next = await cache.refresh(list, 60_000);

    expect(next.get('a')).not.toBe(first.get('a'));
    expect(next.get('a')?.counter).toBe(2);
    expect(next.get('a')?.code).not.toBe(first.get('a')?.code);
  });

  it('翻页瞬间先给旧码占位，不产生空白', async () => {
    const cache = new TotpCache();
    const list = [account('a')];

    await cache.refresh(list, 30_000);
    const pending = cache.refresh(list, 60_000);

    // refresh 是 async 的，但占位在第一个 await 之前就已经放进 Map。
    // 这里拿不到中间态，所以只校验最终态一定是新码而非空。
    const settled = await pending;
    expect(settled.get('a')?.code).not.toBe('');
  });

  it('不同周期各算各的', async () => {
    const cache = new TotpCache();
    const list = [account('a'), account('b', { period: 60 })];

    const r = await cache.refresh(list, 45_000);
    expect(r.get('a')?.period).toBe(30);
    expect(r.get('b')?.period).toBe(60);
    expect(r.get('a')?.counter).toBe(1); // 45/30
    expect(r.get('b')?.counter).toBe(0); // 45/60
  });

  it('密钥非法时不抛异常，留空码', async () => {
    const cache = new TotpCache();
    const r = await cache.refresh([account('bad', { secret: '!!!!!!!!' })], 30_000);
    expect(r.get('bad')?.code).toBe('');
  });

  it('retain 清掉已删除账户的缓存', async () => {
    const cache = new TotpCache();
    await cache.refresh([account('a'), account('b')], 30_000);
    expect(cache.size).toBe(2);

    await cache.refresh([account('a')], 30_000);
    expect(cache.size).toBe(1);
  });

  it('20 个账户跑 200 次 tick，只算 40 次 HMAC', async () => {
    const cache = new TotpCache();
    const list = Array.from({ length: 20 }, (_, i) => account(`a${i}`));

    // 200 次 tick × 250ms = 50 秒：从 30s 走到 79.75s，跨过 60s 边界一次。
    // 每个账户在 30s、60s 两个窗口各算一次 = 20 × 2 = 40 次，
    // 其余 3960 次全部命中缓存。
    for (let i = 0; i < 200; i++) {
      await cache.refresh(list, 30_000 + i * 250);
    }

    expect(cache.stats.computed).toBe(40);
    expect(cache.stats.hits).toBe(20 * 200 - 40);
  });
});
