import { describe, expect, it } from 'vitest';
import {
  ORDER_STEP,
  VaultError,
  addAccount,
  emptyVault,
  moveAccount,
  nextOrder,
  normalizeVault,
  removeAccount,
  updateAccount,
} from '../vault';
import { DEFAULT_SETTINGS } from '../types';

const SECRET = 'JBSWY3DPEHPK3PXP';

describe('normalizeVault · 宽容读取', () => {
  it('完整数据原样通过，没有 issue', () => {
    const input = {
      version: 1,
      accounts: [
        {
          id: 'a1',
          issuer: '示例',
          account: 'u@example.com',
          secret: SECRET,
          algorithm: 'SHA256',
          digits: 8,
          period: 60,
          order: 1024,
          pinned: true,
          groupId: null,
          createdAt: 1,
        },
      ],
      groups: [{ id: 'g1', name: '工作', order: 1024 }],
      settings: { ...DEFAULT_SETTINGS, view: 'compact' },
    };
    const { vault, issues } = normalizeVault(input);
    expect(issues).toEqual([]);
    expect(vault.accounts).toHaveLength(1);
    expect(vault.accounts[0]?.algorithm).toBe('SHA256');
    expect(vault.accounts[0]?.digits).toBe(8);
    expect(vault.settings.view).toBe('compact');
  });

  it('坏账户跳过，好账户照常救回来，并说明跳了几个', () => {
    const { vault, issues } = normalizeVault({
      version: 1,
      accounts: [
        { id: 'ok', issuer: '好的', secret: SECRET },
        { id: 'bad', issuer: '坏的', secret: '!!!not-base32!!!' },
        { id: 'empty', issuer: '空的' },
        'not-an-object',
      ],
    });
    expect(vault.accounts.map((a) => a.id)).toEqual(['ok']);
    expect(issues).toHaveLength(3);
    expect(issues.join()).toContain('坏的');
  });

  it('字段类型不对就用默认值，不整包失败', () => {
    const { vault } = normalizeVault({
      version: 1,
      accounts: [{ secret: SECRET, algorithm: 'MD5', digits: 9, period: -5 }],
    });
    const account = vault.accounts[0];
    expect(account?.algorithm).toBe('SHA1');
    expect(account?.digits).toBe(6);
    expect(account?.period).toBe(1);
    expect(account?.id).toBeTruthy();
  });

  it('重复 id 会被重新分配（否则列表 key 与缓存会打架）', () => {
    const { vault, issues } = normalizeVault({
      version: 1,
      accounts: [
        { id: 'dup', secret: SECRET },
        { id: 'dup', secret: SECRET },
      ],
    });
    const ids = vault.accounts.map((a) => a.id);
    expect(new Set(ids).size).toBe(2);
    expect(issues.join()).toContain('重复');
  });

  it('groupId 指向不存在的分组时清空', () => {
    const { vault } = normalizeVault({
      version: 1,
      accounts: [{ secret: SECRET, groupId: 'ghost-group' }],
      groups: [],
    });
    expect(vault.accounts[0]?.groupId).toBeNull();
  });

  it('不是对象时返回空保险库而不是抛错', () => {
    expect(normalizeVault(null).vault.accounts).toEqual([]);
    expect(normalizeVault('字符串').issues).toHaveLength(1);
  });

  it('版本比我们新 → 明确拒绝，不试图解析', () => {
    expect(() => normalizeVault({ version: 99, accounts: [] })).toThrow(VaultError);
    try {
      normalizeVault({ version: 99 });
    } catch (error) {
      expect((error as VaultError).reason).toBe('unsupported-version');
    }
  });

  it('未来版本抛带版本号的错误信息', () => {
    try {
      normalizeVault({ version: 7 });
    } catch (error) {
      expect((error as VaultError).message).toContain('7');
    }
  });

  it('迁移骨架：没有 version 的老数据按 v1 收敛并留痕', () => {
    const { vault, issues } = normalizeVault({ accounts: [{ secret: SECRET }] });
    expect(vault.version).toBe(1);
    expect(vault.accounts).toHaveLength(1);
    expect(issues.join()).toContain('迁移');
  });
});

describe('账户增删改', () => {
  it('添加：排序值按间隔递增，密钥归一化成大写', () => {
    let vault = emptyVault();
    vault = addAccount(vault, { issuer: ' 示例 ', account: ' u@example.com ', secret: 'jbswy3dpehpk3pxp' });
    const account = vault.accounts[0];
    expect(account?.issuer).toBe('示例');
    expect(account?.account).toBe('u@example.com');
    expect(account?.secret).toBe(SECRET);
    expect(account?.order).toBe(ORDER_STEP);
    expect(nextOrder(vault.accounts)).toBe(ORDER_STEP * 2);
  });

  it('添加时密钥非法就拒绝，不写入', () => {
    expect(() => addAccount(emptyVault(), { issuer: 'x', account: 'y', secret: 'MZ' })).toThrow(
      VaultError,
    );
  });

  it('修改：只动指定字段，id 与 createdAt 不变', () => {
    const vault = addAccount(emptyVault(), { issuer: '旧', account: 'a', secret: SECRET });
    const id = vault.accounts[0]!.id;
    const createdAt = vault.accounts[0]!.createdAt;
    const updated = updateAccount(vault, id, { issuer: '新', pinned: true });
    expect(updated.accounts[0]?.issuer).toBe('新');
    expect(updated.accounts[0]?.pinned).toBe(true);
    expect(updated.accounts[0]?.id).toBe(id);
    expect(updated.accounts[0]?.createdAt).toBe(createdAt);
  });

  it('修改不存在的账户要报错，而不是静默当作成功', () => {
    expect(() => updateAccount(emptyVault(), 'nope', { issuer: 'x' })).toThrow(VaultError);
  });

  it('删除只影响目标账户', () => {
    let vault = addAccount(emptyVault(), { issuer: 'A', account: 'a', secret: SECRET });
    vault = addAccount(vault, { issuer: 'B', account: 'b', secret: SECRET });
    const target = vault.accounts[0]!.id;
    const after = removeAccount(vault, target);
    expect(after.accounts).toHaveLength(1);
    expect(after.accounts[0]?.issuer).toBe('B');
  });
});

describe('拖拽排序（稀疏 order）', () => {
  const build = (count: number) => {
    let vault = emptyVault();
    for (let i = 0; i < count; i++) {
      vault = addAccount(vault, { issuer: `S${i}`, account: `a${i}`, secret: SECRET });
    }
    return vault;
  };

  it('挪到下一条与上一条之间只改一行', () => {
    const vault = build(3);
    const [first, second, third] = vault.accounts;
    const moved = moveAccount(vault, third!.id, 1);
    const byId = new Map(moved.accounts.map((a) => [a.id, a]));
    // 只有被移动的那条 order 变了，其余原封不动
    expect(byId.get(first!.id)?.order).toBe(first!.order);
    expect(byId.get(second!.id)?.order).toBe(second!.order);
    expect(byId.get(third!.id)?.order).toBeGreaterThan(first!.order);
    expect(byId.get(third!.id)?.order).toBeLessThan(second!.order);
  });

  it('相邻差挤不出空隙时整表重排（间隔 1024）', () => {
    const vault = build(3);
    const [a, b] = vault.accounts;
    // 人为把两条挤到一起，模拟"已插入很多次"
    const squeezed = {
      ...vault,
      accounts: vault.accounts.map((account) => {
        if (account.id === a!.id) return { ...account, order: 1024 };
        if (account.id === b!.id) return { ...account, order: 1025 };
        return account;
      }),
    };
    const moved = moveAccount(squeezed, b!.id, 0);
    const orders = [...moved.accounts].sort((x, y) => x.order - y.order).map((x) => x.order);
    expect(orders).toEqual([ORDER_STEP, ORDER_STEP * 2, ORDER_STEP * 3]);
  });

  it('移动不存在的账户会报错', () => {
    expect(() => moveAccount(build(2), 'missing', 0)).toThrow(VaultError);
  });
});
