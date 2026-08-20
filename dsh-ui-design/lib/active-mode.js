/**
 * 当前激活视图模式(design | slides)的共享状态。
 *
 * host 端在收到某路由的 API 请求时记录「用户当前打开的是哪个视图」
 * (Design 视图走 /dsh-ui-design,PPT 视图走 /dsh-ui-design-ppt);
 * preset 端在每次组装 system-prompt 时读取,按模式注入差异化约束与
 * 自查(review)清单。未记录时返回 null,提示词退化为双项目通用描述。
 * @module @calwang414/dsh-ui-design/active-mode
 */

/** 最近一次被访问的视图模式;从未记录时为 null。 */
let activeMode = null;

/**
 * 记录最近一次被访问的视图模式。
 * @param mode - "design"(普通设计)或 "slides"(演示文稿)。
 */
export function recordActiveMode(mode) {
	activeMode = mode;
}

/**
 * 读取当前激活视图模式。
 * @returns "design" | "slides" | null(尚未记录)。
 */
export function getActiveMode() {
	return activeMode;
}
