window.__ModuleLoader__.load({
	id: "@calwang414/dsh-ui-design",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
		function isDesignStudioHostMessage(value) {
			if (!value || typeof value !== "object") return false;
			if (Reflect.get(value, "channel") !== "dsh-ui-design-studio-host-v1") return false;
			if (Reflect.get(value, "type") !== "ask-ai") return false;
			const request = Reflect.get(value, "request");
			if (!request || typeof request !== "object") return false;
			const target = Reflect.get(request, "target");
			return typeof Reflect.get(request, "id") === "string" && typeof Reflect.get(request, "sessionId") === "string" && typeof Reflect.get(request, "workspaceId") === "string" && typeof Reflect.get(request, "filePath") === "string" && Boolean(target) && typeof target === "object" && typeof Reflect.get(target, "locator") === "string" && typeof Reflect.get(target, "label") === "string";
		}
		function designStudioAskAiPrompt(request) {
			const target = request.target;
			const summary = [
				target.text ? `Text: ${target.text.slice(0, 240)}` : "",
				target.alt ? `Alt: ${target.alt.slice(0, 240)}` : "",
				target.src ? `Source: ${target.src.slice(0, 240)}` : ""
			].filter(Boolean);
			return [
				"Help me edit the selected element in dsh-ui-design Design Studio.",
				`File: ${request.filePath}`,
				`Element: ${target.label}`,
				`CSS locator: ${target.locator}`,
				...summary,
				"Read the current file before editing. Change only this element unless I explicitly request a wider redesign, preserve unrelated structure and styles, and keep the linked design-tokens.css theme contract.",
				"My requested change:"
			].join("\n");
		}
		//#endregion
		//#region src/client.tsx
		const inject = ["slots", "sessions"];
		const DESIGN_PRESET_ID = "dsh-ui-design";
		function createDeepSeekDesignStudioClient(options) {
			function buildThumbDoc(html, tokensCss) {
				let doc = String(html ?? "");
				doc = doc.replace(/<link\b[^>]*>/gi, (tag) => {
					if (/design-tokens\.css/i.test(tag) && tokensCss) return `<style>${tokensCss}</style>`;
					return "";
				});
				return doc;
			}
			function TemplateCard({ template, token, workspaceId, onApply }) {
				const [cover, setCover] = react.useState(null);
				react.useEffect(() => {
					let disposed = false;
					let url = null;
					const load = async () => {
						if (!token || !workspaceId) return;
						try {
							const response = await window.fetch(`${options.routeRoot}/api/template-cover?workspaceId=${encodeURIComponent(String(workspaceId))}&templateId=${encodeURIComponent(String(template.id))}`, {
								headers: { "x-dsh-ui-design-token": token }
							});
							if (!response.ok) return;
							const blob = await response.blob();
							url = URL.createObjectURL(blob);
							if (!disposed) setCover(url);
						} catch {
							// 封面加载失败时显示占位。
						}
					};
					void load();
					return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
				}, [token, workspaceId, template.id]);
				return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
					type: "button",
					style: pickerCardStyle,
					onClick: onApply,
					title: template.title,
					children: [
						cover ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("img", { src: cover, style: pickerCoverStyle, alt: "" }) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: pickerCoverPlaceholderStyle }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { style: pickerCardTitleStyle, children: template.title }),
						/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: pickerCardDescStyle, children: template.description ?? "" })
					]
				});
			}

			function StudioView({ sessionId, useWorkspaces, inputActions, sessions }) {
				const iframeRef = react.useRef(null);
				const [reloadKey, setReloadKey] = react.useState(0);
				const [pageModel, setPageModel] = react.useState(null);
				const list = react.useSyncExternalStore(
					(fn) => sessions?.list.subscribe(fn) ?? (() => {}),
					() => sessions?.list.getSnapshot() ?? null
				);
				const summary = list?.byId?.[sessionId];
				const isDesignMode = summary?.agentPreset === DESIGN_PRESET_ID;
				const workspace = useWorkspaces((state) => state.items.find((item) => item.sessionIds.includes(sessionId)));
				react.useEffect(() => {
					const receive = (event) => {
						if (event.origin !== window.location.origin || event.source !== iframeRef.current?.contentWindow) return;
						if (!isDesignStudioHostMessage(event.data)) return;
						inputActions.setDraft(designStudioAskAiPrompt(event.data.request));
					};
					window.addEventListener("message", receive);
					return () => window.removeEventListener("message", receive);
				}, [inputActions]);
				const workspaceId = workspace?.workspaceId;
				react.useEffect(() => {
					// 只在设计模式会话中拉取/播种项目:非设计模式会话不得触发
					// /api/session(那会在其工作区创建 design 目录)。
					if (!workspaceId || !isDesignMode) return undefined;
					let disposed = false;
					const load = async () => {
						try {
							const html = await window.fetch(`${options.routeRoot}/studio/`).then((response) => response.text());
							const token = html.match(/__DSH_UI_DESIGN_STUDIO_TOKEN__ = "([^"]+)"/)?.[1];
							if (!token) return;
							const response = await window.fetch(`${options.routeRoot}/api/session?workspaceId=${encodeURIComponent(String(workspaceId))}&sessionId=${encodeURIComponent(String(sessionId))}`, {
								headers: { "x-dsh-ui-design-token": token }
							});
							if (!response.ok) return;
							const sessionState = await response.json();
							if (disposed) return;
							setPageModel({ token, pages: sessionState.state.pages ?? [], active: sessionState.state.entry });
						} catch {
							// 切换器不可用时静默降级:Studio 本身不依赖它。
						}
					};
					void load();
					return () => { disposed = true; };
				}, [workspaceId, sessionId, reloadKey, options.routeRoot, isDesignMode]);
				const pageApi = async (payload) => {
					if (!pageModel?.token || !workspaceId) return;
					try {
						await window.fetch(`${options.routeRoot}/api/page`, {
							method: "POST",
							headers: { "content-type": "application/json", "x-dsh-ui-design-token": pageModel.token },
							body: JSON.stringify({ workspaceId: String(workspaceId), sessionId: String(sessionId), ...payload })
						});
					} finally {
						setReloadKey((key) => key + 1);
					}
				};
				const activePage = pageModel?.pages.find((page) => page.entry === pageModel.active) ?? null;
				const [thumbs, setThumbs] = react.useState({});
				const [showPicker, setShowPicker] = react.useState(false);
				const [templates, setTemplates] = react.useState(null);
				react.useEffect(() => {
					if (!pageModel?.token || !workspaceId || !pageModel.pages.length) return undefined;
					let disposed = false;
					const load = async () => {
						const token = pageModel.token;
						const fetchText = async (rel) => {
							try {
								const response = await window.fetch(`${options.routeRoot}/api/file?workspaceId=${encodeURIComponent(String(workspaceId))}&path=${encodeURIComponent(rel)}`, {
									headers: { "x-dsh-ui-design-token": token }
								});
								if (!response.ok) return "";
								const data = await response.json();
								return typeof data.content === "string" ? data.content : "";
							} catch {
								return "";
							}
						};
						const tokensCss = await fetchText("design/design-tokens.css");
						const entries = pageModel.pages.map((page) => page.entry);
						const htmls = await Promise.all(entries.map((entry) => fetchText(entry)));
						if (disposed) return;
						const next = {};
						entries.forEach((entry, index) => {
							next[entry] = buildThumbDoc(htmls[index], tokensCss);
						});
						setThumbs(next);
					};
					void load();
					return () => { disposed = true; };
				}, [pageModel, workspaceId, options.routeRoot, reloadKey]);
				const openTemplatePicker = async () => {
					setShowPicker(true);
					if (templates === null && pageModel?.token && workspaceId) {
						try {
							const response = await window.fetch(`${options.routeRoot}/api/templates?workspaceId=${encodeURIComponent(String(workspaceId))}`, {
								headers: { "x-dsh-ui-design-token": pageModel.token }
							});
							if (response.ok) {
								const items = await response.json();
								setTemplates(items.map((item) => item.manifest));
							}
						} catch {
							// 模板加载失败时弹层内显示空态。
						}
					}
				};
				const applyTemplate = async (templateId) => {
					if (!pageModel?.token || !workspaceId) return;
					try {
						await window.fetch(`${options.routeRoot}/api/template`, {
							method: "POST",
							headers: { "content-type": "application/json", "x-dsh-ui-design-token": pageModel.token },
							body: JSON.stringify({ workspaceId: String(workspaceId), sessionId: String(sessionId), templateId })
						});
					} finally {
						setShowPicker(false);
						setReloadKey((key) => key + 1);
					}
				};

				const pageBar = pageModel && pageModel.pages.length > 0
					? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: pageBarStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: thumbStripStyle,
							children: pageModel.pages.map((page) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: page.entry === pageModel.active ? { ...thumbCardStyle, ...thumbCardActiveStyle } : thumbCardStyle,
								onClick: () => void pageApi({ action: "switch", pageId: page.id }),
								title: page.title,
								children: [
									thumbs[page.entry] ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
										srcDoc: thumbs[page.entry],
										style: thumbFrameStyle,
										sandbox: "",
										tabIndex: -1,
										"aria-hidden": true,
										loading: "lazy"
									}) : /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", { style: thumbPlaceholderStyle }),
									/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: thumbLabelStyle, children: page.title })
								]
							}, page.id))
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: pageIconStyle,
							onClick: () => void openTemplatePicker(),
							title: "新建页面或选择模板",
							"aria-label": "新建页面或选择模板",
							children: "+"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: pageIconStyle,
							disabled: pageModel.pages.length <= 1,
							onClick: () => {
								if (activePage && window.confirm(`移除页面「${activePage.title}」?`)) void pageApi({ action: "remove", pageId: activePage.id });
							},
							title: "移除当前页面",
							"aria-label": "移除当前页面",
							children: "−"
						})]
					})
					: null;
				if (!isDesignMode) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: emptyStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { children: `${options.studioTitle} 仅在设计模式会话中可用` }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "请在会话开始前选择「设计模式」Agent 预设后使用。" })]
				});
				if (!workspace) return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					style: emptyStyle,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("strong", { children: [options.studioTitle, " needs a workspace"] }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "Open this conversation from a registered DeepSeek Harness workspace." })]
				});
				const query = new URLSearchParams({
					workspaceId: String(workspace.workspaceId),
					sessionId: String(sessionId)
				});
				return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
					style: shellStyle,
					"aria-label": `dsh-ui-design ${options.studioTitle}`,
					children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("header", {
						style: headerStyle,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", { children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: eyebrowStyle,
							children: "dsh-ui-design"
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", {
							style: titleStyle,
							children: options.studioTitle
						})] }), pageBar, /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
							type: "button",
							style: buttonStyle,
							onClick: () => inputActions.setDraft([
								`Help me improve the current ${options.studioTitle} document.`,
								"Project: design/",
								"Read manifest.json, then read its entry file and linked design-tokens.css before editing.",
								"Preserve the existing structure unless I request a redesign.",
								"My requested change:"
							].join("\n")),
							children: "Ask AI"
						})]
					}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("iframe", {
						key: reloadKey,
						ref: iframeRef,
						title: `dsh-ui-design ${options.studioTitle}`,
						src: `${options.routeRoot}/studio/?${query.toString()}`,
						style: frameStyle,
						sandbox: "allow-downloads allow-forms allow-modals allow-popups allow-same-origin allow-scripts"
					}), showPicker ? /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: overlayStyle,
						onClick: () => setShowPicker(false),
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: pickerStyle,
							onClick: (event) => event.stopPropagation(),
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
								style: pickerHeadStyle,
								children: "新增页面或应用模板"
							}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: pickerGridStyle,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									style: pickerBlankStyle,
									onClick: () => {
										const title = window.prompt("新页面标题", "New Page");
										if (title && title.trim()) {
											setShowPicker(false);
											void pageApi({ action: "create", title: title.trim() });
										}
									},
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("strong", { style: pickerCardTitleStyle, children: "空白页面" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { style: pickerCardDescStyle, children: "创建不带模板的新页面" })]
								}), templates === null ? /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: pickerLoadingStyle,
									children: "加载模板中…"
								}) : templates.map((template) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(TemplateCard, {
									template,
									token: pageModel?.token,
									workspaceId,
									onApply: () => void applyTemplate(template.id)
								}, template.id))]
							})]
						})]
					}) : null]
				});
			}
			return {
				viewId: options.viewId,
				label: options.label,
				studioTitle: options.studioTitle,
				order: options.order ?? 20,
				component: StudioView
			};
		}
		const designClient = createDeepSeekDesignStudioClient({
			routeRoot: "/dsh-ui-design",
			viewId: "dsh-ui-design-studio",
			label: "Design",
			studioTitle: "UI Design",
			order: 20
		});
		const pptClient = createDeepSeekDesignStudioClient({
			routeRoot: "/dsh-ui-design-ppt",
			viewId: "dsh-ui-design-ppt-studio",
			label: "PPT",
			studioTitle: "DeepSeek iPPT",
			order: 21
		});
		const studioViews = [designClient, pptClient];
		const shellStyle = {
			display: "flex",
			flexDirection: "column",
			width: "100%",
			height: "100%",
			minHeight: 0,
			background: "var(--color-background, #f6f7f9)"
		};
		const headerStyle = {
			display: "flex",
			alignItems: "center",
			justifyContent: "space-between",
			gap: 16,
			minHeight: 62,
			padding: "10px 16px",
			borderBottom: "1px solid color-mix(in srgb, currentColor 12%, transparent)"
		};
		const eyebrowStyle = {
			color: "#70757f",
			fontSize: 10,
			fontWeight: 700,
			letterSpacing: "0.12em",
			textTransform: "uppercase"
		};
		const titleStyle = {
			fontSize: 14,
			lineHeight: 1.3
		};
		const buttonStyle = {
			border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
			borderRadius: 10,
			padding: "8px 13px",
			color: "inherit",
			background: "color-mix(in srgb, currentColor 6%, transparent)",
			font: "inherit",
			fontSize: 12,
			fontWeight: 650,
			cursor: "pointer"
		};
		const pageBarStyle = {
			display: "flex",
			alignItems: "center",
			gap: 6,
			flex: 1,
			justifyContent: "center",
			minWidth: 0,
			padding: "0 12px"
		};
		const pageSelectStyle = {
			maxWidth: 220,
			padding: "6px 8px",
			borderRadius: 8,
			border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
			background: "color-mix(in srgb, currentColor 4%, transparent)",
			color: "inherit",
			font: "inherit",
			fontSize: 12
		};
		const pageIconStyle = {
			width: 26,
			height: 26,
			borderRadius: 8,
			border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
			background: "color-mix(in srgb, currentColor 6%, transparent)",
			color: "inherit",
			font: "inherit",
			fontSize: 14,
			lineHeight: 1,
			cursor: "pointer",
			padding: 0,
			display: "inline-flex",
			alignItems: "center",
			justifyContent: "center"
		};
		const thumbStripStyle = {
			display: "flex",
			alignItems: "center",
			gap: 8,
			overflowX: "auto",
			overflowY: "hidden",
			padding: "2px",
			scrollbarWidth: "thin",
			maxWidth: "100%"
		};
		const thumbCardStyle = {
			flex: "0 0 auto",
			width: 108,
			border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
			borderRadius: 8,
			overflow: "hidden",
			cursor: "pointer",
			background: "color-mix(in srgb, currentColor 4%, transparent)"
		};
		const thumbCardActiveStyle = {
			borderColor: "var(--color-primary, #5b50e6)",
			boxShadow: "0 0 0 1px var(--color-primary, #5b50e6)"
		};
		const thumbFrameStyle = {
			width: "100%",
			height: 56,
			border: 0,
			display: "block",
			pointerEvents: "none",
			background: "#ffffff"
		};
		const thumbPlaceholderStyle = {
			width: "100%",
			height: 56,
			background: "color-mix(in srgb, currentColor 6%, transparent)"
		};
		const thumbLabelStyle = {
			display: "block",
			padding: "3px 6px",
			fontSize: 10,
			lineHeight: 1.2,
			whiteSpace: "nowrap",
			overflow: "hidden",
			textOverflow: "ellipsis"
		};
		const overlayStyle = {
			position: "fixed",
			inset: 0,
			zIndex: 100,
			display: "grid",
			placeItems: "center",
			background: "rgb(0 0 0 / 32%)",
			padding: 32
		};
		const pickerStyle = {
			width: "min(720px, 100%)",
			maxHeight: "min(560px, 80vh)",
			display: "flex",
			flexDirection: "column",
			borderRadius: 14,
			border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
			background: "var(--color-background, #ffffff)",
			color: "inherit",
			boxShadow: "0 24px 70px rgb(0 0 0 / 24%)",
			overflow: "hidden"
		};
		const pickerHeadStyle = {
			padding: "12px 16px",
			fontSize: 13,
			fontWeight: 650,
			borderBottom: "1px solid color-mix(in srgb, currentColor 12%, transparent)"
		};
		const pickerGridStyle = {
			display: "grid",
			gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
			gap: 10,
			padding: 14,
			overflowY: "auto"
		};
		const pickerCardStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 6,
			padding: 0,
			border: "1px solid color-mix(in srgb, currentColor 14%, transparent)",
			borderRadius: 10,
			background: "color-mix(in srgb, currentColor 4%, transparent)",
			color: "inherit",
			font: "inherit",
			textAlign: "left",
			cursor: "pointer",
			overflow: "hidden"
		};
		const pickerCoverStyle = {
			width: "100%",
			height: 84,
			objectFit: "cover",
			display: "block",
			background: "#ffffff"
		};
		const pickerCoverPlaceholderStyle = {
			width: "100%",
			height: 84,
			background: "color-mix(in srgb, currentColor 8%, transparent)"
		};
		const pickerCardTitleStyle = {
			fontSize: 12,
			fontWeight: 650,
			padding: "0 10px"
		};
		const pickerCardDescStyle = {
			fontSize: 11,
			lineHeight: 1.4,
			color: "color-mix(in srgb, currentColor 65%, transparent)",
			padding: "0 10px 10px",
			display: "-webkit-box",
			WebkitLineClamp: 2,
			WebkitBoxOrient: "vertical",
			overflow: "hidden"
		};
		const pickerBlankStyle = {
			display: "flex",
			flexDirection: "column",
			gap: 6,
			padding: 12,
			border: "1px dashed color-mix(in srgb, currentColor 28%, transparent)",
			borderRadius: 10,
			background: "transparent",
			color: "inherit",
			font: "inherit",
			textAlign: "left",
			cursor: "pointer"
		};
		const pickerLoadingStyle = {
			gridColumn: "1 / -1",
			padding: "28px 0",
			textAlign: "center",
			fontSize: 12,
			color: "color-mix(in srgb, currentColor 55%, transparent)"
		};
		const frameStyle = {
			flex: 1,
			width: "100%",
			minHeight: 0,
			border: 0,
			background: "#f6f7f9"
		};
		const emptyStyle = {
			display: "grid",
			placeContent: "center",
			gap: 8,
			height: "100%",
			padding: 32,
			color: "#70757f",
			textAlign: "center"
		};
		//#endregion
		const apply = (ctx) => {
			let registered = null;
			const register = () => {
				if (registered) return;
				registered = studioViews.map((view) => ctx.slots.register({
					name: "conversation.view",
					id: view.viewId,
					order: view.order,
					label: view.label,
					inject: () => ({ sessions: ctx.sessions })
				}, view.component));
			};
			const unregister = () => {
				if (!registered) return;
				for (const dispose of registered) dispose();
				registered = null;
			};
			const sync = () => {
				// 标签跟随「当前活动会话」:只有当前会话是设计模式时才注册,
				// 切到其他模式的会话/回到首页时立即注销——避免其他工作区或
				// 非设计模式会话看到 Design/PPT 标签。
				const list = ctx.sessions.list.getSnapshot();
				const currentId = list?.current;
				const current = currentId === undefined ? undefined : list?.byId?.[currentId];
				const isDesignMode = current?.agentPreset === DESIGN_PRESET_ID;
				if (isDesignMode) register();
				else unregister();
			};
			ctx.effect(() => {
				sync();
				const unsubscribe = ctx.sessions.list.subscribe(sync);
				return () => {
					unsubscribe();
					unregister();
				};
			}, "dsh-ui-design: design-mode view registration");
		};
		exports.apply = apply;
		exports.createDeepSeekDesignStudioClient = createDeepSeekDesignStudioClient;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map