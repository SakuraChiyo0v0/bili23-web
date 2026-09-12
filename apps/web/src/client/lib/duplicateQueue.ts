/**
 * 重复项「逐条询问」的推进逻辑（原版 `duplicate_download.py` + `task/manager.py:561-571`）。
 *
 * 抽成纯函数是为了能单测：这段语义（勾"不再询问"后是**把剩下的按同一决定批量处理**，
 * 而不是重新问一遍）是最容易被写错的地方，而它藏在 React 组件里没法直接测。
 */
export interface DuplicateItem {
  itemId: string;
  title: string;
}

export interface DuplicateStep {
  /** 本次要强制建任务的 id（原版「继续下载」） */
  force: string[];
  /** 本次要跳过的 id（原版「跳过下载」） */
  skip: string[];
  /** 勾了「不再询问」时要写回的全局策略（原版 `config.set(duplicate_download_resolution, …)`） */
  policy?: "force" | "skip";
  /** 还没处理的队列（原版下一条会再弹一次） */
  rest: DuplicateItem[];
  /** 是否整队处理完毕（问完就该关掉两个弹窗） */
  done: boolean;
}

export function stepDuplicates(
  queue: DuplicateItem[],
  continueDownload: boolean,
  neverAsk: boolean,
): DuplicateStep {
  const [head, ...rest] = queue;
  if (!head) return { force: [], skip: [], rest: [], done: true };

  // 勾了「不再询问」：本条 + 剩下全部按同一决定处理，并写回全局策略
  if (neverAsk) {
    const ids = [head.itemId, ...rest.map((d) => d.itemId)];
    return {
      force: continueDownload ? ids : [],
      skip: continueDownload ? [] : ids,
      policy: continueDownload ? "force" : "skip",
      rest: [],
      done: true,
    };
  }

  return {
    force: continueDownload ? [head.itemId] : [],
    skip: continueDownload ? [] : [head.itemId],
    rest,
    done: rest.length === 0,
  };
}
