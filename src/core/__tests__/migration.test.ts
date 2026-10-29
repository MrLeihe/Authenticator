import { describe, expect, it } from 'vitest';
import { base32Decode } from '../base32';
import { MigrationError, isMigrationUri, parseMigrationUri } from '../migration';

/**
 * 迁移载荷是 protobuf，这里用一个二十行的小编码器在测试里**现搓**一份，
 * 不引入第三方库、也不带任何真实账户 —— 密钥用的是 RFC 4648 的公开示例。
 */

function varint(value: number): number[] {
  const out: number[] = [];
  let rest = value;
  while (rest > 0x7f) {
    out.push((rest & 0x7f) | 0x80);
    rest = Math.floor(rest / 128);
  }
  out.push(rest);
  return out;
}

function tag(field: number, wire: number): number[] {
  return varint(field * 8 + wire);
}

function bytesField(field: number, bytes: number[]): number[] {
  return [...tag(field, 2), ...varint(bytes.length), ...bytes];
}

function varintField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)];
}

const utf8 = (text: string) => [...new TextEncoder().encode(text)];

interface OtpOptions {
  secret: string;
  name?: string;
  issuer?: string;
  /** 1 = SHA1, 2 = SHA256, 3 = SHA512, 4 = MD5 */
  algorithm?: number;
  /** 1 = 六位, 2 = 八位 */
  digits?: number;
  /** 1 = HOTP, 2 = TOTP */
  type?: number;
}

function otpParams(options: OtpOptions): number[] {
  const out: number[] = [...bytesField(1, [...base32Decode(options.secret)])];
  if (options.name) out.push(...bytesField(2, utf8(options.name)));
  if (options.issuer) out.push(...bytesField(3, utf8(options.issuer)));
  out.push(...varintField(4, options.algorithm ?? 1));
  out.push(...varintField(5, options.digits ?? 1));
  out.push(...varintField(6, options.type ?? 2));
  return out;
}

function migrationUri(options: {
  items: number[][];
  version?: number;
  batchSize?: number;
  batchIndex?: number;
}): string {
  const bytes = options.items.flatMap((item) => bytesField(1, item));
  bytes.push(...varintField(2, options.version ?? 1));
  if (options.batchSize) bytes.push(...varintField(3, options.batchSize));
  if (options.batchIndex !== undefined) bytes.push(...varintField(4, options.batchIndex));
  const base64 = btoa(String.fromCharCode(...bytes));
  return `otpauth-migration://offline?data=${encodeURIComponent(base64)}`;
}

const RFC_SECRET = 'JBSWY3DPEHPK3PXP';
const RFC_SECRET_2 = 'GEZDGNBVGY3TQOJQ';

describe('迁移码 · 正常路径', () => {
  it('两条 TOTP 全部读出来，算法与位数都按枚举还原', () => {
    const uri = migrationUri({
      items: [
        otpParams({ secret: RFC_SECRET, name: 'alice@example.com', issuer: '示例站点' }),
        otpParams({ secret: RFC_SECRET_2, name: 'bob@example.com', algorithm: 2, digits: 2 }),
      ],
    });
    const result = parseMigrationUri(uri);
    expect(result?.accounts).toEqual([
      {
        issuer: '示例站点',
        account: 'alice@example.com',
        secret: RFC_SECRET,
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
      },
      {
        issuer: '',
        account: 'bob@example.com',
        secret: RFC_SECRET_2,
        algorithm: 'SHA256',
        digits: 8,
        period: 30,
      },
    ]);
    expect(result?.issues).toEqual([]);
    expect(result?.batch).toBeNull();
  });

  it('issuer 只写在 name 前缀里时也能切出来', () => {
    const uri = migrationUri({ items: [otpParams({ secret: RFC_SECRET, name: '示例站点:alice' })] });
    const result = parseMigrationUri(uri);
    expect(result?.accounts[0]?.issuer).toBe('示例站点');
    expect(result?.accounts[0]?.account).toBe('alice');
  });

  it('issuer 字段与 name 前缀重复时不重复拼接', () => {
    const uri = migrationUri({
      items: [otpParams({ secret: RFC_SECRET, name: '示例站点:alice', issuer: '示例站点' })],
    });
    const result = parseMigrationUri(uri);
    expect(result?.accounts[0]).toMatchObject({ issuer: '示例站点', account: 'alice' });
  });

  it('分批导出时如实报告这是第几张', () => {
    const uri = migrationUri({
      items: [otpParams({ secret: RFC_SECRET, name: 'a' })],
      batchSize: 3,
      batchIndex: 1,
    });
    expect(parseMigrationUri(uri)?.batch).toEqual({ index: 1, size: 3 });
  });

  it('URL-safe base64 与缺 padding 都容错', () => {
    const standard = migrationUri({ items: [otpParams({ secret: RFC_SECRET, name: 'a' })] });
    const data = decodeURIComponent(standard.split('data=')[1]!);
    const lax = data.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    expect(parseMigrationUri(`otpauth-migration://offline?data=${lax}`)?.accounts).toHaveLength(1);
  });
});

describe('迁移码 · 必须跳过的条目', () => {
  it('HOTP 跳过并说明原因', () => {
    const uri = migrationUri({
      items: [
        otpParams({ secret: RFC_SECRET, name: 'counter', type: 1 }),
        otpParams({ secret: RFC_SECRET_2, name: 'time', type: 2 }),
      ],
    });
    const result = parseMigrationUri(uri);
    expect(result?.accounts).toHaveLength(1);
    // 断言原因码而不是句子：句子是界面的事，数据层只报"哪一条、为什么"
    expect(result?.issues[0]).toEqual({ code: 'migration-hotp', index: 0, label: 'counter' });
  });

  it('MD5 跳过', () => {
    const uri = migrationUri({ items: [otpParams({ secret: RFC_SECRET, name: 'md5', algorithm: 4 })] });
    const result = parseMigrationUri(uri);
    expect(result?.accounts).toHaveLength(0);
    expect(result?.issues[0]).toEqual({ code: 'migration-md5', index: 0, label: 'md5' });
  });

  it('一条都没有密钥时报错，而不是返回一个空列表', () => {
    const empty = migrationUri({ items: [] });
    expect(() => parseMigrationUri(empty)).toThrow(MigrationError);
  });
});

describe('迁移码 · 失败路径', () => {
  it('不是迁移地址时返回 null，交给别的格式去试', () => {
    expect(isMigrationUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP')).toBe(false);
    expect(parseMigrationUri('otpauth://totp/a?secret=JBSWY3DPEHPK3PXP')).toBeNull();
  });

  it('没有 data 参数 → malformed', () => {
    expect(() => parseMigrationUri('otpauth-migration://offline')).toThrow(MigrationError);
    try {
      parseMigrationUri('otpauth-migration://offline');
    } catch (error) {
      expect((error as MigrationError).reason).toBe('malformed');
    }
  });

  it('data 不是 base64 → malformed', () => {
    expect(() => parseMigrationUri('otpauth-migration://offline?data=%21%21%21')).toThrow(
      MigrationError,
    );
  });

  it('版本比我们新 → unsupported-version', () => {
    const uri = migrationUri({ items: [otpParams({ secret: RFC_SECRET, name: 'a' })], version: 3 });
    try {
      parseMigrationUri(uri);
      throw new Error('不该走到这里');
    } catch (error) {
      expect((error as MigrationError).reason).toBe('unsupported-version');
    }
  });
});
