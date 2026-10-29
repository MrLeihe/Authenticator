import { describe, expect, it } from 'vitest';
import { DICTIONARIES, listSeparator, resolveLang, translate } from '@/ui/i18n';

/**
 * 文案表的体检。
 *
 * 类型层面已经保证 `en` 不缺键（少一个就编译不过），这里补的是类型看不见的那几件事：
 * 空串、某一句被忘在中文、占位符两边对不上 —— 这三种在编译期全都是合法的。
 */

const KEYS = Object.keys(DICTIONARIES.zh);

/** `{name}` 形式的占位符，取出来排序后比对 */
function placeholders(template: string): string[] {
  return [...template.matchAll(/\{(\w+)\}/g)].map((match) => match[1] ?? '').sort();
}

describe('界面文案表', () => {
  it('中文表是键的全集，没有一条是空串', () => {
    expect(KEYS.length).toBeGreaterThan(100);
    for (const key of KEYS) {
      expect(DICTIONARIES.zh[key]?.trim(), key).not.toBe('');
    }
  });

  it('英文表键集与中文完全一致，且没有空串', () => {
    expect(Object.keys(DICTIONARIES.en).sort()).toEqual([...KEYS].sort());
    for (const key of KEYS) {
      expect(DICTIONARIES.en[key]?.trim(), key).not.toBe('');
    }
  });

  it('英文表里不该残留汉字（漏翻最容易漏成"照抄一遍"）', () => {
    // 语言名永远用它的本族写法：在英文界面里，中文那一项也该写「中文」
    const native = new Set(['language.zh']);
    for (const key of KEYS) {
      if (native.has(key)) continue;
      expect(DICTIONARIES.en[key], key).not.toMatch(/[一-鿿]/);
    }
  });

  it('同一句的占位符两种语言必须一致，否则插值会漏', () => {
    for (const key of KEYS) {
      expect(placeholders(DICTIONARIES.en[key] ?? ''), key).toEqual(
        placeholders(DICTIONARIES.zh[key] ?? ''),
      );
    }
  });

  it('translate 会替换变量，认不出的变量原样留着而不是变成 undefined', () => {
    expect(translate('zh', 'name.dot-joined', { issuer: 'GitHub', account: 'a@b.c' })).toBe(
      'GitHub · a@b.c',
    );
    expect(translate('en', 'name.with-issuer', { issuer: 'GitHub', account: 'a@b.c' })).toBe(
      'GitHub: a@b.c',
    );
    expect(translate('zh', 'delete.confirm')).not.toContain('{');
  });

  it('并列句分隔符跟着语言走', () => {
    expect(listSeparator('zh')).toBe('；');
    expect(listSeparator('en')).toBe('; ');
  });

  it('语言偏好优先，其余情况回落到一个合法值', () => {
    expect(resolveLang('zh')).toBe('zh');
    expect(resolveLang('en')).toBe('en');
    // 'system' 在测试环境里没有 navigator 可用，只要不抛错并给出合法值即可
    expect(['zh', 'en']).toContain(resolveLang('system'));
  });
});
