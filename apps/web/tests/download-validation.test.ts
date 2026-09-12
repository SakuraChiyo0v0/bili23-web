import { describe, expect, it } from "vitest";
import { validateDownloadForm, type DownloadFormState } from "../src/client/lib/downloadValidation.js";

const base: DownloadFormState = { video: true, audio: true, merge: true, hasExtra: false };
const v = (p: Partial<DownloadFormState>) => validateDownloadForm({ ...base, ...p });

describe("下载选项弹窗的三条校验（原版 dialog.py:60-75 / media.py:92-115）", () => {
  it("什么都没选 → 纯提示（原版 hideCancelButton，标题「未选择任何文件进行下载」）", () => {
    const r = validateDownloadForm({ video: false, audio: false, merge: true, hasExtra: false });
    expect(r.kind).toBe("notice");
    if (r.kind !== "notice") throw new Error("unreachable");
    expect(r.title).toBe("未选择任何文件进行下载");
    expect(r.body).toBe("请至少选择下载独立视频流、音频流或附加文件中的一个。");
  });

  it("只勾了附加文件也算选了内容（不触发提示）", () => {
    expect(validateDownloadForm({ video: false, audio: false, merge: true, hasExtra: true }).kind).toBe("ok");
  });

  it("只下视频不下音频 → 「重要提示」可确认（取消=不继续）", () => {
    const r = v({ audio: false });
    expect(r.kind).toBe("confirm");
    if (r.kind !== "confirm") throw new Error("unreachable");
    expect(r.title).toBe("重要提示");
    expect(r.body).toContain("仅下载视频流将导致视频没有声音");
    expect(r.confirmText).toBe("继续");
    expect(r.cancelText).toBe("取消");
  });

  it("音视频都要但不合并 → 「重要提示」可确认", () => {
    const r = v({ merge: false });
    expect(r.kind).toBe("confirm");
    if (r.kind !== "confirm") throw new Error("unreachable");
    expect(r.body).toContain("将分别下载两个独立文件");
  });

  it("只下音频 / 音视频都下且合并 → 直接通过", () => {
    expect(v({ video: false }).kind).toBe("ok");
    expect(v({}).kind).toBe("ok");
  });

  it("只下视频时的优先级高于「不合并」（两个条件同时成立只提示一次）", () => {
    const r = v({ audio: false, merge: false });
    expect(r.kind).toBe("confirm");
    if (r.kind !== "confirm") throw new Error("unreachable");
    expect(r.body).toContain("没有声音");
  });
});
