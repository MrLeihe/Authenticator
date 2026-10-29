import { base32Decode } from './base32';
import { totp } from './totp';
import type { Account } from './types';

export interface CachedCode {
  code: string;
  counter: number;
  period: number;
  expiresAt: number;
}

const DEFAULT_PERIOD = 30;

/**
 * 验证码缓存。
 *
 * 20 个账户每 250ms 全量重算 = 每秒 80 次 HMAC，MV3 里会明显掉帧。
 * 这里按 `accountId → { counter, code }` 缓存，每次 tick 只重算 counter 变了的账户，
 * 其余 119 次 tick 全部命中缓存，开销只剩一次 Map 查找。
 *
 * 缓存归属 UI 层，popup 关闭即随进程销毁 —— 验证码不落盘。
 */
export class TotpCache {
  private readonly cache = new Map<string, CachedCode>();

  /**
   * 只读计数器。用来验证"20 个账户跑 200 次 tick 到底算了几次 HMAC"，
   * 也是性能验收的旁证 —— 预期 computed 等于账户数 × 翻页次数。
   */
  readonly stats = { computed: 0, hits: 0 };

  private periodOf(account: Account): number {
    return Number.isFinite(account.period) && account.period > 0 ? account.period : DEFAULT_PERIOD;
  }

  private counterOf(account: Account, now: number): number {
    return Math.floor(Math.floor(now / 1000) / this.periodOf(account));
  }

  /**
   * 批量取当前验证码。返回新 Map，未变化的账户直接复用缓存对象，
   * 调用方可以用引用相等来判断"这一格没变、不用重渲染"。
   */
  async refresh(accounts: readonly Account[], now: number): Promise<Map<string, CachedCode>> {
    const out = new Map<string, CachedCode>();
    const pending: Array<Promise<void>> = [];

    for (const account of accounts) {
      const period = this.periodOf(account);
      const counter = this.counterOf(account, now);
      const hit = this.cache.get(account.id);

      if (hit && hit.counter === counter && hit.period === period) {
        this.stats.hits++;
        out.set(account.id, hit);
        continue;
      }

      // 先占位：沿用上一窗口的码，避免翻页瞬间闪一下空白。
      // 首次出现（无缓存）时才是空字符串，UI 会显示占位符。
      const placeholder: CachedCode = {
        code: hit ? hit.code : '',
        counter,
        period,
        expiresAt: (counter + 1) * period * 1000,
      };
      out.set(account.id, placeholder);
      pending.push(this.compute(account, now, out));
    }

    await Promise.all(pending);
    this.retain(accounts.map((a) => a.id));
    return out;
  }

  private async compute(
    account: Account,
    now: number,
    out: Map<string, CachedCode>,
  ): Promise<void> {
    const period = this.periodOf(account);
    this.stats.computed++;
    try {
      const secret = base32Decode(account.secret);
      const result = await totp(secret, {
        algorithm: account.algorithm,
        digits: account.digits,
        period,
        now,
      });
      const entry: CachedCode = {
        code: result.code,
        counter: result.counter,
        period,
        expiresAt: result.expiresAt,
      };
      this.cache.set(account.id, entry);
      out.set(account.id, entry);
    } catch {
      // 密钥坏掉的账户不该拖垮整个列表：留空码，行上显示"密钥无效"
      const entry: CachedCode = {
        code: '',
        counter: this.counterOf(account, now),
        period,
        expiresAt: (this.counterOf(account, now) + 1) * period * 1000,
      };
      this.cache.set(account.id, entry);
      out.set(account.id, entry);
    }
  }

  /** 丢掉已经不存在的账户，避免删号后缓存常驻 */
  retain(ids: readonly string[]): void {
    const keep = new Set(ids);
    for (const id of this.cache.keys()) {
      if (!keep.has(id)) this.cache.delete(id);
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}
