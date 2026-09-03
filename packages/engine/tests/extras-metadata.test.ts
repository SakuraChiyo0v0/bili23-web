import { describe, expect, it } from "vitest";
import { buildMetadataNfo } from "../src/extras/metadata-nfo.js";
import { buildMetadataJson } from "../src/extras/metadata-json.js";
import type { MetadataInput } from "../src/extras/types.js";

function ymd(ts: number): string {
  const d = new Date(ts * 1000);
  const p = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
function year(ts: number): string {
  return String(new Date(ts * 1000).getFullYear());
}

const VIDEO: MetadataInput = {
  kind: "video",
  showTitle: "Sample Video",
  description: "Sample description",
  durationSec: 305,
  pubtime: 1586344377,
  cover: "https://i0.hdslb.com/bfs/cover.jpg",
  owner: { mid: 123, name: "Uploader", face: "https://i0.hdslb.com/bfs/face.jpg" },
  bvid: "BV1xx411c7mD",
  tags: ["tag-a", "tag-b"],
};

const BANGUMI: MetadataInput = {
  kind: "bangumi",
  showTitle: "第1话",
  description: "季简介",
  durationSec: 1500,
  pubtime: 1600000000,
  premiered: 1580000000,
  cover: "https://i0.hdslb.com/bfs/ep-cover.jpg",
  poster: "https://i0.hdslb.com/bfs/poster.jpg",
  owner: { mid: 456, name: "Studio", face: "" },
  bvid: "BV1xx411c7mD",
  seasonId: 28276,
  epId: 399341,
  episodeNumber: 1,
  seasonTitle: "Sample Season",
  episodeTitle: "第1话",
  genres: ["Action"],
  areas: ["Japan"],
  rating: 9.5,
  ratingVotes: 1000,
  newEpStatus: true,
};

describe("metadata-nfo", () => {
  it("video → movie.nfo（限定词 Metadata，含 tag 块）", () => {
    const outputs = buildMetadataNfo(VIDEO, "stem-name");
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.name).toBe("stem-name");
    expect(outputs[0]?.qualifier).toEqual(["Metadata"]);
    const expected = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      "<movie>",
      "    <title>Sample Video</title>",
      "    <plot>Sample description</plot>",
      "    <runtime>6</runtime>",
      `    <premiered>${ymd(VIDEO.pubtime ?? 0)}</premiered>`,
      `    <year>${year(VIDEO.pubtime ?? 0)}</year>`,
      "    <actor>",
      "        <name>Uploader</name>",
      "        <role>UP主</role>",
      "        <profile>https://space.bilibili.com/123</profile>",
      "        <thumb>https://i0.hdslb.com/bfs/face.jpg</thumb>",
      "    </actor>",
      "    <tag>tag-a</tag>",
      "    <tag>tag-b</tag>",
      "    <thumb>https://i0.hdslb.com/bfs/cover.jpg</thumb>",
      '    <uniqueid type="bvid">BV1xx411c7mD</uniqueid>',
      "</movie>",
    ].join("\n");
    expect(outputs[0]?.contents).toBe(expected);
  });

  it("video 无 tag → 不输出空 tag 行", () => {
    const outputs = buildMetadataNfo({ ...VIDEO, tags: [] }, "s");
    expect(outputs[0]?.contents).not.toContain("<tag>");
    expect(outputs[0]?.contents).not.toMatch(/\n\s*\n/);
  });

  it("bangumi → tvshow.nfo + episodedetails.nfo", () => {
    const outputs = buildMetadataNfo(BANGUMI, "第1话");
    expect(outputs.map((o) => o.name)).toEqual(["tvshow", "第1话"]);
    const tv = outputs[0]?.contents ?? "";
    expect(tv).toContain("<tvshow>");
    expect(tv).toContain("    <title>Sample Season</title>");
    expect(tv).toContain("    <studio>Bilibili</studio>");
    expect(tv).toContain("    <genre>Action</genre>");
    expect(tv).toContain("    <country>Japan</country>");
    expect(tv).toContain("    <status>Ongoing</status>");
    expect(tv).toContain("    <rating>9.5</rating>");
    expect(tv).toContain("            <value>9.5</value>");
    expect(tv).toContain("            <votes>1000</votes>");
    expect(tv).toContain('    <thumb aspect="poster">https://i0.hdslb.com/bfs/poster.jpg</thumb>');
    expect(tv).toContain('    <uniqueid type="season_id">28276</uniqueid>');
    const ep = outputs[1]?.contents ?? "";
    expect(ep).toContain("<episodedetails>");
    expect(ep).toContain("    <title>第1话</title>");
    expect(ep).toContain("    <runtime>25</runtime>");
    expect(ep).toContain("    <episode>1</episode>");
    expect(ep).toContain('    <uniqueid type="ep_id">399341</uniqueid>');
  });

  it("includeTvshow=false 时只生成剧集 nfo（已存在 tvshow.nfo 场景）", () => {
    const outputs = buildMetadataNfo(BANGUMI, "ep", false);
    expect(outputs.map((o) => o.name)).toEqual(["ep"]);
  });

  it("无评分/无 genres → 省略对应块；未完结 → Ended", () => {
    const noRating = { ...BANGUMI, genres: [], newEpStatus: false };
    delete noRating.rating;
    const outputs = buildMetadataNfo(noRating, "ep");
    const tv = outputs[0]?.contents ?? "";
    expect(tv).not.toContain("<rating>");
    expect(tv).not.toContain("<genre>");
    expect(tv).toContain("<status>Ended</status>");
  });
});

describe("metadata-json", () => {
  it("输出过滤空值后的 JSON（indent=2）", () => {
    const out = buildMetadataJson({
      ...VIDEO,
      cover: "",
      tags: [],
    });
    const parsed = JSON.parse(out) as Record<string, unknown>;
    expect(parsed.cover).toBeUndefined();
    expect(parsed.tags).toBeUndefined();
    expect(parsed.kind).toBe("video");
    expect(parsed.title ?? parsed.showTitle).toBe("Sample Video");
    expect(out.startsWith("{\n  ")).toBe(true);
  });
});
