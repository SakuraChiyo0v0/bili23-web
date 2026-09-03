/**
 * 下载编号分配（对齐桌面 download/task/manager.py `__get_number` + config.numbering_type）：
 * - FROM_SPECIFIED(0)：从起始号开始，每任务自增 1
 * - USE_PARSE_LIST(1)：使用解析列表序号（调用方传入的 parseNumber）
 * - CONTINUOUS(2)（默认）：连续编号，从起始号开始每任务自增 1
 * 桌面把这两个自增计数器放在内存（每次启动从起始值开始），web 同语义：
 * 计数起点来自 config.json startingNumber，运行期在任务管理器内串行推进。
 */

export const NumberingType = {
  FROM_SPECIFIED: 0,
  USE_PARSE_LIST: 1,
  CONTINUOUS: 2,
} as const;

export type NumberingTypeId = (typeof NumberingType)[keyof typeof NumberingType];

/** 纯函数取号：返回本任务编号与下一个连续号 */
export function allocNumber(
  type: NumberingTypeId,
  opts: { current: number; parseNumber?: number },
): { number: number | ""; next: number } {
  switch (type) {
    case NumberingType.USE_PARSE_LIST:
      if (opts.parseNumber !== undefined && Number.isFinite(opts.parseNumber)) {
        return { number: opts.parseNumber, next: opts.current };
      }
      return { number: "", next: opts.current };
    case NumberingType.FROM_SPECIFIED:
    case NumberingType.CONTINUOUS:
    default:
      return { number: opts.current, next: opts.current + 1 };
  }
}

/** 串行编号分配器（任务管理器持有单例；批量创建逐条 alloc） */
export class NumberingAllocator {
  #type: NumberingTypeId;
  #current: number;

  constructor(type: NumberingTypeId, startNumber: number) {
    this.#type = type;
    this.#current = startNumber > 0 ? Math.trunc(startNumber) : 1;
  }

  /** 取下一个编号（USE_PARSE_LIST 时使用 parseNumber；返回 "" 表示无编号） */
  alloc(parseNumber?: number): number | "" {
    const { number, next } = allocNumber(this.#type, {
      current: this.#current,
      ...(parseNumber !== undefined ? { parseNumber } : {}),
    });
    this.#current = next;
    return number;
  }
}
