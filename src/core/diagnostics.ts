/**
 * 面向用户的诊断信息。
 *
 * `core/` 不产出人话：同一句话是写成中文还是英文，取决于界面语言，
 * 而不是数据层。所以这里只回答"哪件事出了问题、涉及哪一条"，
 * 具体文案表在 `ui/i18n.ts`，由界面在渲染时翻译。
 *
 * 这条边界还有一个现实好处：core 的错误对象里不会有任何用户数据，
 * 也就不存在"把密钥写进日志/截图/错误上报"的可能。
 */
export type Diagnostic =
  // ---- 导入：文件里的某一条账户 ----
  | { code: 'entry-not-object'; index: number }
  | { code: 'entry-bad-secret'; index: number }
  // ---- 导入：一条 otpauth 地址（与 `OtpAuthProblem` 一一对应）----
  | { code: 'uri-not-otpauth' }
  | { code: 'uri-unsupported-type'; value: string }
  | { code: 'uri-missing-secret' }
  | { code: 'uri-bad-secret' }
  | { code: 'uri-bad-algorithm'; value: string }
  | { code: 'uri-bad-digits'; value: string }
  | { code: 'uri-bad-period'; value: string | null }
  // ---- 导入：迁移码里的某一条 ----
  | { code: 'migration-no-secret'; index: number }
  | { code: 'migration-hotp'; index: number; label: string }
  | { code: 'migration-unknown-type'; index: number; label: string; value: string }
  | { code: 'migration-md5'; index: number; label: string };

/** 拼一句纯英文的调试串，只给控制台和测试用，不进界面 */
export function debugText(diagnostic: Diagnostic): string {
  return Object.entries(diagnostic)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
}
