import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOCKOUT_MS,
  MAX_FAILURES,
  clearLockout,
  readLockout,
  recordFailure,
  remainingMs,
} from '../lockout';
import { KEYS, session } from '../storage';

/**
 * 这些测试跑在 Node 里：`chrome` 不存在，storage 退化成内存 Map，
 * 于是"关掉弹窗再打开"这件事可以用「换一个新组件实例」来模拟 ——
 * 状态全在存储里，读一次就是重开后的结果。
 */

const T0 = 1_700_000_000_000;

beforeEach(async () => {
  await clearLockout();
});

describe('失败计数', () => {
  it('没失败过时是干净的', async () => {
    expect(await readLockout()).toEqual({ failures: 0, until: 0 });
  });

  it('连续输错但没到上限：只累计次数，不锁定', async () => {
    for (let i = 1; i < MAX_FAILURES; i += 1) {
      const state = await recordFailure(T0 + i);
      expect(state).toEqual({ failures: i, until: 0 });
    }
  });

  it('第 MAX_FAILURES 次输错：进入锁定，次数归零', async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) await recordFailure(T0);
    const state = await recordFailure(T0);
    expect(state.failures).toBe(0);
    expect(state.until).toBe(T0 + LOCKOUT_MS);
  });

  it('计数存在会话存储里，换一个"弹窗实例"也读得到', async () => {
    await recordFailure(T0);
    // 不走任何内存变量，直接读存储 —— 这就是关掉弹窗再打开时看到的东西
    expect((await session.get(KEYS.lockout)) as unknown).toEqual({ failures: 1, until: 0 });
    expect(await readLockout()).toEqual({ failures: 1, until: 0 });
  });
});

describe('锁定期', () => {
  async function lockOut(): Promise<number> {
    let state = await readLockout();
    for (let i = 0; i < MAX_FAILURES; i += 1) state = await recordFailure(T0);
    return state.until;
  }

  it('锁定期间再记一次失败，不会把锁定解除', async () => {
    const until = await lockOut();
    const state = await recordFailure(T0 + 1_000);
    expect(state).toEqual({ failures: 0, until });
  });

  it('到期之后再错一次，从 1 重新数，不立刻又锁上', async () => {
    const until = await lockOut();
    const state = await recordFailure(until + 1);
    expect(state).toEqual({ failures: 1, until: 0 });
  });

  it('remainingMs 在到期后归零', async () => {
    const until = await lockOut();
    expect(remainingMs({ failures: 0, until }, until - 2_500)).toBe(2_500);
    expect(remainingMs({ failures: 0, until }, until)).toBe(0);
    expect(remainingMs({ failures: 0, until }, until + 1)).toBe(0);
  });
});

describe('清空', () => {
  it('解锁成功后清零，下一次上锁不会只剩一次机会', async () => {
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) await recordFailure(T0);
    await clearLockout();
    expect(await readLockout()).toEqual({ failures: 0, until: 0 });
  });
});

describe('存储里的脏数据', () => {
  it('字段类型不对时当作没有，而不是让整个解锁页崩掉', async () => {
    await session.set(KEYS.lockout, { failures: '五次', until: null });
    expect(await readLockout()).toEqual({ failures: 0, until: 0 });
    // 脏数据上还能正常继续计数
    expect(await recordFailure(T0)).toEqual({ failures: 1, until: 0 });
  });

  it('次数被改得比上限还大时，按"还差一次"处理，不直接放行', async () => {
    await session.set(KEYS.lockout, { failures: 99, until: 0 });
    expect((await readLockout()).failures).toBe(MAX_FAILURES - 1);
    expect((await recordFailure(T0)).until).toBe(T0 + LOCKOUT_MS);
  });
});
