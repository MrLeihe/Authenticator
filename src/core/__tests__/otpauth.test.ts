import { describe, expect, it } from 'vitest';
import { findOtpauthUris, OtpAuthError, parseOtpauth } from '../otpauth';

/** 只用 RFC / 公开文档里的合成密钥，真实账户的 secret 不许进测试 */
const SECRET = 'JBSWY3DPEHPK3PXP';

function problem(uri: string): string {
  try {
    parseOtpauth(uri);
  } catch (error) {
    return error instanceof OtpAuthError ? error.problem : 'not-an-otpauth-error';
  }
  return 'no-error';
}

describe('parseOtpauth 正常输入', () => {
  it('解析完整参数', () => {
    const parsed = parseOtpauth(
      `otpauth://totp/ACME%20Co:john@example.com?secret=${SECRET}&issuer=ACME%20Co&algorithm=SHA256&digits=8&period=60`,
    );
    expect(parsed).toEqual({
      issuer: 'ACME Co',
      account: 'john@example.com',
      secret: SECRET,
      algorithm: 'SHA256',
      digits: 8,
      period: 60,
    });
  });

  it('省略算法/位数/周期时用默认值', () => {
    const parsed = parseOtpauth(`otpauth://totp/acme?secret=${SECRET}`);
    expect(parsed).toMatchObject({ algorithm: 'SHA1', digits: 6, period: 30 });
  });

  it('label 里没有冒号时 issuer 为空、account 是整段', () => {
    const parsed = parseOtpauth(`otpauth://totp/alice@example.com?secret=${SECRET}`);
    expect(parsed.issuer).toBe('');
    expect(parsed.account).toBe('alice@example.com');
  });

  it('issuer 参数优先于 label 前缀', () => {
    const parsed = parseOtpauth(`otpauth://totp/Old:alice?secret=${SECRET}&issuer=New`);
    expect(parsed.issuer).toBe('New');
    expect(parsed.account).toBe('alice');
  });

  it('label 里多个冒号时按第一个切分', () => {
    const parsed = parseOtpauth(`otpauth://totp/Corp:EU:alice?secret=${SECRET}`);
    expect(parsed).toMatchObject({ issuer: 'Corp', account: 'EU:alice' });
  });

  it('只接受 issuer：account 形式里冒号被编码成 %3A', () => {
    const parsed = parseOtpauth(`otpauth://totp/ACME%3Aalice?secret=${SECRET}`);
    expect(parsed).toMatchObject({ issuer: 'ACME', account: 'alice' });
  });

  it('协议名与类型大小写不敏感', () => {
    const parsed = parseOtpauth(`OTPAUTH://TOTP/alice?secret=${SECRET}`);
    expect(parsed.account).toBe('alice');
  });

  it('query 里的 + 当空格处理', () => {
    const parsed = parseOtpauth(`otpauth://totp/alice?secret=${SECRET}&issuer=ACME+Co`);
    expect(parsed).toMatchObject({ issuer: 'ACME Co', account: 'alice' });
  });

  it('path 里的 + 保持字面量（RFC 3986 里 path 的 + 不是空格）', () => {
    const parsed = parseOtpauth(`otpauth://totp/C++:alice?secret=${SECRET}`);
    expect(parsed).toMatchObject({ issuer: 'C++', account: 'alice' });
  });

  it('密钥里的空格与连字符会被去掉，并统一成大写', () => {
    const parsed = parseOtpauth(`otpauth://totp/a?secret=jbswy3dp-ehpk-3pxp`);
    expect(parsed.secret).toBe(SECRET);
  });

  it('前后有空白也能解析', () => {
    expect(parseOtpauth(`  otpauth://totp/a?secret=${SECRET}\n`).secret).toBe(SECRET);
  });

  it('参数键大小写不敏感，重复参数取第一个', () => {
    const parsed = parseOtpauth(
      `otpauth://totp/a?SECRET=${SECRET}&ISSuer=Acme&issuer=Other`,
    );
    expect(parsed).toMatchObject({ issuer: 'Acme', secret: SECRET });
  });

  it('没有 label 时 issuer 与 account 都是空串', () => {
    expect(parseOtpauth(`otpauth://totp/?secret=${SECRET}`)).toMatchObject({
      issuer: '',
      account: '',
    });
  });

  it('坏掉的百分号转义不会让解析整体失败', () => {
    const parsed = parseOtpauth(`otpauth://totp/ACME%ZZ:alice?secret=${SECRET}`);
    expect(parsed.account).toBe('alice');
    expect(parsed.issuer.length).toBeGreaterThan(0);
  });
});

describe('parseOtpauth 畸形输入', () => {
  it('不是 otpauth 地址', () => {
    expect(problem('https://example.com/totp?secret=' + SECRET)).toBe('not-otpauth');
    expect(problem('totp://acme?secret=' + SECRET)).toBe('not-otpauth');
    expect(problem('')).toBe('not-otpauth');
  });

  it('HOTP 明确拒绝，而不是当成 TOTP 算', () => {
    expect(problem(`otpauth://hotp/a?secret=${SECRET}&counter=1`)).toBe('unsupported-type');
  });

  it('类型为空', () => {
    expect(problem(`otpauth:///a?secret=${SECRET}`)).toBe('unsupported-type');
  });

  it('缺 secret', () => {
    expect(problem('otpauth://totp/a?issuer=Acme')).toBe('missing-secret');
    expect(problem('otpauth://totp/a?secret=')).toBe('missing-secret');
  });

  it('secret 不是 base32', () => {
    expect(problem('otpauth://totp/a?secret=JBSWY3DPEHPK3PX1')).toBe('bad-secret');
    // MZ 是非规范的尾部编码（残留位不是 0），按截断处理
    expect(problem('otpauth://totp/a?secret=MZ')).toBe('bad-secret');
  });

  it('位数只接受 6 和 8', () => {
    expect(problem(`otpauth://totp/a?secret=${SECRET}&digits=7`)).toBe('bad-digits');
    expect(problem(`otpauth://totp/a?secret=${SECRET}&digits=six`)).toBe('bad-digits');
  });

  it('周期必须是 1..3600 的整数秒', () => {
    expect(problem(`otpauth://totp/a?secret=${SECRET}&period=0`)).toBe('bad-period');
    expect(problem(`otpauth://totp/a?secret=${SECRET}&period=30s`)).toBe('bad-period');
    expect(problem(`otpauth://totp/a?secret=${SECRET}&period=99999`)).toBe('bad-period');
  });

  it('只支持 SHA1 / SHA256 / SHA512', () => {
    expect(problem(`otpauth://totp/a?secret=${SECRET}&algorithm=MD5`)).toBe('bad-algorithm');
  });

  it('超长内容直接拒绝', () => {
    expect(problem(`otpauth://totp/a?secret=${SECRET}&x=${'a'.repeat(5000)}`)).toBe('not-otpauth');
  });

  it('报错信息里不回显密钥', () => {
    try {
      parseOtpauth('otpauth://totp/a?secret=THIS-IS-NOT-BASE32-1');
      throw new Error('应当抛错');
    } catch (error) {
      expect(error).toBeInstanceOf(OtpAuthError);
      expect(String((error as Error).message)).not.toContain('THIS');
    }
  });
});

describe('findOtpauthUris', () => {
  it('从夹杂着别的话的文本里挑出地址', () => {
    const text = `扫到了：otpauth://totp/ACME:alice?secret=${SECRET} 就这样`;
    expect(findOtpauthUris(text)).toEqual([`otpauth://totp/ACME:alice?secret=${SECRET}`]);
  });

  it('去掉句末标点', () => {
    expect(findOtpauthUris(`(otpauth://totp/a?secret=${SECRET}).`)).toEqual([
      `otpauth://totp/a?secret=${SECRET}`,
    ]);
  });

  it('一条文本里有多条就都取出来，顺序保持原样', () => {
    const text = `otpauth://totp/a?secret=${SECRET}\notpauth://totp/b?secret=${SECRET}`;
    expect(findOtpauthUris(text)).toHaveLength(2);
  });

  it('没有就是空数组', () => {
    expect(findOtpauthUris('这只是一段普通文字')).toEqual([]);
    expect(findOtpauthUris('otpauth://')).toEqual([]);
  });
});
