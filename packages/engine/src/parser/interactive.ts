import { BiliError } from "../errors.js";
import { wbiSign } from "../api/wbi.js";
import { ensureWbiKeys } from "../media/wbi-keys.js";
import type { MediaItem } from "../types.js";
import type { ParseContext } from "./types.js";

/**
 * 互动视频节点展开器（语义对齐桌面 parser/video.py 的 InteractiveVideoParser）。
 * - 判定：view 接口 rights.is_stein_gate === 1（调用方已确认）
 * - 先取图版本：x/player/wbi/v2（读 data.interaction.graph_version）
 * - 再 BFS 遍历：x/stein/edgeinfo_v2，从 (cid, edge_id=0) 出发，
 *   每个节点含标题（data.title，否则 story_list[0].title）与下一跳选项
 *   （edges.questions[].choices[]，每个 choice 的 id 为 edge_id、cid 为目标节点）
 * - visited 集合按 (cid, edge_id) 去重；每个节点 → 一个可下载叶子（type=video，bvid/cid，interactive=true）
 */

const API_BASE = "https://api.bilibili.com";

/** x/player/wbi/v2 响应（仅声明用到的字段） */
interface GraphResponse {
  code: number;
  message?: string;
  data?: { interaction?: { graph_version?: string } };
}

/** x/stein/edgeinfo_v2 响应（仅声明用到的字段） */
interface EdgeInfoResponse {
  code: number;
  message?: string;
  data?: {
    title?: string;
    story_list?: Array<{ title?: string }>;
    edges?: {
      questions?: Array<{
        type?: number;
        choices?: Array<{ id: number; option?: string; cid?: number }>;
      }>;
    };
  };
}

interface InteractiveViewData {
  bvid: string;
  aid: number;
  cid: number;
  title: string;
  pic: string;
  duration: number;
  pubdate: number;
  desc: string;
  is_upower_exclusive?: boolean;
  owner?: { mid: number; name: string; face: string };
}

/** 反爬参数（与桌面 get_graph_version 完全一致） */
function gaiaParams(extra: Record<string, string | number | boolean>): Record<string, string | number | boolean> {
  return {
    isGaiaAvoided: false,
    web_location: 1315873,
    dm_img_list: "[]",
    dm_img_str: "V2ViR0wgMS4wIChPcGVuR0wgRVMgMi4wIENocm9taXVtKQ",
    dm_cover_img_str:
      "QU5HTEUgKE5WSURJQSwgTlZJRElBIEdlRm9yY2UgUlRYIDQwNjAgTGFwdG9wIEdQVSAoMHgwMDAwMjhFMCkgRGlyZWN0M0QxMSB2c181XzAgcHNfNV8wLCBEM0QxMSlHb29nbGUgSW5jLiAoTlZJRElBKQ",
    dm_img_inter: '{"ds":[],"wh":[3688,4546,12],"of":[119,238,119]}',
    ...extra,
  };
}

/** 取图版本（graph_version），非互动视频或接口失败抛错 */
async function fetchGraphVersion(ctx: ParseContext, aid: number, cid: number): Promise<string> {
  const { imgKey, subKey } = await ensureWbiKeys(ctx);
  const signed = wbiSign(gaiaParams({ aid, cid }), imgKey, subKey);
  const body = await ctx.http.getJSON<GraphResponse>(`${API_BASE}/x/player/wbi/v2`, { params: signed });
  if (body.code !== 0) {
    throw new BiliError("API_ERROR", body.message ?? "获取互动视频图版本失败", { apiCode: body.code });
  }
  const version = body.data?.interaction?.graph_version;
  if (!version) {
    throw new BiliError("API_ERROR", "无法获取 graph_version，可能不是互动视频");
  }
  return version;
}

/** 拉取单个节点信息（标题 + 下一跳选项） */
async function fetchEdgeInfo(
  ctx: ParseContext,
  imgKey: string,
  subKey: string,
  bvid: string,
  graphVersion: string,
  cid: number,
  edgeId: number,
): Promise<NonNullable<EdgeInfoResponse["data"]>> {
  const signed = wbiSign({ bvid, graph_version: graphVersion, edge_id: edgeId }, imgKey, subKey);
  const body = await ctx.http.getJSON<EdgeInfoResponse>(`${API_BASE}/x/stein/edgeinfo_v2`, { params: signed });
  if (body.code !== 0) {
    throw new BiliError("API_ERROR", body.message ?? "获取互动视频节点失败", { apiCode: body.code });
  }
  if (!body.data) {
    throw new BiliError("API_ERROR", "互动视频节点缺少 data");
  }
  return body.data;
}

export async function fetchInteractiveItems(ctx: ParseContext, data: InteractiveViewData): Promise<MediaItem[]> {
  const graphVersion = await fetchGraphVersion(ctx, data.aid, data.cid);
  const { imgKey, subKey } = await ensureWbiKeys(ctx);

  const owner = data.owner ?? { mid: 0, name: "", face: "" };
  const badge = data.is_upower_exclusive ? "充电专属" : "";

  // BFS 状态去重与节点表（节点按 cid 去重；标题首次可能为空，后续补全）
  const pending: Array<{ cid: number; edgeId: number }> = [{ cid: data.cid, edgeId: 0 }];
  const visited = new Set<string>();
  const nodes = new Map<number, { cid: number; title: string }>();

  while (pending.length > 0) {
    const node = pending.shift() as { cid: number; edgeId: number };
    const state = `${node.cid}:${node.edgeId}`;
    if (visited.has(state)) continue;
    visited.add(state);

    const info = await fetchEdgeInfo(ctx, imgKey, subKey, data.bvid, graphVersion, node.cid, node.edgeId);
    const nodeTitle = info.title ?? info.story_list?.[0]?.title ?? "";

    const existing = nodes.get(node.cid);
    if (existing) {
      if (nodeTitle && existing.title !== nodeTitle) existing.title = nodeTitle;
    } else {
      nodes.set(node.cid, { cid: node.cid, title: nodeTitle });
    }

    for (const question of info.edges?.questions ?? []) {
      for (const choice of question.choices ?? []) {
        const targetCid = choice.cid;
        if (targetCid === undefined) continue;
        const nextState = `${targetCid}:${choice.id}`;
        if (!visited.has(nextState)) {
          pending.push({ cid: targetCid, edgeId: choice.id });
        }
      }
    }
  }

  const items: MediaItem[] = [];
  for (const node of nodes.values()) {
    items.push({
      id: `video:${data.bvid}:iv:${node.cid}`,
      type: "video",
      aid: data.aid,
      bvid: data.bvid,
      cid: node.cid,
      page: 1,
      partCount: 1,
      title: node.title || data.title,
      groupTitle: data.title,
      duration: 0,
      badge,
      cover: data.pic,
      pubtime: data.pubdate,
      owner,
      desc: data.desc,
      url: `https://www.bilibili.com/video/${data.bvid}?iv=${node.cid}`,
      interactive: true,
      containerTitle: data.title,
    });
  }
  return items;
}
