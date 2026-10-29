import { beforeEach, describe, expect, it } from 'vitest';
import { CryptoError, DEK_BYTES, bytesToBase64, randomBytes } from '@/core/crypto';
import type { DekWrap } from '@/core/crypto';
import { addAccount, emptyVault } from '@/core/vault';
import { KEYS, backupKey, local, session } from '../storage';
import {
  MAX_BACKUPS,
  autoLockIfExpired,
  expired,
  initializeVault,
  isUnlocked,
  lock,
  maybeBackup,
  resetAll,
  resolveStatus,
  saveVault,
  unlockWithPassword,
  unlockWithRecovery,
  changePassword,
  enablePassword,
  disablePassword,
  resetPasswordWithRecovery,
} from '../vault-service';

/**
 * 这些测试跑在 Node 里，`chrome` 不存在，storage 自动退化成内存 Map，
 * 于是整条「初始化 → 落盘 → 冷启动 → 解锁」链路可以在没有浏览器的环境下验证。
 *
 * 注意：这里用的是真实的 600k 次 PBKDF2（不是缩短版），
 * 因为要验证的正是"生产参数下这条路走得通"。每次设 / 解锁密码约 50ms。
 */

const PASSWORD = 'correct horse battery';
const OTHER_PASSWORD = 'another fine password';

beforeEach(async () => {
  await resetAll();
  for (const key of await session.keys()) await session.remove(key);
});

describe('冷启动状态机', () => {
  it('什么都没存过 → empty', async () => {
    expect(await resolveStatus(0)).toEqual({ kind: 'empty' });
  });

  it('未开密码保护 → 直接 unlocked，DEK 只从 wrap 里取', async () => {
    const { recoveryCode } = await initializeVault();
    expect(recoveryCode).toBeNull();

    // 模拟浏览器重启：内存缓存没了，session 也空了
    await lock();
    expect(isUnlocked()).toBe(false);

    const status = await resolveStatus(0);
    expect(status.kind).toBe('unlocked');
    expect(status.kind === 'unlocked' && status.vault.accounts).toEqual([]);
    expect(isUnlocked()).toBe(true);
  });

  it('开了密码保护 → locked，并且告诉界面"有恢复码可用"', async () => {
    const { recoveryCode } = await initializeVault(PASSWORD);
    expect(recoveryCode).not.toBeNull();
    // 设完密码立刻清会话，强制马上验证一次
    expect(isUnlocked()).toBe(false);

    expect(await resolveStatus(0)).toEqual({ kind: 'locked', canRecover: true });
  });

  it('会话里的 DEK 解不开当前 vault 时，不炸，退回 locked', async () => {
    await initializeVault(PASSWORD);
    // 塞一个"对不上号"的 DEK，模拟存储被外部改过
    await session.set(KEYS.dek, bytesToBase64(randomBytes(DEK_BYTES)));
    await session.set(KEYS.unlockedAt, Date.now());

    expect(await resolveStatus(0)).toEqual({ kind: 'locked', canRecover: true });
    expect(isUnlocked()).toBe(false);
  });

  it('会话里的 DEK 长度不对时当作没有', async () => {
    await initializeVault(PASSWORD);
    await session.set(KEYS.dek, bytesToBase64(randomBytes(16)));
    expect(await resolveStatus(0)).toEqual({ kind: 'locked', canRecover: true });
  });

  it('超过自动锁时限 → locked，并把会话清掉', async () => {
    await initializeVault(PASSWORD);
    const vault = await unlockWithPassword(PASSWORD);
    expect(vault.version).toBe(1);

    // 伪造成 10 分钟前解锁的
    await session.set(KEYS.unlockedAt, Date.now() - 10 * 60_000);
    expect(await resolveStatus(5)).toEqual({ kind: 'locked', canRecover: true });
    expect(await session.get(KEYS.dek)).toBeUndefined();
  });

  it('关闭自动锁时，多老的会话都还算解锁', async () => {
    await initializeVault(PASSWORD);
    await unlockWithPassword(PASSWORD);
    await session.set(KEYS.unlockedAt, Date.now() - 999 * 60_000);
    expect((await resolveStatus(0)).kind).toBe('unlocked');
  });
});

describe('expired · 纯函数', () => {
  it('0 表示关闭自动锁，永不超时', () => {
    expect(expired(0, undefined)).toBe(false);
    expect(expired(0, 0)).toBe(false);
  });

  it('没有解锁时间戳一律视为已超时', () => {
    expect(expired(5, undefined)).toBe(true);
  });

  it('刚好过界不算超时，多 1ms 就算', () => {
    const now = Date.now();
    expect(expired(5, now - 5 * 60_000 + 1000)).toBe(false);
    expect(expired(5, now - 5 * 60_000 - 1000)).toBe(true);
  });
});

describe('autoLockIfExpired · 定时巡检', () => {
  it('没解锁时什么都不做', async () => {
    await initializeVault(PASSWORD);
    expect(await autoLockIfExpired(5)).toBe(false);
  });

  it('超过时限就真的上锁，并清掉会话', async () => {
    await initializeVault(PASSWORD);
    await unlockWithPassword(PASSWORD);
    await session.set(KEYS.unlockedAt, Date.now() - 10 * 60_000);

    expect(await autoLockIfExpired(5)).toBe(true);
    expect(isUnlocked()).toBe(false);
    expect(await session.get(KEYS.dek)).toBeUndefined();
  });

  it('没过时限不动；关闭自动锁时永远不动', async () => {
    await initializeVault(PASSWORD);
    await unlockWithPassword(PASSWORD);
    expect(await autoLockIfExpired(5)).toBe(false);

    await session.set(KEYS.unlockedAt, Date.now() - 999 * 60_000);
    expect(await autoLockIfExpired(0)).toBe(false);
    expect(isUnlocked()).toBe(true);
  });

  it('刚建好的无密码库带着解锁时间戳，不会被立刻判超时', async () => {
    await initializeVault();
    expect(typeof (await session.get(KEYS.unlockedAt))).toBe('number');
  });

  it('没设密码的库根本不参与自动锁', async () => {
    await initializeVault();
    // 时间戳缺失正是当初的 bug：建完库 5 秒后巡检判超时，
    // 界面落到一个"请输入密码"的锁屏，而用户从来没有设过密码
    await session.remove(KEYS.unlockedAt);
    expect(await autoLockIfExpired(5)).toBe(false);
    expect(isUnlocked()).toBe(true);
  });
});

describe('密码解锁', () => {
  it('密码对 → 拿到保险库；密码错 → wrong-key', async () => {
    await initializeVault(PASSWORD);
    const vault = await unlockWithPassword(PASSWORD);
    expect(vault.accounts).toEqual([]);
    expect(isUnlocked()).toBe(true);

    await lock();
    await expect(unlockWithPassword(OTHER_PASSWORD)).rejects.toBeInstanceOf(CryptoError);
    // 失败不能留下半开的会话
    expect(isUnlocked()).toBe(false);
  });

  it('密码错抛的是 wrong-key，不泄露"哪一步失败"', async () => {
    await initializeVault(PASSWORD);
    await lock();
    try {
      await unlockWithPassword(OTHER_PASSWORD);
      throw new Error('不该走到这里');
    } catch (error) {
      expect((error as CryptoError).reason).toBe('wrong-key');
    }
  });

  it('未开密码保护时用密码解锁要明确报错，而不是"随便解开了"', async () => {
    await initializeVault();
    await expect(unlockWithPassword(PASSWORD)).rejects.toBeInstanceOf(CryptoError);
  });
});

describe('恢复码解锁', () => {
  it('恢复码大小写 / 空格 / 缺横线都能用', async () => {
    const { recoveryCode } = await initializeVault(PASSWORD);
    expect(recoveryCode).not.toBeNull();
    const messy = recoveryCode!.toLowerCase().replace(/-/g, ' ');
    const vault = await unlockWithRecovery(messy);
    expect(vault.version).toBe(1);
  });

  it('恢复码错 → wrong-key', async () => {
    await initializeVault(PASSWORD);
    const wrong = 'AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH';
    await expect(unlockWithRecovery(wrong)).rejects.toBeInstanceOf(CryptoError);
  });

  it('未开密码保护时没有恢复码包装，明确指出', async () => {
    await initializeVault();
    await expect(unlockWithRecovery('AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH')).rejects.toThrow(
      /恢复码/,
    );
  });
});

describe('开关密码保护', () => {
  it('开后立刻上锁，用新密码能进；关闭后退回明文包装并删掉恢复码', async () => {
    await initializeVault();
    expect(await resolveStatus(0)).toMatchObject({ kind: 'unlocked' });

    const { recoveryCode } = await enablePassword(PASSWORD);
    expect(recoveryCode).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    expect(isUnlocked()).toBe(false);

    expect(await resolveStatus(0)).toEqual({ kind: 'locked', canRecover: true });
    await unlockWithPassword(PASSWORD);
    expect(isUnlocked()).toBe(true);

    // 关闭需要再次验密码
    await disablePassword(PASSWORD);
    expect(isUnlocked()).toBe(true);
    expect((await local.get<DekWrap>(KEYS.dekWrap))?.kind).toBe('none');
    expect(await local.get(KEYS.dekWrapRecovery)).toBeUndefined();
    expect(await resolveStatus(0)).toMatchObject({ kind: 'unlocked' });
  });

  it('密码太短时不写入任何包装，保险库仍是原来的状态', async () => {
    await initializeVault();
    await expect(enablePassword('short')).rejects.toThrow(/至少/);
    expect((await local.get<DekWrap>(KEYS.dekWrap))?.kind).toBe('none');
    // 失败不该把当前会话弄丢
    expect(isUnlocked()).toBe(true);
  });

  it('换密码后旧密码失效、新密码可用', async () => {
    const { recoveryCode } = await initializeVault(PASSWORD);
    await resetPasswordWithRecovery(recoveryCode!, OTHER_PASSWORD);
    expect(isUnlocked()).toBe(false);

    await expect(unlockWithPassword(PASSWORD)).rejects.toBeInstanceOf(CryptoError);
    await unlockWithPassword(OTHER_PASSWORD);
    expect(isUnlocked()).toBe(true);
  });

  it('重置密码会换掉恢复码，旧码作废', async () => {
    const { recoveryCode: oldCode } = await initializeVault(PASSWORD);
    const { recoveryCode: newCode } = await resetPasswordWithRecovery(oldCode!, OTHER_PASSWORD);
    expect(newCode).not.toBe(oldCode);
    await lock();

    await expect(unlockWithRecovery(oldCode!)).rejects.toBeInstanceOf(CryptoError);
    // 新码可用，新密码也照常
    await expect(unlockWithRecovery(newCode)).resolves.toBeTruthy();
    await unlockWithPassword(OTHER_PASSWORD);
  });
});

describe('changePassword · 拿旧密码直接换新的', () => {
  it('换完之后旧密码进不去、新密码能进，账户还在', async () => {
    await initializeVault(PASSWORD);
    await unlockWithPassword(PASSWORD);
    await saveVault(
      addAccount(emptyVault(), {
        issuer: '示例',
        account: 'u@example.com',
        secret: 'JBSWY3DPEHPK3PXP',
      }),
    );

    const { recoveryCode } = await changePassword(PASSWORD, OTHER_PASSWORD);
    expect(recoveryCode).toMatch(/^([A-Z2-7]{4}-){7}[A-Z2-7]{4}$/);
    // 换完必须重新解锁：让用户当场用新密码走一遍，别等下次开机才发现记错
    expect(isUnlocked()).toBe(false);

    await expect(unlockWithPassword(PASSWORD)).rejects.toBeInstanceOf(CryptoError);
    await unlockWithPassword(OTHER_PASSWORD);
    expect(isUnlocked()).toBe(true);

    const status = await resolveStatus(0);
    expect(status.kind).toBe('unlocked');
    if (status.kind === 'unlocked') {
      expect(status.vault.accounts[0]?.issuer).toBe('示例');
    }
  });

  it('顺带换掉恢复码：旧的作废，新的能用', async () => {
    const { recoveryCode: oldCode } = await initializeVault(PASSWORD);
    const { recoveryCode: newCode } = await changePassword(PASSWORD, OTHER_PASSWORD);
    expect(newCode).not.toBe(oldCode);

    await expect(unlockWithRecovery(oldCode!)).rejects.toBeInstanceOf(CryptoError);
    await expect(unlockWithRecovery(newCode)).resolves.toBeTruthy();
  });

  it('旧密码输错时什么都不改，原密码照常能用', async () => {
    await initializeVault(PASSWORD);
    await unlockWithPassword(PASSWORD);

    await expect(changePassword('wrong password here', OTHER_PASSWORD)).rejects.toBeInstanceOf(
      CryptoError,
    );
    await expect(unlockWithPassword(PASSWORD)).resolves.toBeTruthy();
  });

  it('没有密码保护时没有可换的东西', async () => {
    await initializeVault();
    await expect(changePassword(PASSWORD, OTHER_PASSWORD)).rejects.toThrow(/没有开启密码保护/);
  });
});

describe('保存与持久化', () => {
  it('saveVault 写入的改动，冷启动后还在', async () => {
    await initializeVault();
    const vault = addAccount(emptyVault(), {
      issuer: '示例',
      account: 'u@example.com',
      secret: 'JBSWY3DPEHPK3PXP',
    });
    await saveVault(vault);

    await lock();
    const status = await resolveStatus(0);
    expect(status.kind).toBe('unlocked');
    if (status.kind === 'unlocked') {
      expect(status.vault.accounts).toHaveLength(1);
      expect(status.vault.accounts[0]?.issuer).toBe('示例');
    }
  });

  it('上锁后写不进去，明确报错而不是静默丢弃', async () => {
    await initializeVault();
    await lock();
    await expect(saveVault(emptyVault())).rejects.toBeInstanceOf(CryptoError);
  });

  it('vault 明文不会以任何形式出现在存储里', async () => {
    await initializeVault(PASSWORD);
    await unlockWithPassword(PASSWORD);
    await saveVault(addAccount(emptyVault(), { issuer: '机密标记', account: 'x', secret: 'JBSWY3DPEHPK3PXP' }));

    // 遍历所有存储键，确保落盘的只有密文
    const dump = JSON.stringify(await Promise.all((await local.keys()).map((k) => local.get(k))));
    expect(dump).not.toContain('机密标记');
    expect(dump).not.toContain('JBSWY3DPEHPK3PXP');
  });
});

describe('每日备份', () => {
  it('同一天只备一次', async () => {
    await initializeVault();
    expect(await maybeBackup(emptyVault())).toBe(true);
    expect(await maybeBackup(emptyVault())).toBe(false);
  });

  it(`最多留 ${MAX_BACKUPS} 份，裁掉最旧的`, async () => {
    await initializeVault();
    // 预置 8 份历史备份，让 maybeBackup 写入今天这份后触发裁剪
    for (let day = 1; day <= 8; day++) {
      await local.set(backupKey(`2020-01-0${day}`), { v: 1, iv: 'x', ct: 'y' });
    }
    expect(await maybeBackup(emptyVault())).toBe(true);

    const backups = (await local.keys()).filter((key) => key.startsWith('2fa:backup:')).sort();
    expect(backups).toHaveLength(MAX_BACKUPS);
    expect(backups).not.toContain(backupKey('2020-01-01'));
    expect(backups).not.toContain(backupKey('2020-01-02'));
  });

  it('上锁时不留备份（没有密钥可加密）', async () => {
    await initializeVault();
    await lock();
    expect(await maybeBackup(emptyVault())).toBe(false);
    expect((await local.keys()).filter((key) => key.startsWith('2fa:backup:'))).toHaveLength(0);
  });
});

describe('resetAll', () => {
  it('清干净存储与本模块缓存', async () => {
    await initializeVault(PASSWORD);
    await unlockWithPassword(PASSWORD);
    await maybeBackup(emptyVault());

    await resetAll();
    expect(isUnlocked()).toBe(false);
    expect(await resolveStatus(0)).toEqual({ kind: 'empty' });
    expect((await local.keys()).filter((key) => key.startsWith('2fa:'))).toHaveLength(0);
  });
});

describe('明文 DEK 包装的健壮性', () => {
  it('kind:none 里长度不对时明确报错，不当作解锁成功', async () => {
    await initializeVault();
    await lock();
    await local.set(KEYS.dekWrap, {
      v: 1,
      kind: 'none',
      dek: bytesToBase64(randomBytes(8)),
    } satisfies DekWrap);
    await expect(resolveStatus(0)).rejects.toThrow(/长度/);
  });
});
