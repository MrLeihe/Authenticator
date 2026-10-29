import { describe, expect, it } from 'vitest';
import {
  ORDER_STEP,
  VaultError,
  addAccount,
  emptyVault,
  reorderAccount,
  setPinned,
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
    const { vault, notes } = normalizeVault(input);
    expect(notes).toEqual([]);
    expect(vault.accounts).toHaveLength(1);
    expect(vault.accounts[0]?.algorithm).toBe('SHA256');
    expect(vault.accounts[0]?.digits).toBe(8);
    expect(vault.settings.view).toBe('compact');
  });

  it('坏账户跳过，好账户照常救回来，并记下跳了哪几个', () => {
    const { vault, notes } = normalizeVault({
      version: 1,
      accounts: [
        { id: 'ok', issuer: '好的', secret: SECRET },
        { id: 'bad', issuer: '坏的', secret: '!!!not-base32!!!' },
        { id: 'empty', issuer: '空的' },
        'not-an-object',
      ],
    });
    expect(vault.accounts.map((a) => a.id)).toEqual(['ok']);
    // 两条读不出来（密钥坏 / 根本不是对象）+ 一条压根没有密钥
    expect(notes).toEqual([
      { code: 'account-bad-secret', index: 1, label: '坏的' },
      { code: 'account-bad-secret', index: 2, label: '空的' },
      { code: 'account-not-object', index: 3 },
    ]);
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
    const { vault, notes } = normalizeVault({
      version: 1,
      accounts: [
        { id: 'dup', secret: SECRET },
        { id: 'dup', secret: SECRET },
      ],
    });
    const ids = vault.accounts.map((a) => a.id);
    expect(new Set(ids).size).toBe(2);
    expect(notes).toContainEqual({ code: 'duplicate-id' });
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
    expect(normalizeVault('字符串').notes).toEqual([{ code: 'not-object' }]);
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
    const { vault, notes } = normalizeVault({ accounts: [{ secret: SECRET }] });
    expect(vault.version).toBe(1);
    expect(vault.accounts).toHaveLength(1);
    expect(notes).toContainEqual({ code: 'migrated', from: 0 });
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

  /** 按界面看到的顺序（置顶优先，其次 order）取 id 列表 */
  const visualIds = (vault: ReturnType<typeof build>) =>
    [...vault.accounts]
      .sort((a, b) => (a.pinned === b.pinned ? a.order - b.order : a.pinned ? -1 : 1))
      .map((a) => a.id);

  it('挪到两条之间只改一行', () => {
    const vault = build(3);
    const [first, second, third] = vault.accounts;
    const moved = reorderAccount(vault, third!.id, second!.id);
    const byId = new Map(moved.accounts.map((a) => [a.id, a]));
    // 只有被移动的那条 order 变了，其余原封不动
    expect(byId.get(first!.id)?.order).toBe(first!.order);
    expect(byId.get(second!.id)?.order).toBe(second!.order);
    expect(byId.get(third!.id)?.order).toBeGreaterThan(first!.order);
    expect(byId.get(third!.id)?.order).toBeLessThan(second!.order);
    expect(visualIds(moved)).toEqual([first!.id, third!.id, second!.id]);
  });

  it('beforeId 为 null 表示放到末尾', () => {
    const vault = build(3);
    const [first, second, third] = vault.accounts;
    const moved = reorderAccount(vault, first!.id, null);
    expect(visualIds(moved)).toEqual([second!.id, third!.id, first!.id]);
  });

  it('插到挤在一起的两条中间时才重排，且只重排这一组（间隔 1024）', () => {
    const vault = build(3);
    const [a, b, c] = vault.accounts;
    // 人为把两条挤到一起，模拟"已插入很多次"
    const squeezed = {
      ...vault,
      accounts: vault.accounts.map((account) => {
        if (account.id === a!.id) return { ...account, order: 1024 };
        if (account.id === b!.id) return { ...account, order: 1025 };
        return account;
      }),
    };
    // c 挤到 a 与 b 之间：1024 与 1025 之间没有整数空隙，只能重排
    const moved = reorderAccount(squeezed, c!.id, b!.id);
    const orders = [...moved.accounts].sort((x, y) => x.order - y.order).map((x) => x.order);
    expect(orders).toEqual([ORDER_STEP, ORDER_STEP * 2, ORDER_STEP * 3]);
    expect(visualIds(moved)).toEqual([a!.id, c!.id, b!.id]);
  });

  it('挪到最前不需要重排，直接往前减一个间隔', () => {
    const vault = build(3);
    const [a, , c] = vault.accounts;
    const moved = reorderAccount(vault, c!.id, a!.id);
    expect(moved.accounts.find((x) => x.id === c!.id)?.order).toBe(0);
  });

  it('拖进置顶区时 pinned 跟着落点走，否则界面会把这一行弹回去', () => {
    const vault = build(3);
    const [first, second, third] = vault.accounts;
    const pinnedVault = setPinned(vault, second!.id, true);
    const moved = reorderAccount(pinnedVault, third!.id, second!.id);
    const byId = new Map(moved.accounts.map((a) => [a.id, a]));
    expect(byId.get(third!.id)?.pinned).toBe(true);
    expect(visualIds(moved)).toEqual([third!.id, second!.id, first!.id]);
  });

  it('拖出置顶区同样取消置顶', () => {
    const vault = build(3);
    const [, second, third] = vault.accounts;
    const pinnedVault = setPinned(vault, second!.id, true);
    const moved = reorderAccount(pinnedVault, second!.id, third!.id);
    const byId = new Map(moved.accounts.map((a) => [a.id, a]));
    expect(byId.get(second!.id)?.pinned).toBe(false);
  });

  it('移动不存在的账户、或落点不存在，都要报错', () => {
    const vault = build(2);
    expect(() => reorderAccount(vault, 'missing', null)).toThrow(VaultError);
    expect(() => reorderAccount(vault, vault.accounts[0]!.id, 'missing')).toThrow(VaultError);
  });

  it('拖到自己前面是空操作', () => {
    const vault = build(2);
    const id = vault.accounts[0]!.id;
    expect(reorderAccount(vault, id, id)).toBe(vault);
  });
});

describe('置顶', () => {
  const build = (count: number) => {
    let vault = emptyVault();
    for (let i = 0; i < count; i++) {
      vault = addAccount(vault, { issuer: `S${i}`, account: `a${i}`, secret: SECRET });
    }
    return vault;
  };

  const visualOrder = (vault: ReturnType<typeof build>) =>
    [...vault.accounts]
      .sort((a, b) => (a.pinned === b.pinned ? a.order - b.order : a.pinned ? -1 : 1))
      .map((a) => a.issuer);

  it('置顶后排到最前，其他项的顺序一动没动', () => {
    const vault = build(3);
    const last = vault.accounts[2]!;
    const pinned = setPinned(vault, last.id, true);
    expect(visualOrder(pinned)).toEqual(['S2', 'S0', 'S1']);
    // 组里本来没有置顶项时 order 不必变：分组本身已经把顺序说清楚了
    expect(pinned.accounts.find((a) => a.id === last.id)?.order).toBe(last.order);
  });

  it('第二个置顶项插到第一个前面，不用整体重排', () => {
    let vault = build(3);
    const [first, second] = vault.accounts;
    vault = setPinned(vault, second!.id, true);
    const pinned = setPinned(vault, first!.id, true);
    const order = (id: string) => pinned.accounts.find((a) => a.id === id)?.order ?? NaN;
    expect(order(first!.id)).toBeLessThan(order(second!.id));
  });

  it('多个置顶项按置顶先后，后来的在上', () => {
    let vault = build(3);
    const [first, second] = vault.accounts;
    vault = setPinned(vault, second!.id, true);
    vault = setPinned(vault, first!.id, true);
    expect(visualOrder(vault)).toEqual(['S0', 'S1', 'S2']);
  });

  it('取消置顶落到非置顶区最前', () => {
    let vault = build(3);
    const [first, second, third] = vault.accounts;
    vault = setPinned(vault, third!.id, true);
    vault = setPinned(vault, third!.id, false);
    expect(visualOrder(vault)).toEqual(['S2', 'S0', 'S1']);
    expect(vault.accounts.find((a) => a.id === second!.id)?.pinned).toBe(false);
    expect(vault.accounts.find((a) => a.id === first!.id)?.pinned).toBe(false);
  });

  it('状态没变时原样返回，不产生新对象', () => {
    const vault = build(1);
    expect(setPinned(vault, vault.accounts[0]!.id, false)).toBe(vault);
  });

  it('找不到账户要报错', () => {
    expect(() => setPinned(build(1), 'missing', true)).toThrow(VaultError);
  });
});
