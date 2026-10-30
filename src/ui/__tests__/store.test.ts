import { beforeEach, describe, expect, it } from 'vitest';
import type { Vault } from '@/core/types';
import { backupKey, local } from '@/platform/storage';
import { initializeVault, resetAll, today } from '@/platform/vault-service';
import { useAppStore } from '../store';

/**
 * `mutate` 里有一个写错了也不会报错的分支：自动备份要不要看设置。
 *
 * 漏看设置时用户的感受是"我明明关掉了自动备份"，而实际上每天还在往
 * storage.local 里写一份完整账户快照 —— 既费空间，也让"关掉了"这句话变成假的。
 * 所以这里盯的不是备份产不产得出来，而是**关掉之后确实一份都不再产**。
 */

const backupKeys = async () => (await local.keys()).filter((key) => key.startsWith('2fa:backup:'));

/** 建一个免密库：`initializeVault` 会把 DEK 放回内存，后续 saveVault 才写得了盘 */
async function unlockedVault(): Promise<Vault> {
  const { vault } = await initializeVault();
  return vault;
}

beforeEach(async () => {
  await resetAll();
  useAppStore.setState({ phase: 'unlocked', vault: null, sheet: null, notice: null });
});

describe('mutate 的自动备份', () => {
  it('默认开启时，当天第一次改动写一份快照', async () => {
    useAppStore.setState({ vault: await unlockedVault() });

    await useAppStore.getState().mutate((current) => current);

    expect(await local.get(backupKey(today()))).toBeDefined();
  });

  it('关掉之后不再写新快照', async () => {
    const vault = await unlockedVault();
    useAppStore.setState({
      vault: { ...vault, settings: { ...vault.settings, autoBackup: false } },
    });

    await useAppStore.getState().mutate((current) => current);

    expect(await backupKeys()).toEqual([]);
  });

  it('关掉开关不会顺手删掉已有的快照', async () => {
    useAppStore.setState({ vault: await unlockedVault() });
    await useAppStore.getState().mutate((current) => current);
    const before = await backupKeys();
    expect(before).toHaveLength(1);

    const current = useAppStore.getState().vault;
    if (!current) throw new Error('vault missing');
    useAppStore.setState({
      vault: { ...current, settings: { ...current.settings, autoBackup: false } },
    });
    await useAppStore.getState().mutate((v) => v);

    // 关开关是"不再产生"，不是"清理"。删旧快照会让"昨天还好的"变成无路可退
    expect(await backupKeys()).toEqual(before);
  });
});
