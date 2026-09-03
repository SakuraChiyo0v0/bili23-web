import { describe, expect, it } from "vitest";
import {
  formatAssTimeByMs,
  formatAssTimeBySeconds,
  formatDateYmd,
  formatSrtTime,
  pyRound,
} from "../src/extras/time.js";

describe("extras/time", () => {
  it("pyRound 对齐 Python round（银行家舍入）", () => {
    expect(pyRound(60.1)).toBe(60);
    expect(pyRound(99.6)).toBe(100);
    expect(pyRound(0.5)).toBe(0); // half-to-even
    expect(pyRound(1.5)).toBe(2);
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(45.3)).toBe(45);
  });

  it("formatSrtTime 对齐 Time.format_srt_time", () => {
    // 期望值来自上游 Python 实现逐例验证
    const cases: Array<[number, string]> = [
      [0.601, "00:00:00,601"],
      [1.0, "00:00:01,000"],
      [59.999, "00:00:59,999"],
      [65.5, "00:01:05,500"],
      [3599.999, "00:59:59,999"],
      [3661.5, "01:01:01,500"],
      [7200.25, "02:00:00,250"],
      [123.4567, "00:02:03,457"],
      [59.9999, "00:01:00,000"],
    ];
    for (const [input, expected] of cases) {
      expect(formatSrtTime(input)).toBe(expected);
    }
  });

  it("formatAssTimeByMs 对齐 Time.format_ass_time_by_ms", () => {
    const cases: Array<[number, string]> = [
      [601, "0:00:00.60"],
      [6996, "0:00:06.99"],
      [95453, "0:01:35.45"],
      [10000, "0:00:10.00"],
      [15000, "0:00:15.00"],
      [3600000, "1:00:00.00"],
      [3661000, "1:01:01.00"],
      [999, "0:00:00.99"],
      [1000, "0:00:01.00"],
      [59999, "0:00:59.99"],
      [1234567, "0:20:34.57"],
    ];
    for (const [input, expected] of cases) {
      expect(formatAssTimeByMs(input)).toBe(expected);
    }
  });

  it("formatAssTimeBySeconds 对齐 Time.format_ass_time_by_seconds", () => {
    const cases: Array<[number, string]> = [
      [0.601, "0:00:00.60"],
      [1.0, "0:00:01.00"],
      [65.5, "0:01:05.50"],
      [3599.999, "1:00:00.00"],
      [3661.5, "1:01:01.50"],
      [59.9999, "0:01:00.00"],
      [123.4567, "0:02:03.46"],
    ];
    for (const [input, expected] of cases) {
      expect(formatAssTimeBySeconds(input)).toBe(expected);
    }
  });

  it("formatDateYmd 输出本地 YYYY-MM-DD", () => {
    const ts = 1586344377;
    const d = new Date(ts * 1000);
    const pad = (n: number): string => String(n).padStart(2, "0");
    const expected = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    expect(formatDateYmd(ts)).toBe(expected);
    const d0 = new Date(0);
    const p0 = (n: number): string => String(n).padStart(2, "0");
    expect(formatDateYmd(0)).toBe(`${d0.getFullYear()}-${p0(d0.getMonth() + 1)}-${p0(d0.getDate())}`);
  });
});
