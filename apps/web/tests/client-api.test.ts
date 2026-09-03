import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "../src/client/api.js";

type FetchMock = ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("client API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends typed parse requests and unwraps results", async () => {
    const fetchMock: FetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ results: [{ type: "space", items: [] }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const api = new ApiClient();
    const results = await api.parse({
      type: "space",
      query: "123456",
      keyword: "测试",
      pn: 2,
      pages: 3,
    });

    expect(results).toEqual([{ type: "space", items: [] }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/parse");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      type: "space",
      query: "123456",
      keyword: "测试",
      pn: 2,
      pages: 3,
    });
  });

  it("creates downloads with the full options snapshot", async () => {
    const fetchMock: FetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ tasks: [], duplicates: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const api = new ApiClient();
    const result = await api.createDownload({
      itemIds: ["video:BV1:p1"],
      force: true,
      options: {
        videoQualityId: 80,
        videoCodecId: 7,
        audioQualityId: 30280,
        container: "mkv",
        extras: { danmaku: { enabled: true, format: "xml" } },
        naming: { conventionType: 11, rule: "{uploader}/{title}", number: 3 },
      },
    });

    expect(result).toEqual({ tasks: [], duplicates: [] });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/download");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      itemIds: ["video:BV1:p1"],
      force: true,
      options: {
        videoQualityId: 80,
        videoCodecId: 7,
        audioQualityId: 30280,
        container: "mkv",
        extras: { danmaku: { enabled: true, format: "xml" } },
        naming: { conventionType: 11, rule: "{uploader}/{title}", number: 3 },
      },
    });
  });

  it("surfaces backend error code and message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ error: { code: "DUPLICATE", message: "以下内容已下载过" } }, 409),
      ),
    );

    const api = new ApiClient();
    await expect(api.createDownload({ itemIds: ["x"] })).rejects.toMatchObject({
      code: "DUPLICATE",
      message: "以下内容已下载过",
      status: 409,
    });
  });
});